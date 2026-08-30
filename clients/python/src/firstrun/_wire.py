"""Shapes shared with the server: source keys, entry names, the severity ladder,
the attribute bounds, and the exact strings ``os.type`` and ``host.arch`` are
spelled with.

Nothing here talks to the network or keeps state. It is the half of the client
that has to agree with ``packages/schema/src`` exactly.

One shape for everything
------------------------

There is no event type, no error type and no metric type. There is a LOG ENTRY.
An error is an entry with a high severity and ``exception.*`` attributes; a
product event is an entry with a name; a measurement is an entry carrying
``firstrun.metric`` and ``firstrun.value``. Meaning is assigned by convention
when it is written and by query when it is read, never by a closed set of types
in the backend.
"""

from __future__ import annotations

import datetime as _datetime
import locale as _locale
import math
import platform
import re
import time
from typing import Any, Dict, List, Mapping, Optional

#: The five surfaces. Closed list, from ``packages/schema/src/surface.ts``.
SURFACES = ("web", "desktop", "mobile", "server", "other")

#: ``fr_<surface>_<16 chars>``. Public by necessity, authorises nothing.
SOURCE_KEY_RE = re.compile(r"^fr_(web|desktop|mobile|server|other)_[0-9a-z]{16}$")

#: The server's entry-name rule. There is no allowlist anywhere in the system.
#:
#: ``:`` and ``>`` are excluded on purpose: they delimit the parts of a
#: dashboard's snapshot keys (``c:page_view:uniques``, ``f:a>b>c:7``), so a name
#: containing one could forge a key of a different shape. Keep this in step with
#: the server regex.
LOG_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,127}$")

LOG_NAME_MAX = 128
ID_MAX = 512

#: The one ingestion path. Every body shape goes to it.
INGEST_PATH = "/v1/e"

#: ``LogBatch.entries`` is bounded. A larger body is rejected whole.
MAX_ENTRIES_PER_BATCH = 500

# ---------------------------------------------------------------------------
# Attribute bounds
# ---------------------------------------------------------------------------

# The bounds the edge enforces, mirrored here so one oversized attribute costs
# itself rather than costing the whole batch its existence. The edge rejects a
# body that breaks any of these, and a rejected body is a permanent failure that
# takes every entry in it down with it.
MAX_ATTRIBUTES = 64
MAX_ATTRIBUTE_DEPTH = 4
MAX_ATTRIBUTE_KEY = 128
MAX_ATTRIBUTE_STRING = 4096
MAX_ATTRIBUTE_ITEMS = 128

#: The longest ``body`` this client will send. Truncated, never dropped.
MAX_BODY = 16_384

# ---------------------------------------------------------------------------
# Severity
# ---------------------------------------------------------------------------

# The OpenTelemetry severity ladder: twenty-four numbers in six bands of four.
#
# The number is authoritative and is what the server stores; text is derived from
# it for display and never travels. Two entries that sorted differently because
# one said "warn" and the other said "WARNING" would be a bug nobody could see.
#
# The three spare steps inside each band exist so a program whose logger already
# has nine levels can map onto this without losing the ordering: ``WARN + 1`` is
# a slightly worse warning and still filters as a warning.
TRACE = 1
DEBUG = 5
INFO = 9
WARN = 13
ERROR = 17
FATAL = 21

SEVERITY_MIN = 1
SEVERITY_MAX = 24

_BANDS = (("TRACE", TRACE), ("DEBUG", DEBUG), ("INFO", INFO), ("WARN", WARN), ("ERROR", ERROR), ("FATAL", FATAL))

#: The spellings people already have in their loggers, mapped onto a band.
_ALIASES = {
    "VERBOSE": TRACE,
    "FINER": TRACE,
    "FINEST": TRACE,
    "FINE": DEBUG,
    "NOTICE": INFO,
    "INFORMATION": INFO,
    "INFORMATIONAL": INFO,
    "WARNING": WARN,
    "ERR": ERROR,
    "SEVERE": ERROR,
    "CRIT": FATAL,
    "CRITICAL": FATAL,
    "ALERT": FATAL,
    "EMERG": FATAL,
    "EMERGENCY": FATAL,
    "PANIC": FATAL,
}

#: What ``logging`` calls a level, so a handler can map straight across.
STDLIB_LEVELS = {10: DEBUG, 20: INFO, 30: WARN, 40: ERROR, 50: FATAL}

_SEVERITY_TEXT_RE = re.compile(r"^([A-Za-z]+)([1-4])?$")


def severity_number(text: Any) -> Optional[int]:
    """A severity name back to its number, or None when it is not one of ours.

    None rather than a default, because guessing a severity is worse than having
    none: an entry with no severity is honestly unclassified, and one silently
    filed as INFO is a lie a filter will act on.
    """
    if not isinstance(text, str):
        return None
    match = _SEVERITY_TEXT_RE.match(text.strip())
    if match is None:
        return None
    word = match.group(1).upper()
    base = _ALIASES.get(word)
    if base is None:
        for name, number in _BANDS:
            if name == word:
                base = number
                break
    if base is None:
        return None
    step = int(match.group(2)) - 1 if match.group(2) else 0
    return base + step


def severity_text(number: int) -> str:
    """``9`` becomes ``INFO``, ``10`` becomes ``INFO2``. Display only."""
    value = max(SEVERITY_MIN, min(SEVERITY_MAX, int(number)))
    name, base = _BANDS[min(len(_BANDS) - 1, (value - 1) // 4)]
    step = value - base
    return name if step == 0 else "%s%d" % (name, step + 1)


def resolve_severity(value: Any) -> Optional[int]:
    """A number, a name, or a ``logging`` level, to a ladder number.

    None when the caller said nothing we could read, which is honest. It is not
    an error: an entry with no severity is still a perfectly good entry.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        # A stdlib logging level, when it is exactly one of them: 20 is INFO,
        # not "somewhere in the WARN band". Anything else is read as a ladder
        # number, which is what a caller passing 17 means.
        if value in STDLIB_LEVELS:
            return STDLIB_LEVELS[value]
        return max(SEVERITY_MIN, min(SEVERITY_MAX, value))
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else resolve_severity(int(value))
    return severity_number(value)


# ---------------------------------------------------------------------------
# Conventions
# ---------------------------------------------------------------------------

# Conventional entry names. SUGGESTIONS, NOT LAW: any string matching
# LOG_NAME_RE is stored, counted, grouped and filtered identically.
PAGE_VIEW = "page_view"
SESSION_START = "session_start"
APP_INSTALL = "app_install"
APP_LAUNCH = "app_launch"
IDENTIFY = "identify"
EXCEPTION = "exception"
HTTP_REQUEST = "http.request"
MEASUREMENT = "measurement"
#: What the level helpers name an entry. A free-form line still needs a name,
#: because ``name`` is the column a dashboard groups on.
LOG = "log"

# Conventional attribute keys, from ``packages/schema/src/conventions.ts``. The
# exception, session, user, os, http and url keys are OpenTelemetry's, used
# verbatim; ``firstrun.*`` is ours, namespaced so it is obvious at a glance which
# half of the vocabulary we can change.
#: The human-readable line.
#:
#: OpenTelemetry's log model has ``body`` as a top-level field. This product
#: promotes five columns and no more, so it travels as an attribute under the
#: spec's own name. Same for ``trace_id`` and ``span_id``: they are part of the
#: spec's vocabulary, not part of ours, and promoting one later is a generated
#: column over ``attributes`` rather than a schema break.
ATTR_BODY = "body"
ATTR_TRACE_ID = "trace_id"
ATTR_SPAN_ID = "span_id"

ATTR_EXCEPTION_TYPE = "exception.type"
ATTR_EXCEPTION_MESSAGE = "exception.message"
ATTR_EXCEPTION_STACKTRACE = "exception.stacktrace"
ATTR_EXCEPTION_ESCAPED = "exception.escaped"
ATTR_SESSION_ID = "session.id"
ATTR_USER_ID = "user.id"
ATTR_SERVICE_NAME = "service.name"
ATTR_SERVICE_VERSION = "service.version"
ATTR_OS_TYPE = "os.type"
ATTR_OS_VERSION = "os.version"
ATTR_HOST_ARCH = "host.arch"
ATTR_BROWSER_LANGUAGE = "browser.language"
ATTR_URL_PATH = "url.path"
ATTR_URL_FULL = "url.full"
ATTR_HTTP_REQUEST_METHOD = "http.request.method"
ATTR_HTTP_RESPONSE_STATUS_CODE = "http.response.status_code"
ATTR_HTTP_ROUTE = "http.route"
ATTR_CHANNEL = "firstrun.channel"
# Test data. Only ever the JSON boolean true, and only ever present when true:
# the dashboard matches it with jsonb containment, where "true" is a different
# value from true and would match neither world.
ATTR_TEST = "firstrun.test"
ATTR_DURATION_MS = "firstrun.duration_ms"
ATTR_VALUE = "firstrun.value"
ATTR_METRIC = "firstrun.metric"
ATTR_UNIT = "firstrun.unit"


def is_log_name(name: Any) -> bool:
    """True when the server will accept this as an entry name."""
    return isinstance(name, str) and LOG_NAME_RE.match(name) is not None


def surface_from_source_key(key: Any) -> Optional[str]:
    """The surface a key claims, or None when it is malformed.

    Advisory only: the server trusts the stored source row, never the key text.
    """
    if not isinstance(key, str):
        return None
    match = SOURCE_KEY_RE.match(key)
    return match.group(1) if match else None


def now_ms() -> int:
    """Milliseconds since the Unix epoch, which is what ``timestamp`` is."""
    return int(time.time() * 1000)


def clamp_id(value: Any) -> Optional[str]:
    """An id the server will accept, or None when there is not one."""
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    text = text.strip()
    if not text:
        return None
    return text[:ID_MAX]


def clamp_body(value: Any) -> Optional[str]:
    """A body the server will accept. Truncated rather than dropped: half a line
    still says something."""
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    if not text:
        return None
    return text[:MAX_BODY]


def os_name() -> str:
    """The ``os.type`` string, spelled the way the Rust and .NET clients spell it.

    Same spelling on every client so a breakdown by os does not split one
    platform across two rows.
    """
    try:
        system = platform.system().lower()
    except Exception:
        return "other"
    if system == "windows":
        return "windows"
    if system == "darwin":
        return "macos"
    if system == "linux":
        return "linux"
    if system.startswith("freebsd"):
        return "freebsd"
    return system or "other"


def arch_name() -> str:
    """The ``host.arch`` string, normalised to the spelling the other clients use."""
    try:
        machine = platform.machine().lower()
    except Exception:
        return "other"
    if machine in ("amd64", "x86_64", "x64"):
        return "x86_64"
    if machine in ("i386", "i686", "x86"):
        return "x86"
    if machine in ("arm64", "aarch64"):
        return "aarch64"
    if machine.startswith("arm"):
        return "arm"
    return machine or "other"


#: What a BCP-47 tag looks like, near enough to tell one from a display name.
#:
#: ``locale.getlocale()`` returns a HUMAN-READABLE name on Windows
#: (``English_Switzerland``), not a tag. Sending that as ``browser.language``
#: would put one language under two spellings in a breakdown, so anything that
#: does not look like a tag is dropped rather than guessed at.
_BCP47_RE = re.compile(r"^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$")


def locale_name() -> Optional[str]:
    """A BCP-47 tag for the current locale, or None when there is not one.

    ``getdefaultlocale`` is tried first because it is the one that returns a tag
    (``de_CH``) on every platform. ``getlocale`` is the fallback, and both are
    guarded: the first is deprecated from 3.11 and the second returns a display
    name on Windows. Whatever comes back is shape-checked before it is used, so
    a value that is not a tag becomes no attribute at all.
    """
    for name in ("getdefaultlocale", "getlocale"):
        getter = getattr(_locale, name, None)
        if getter is None:
            continue
        try:
            raw = getter()[0]
        except Exception:
            continue
        if not raw:
            continue
        tag = str(raw).replace("_", "-")[:35]
        if _BCP47_RE.match(tag):
            return tag
    return None


# ---------------------------------------------------------------------------
# Attributes
# ---------------------------------------------------------------------------


def clean_attributes(attributes: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """Copy and bound an attribute map into something the edge will accept.

    Copying matters as much as bounding: a caller who mutates their dict
    afterwards must not be able to rewrite an entry that was already recorded.

    Values may be strings, numbers, booleans, None, lists or nested dicts, up to
    four levels. Anything else is stringified where that is meaningful (a
    ``datetime`` becomes ISO-8601, a ``UUID`` or a ``Decimal`` becomes its text)
    and dropped where it is not, because a whole batch rejected for one
    unserialisable value is a much worse outcome than one missing key.
    """
    if not attributes:
        return {}
    try:
        items = list(attributes.items())
    except Exception:
        return {}

    out: Dict[str, Any] = {}
    for key, value in items:
        if len(out) >= MAX_ATTRIBUTES:
            break
        if not isinstance(key, str):
            try:
                key = str(key)
            except Exception:
                continue
        if not key or len(key) > MAX_ATTRIBUTE_KEY:
            continue
        cleaned = _clean_value(value, MAX_ATTRIBUTE_DEPTH)
        if cleaned is _DROP:
            continue
        out[key] = cleaned
    return out


class _Drop:
    """A sentinel that is not None, because None is a value we send."""

    __slots__ = ()


_DROP = _Drop()


def _clean_value(value: Any, depth: int) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value[:MAX_ATTRIBUTE_STRING]
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        # NaN and Infinity are not JSON. json.dumps writes them as bare literals
        # that the server's parser rejects, taking the whole batch with them.
        return value if math.isfinite(value) else _DROP
    if isinstance(value, (bytes, bytearray)):
        # Bytes are not JSON and guessing an encoding is worse than saying how
        # many there were.
        return "<%d bytes>" % len(value)
    if isinstance(value, (_datetime.datetime, _datetime.date)):
        try:
            return value.isoformat()[:MAX_ATTRIBUTE_STRING]
        except Exception:
            return _DROP

    if depth <= 1:
        # Past the ceiling. Dropped rather than flattened: a truncated object
        # that still looks like an object is worse to debug than an absent key.
        return _DROP

    if isinstance(value, Mapping):
        nested: Dict[str, Any] = {}
        try:
            pairs = list(value.items())
        except Exception:
            return _DROP
        for key, item in pairs:
            if len(nested) >= MAX_ATTRIBUTE_ITEMS:
                break
            if not isinstance(key, str):
                try:
                    key = str(key)
                except Exception:
                    continue
            if not key or len(key) > MAX_ATTRIBUTE_KEY:
                continue
            cleaned = _clean_value(item, depth - 1)
            if cleaned is _DROP:
                continue
            nested[key] = cleaned
        return nested

    if isinstance(value, (list, tuple, set, frozenset)):
        seq: List[Any] = []
        try:
            members = list(value)
        except Exception:
            return _DROP
        for item in members[:MAX_ATTRIBUTE_ITEMS]:
            cleaned = _clean_value(item, depth - 1)
            # A hole in a list shifts every later index, so a member that did
            # not survive becomes null rather than disappearing.
            seq.append(None if cleaned is _DROP else cleaned)
        return seq

    # A UUID, a Decimal, an Enum, a Path: things whose text is the useful part.
    try:
        return str(value)[:MAX_ATTRIBUTE_STRING]
    except Exception:
        return _DROP


def merge_attributes(*maps: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """Merges already-cleaned maps. Later keys win, and the count stays bounded."""
    out: Dict[str, Any] = {}
    for source in maps:
        if not source:
            continue
        for key, value in source.items():
            if key not in out and len(out) >= MAX_ATTRIBUTES:
                continue
            out[key] = value
    return out


def exception_attributes(error: BaseException) -> Dict[str, Any]:
    """Unwrap an exception into the conventional ``exception.*`` attributes.

    The single most valuable helper in the library, so it does the work the
    caller would otherwise do at every ``except`` site: the class name, the
    message, and the formatted traceback including any ``__cause__`` or
    ``__context__`` chain, which is what ``traceback`` already produces.
    """
    import traceback

    kind = type(error).__name__
    try:
        message = str(error)
    except Exception:
        # An exception whose __str__ raises. There is nothing to read, but the
        # entry itself is still worth having: something failed here.
        message = ""

    out: Dict[str, Any] = {
        ATTR_EXCEPTION_TYPE: kind[:MAX_ATTRIBUTE_STRING],
        ATTR_EXCEPTION_MESSAGE: message[:MAX_ATTRIBUTE_STRING],
    }
    try:
        formatted = "".join(
            traceback.format_exception(type(error), error, error.__traceback__)
        ).strip()
    except Exception:
        formatted = ""
    if formatted:
        # Truncated from the FRONT, because the deepest frames and the exception
        # line itself are at the end and are what a reader looks at first.
        out[ATTR_EXCEPTION_STACKTRACE] = formatted[-MAX_ATTRIBUTE_STRING:]
    return out
