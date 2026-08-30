"""The client itself: a bounded queue, a daemon worker, and nothing in your way.

Everything this client sends is a LOG ENTRY. :meth:`Firstrun.log` is the whole
API; :meth:`Firstrun.event`, :meth:`Firstrun.error` and the level helpers are
convenience helpers that build a CONVENTIONAL entry. They are examples of a good
shape, not a schema: nothing they produce is privileged, and nothing you send
without them is second class.
"""

from __future__ import annotations

import atexit
import os
import random
import ssl
import threading
import time
import uuid
import weakref
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Mapping, NamedTuple, Optional, Tuple

from . import _ids, _spool, _wire
from ._transport import ACCEPTED, REJECTED, TRANSIENT, SendResult, Transport, build_batch

__all__ = [
    "Firstrun",
    "Diagnostic",
    "Stats",
    "IMMEDIATE",
    "INTERVAL",
    "STARTUP",
    "MANUAL",
    "DELIVERY_MODES",
    "MEMORY",
    "DISK",
    "PERSISTENCE_MODES",
]


# ----------------------------------------------------------------------
# The two axes of the delivery policy (docs/delivery-policy.md)
#
# Scheduling and durability look like one setting and are not. The schedule
# decides WHEN a send is attempted; the persistence decides WHAT is still there
# after a crash or a kill. "Send once at startup" is not a schedule on its own:
# it is a schedule that never fires during the run, combined with a queue that
# survives to the next one. Modelled as one setting, that combination cannot be
# expressed at all.
# ----------------------------------------------------------------------

#: Send as soon as a batch can be formed. NOT one request per entry: entries
#: produced in the same tick coalesce, see ``coalesce_delay``.
IMMEDIATE = "immediate"
#: Every ``flush_interval``, or when ``max_batch_size`` is reached. The default.
INTERVAL = "interval"
#: Drain what survived the last run, then never again during this one.
STARTUP = "startup"
#: Only when flush() is called.
MANUAL = "manual"

DELIVERY_MODES = (IMMEDIATE, INTERVAL, STARTUP, MANUAL)

#: The queue lives in this process and dies with it.
MEMORY = "memory"
#: The queue is mirrored to a file and drained on the next start.
DISK = "disk"

PERSISTENCE_MODES = (MEMORY, DISK)

#: What the worker waits when its schedule has no tick of its own. It is woken
#: by a notify, not by this: the number only exists so a thread that somehow
#: misses a notification recovers instead of sleeping forever.
_IDLE_WAIT = 3600.0


class Diagnostic(NamedTuple):
    """One line of diagnostics, handed to the ``diagnostics`` callback.

    Delivered on the background thread. The library never prints it, never logs
    it and never writes to your stdout or stderr: what to do with it is yours.
    """

    kind: str
    message: str
    # Named event_count rather than count: a NamedTuple field called `count`
    # shadows tuple.count, and a diagnostic that is no longer a working tuple is
    # a surprise nobody asked for.
    event_count: int = 0
    error: Optional[BaseException] = None

    def __str__(self) -> str:
        if self.event_count:
            return "%s: %s (%d events)" % (self.kind, self.message, self.event_count)
        return "%s: %s" % (self.kind, self.message)


# Diagnostic kinds.
BATCH_SENT = "batch_sent"
BATCH_RETRYING = "batch_retrying"
BATCH_REJECTED = "batch_rejected"
QUEUE_OVERFLOW = "queue_overflow"
EVENT_REFUSED = "event_refused"
CIRCUIT_OPENED = "circuit_opened"
CIRCUIT_CLOSED = "circuit_closed"
INTERNAL_ERROR = "internal_error"
FORKED = "forked"
CONFIG_COERCED = "config_coerced"
QUEUE_RESTORED = "queue_restored"
QUEUE_PERSISTED = "queue_persisted"


class Stats(NamedTuple):
    """What the client has done so far. Cheap to read, safe from any thread."""

    #: Entries waiting to be sent.
    queued: int
    accepted: int
    dropped_from_overflow: int
    dropped_from_rejection: int
    refused: int
    circuit_open: bool
    consecutive_failures: int


class _Flush:
    """A barrier in the queue: set once everything queued before it has gone."""

    __slots__ = ("event", "sent")

    def __init__(self) -> None:
        self.event = threading.Event()
        self.sent = False


# Every live client, so the fork handler can find them. Weak, so a client the
# host dropped is not kept alive by this.
_LIVE: "weakref.WeakSet[Firstrun]" = weakref.WeakSet()


class Firstrun:
    """The firstrun analytics client.

    **This library is never in your program's critical path.** Every public
    method appends to a bounded in-memory queue and returns. Nothing here blocks
    on the network, nothing here raises into your code, and nothing here writes
    to your stdout or stderr. If the ingest host is unreachable, slow, or
    returning 500s, the worst that happens is that some analytics are lost.

    One instance per process. It owns a daemon thread; making one per request
    would be a thread per request.

    WHEN it sends is two settings, not one (``docs/delivery-policy.md``):
    ``delivery`` is the schedule and ``persistence`` is what survives the
    process. The server defaults are ``interval`` at 15 seconds, in memory, with
    anything at or above ERROR going immediately. Neither setting can buy an
    exemption from the paragraph above.
    """

    def __init__(
        self,
        source_key: str,
        host: str,
        *,
        app_name: Optional[str] = None,
        service_name: Optional[str] = None,
        service_version: Optional[str] = None,
        channel: Optional[str] = None,
        os_name: Optional[str] = None,
        arch: Optional[str] = None,
        locale: Optional[str] = None,
        resource: Optional[Mapping[str, Any]] = None,
        default_attributes: Optional[Mapping[str, Any]] = None,
        test_mode: bool = False,
        min_severity: int = 0,
        distinct_id: Optional[str] = None,
        persist_distinct_id: bool = True,
        track_lifecycle: Optional[bool] = None,
        delivery: str = INTERVAL,
        persistence: str = MEMORY,
        flush_on_severity: Any = _wire.ERROR,
        flush_on_exit: Optional[bool] = None,
        coalesce_delay: float = 0.05,
        persist_interval: float = 5.0,
        queue_path: Optional[str] = None,
        max_disk_entries: Optional[int] = None,
        max_disk_bytes: int = 8 * 1024 * 1024,
        max_queued_entries: int = 10_000,
        max_batch_size: int = 200,
        flush_interval: float = 15.0,
        timeout: float = 10.0,
        retry_base_delay: float = 1.0,
        retry_max_delay: float = 60.0,
        circuit_breaker_threshold: int = 5,
        circuit_breaker_cooldown: float = 300.0,
        diagnostics: Optional[Callable[[Diagnostic], None]] = None,
        enabled: bool = True,
        register_atexit: Optional[bool] = None,
        atexit_timeout: float = 3.0,
        ssl_context: Optional[ssl.SSLContext] = None,
    ) -> None:
        self._diagnostics = diagnostics
        self._lock = threading.Lock()
        self._wake = threading.Condition(self._lock)
        self._queue: Deque[Any] = deque()
        self._queued_entries = 0
        self._closed = False
        self._pid = os.getpid()
        self._thread: Optional[threading.Thread] = None
        self._random = random.Random()
        # One pending wake at a time. A thousand event() calls in a loop must not
        # become a thousand context switches into a worker that has already been
        # told there is work.
        self._wake_pending = False
        # Set by anything that means "send now": flush(), an entry at or above
        # flush_on_severity, the startup drain. A schedule that never fires
        # during the run sends only when this is set.
        self._send_requested = False
        # Bumped whenever the queue changes, so the spool can skip a rewrite
        # that would produce the file it already holds.
        self._queue_version = 0
        self._persisted_version = 0
        self._spool: Optional[_spool.Spool] = None

        self.source_key = source_key or ""
        self.host = (host or "").rstrip("/")

        self._enabled = bool(enabled and self.source_key and self.host)
        if enabled and not (self.source_key and self.host):
            self._report(
                INTERNAL_ERROR,
                "source_key and host are required; this client is disabled and will discard every call",
            )
        elif self._enabled and not _wire.SOURCE_KEY_RE.match(self.source_key):
            # Not fatal: the server is the authority on whether a key resolves.
            # This exists so a typo shows up in diagnostics instead of as silence.
            self._report(INTERNAL_ERROR, "source_key does not look like fr_<16 hex>")

        self.channel = channel
        self.os = os_name if os_name is not None else _wire.os_name()
        self.arch = arch if arch is not None else _wire.arch_name()
        self.locale = locale if locale is not None else _wire.locale_name()

        # The resource: what is true of this PROCESS rather than of one entry.
        # Built once, because none of it changes while the process runs, and
        # sent once per body rather than copied onto every entry.
        named = {
            _wire.ATTR_SERVICE_NAME: service_name,
            _wire.ATTR_SERVICE_VERSION: service_version,
            _wire.ATTR_CHANNEL: channel,
            _wire.ATTR_OS_TYPE: self.os,
            _wire.ATTR_HOST_ARCH: self.arch,
            _wire.ATTR_BROWSER_LANGUAGE: self.locale,
            # A real bool, so it serialises as JSON true rather than "True".
            # The falsy filter below is what keeps it off a production body:
            # production says nothing rather than saying false.
            _wire.ATTR_TEST: bool(test_mode),
        }
        self.resource = _wire.merge_attributes(
            _wire.clean_attributes(resource),
            {k: v for k, v in named.items() if v},
        )

        # Stamped onto every entry: what is true of every entry but is not a
        # property of the process, such as a tenant or a deployment id. An
        # entry's own attributes win over these.
        self.default_attributes = _wire.clean_attributes(default_attributes)

        # Entries the caller CLASSIFIED below this are dropped before queueing.
        # An entry with no severity is unclassified rather than quiet, so it is
        # never dropped here: that would make the threshold a filter on a field
        # the caller did not set.
        self.min_severity = max(0, int(min_severity))

        self.max_queued_entries = max(1, int(max_queued_entries))
        # The server rejects a body carrying more than MAX_ENTRIES_PER_BATCH
        # entries, and a rejected body is dropped rather than retried: a
        # max_batch_size above the cap would mean every request rejected, a queue
        # that never drains, and total silence that looks like a network fault.
        # The cap is read from the wire contract rather than guessed at.
        self.max_batch_size = min(_wire.MAX_ENTRIES_PER_BATCH, max(1, int(max_batch_size)))
        self.flush_interval = max(0.1, float(flush_interval))
        self.timeout = max(0.1, float(timeout))
        self.retry_base_delay = max(0.01, float(retry_base_delay))
        self.retry_max_delay = max(self.retry_base_delay, float(retry_max_delay))
        self.circuit_breaker_threshold = max(1, int(circuit_breaker_threshold))
        self.circuit_breaker_cooldown = max(0.0, float(circuit_breaker_cooldown))

        # --- the delivery policy: two axes, resolved independently ---

        self.delivery = str(delivery or "").lower()
        if self.delivery not in DELIVERY_MODES:
            self._report(
                INTERNAL_ERROR,
                "unknown delivery %r, using %r" % (delivery, INTERVAL),
            )
            self.delivery = INTERVAL

        self.persistence = str(persistence or "").lower()
        if self.persistence not in PERSISTENCE_MODES:
            self._report(
                INTERNAL_ERROR,
                "unknown persistence %r, using %r" % (persistence, MEMORY),
            )
            self.persistence = MEMORY

        # `startup` with `memory` is incoherent: nothing survives the run, so a
        # schedule that only fires at the start of the next one never sends
        # anything at all. Coerced rather than raised, because a constructor here
        # never raises into the host, and silently sending nothing is the worst
        # of the three outcomes.
        if self.delivery == STARTUP and self.persistence == MEMORY:
            self.persistence = DISK
            self._report(
                CONFIG_COERCED,
                "delivery='startup' needs persistence='disk' (nothing survives a memory queue, "
                "so nothing would ever be sent); using disk",
            )

        # At or above this, an entry goes now whatever the schedule says. This is
        # most of the value of having a policy: a crash report that waits for the
        # next tick usually never arrives, because the process is gone by then.
        # None, or anything unresolvable, turns it off.
        self.flush_on_severity: Optional[int] = _wire.resolve_severity(flush_on_severity)

        # True everywhere except `startup`, where it would defeat the mode: the
        # whole point of `startup` is ONE burst per launch, and a flush at exit
        # makes it two and empties the queue the next launch was meant to drain.
        # An explicit value always wins, including True here.
        if flush_on_exit is None:
            self.flush_on_exit = self.delivery != STARTUP
        else:
            self.flush_on_exit = bool(flush_on_exit)
        # How long the worker lets a burst accumulate before sending it, in
        # `immediate`. Zero means one request per wake, which under a loop is one
        # request per entry: that is the mistake this setting exists to stop.
        self.coalesce_delay = max(0.0, float(coalesce_delay))
        self.persist_interval = max(0.1, float(persist_interval))

        if self.persistence == DISK and self._enabled:
            folder = app_name or self.source_key or "default"
            path = queue_path or _spool.resolve_path(folder)
            spool = _spool.Spool(
                path,
                max_entries=int(max_disk_entries) if max_disk_entries else self.max_queued_entries,
                max_bytes=max_disk_bytes,
                on_error=lambda message, exc: self._report(INTERNAL_ERROR, message, error=exc),
            )
            if spool.open():
                self._spool = spool
            else:
                # No usable disk. Falling back to memory keeps ordinary telemetry
                # flowing; `startup` on top of a memory queue would send nothing
                # at all, so that combination falls back to a schedule that does.
                self.persistence = MEMORY
                if self.delivery == STARTUP:
                    self.delivery = INTERVAL
                    if flush_on_exit is None:
                        self.flush_on_exit = True
                    self._report(
                        CONFIG_COERCED,
                        "no writable queue directory; delivery='startup' would send nothing, "
                        "using 'interval' in memory",
                    )
                else:
                    self._report(CONFIG_COERCED, "no writable queue directory; using memory")

        self.queue_path: Optional[str] = self._spool.path if self._spool else None

        self._accepted = 0
        self._dropped_overflow = 0
        self._dropped_rejected = 0
        self._refused = 0
        self._failures = 0
        self._circuit_open = False
        self._circuit_retry_at = 0.0
        self._next_attempt_at = 0.0
        # When the `interval` schedule next fires. Only that schedule has a tick.
        self._next_tick_at = time.monotonic() + self.flush_interval

        # Identity. Anonymous, scoped to this source, never joined to another's.
        self._user_id: Optional[str] = None
        self._session_id = str(uuid.uuid4())

        explicit = _wire.clamp_id(distinct_id)
        self.distinct_id_path: Optional[str] = None
        if explicit is not None:
            self._distinct_id = explicit
            self.is_first_run = False
        elif persist_distinct_id:
            folder = app_name or self.source_key or "default"
            self._distinct_id, self.is_first_run, self.distinct_id_path = _ids.load_or_create(
                folder,
                lambda exc: self._report(INTERNAL_ERROR, "could not persist the anonymous id", error=exc),
            )
        else:
            self._distinct_id = str(uuid.uuid4())
            self.is_first_run = True

        self._transport = Transport(self.host, self.timeout, ssl_context) if self._enabled else None

        if self._enabled:
            _LIVE.add(self)
            self._restore()
            self._ensure_worker()

            # `flush_on_exit` is the policy's name for it. `register_atexit` is
            # the older one and still wins when it is passed, because turning it
            # off is the one thing a caller passed it for.
            register = self.flush_on_exit if register_atexit is None else bool(register_atexit)
            if register:
                # Bound method through a weakref, so registering here does not keep
                # a client the host has dropped alive until interpreter exit.
                ref = weakref.ref(self)
                budget = float(atexit_timeout)

                def _at_exit() -> None:
                    client = ref()
                    if client is not None:
                        client.close(timeout=budget)

                atexit.register(_at_exit)
                self._atexit = _at_exit

        # Off unless asked for. It used to default on when the key's middle
        # segment said "desktop" or "mobile"; a source has no such segment and no
        # kind, so the client cannot know whether app_install and app_launch mean
        # anything here. An app that wants them passes track_lifecycle=True.
        lifecycle = bool(track_lifecycle)
        if lifecycle and self._enabled:
            if self.is_first_run:
                self.event(_wire.APP_INSTALL)
            self.event(_wire.APP_LAUNCH)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        """False when the client was misconfigured, disabled, or closed. It still accepts every call."""
        return self._enabled and not self._closed

    @property
    def distinct_id(self) -> str:
        """The anonymous per-install id being sent. Not a person, not joined to anything."""
        return self._distinct_id

    @property
    def user_id(self) -> Optional[str]:
        """The id the host passed to :meth:`identify`, or None."""
        return self._user_id

    @property
    def session_id(self) -> str:
        """The current session id. Rotated by :meth:`new_session` and :meth:`reset`."""
        return self._session_id

    def stats(self) -> Stats:
        """Counters, for a health endpoint or a debug screen."""
        with self._lock:
            return Stats(
                queued=self._queued_entries,
                accepted=self._accepted,
                dropped_from_overflow=self._dropped_overflow,
                dropped_from_rejection=self._dropped_rejected,
                refused=self._refused,
                circuit_open=self._circuit_open,
                consecutive_failures=self._failures,
            )

    # ------------------------------------------------------------------
    # The API. None of these block, and none of these raise.
    # ------------------------------------------------------------------

    def log(
        self,
        name: str,
        *,
        body: Optional[str] = None,
        severity: Any = None,
        attributes: Optional[Mapping[str, Any]] = None,
        distinct_id: Optional[str] = None,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        timestamp: Optional[float] = None,
        trace_id: Optional[str] = None,
        span_id: Optional[str] = None,
    ) -> None:
        """Record one log entry. Returns immediately; never raises.

        **This is the whole API.** :meth:`event`, :meth:`error` and the level
        helpers are convenience helpers that call this one with the conventional
        fields filled in. There is nothing they can produce that you cannot write
        here by hand, and nothing they produce is privileged.

        ``name`` is any string matching the server's entry-name rule. There is no
        allowlist and no special-casing anywhere in the system:
        ``log("exported_csv")`` and ``log("page_view")`` are the same kind of
        thing to everything downstream.

        ``severity`` is 1..24 on the OpenTelemetry ladder, a name like ``"warn"``
        or ``"ERROR2"``, or a ``logging`` level. Leave it out when you have
        nothing to say: an entry with no severity is honestly unclassified, and
        one silently filed as INFO is a lie a filter will act on.

        ``attributes`` is everything else. The backend does not know what any key
        means, which is the point: a closed set of columns is a closed set of
        questions. The ``ATTR_*`` names in this package are the conventional
        spellings, so two projects that mean the same thing agree.

        ``distinct_id`` and ``user_id`` override this client's own for one call,
        which is what a server wants: the anonymous id belongs to the request,
        not to the box the process runs on.

        ``timestamp`` is seconds since the epoch, for something you are recording
        after the fact. It is authoritative on the server, so an entry that
        happened on Friday and is sent on Monday is a Friday entry.
        """
        try:
            if self._closed or not self._enabled:
                with self._lock:
                    self._refused += 1
                return

            if not _wire.is_log_name(name):
                with self._lock:
                    self._refused += 1
                self._report(EVENT_REFUSED, "invalid entry name")
                return

            resolved_severity = _wire.resolve_severity(severity)
            if resolved_severity is not None and resolved_severity < self.min_severity:
                return

            resolved_distinct = _wire.clamp_id(distinct_id) or self._distinct_id
            resolved_user = _wire.clamp_id(user_id) or self._user_id
            resolved_session = _wire.clamp_id(session_id) or self._session_id

            if not resolved_distinct:
                with self._lock:
                    self._refused += 1
                self._report(EVENT_REFUSED, "no distinct id")
                return

            # Identity sits UNDER the caller's own attributes, so an entry that
            # names `user.id` explicitly wins over the client-level default.
            # Anything else would make a per-call override silently ineffective.
            identity: Dict[str, Any] = {}
            if resolved_user:
                identity[_wire.ATTR_USER_ID] = resolved_user
            if resolved_session:
                identity[_wire.ATTR_SESSION_ID] = resolved_session

            # `body`, `trace_id` and `span_id` are attributes, not columns: this
            # product promotes five columns and no more, and the spec's
            # vocabulary is not ours to promote. The dedicated argument wins over
            # a same-named attribute, because naming it is the more specific
            # statement.
            spec: Dict[str, Any] = {}
            clamped_body = _wire.clamp_body(body)
            if clamped_body is not None:
                spec[_wire.ATTR_BODY] = clamped_body
            clamped_trace = _wire.clamp_id(trace_id)
            if clamped_trace is not None:
                spec[_wire.ATTR_TRACE_ID] = clamped_trace
            clamped_span = _wire.clamp_id(span_id)
            if clamped_span is not None:
                spec[_wire.ATTR_SPAN_ID] = clamped_span

            merged = _wire.merge_attributes(
                self.default_attributes,
                identity,
                _wire.clean_attributes(attributes),
                spec,
            )

            entry: Dict[str, Any] = {
                # Generated here so a send that timed out can be retried and the
                # server can dedup on the id rather than double-count.
                "i": str(uuid.uuid4()),
                "t": _wire.now_ms() if timestamp is None else int(float(timestamp) * 1000),
                "n": name,
            }
            if resolved_severity is not None:
                entry["s"] = resolved_severity
            if merged:
                entry["a"] = merged

            # `flush_on_severity` cuts across the schedule rather than replacing
            # it: the entry joins the same queue and the same batch, and the only
            # difference is that the worker is told now instead of at the next
            # tick. It still does not block, still does not throw, and still
            # cannot send while the breaker is open.
            urgent = (
                self.flush_on_severity is not None
                and resolved_severity is not None
                and resolved_severity >= self.flush_on_severity
            )
            self._enqueue((resolved_distinct, entry), urgent=urgent)

        except BaseException as exc:  # noqa: BLE001 - the whole point of this method
            # The contract is that log never raises. That has to hold even for
            # the failures we did not think of.
            try:
                with self._lock:
                    self._refused += 1
                self._report(INTERNAL_ERROR, "could not queue an entry", error=exc)
            except BaseException:
                pass

    def event(
        self,
        name: str,
        attributes: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """A conventional product event: any name you like, at INFO.

        One call to :meth:`log` with the conventional fields filled in. An
        example of a good shape, not a schema.
        """
        kwargs.setdefault("severity", _wire.INFO)
        self.log(name, attributes=attributes, **kwargs)

    def error(
        self,
        error: BaseException,
        attributes: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """A conventional exception entry, at ERROR.

        The single most valuable helper here, because it does the unwrapping the
        caller would otherwise do at every ``except`` site: the class name, the
        message, and the formatted traceback including any ``__cause__`` chain,
        as ``exception.type``, ``exception.message`` and
        ``exception.stacktrace``.

        The name is ``exception`` for every one of them and the attributes say
        what happened, which is OpenTelemetry's shape. It means "all exceptions"
        is one name and "this exception" is a filter on a path, rather than a
        thousand names nobody can enumerate.

        This is a log entry like every other one. There is no error table and no
        error pipeline: it is only an error because of its severity and its
        attributes.
        """
        if isinstance(error, BaseException):
            unwrapped = _wire.exception_attributes(error)
        else:
            # A caller who passed a string rather than an exception still gets an
            # entry worth having: something failed here.
            text = str(error)
            unwrapped = {
                _wire.ATTR_EXCEPTION_TYPE: type(error).__name__,
                _wire.ATTR_EXCEPTION_MESSAGE: text[: _wire.MAX_ATTRIBUTE_STRING],
            }

        kwargs.setdefault("severity", _wire.ERROR)
        kwargs.setdefault("body", unwrapped.get(_wire.ATTR_EXCEPTION_MESSAGE) or None)
        self.log(
            _wire.EXCEPTION,
            attributes=_wire.merge_attributes(unwrapped, _wire.clean_attributes(attributes)),
            **kwargs
        )

    def trace(self, body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
        """A line at TRACE."""
        self._line(_wire.TRACE, body, attributes, kwargs)

    def debug(self, body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
        """A line at DEBUG."""
        self._line(_wire.DEBUG, body, attributes, kwargs)

    def info(self, body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
        """A line at INFO."""
        self._line(_wire.INFO, body, attributes, kwargs)

    def warn(self, body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
        """A line at WARN."""
        self._line(_wire.WARN, body, attributes, kwargs)

    def error_log(self, body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
        """A line at ERROR with no exception to unwrap.

        :meth:`error` is taken by the helper that unwraps a thrown thing, which
        is the one worth the shorter name. This is for the case where you have a
        sentence and no exception.
        """
        self._line(_wire.ERROR, body, attributes, kwargs)

    def fatal(self, body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
        """A line at FATAL."""
        self._line(_wire.FATAL, body, attributes, kwargs)

    def _line(
        self,
        severity: int,
        body: str,
        attributes: Optional[Mapping[str, Any]],
        kwargs: Dict[str, Any],
    ) -> None:
        # A free-form line still needs a name, because `name` is the column a
        # dashboard groups on. `log` is this client's convention for "a line, not
        # an occurrence of a thing"; pass your own name to `log()` for anything
        # you want to count.
        kwargs.setdefault("severity", severity)
        self.log(_wire.LOG, body=body, attributes=attributes, **kwargs)

    def page(
        self,
        path: str,
        attributes: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """A server-rendered page view.

        The path travels as the conventional ``url.path`` attribute. There is no
        url column: everything that is not one of the five promoted columns lives
        in attributes and is queried from there.
        """
        bag: Dict[str, Any] = dict(attributes or {})
        if path:
            bag[_wire.ATTR_URL_PATH] = path
        self.event(_wire.PAGE_VIEW, bag, **kwargs)

    def identify(self, user_id: Optional[str], attributes: Optional[Mapping[str, Any]] = None) -> None:
        """Attach the customer's own user id to everything sent from now on.

        This is the only way a ``user.id`` ever appears. Nothing is inferred,
        nothing is merged, and this source is never linked to another source's
        ids. Pass None to go back to anonymous.
        """
        clamped = _wire.clamp_id(user_id)
        self._user_id = clamped
        if clamped is not None:
            self.event(_wire.IDENTIFY, attributes)

    def reset(self) -> None:
        """Forget the user id and start a new session.

        The anonymous id is kept: it belongs to this installation, not to
        whoever was signed in.
        """
        self._user_id = None
        self.new_session()

    def new_session(self) -> str:
        """Start a new session id without touching the user id."""
        self._session_id = str(uuid.uuid4())
        return self._session_id

    def flush(self, timeout: Optional[float] = None) -> bool:
        """Ask the worker to send now.

        With no timeout this returns immediately and the send happens on the
        background thread. With a timeout it waits at most that long for
        everything queued before this call to reach the server, and returns
        whether it did.

        **You never have to call this.** It exists for a program about to exit
        that would rather not lose the last few events. A False return means the
        events are still queued, not that anything broke.
        """
        if not self._enabled or self._closed:
            return False

        if timeout is None:
            with self._wake:
                self._request_send_locked()
            self._ensure_worker()
            return True

        marker = _Flush()
        try:
            with self._wake:
                self._queue.append(marker)
                self._request_send_locked()
            self._ensure_worker()
            if not marker.event.wait(max(0.0, float(timeout))):
                return False
            return marker.sent
        except BaseException as exc:  # noqa: BLE001
            self._report(INTERNAL_ERROR, "flush failed", error=exc)
            return False

    async def aflush(self, timeout: float = 3.0) -> bool:
        """:meth:`flush` off the event loop, for an async program.

        The queue is already non-blocking, so there is no async transport here
        and no second implementation to keep in step: this is the blocking wait
        moved onto a worker thread so it does not stall the loop.
        """
        import asyncio

        return await asyncio.get_running_loop().run_in_executor(None, self.flush, timeout)

    def close(self, timeout: float = 3.0) -> bool:
        """Flush with a bounded wait, then stop the worker. Never raises, never hangs.

        The flush is `flush_on_exit`: best effort and TIME-BOUNDED, because a
        slow network must not be able to hold the process open. With
        ``flush_on_exit=False`` this still stops the worker and still persists a
        disk queue; it just does not try to send first.
        """
        if self._closed:
            return True
        sent = False
        try:
            if self._enabled and self.flush_on_exit:
                sent = self.flush(timeout)
        except BaseException:
            sent = False

        self._closed = True
        try:
            with self._wake:
                self._wake.notify_all()
            thread = self._thread
            if thread is not None and thread.is_alive() and thread is not threading.current_thread():
                # A daemon thread: if it is stuck in a socket read the process
                # still exits. Joining briefly is a courtesy, not a requirement.
                thread.join(min(1.0, max(0.0, float(timeout))))
        except BaseException:
            pass

        self._release_markers(False)
        # After the worker has stopped, so this is the last word on what was
        # left over and there is nobody to race with for the file.
        try:
            self._persist()
        except BaseException:
            pass
        return sent

    # ``shutdown`` reads better at the bottom of a script than ``close``.
    shutdown = close

    def __enter__(self) -> "Firstrun":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    async def __aenter__(self) -> "Firstrun":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    async def aclose(self, timeout: float = 3.0) -> None:
        """:meth:`close` off the event loop."""
        import asyncio

        await asyncio.get_running_loop().run_in_executor(None, self.close, timeout)

    # ------------------------------------------------------------------
    # The queue
    # ------------------------------------------------------------------

    def _enqueue(self, item: Tuple[str, Dict[str, Any]], urgent: bool = False) -> None:
        dropped = 0
        with self._wake:
            self._queue.append(item)
            self._queued_entries += 1
            self._queue_version += 1
            # Full queue drops the OLDEST. A program that has been offline for a
            # week should report this week's behaviour, not the first ten
            # thousand events after the outage started.
            while self._queued_entries > self.max_queued_entries:
                if not self._drop_oldest_locked():
                    break
                dropped += 1
            if dropped:
                self._dropped_overflow += dropped

            # Whether this entry means "send", by the schedule or in spite of it.
            # `startup` and `manual` have no answer to give here: neither fires
            # during the run, so only an urgent entry or flush() wakes them.
            ready = urgent or self.delivery == IMMEDIATE or (
                self.delivery == INTERVAL and self._queued_entries >= self.max_batch_size
            )
            if ready:
                self._request_send_locked()

        if dropped:
            self._report(QUEUE_OVERFLOW, "queue full, dropped the oldest", count=dropped)

        self._ensure_worker()

    def _request_send_locked(self) -> None:
        """Ask the worker to send. Call with the lock held.

        Two things stop this from being a wake per entry. The pending flag means
        a burst notifies once rather than once each, which is what keeps
        `immediate` at a handful of requests for a thousand events instead of a
        thousand. The backoff check means a wake is not even scheduled while the
        breaker is open or a retry delay is running: the worker would refuse to
        send anyway, and a timer that fires on schedule regardless of outcome is
        the spin the reliability rules forbid.
        """
        self._send_requested = True
        if self._wake_pending:
            return
        if self._circuit_open or time.monotonic() < self._next_attempt_at:
            return
        self._wake_pending = True
        self._wake.notify_all()

    def _drop_oldest_locked(self) -> bool:
        for index, value in enumerate(self._queue):
            if not isinstance(value, _Flush):
                del self._queue[index]
                self._queued_entries -= 1
                return True
        return False

    def _requeue_front_locked(self, items: List[Tuple[str, Dict[str, Any]]]) -> int:
        dropped = 0
        for item in reversed(items):
            self._queue.appendleft(item)
            self._queued_entries += 1
        while self._queued_entries > self.max_queued_entries:
            if not self._drop_oldest_locked():
                break
            dropped += 1
        self._dropped_overflow += dropped
        return dropped

    def _release_markers(self, sent: bool) -> None:
        markers: List[_Flush] = []
        with self._lock:
            remaining: Deque[Any] = deque()
            for value in self._queue:
                if isinstance(value, _Flush):
                    markers.append(value)
                else:
                    remaining.append(value)
            self._queue = remaining
        for marker in markers:
            marker.sent = sent
            marker.event.set()

    # ------------------------------------------------------------------
    # The worker
    # ------------------------------------------------------------------

    def _ensure_worker(self) -> None:
        """Start the worker if there is not one. Also the recovery path after a fork."""
        if not self._enabled or self._closed:
            return
        thread = self._thread
        if thread is not None and thread.is_alive():
            return
        with self._lock:
            thread = self._thread
            if thread is not None and thread.is_alive():
                return
            self._thread = threading.Thread(
                target=self._run,
                name="firstrun-sender",
                # Daemon, so a program that exits without closing us still exits.
                daemon=True,
            )
            self._thread.start()

    def _run(self) -> None:
        try:
            while not self._closed:
                with self._wake:
                    # Only wait when waiting is the right answer. A send asked
                    # for while we were backing off is not a reason to spin: it
                    # is a reason to sleep exactly as long as the delay has left.
                    if not self._ready_to_send_locked():
                        self._wake.wait(self._wait_seconds())
                    self._wake_pending = False
                    # A wake is not the same thing as a tick. The worker is also
                    # woken to rewrite the spool, and answering that with a send
                    # would quietly turn `interval` into `immediate` for anyone
                    # who asked for a disk queue.
                    send = self._send_requested or (
                        self.delivery == INTERVAL and time.monotonic() >= self._next_tick_at
                    )
                if self._closed:
                    break

                if send:
                    if self.delivery == IMMEDIATE and self.coalesce_delay:
                        # THIS is what makes `immediate` mean "do not wait for a
                        # timer" rather than "one request per entry". A loop
                        # calling event() a thousand times wakes this thread once
                        # and then keeps appending while we are asleep here, so
                        # what we pick up is one batch of a thousand rather than
                        # a thousand batches of one. It costs the caller nothing:
                        # the sleep is on this thread and log() never waits on it.
                        time.sleep(self.coalesce_delay)
                    # Drain the whole backlog rather than one batch per wake. A
                    # queue of ten thousand behind a fifteen second tick would
                    # otherwise take an hour to leave.
                    while self._drain_once():
                        if self._closed:
                            break
                    self._next_tick_at = time.monotonic() + self.flush_interval

                self._persist()
        except BaseException as exc:  # noqa: BLE001
            self._report(INTERNAL_ERROR, "sender thread stopped", error=exc)
        finally:
            # Nobody is left to complete these, and a caller blocked in flush
            # should get its answer rather than its timeout.
            try:
                self._release_markers(False)
            except BaseException:
                pass

    def _ready_to_send_locked(self) -> bool:
        """A send is owed and nothing is holding it back. Call with the lock held."""
        if not self._send_requested:
            return False
        now = time.monotonic()
        if self._circuit_open and now < self._circuit_retry_at:
            return False
        return now >= self._next_attempt_at

    def _wait_seconds(self) -> float:
        now = time.monotonic()

        # The schedule's own tick. Only `interval` has one: `immediate` is woken
        # by the entry, and `startup` and `manual` are woken by flush() or by an
        # entry at or above flush_on_severity. The idle number is a backstop
        # against a lost notification, not a schedule.
        wait = max(0.0, self._next_tick_at - now) if self.delivery == INTERVAL else _IDLE_WAIT

        # Retrying, or the breaker is open. A timer must NOT fire on schedule
        # while either is true: back off instead, and come back exactly when the
        # delay expires if something is already waiting to go.
        resume = self._next_attempt_at
        if self._circuit_open:
            resume = max(resume, self._circuit_retry_at)
        if resume > now:
            wait = (resume - now) if self._send_requested else max(wait, resume - now)

        # A disk queue is rewritten on its own cadence, so a run that never sends
        # (`startup`, `manual`, or an outage) still leaves something behind for
        # the next one. Persisting is not sending: this wake writes a file and
        # does not touch the network.
        if self._spool is not None:
            wait = min(wait, self.persist_interval)
        return max(0.0, wait)

    def _drain_once(self) -> bool:
        """Send at most one batch per group. True when there is more to send."""
        now = time.monotonic()

        if self._circuit_open:
            if now < self._circuit_retry_at:
                return False
            # Half open: let exactly one pass through. If it fails, the failure
            # count is still over the threshold, so the circuit opens again.
            self._circuit_open = False
            self._report(CIRCUIT_CLOSED, "circuit half open, probing")

        if now < self._next_attempt_at:
            return False

        entries: List[Tuple[str, Dict[str, Any]]] = []
        markers: List[_Flush] = []
        with self._lock:
            # Consumed here rather than at the wake, so a request that arrived
            # while we were backing off is still standing when the delay expires.
            self._send_requested = False
            while self._queue and len(entries) < self.max_batch_size:
                value = self._queue.popleft()
                if isinstance(value, _Flush):
                    markers.append(value)
                else:
                    entries.append(value)
                    self._queued_entries -= 1
            # A marker immediately behind the batch limit still only guarantees
            # what was queued before it, and all of that is in this batch.
            while self._queue and isinstance(self._queue[0], _Flush):
                markers.append(self._queue.popleft())
            if entries:
                self._queue_version += 1

        if not entries:
            for marker in markers:
                marker.sent = True
                marker.event.set()
            return False

        all_sent = True
        settled: List[Tuple[str, Dict[str, Any]]] = []

        for group in _group(entries, self.max_batch_size):
            distinct_id = group[0][0]
            body = build_batch(
                self.source_key,
                distinct_id,
                self.resource,
                [item[1] for item in group],
            )

            assert self._transport is not None
            result: SendResult = self._transport.send(body)

            if result.outcome == ACCEPTED:
                with self._lock:
                    self._accepted += len(group)
                settled.extend(group)
                self._on_success()
                continue

            if result.outcome == REJECTED:
                with self._lock:
                    self._dropped_rejected += len(group)
                settled.extend(group)
                self._report(BATCH_REJECTED, "server rejected a batch: " + result.detail, count=len(group))
                # A rejection is a working connection, so it is not a transport
                # failure and must not push the circuit towards open.
                self._on_success()
                continue

            self._on_failure(result)
            all_sent = False
            break

        if not all_sent:
            settled_ids = {item[1]["i"] for item in settled}
            remaining = [item for item in entries if item[1]["i"] not in settled_ids]
            with self._lock:
                dropped = self._requeue_front_locked(remaining)
                # Still owed a send, so the next wake is the retry delay expiring
                # rather than an hour of idling in a schedule with no tick.
                self._send_requested = True
            if dropped:
                self._report(QUEUE_OVERFLOW, "queue full while retrying, dropped the oldest", count=dropped)

        for marker in markers:
            marker.sent = all_sent
            marker.event.set()

        if not all_sent:
            return False
        with self._lock:
            return self._queued_entries > 0

    # ------------------------------------------------------------------
    # The durable half of the queue
    # ------------------------------------------------------------------

    def _restore(self) -> None:
        """Take back whatever the last run did not manage to send."""
        spool = self._spool
        if spool is None:
            return
        try:
            items = spool.load()
        except BaseException as exc:  # noqa: BLE001
            self._report(INTERNAL_ERROR, "could not restore the queued entries", error=exc)
            return
        if not items:
            return

        dropped = 0
        with self._wake:
            # In front of anything this run has produced: they are older, and
            # `time` is stamped at log() rather than at send, so an entry from
            # last Friday is still a Friday entry however late it arrives.
            for item in reversed(items):
                self._queue.appendleft(item)
                self._queued_entries += 1
            self._queue_version += 1
            while self._queued_entries > self.max_queued_entries:
                if not self._drop_oldest_locked():
                    break
                dropped += 1
            self._dropped_overflow += dropped
            # `startup` fires exactly here and nowhere else in the run. Every
            # other schedule gets these as a head start on its own next send.
            self._request_send_locked()

        self._report(QUEUE_RESTORED, "restored entries from the last run", count=len(items) - dropped)
        if dropped:
            self._report(QUEUE_OVERFLOW, "queue full while restoring, dropped the oldest", count=dropped)

    def _persist(self) -> None:
        """Mirror what is still pending to disk. Called on the worker, and at close."""
        spool = self._spool
        if spool is None:
            return
        with self._lock:
            version = self._queue_version
            if version == self._persisted_version:
                return
            items = [value for value in self._queue if not isinstance(value, _Flush)]
        try:
            dropped = spool.save(items)
        except BaseException as exc:  # noqa: BLE001
            self._report(INTERNAL_ERROR, "could not persist the queued entries", error=exc)
            return
        self._persisted_version = version
        if dropped:
            self._report(QUEUE_OVERFLOW, "disk queue full, dropped the oldest", count=dropped)
        elif items:
            self._report(QUEUE_PERSISTED, "queued entries written to disk", count=len(items))

    def _on_success(self) -> None:
        with self._lock:
            previous = self._failures
            self._failures = 0
        self._next_attempt_at = 0.0
        if previous:
            self._report(BATCH_SENT, "recovered after %d failures" % previous)

    def _on_failure(self, result: SendResult) -> None:
        with self._lock:
            self._failures += 1
            failures = self._failures

        # Capped exponential with equal jitter: half the delay is fixed so it
        # still grows, half is random so a thousand clients that went offline
        # together do not come back in lockstep and finish the outage for us.
        delay = min(self.retry_max_delay, self.retry_base_delay * (2 ** min(failures - 1, 20)))
        delay = delay / 2 + self._random.random() * (delay / 2)
        if result.retry_after is not None:
            delay = max(delay, min(result.retry_after, self.retry_max_delay * 5))

        self._next_attempt_at = time.monotonic() + delay
        self._report(BATCH_RETRYING, "send failed (%s), retrying in %.1fs" % (result.detail, delay))

        if failures >= self.circuit_breaker_threshold and not self._circuit_open:
            self._circuit_open = True
            self._circuit_retry_at = time.monotonic() + self.circuit_breaker_cooldown
            self._report(
                CIRCUIT_OPENED,
                "giving up for %.0fs after %d consecutive failures" % (self.circuit_breaker_cooldown, failures),
            )

    # ------------------------------------------------------------------
    # fork
    # ------------------------------------------------------------------

    def _after_fork_in_child(self) -> None:
        """Rebuild everything a fork broke.

        ``os.fork`` copies the memory but only the calling thread. So in the
        child the sender thread does not exist, and the lock it was holding at
        the moment of the fork is copied in its locked state, which would
        deadlock the first ``track()`` the child makes. Both are replaced here
        rather than reused.

        The queue is dropped rather than inherited: parent and child both
        holding the same pending events would send each of them twice. Anything
        unsent at the moment of the fork stays with the parent, which still has
        a live worker for it.

        The anonymous id is kept. It describes the installation, and a fork does
        not make a second installation.

        The spool goes too. One file cannot have two writers: parent and child
        would take turns rewriting it with their own idea of what is pending, and
        whichever wrote last would erase the other's entries. The child therefore
        runs in memory, which is also the default for a server. This is why a
        pre-forked server should configure after the fork if it wants a disk
        queue per worker, each with its own ``queue_path``.
        """
        self._lock = threading.Lock()
        self._wake = threading.Condition(self._lock)
        self._queue = deque()
        self._queued_entries = 0
        self._thread = None
        self._pid = os.getpid()
        self._failures = 0
        self._circuit_open = False
        self._circuit_retry_at = 0.0
        self._next_attempt_at = 0.0
        self._next_tick_at = time.monotonic() + self.flush_interval
        self._wake_pending = False
        self._send_requested = False
        self._queue_version = 0
        self._persisted_version = 0
        forked_from_disk = self._spool is not None
        if forked_from_disk:
            self._spool = None
            self.persistence = MEMORY
            self.queue_path = None
            if self.delivery == STARTUP:
                # `startup` over a memory queue sends nothing, ever. The child
                # would be silent for its whole life.
                self.delivery = INTERVAL
        # A fresh session: the child is a different run of the program.
        self._session_id = str(uuid.uuid4())
        # urllib holds no socket between calls, but the opener was built before
        # the fork and a child sharing it with the parent is not worth the doubt.
        if self._enabled:
            self._transport = Transport(self.host, self.timeout)
        if forked_from_disk:
            self._report(
                FORKED,
                "reinitialised after fork; the parent keeps its queued events and its disk queue, "
                "this child sends from memory",
            )
        else:
            self._report(FORKED, "reinitialised after fork; the parent keeps its queued events")

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def _report(
        self,
        kind: str,
        message: str,
        count: int = 0,
        error: Optional[BaseException] = None,
    ) -> None:
        sink = self._diagnostics
        if sink is None:
            return
        try:
            sink(Diagnostic(kind, message, count, error))
        except BaseException:
            # A diagnostics callback that raises is the host's bug, and it is
            # still not allowed to become our crash.
            pass


def _group(
    entries: List[Tuple[str, Dict[str, Any]]],
    max_batch: int,
) -> List[List[Tuple[str, Dict[str, Any]]]]:
    """Group by distinct id, because that sits on the batch, not on the entry.

    The resource is the only other thing on the batch and it does not change
    while the process runs, so it is not part of the key. ``user.id`` and
    ``session.id`` are per-entry attributes in the log model and do not split a
    batch: a server handling many people at once therefore sends one request per
    person per flush, which is a property of the wire contract rather than a
    choice this client makes.

    Order within a group is preserved, and groups keep the order their first
    entry appeared in.
    """
    order: List[str] = []
    buckets: Dict[str, List[Tuple[str, Dict[str, Any]]]] = {}
    for item in entries:
        key = item[0]
        bucket = buckets.get(key)
        if bucket is None:
            bucket = []
            buckets[key] = bucket
            order.append(key)
        bucket.append(item)

    out: List[List[Tuple[str, Dict[str, Any]]]] = []
    for key in order:
        bucket = buckets[key]
        for start in range(0, len(bucket), max_batch):
            out.append(bucket[start : start + max_batch])
    return out


def _after_fork() -> None:
    for client in list(_LIVE):
        try:
            client._after_fork_in_child()
        except BaseException:
            pass


# POSIX only. On Windows there is no fork, and there is no hook to register.
if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_after_fork)
