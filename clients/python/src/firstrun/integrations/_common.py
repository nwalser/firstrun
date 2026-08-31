"""The half of an HTTP integration that does not depend on the framework.

Django, Flask and ASGI differ in where a route template comes from and in where
a ``try`` is allowed to go. They do not differ in what an entry looks like, in
which status codes are errors, or in what happens when the customer's extractor
throws, so those answers live here rather than as three opinions that drift.

Everything in this module holds to the same contract the client does: nothing
raises, nothing is inferred, and the host's request is never failed by anything
of ours. The one rule with teeth is the ORDER in :func:`leave`: the entry is
written while the request's identity is still in scope, and the identity is
taken back down afterwards.
"""

from __future__ import annotations

import sys
import time
from typing import Any, Callable, Dict, Optional, Sequence, Tuple

from .. import _context, _wire, get_client
from .._client import INTERNAL_ERROR, Firstrun

#: What an extractor is: something that turns one request into one id, or into
#: None. It is the customer's function and it is the only place an id can come
#: from, which is rule 6: we never read a cookie, a header, a session or an
#: address on our own initiative, and a ``user.id`` is only ever a string that
#: was passed to us.
Extractor = Callable[[Any], Any]


class Tracked:
    """What one request in flight is worth remembering.

    Not a dataclass, because one of these is built per request on the hot path
    and ``__slots__`` on a plain class is the cheapest shape that still reads
    like a record.
    """

    __slots__ = ("token", "started", "device_id", "user_id", "status", "recorded", "released")

    def __init__(self) -> None:
        self.token: Any = None
        self.started: float = time.monotonic()
        self.device_id: Optional[str] = None
        self.user_id: Optional[str] = None
        self.status: Any = None
        self.recorded = False
        # One request's identity is taken back down exactly once. A token that
        # is reset twice raises, and the failure path for that clears the whole
        # variable rather than one layer of it, which would take down a context
        # the customer owns. See `_context.reset_context`.
        self.released = False


def enter(device_id: Optional[Extractor], user_id: Optional[Extractor], target: Any) -> Tracked:
    """Extract the identity, put it in scope, and start the clock.

    ``target`` is whatever the framework calls a request: a Django ``HttpRequest``,
    Flask's proxy, an ASGI scope. It is handed to the customer's extractors
    unchanged and is never read by us.

    REPLACES rather than layers, which is rule 6 and not a detail. Layering
    would let an id this request's extractor did not return fall back on
    whatever is ambient on this thread or in this task: the previous request's
    ``user.id``, or one installed by a second middleware in the same chain.
    That is an identity the customer never passed for this request. An extractor
    that returned nothing means anonymous, and anonymous is what gets installed.
    """
    tracked = Tracked()
    tracked.device_id = call_extractor(device_id, target)
    tracked.user_id = call_extractor(user_id, target)
    tracked.token = _context.replace_context(
        device_id=tracked.device_id,
        user_id=tracked.user_id,
    )
    # Started last, so the clock measures the request rather than the customer's
    # extractor plus the request.
    tracked.started = time.monotonic()
    return tracked


def leave(
    client: Optional[Firstrun],
    tracked: Optional[Tracked],
    *,
    method: Any = None,
    path: Any = None,
    route: Any = None,
    status: Any = None,
    error: Optional[BaseException] = None,
) -> None:
    """Write the entry, then take the identity back down. In that order.

    The order is the whole point. Recorded first, so the entry carries the
    identity of the request it describes; reset second, and unconditionally,
    which is why the reset sits in a ``finally`` rather than after the
    ``except``: one request's identity left ambient is the next request's
    entries stamped with somebody else's user id.

    Safe to call twice, and it has to be, because a framework can give us more
    than one place to be told the request is over. The second call writes
    nothing and resets nothing: the token is released once, by :func:`release`,
    and is never handed back to :func:`_context.reset_context` afterwards.
    """
    if tracked is None:
        return
    try:
        if not tracked.recorded:
            tracked.recorded = True
            record(
                client,
                method=method,
                path=path,
                route=route,
                status=tracked.status if status is None else status,
                started=tracked.started,
                device_id=tracked.device_id,
                user_id=tracked.user_id,
                error=error,
            )
    except BaseException:  # noqa: BLE001 - a request is never failed by this library
        pass
    finally:
        release(tracked)


def release(tracked: Optional[Tracked]) -> None:
    """Take the identity back down, once, whatever else has happened."""
    if tracked is None or tracked.released:
        return
    tracked.released = True
    _context.reset_context(tracked.token)


def abandon(tracked: Optional[Tracked]) -> None:
    """Take the identity back down WITHOUT writing an entry.

    For the cases where the identity is in scope and there is nothing worth
    saying about the request: installing it worked and remembering where the
    undo went did not, or the reset is being made good by a backstop long after
    the request itself has gone. An entry that can name neither a method nor a
    path is not worth what it is metered as, and it is not the half that had to
    happen: a token nobody holds is a token nothing ever resets, and that
    identity stays ambient for every later request on a pooled worker thread.
    """
    if tracked is None:
        return
    tracked.recorded = True
    release(tracked)


def record(
    client: Optional[Firstrun],
    *,
    method: Any = None,
    path: Any = None,
    route: Any = None,
    status: Any = None,
    started: Optional[float] = None,
    device_id: Optional[str] = None,
    user_id: Optional[str] = None,
    error: Optional[BaseException] = None,
) -> None:
    """One served request as one ordinary log entry.

    There is no request table, no request pipeline and no special path for this:
    it is ``log()`` with the conventional ``http.*`` attributes filled in, and
    the customer could write the same entry by hand.

    The ids are passed rather than left to the ambient context, so this entry is
    still filed under the right request even in the case where installing the
    context failed.
    """
    if client is None:
        return
    try:
        attributes: Dict[str, Any] = {}

        text = _text(method)
        if text:
            attributes[_wire.ATTR_HTTP_REQUEST_METHOD] = text

        # The route TEMPLATE, or nothing at all. A resolved path here would make
        # a breakdown by route one row per id, which is the single thing this key
        # exists to prevent, so a framework that cannot name the template leaves
        # the key off. `url.path` below still says what was asked for.
        text = _text(route)
        if text:
            attributes[_wire.ATTR_HTTP_ROUTE] = text

        code = _status(status)
        if code is not None:
            # A number rather than a string, so a filter for "500 and above" is a
            # comparison rather than a lexicographic accident.
            attributes[_wire.ATTR_HTTP_RESPONSE_STATUS_CODE] = code

        text = _text(path)
        if text:
            attributes[_wire.ATTR_URL_PATH] = text

        if started is not None:
            attributes[_wire.ATTR_DURATION_MS] = elapsed_ms(started)

        if error is not None:
            if client_gone(error):
                # Nothing is named for a cancellation. The type is the server's
                # word for a socket that closed rather than anything the
                # customer wrote, so putting it under `exception.type` fills an
                # exception breakdown with a type nobody can act on, and the
                # stack is the unwinding rather than the cause. One boolean
                # answers the only question worth asking about it.
                attributes[_wire.ATTR_CLIENT_ABORTED] = True
            else:
                # Still an `http.request` entry rather than an `exception` one:
                # what happened is that a request was served and it failed. The
                # `exception.*` keys are the conventional way to say what went
                # wrong on any entry, and the stack is the only thing here that
                # answers "why", so it travels rather than being left to a
                # handler that may not exist.
                attributes.update(_wire.exception_attributes(error))

        client.log(
            _wire.HTTP_REQUEST,
            severity=severity_for(code, error),
            attributes=attributes,
            device_id=device_id,
            user_id=user_id,
        )
    except BaseException:  # noqa: BLE001
        pass


def severity_for(status: Optional[int], error: Optional[BaseException] = None) -> int:
    """ERROR for a 5xx or an escaped exception, INFO for everything else.

    **A 4xx is not an error.** It is the client's mistake, and a board full of
    ERROR entries because a scanner is walking the site for ``/wp-login.php`` is
    noise that makes the real ones harder to see. It is still recorded, still at
    INFO, and still one filter away.

    **Neither is a cancellation.** Somebody closed a tab, and nothing failed.
    See :func:`client_gone`.
    """
    if error is not None and not client_gone(error):
        return _wire.ERROR
    if status is not None and status >= 500:
        return _wire.ERROR
    return _wire.INFO


def client_gone(error: Optional[BaseException]) -> bool:
    """Whether this exception is the caller hanging up rather than a fault.

    An ``asyncio.CancelledError`` out of an ASGI app is the task running the
    request being cancelled, which is what a server does when the socket goes
    away and what it does again on shutdown. It is not the customer's code
    failing: a timeout of theirs surfaces as ``TimeoutError``, and a task they
    cancelled themselves does not escape their own handler. Recorded as an
    error, it would give any app with SSE, long polling, streaming downloads or
    users who navigate away an error board that is mostly cancellations, and a
    board that is mostly noise is one nobody opens when something real breaks.
    ASP.NET Core's middleware makes the same call for the same reason.

    The entry is still written, at INFO, carrying
    ``firstrun.client_aborted``: the request happened and how long it lasted
    before the caller left is worth having.

    ``asyncio`` is looked up rather than imported, because a WSGI process that
    will never see a coroutine should not pay the import to ask a question about
    one. Nothing that was never imported can be the type of a live exception.

    **This changes what is RECORDED and nothing else.** The exception itself
    goes on to the host untouched, cancellation semantics included.
    """
    if error is None:
        return False
    asyncio = sys.modules.get("asyncio")
    if asyncio is None:
        return False
    try:
        return isinstance(error, asyncio.CancelledError)
    except BaseException:  # noqa: BLE001
        return False


def elapsed_ms(started: float) -> float:
    """How long the request took, as a NUMBER, so a query can average it."""
    return round(max(0.0, time.monotonic() - started) * 1000.0, 3)


def resolve_client(client: Optional[Firstrun]) -> Optional[Firstrun]:
    """The client to write to, resolved per request rather than at construction.

    A middleware is usually built while the application object is, which is
    often before ``configure()`` has run. Resolving here means the order of
    those two lines in somebody's ``main`` is not a thing that can silence a
    service.

    It reads a module global and cannot raise, which is why the middlewares ask
    for the client BEFORE they ask the customer's request object anything: those
    questions can raise, and one that does must cost its own answer rather than
    the entry.
    """
    return client if client is not None else get_client()


def attr(target: Any, name: str) -> Any:
    """One attribute off whatever the framework calls a request, or None.

    ``getattr`` with a default swallows ``AttributeError`` and nothing else, and
    on the way out of a request the other kind is the likely one: ``method`` and
    ``path`` are properties on a Django request and on Flask's proxy, a property
    can raise anything, and the proxy raises on principle once its context is
    gone. Asked without this, one hostile attribute costs the whole entry
    instead of the one thing it could not say.
    """
    try:
        return getattr(target, name, None)
    except BaseException:  # noqa: BLE001
        return None


def call_extractor(extractor: Optional[Extractor], target: Any) -> Optional[str]:
    """Run one of the customer's extractors. Never raises, never substitutes.

    None means "no id", and no id means the entry falls back to the client's
    own. It never means we go looking for one somewhere else: an extractor that
    returns nothing has answered the question.
    """
    if extractor is None:
        return None
    try:
        return _wire.clamp_id(extractor(target))
    except BaseException:  # noqa: BLE001
        # Their function, their bug, and still not a reason to fail a request or
        # to spend an entry on it. The request is measured anonymously instead.
        return None


def is_ignored(
    target: Any,
    path: Any,
    prefixes: Sequence[str],
    predicate: Optional[Callable[[Any], Any]],
) -> bool:
    """Whether the customer said not to measure this one.

    Two spellings, because they answer different questions. A prefix list is
    what ``/static`` and ``/healthz`` want and is a string comparison. A
    predicate is what everything else wants and can look at whatever the
    framework knows.

    A predicate that raises means NOT ignored: an entry too many is cheaper than
    a service that went quiet because a filter has a typo in it.
    """
    if prefixes:
        text = _text(path)
        if text:
            for prefix in prefixes:
                if prefix and text.startswith(prefix):
                    return True
    if predicate is not None:
        try:
            return bool(predicate(target))
        except BaseException:  # noqa: BLE001
            return False
    return False


def path_prefixes(value: Any) -> Tuple[str, ...]:
    """Normalise ``ignore_paths`` into a tuple, accepting one string or many."""
    if not value:
        return ()
    if isinstance(value, str):
        return (value,)
    try:
        return tuple(str(item) for item in value if item)
    except BaseException:  # noqa: BLE001
        return ()


def import_string(value: Any) -> Any:
    """A dotted path to the thing it names, or the value untouched.

    Settings files name functions as strings because importing the view layer
    from ``settings.py`` is how an import cycle starts. Returns None when the
    path does not resolve, which the caller reads as "not configured" rather
    than as a reason to raise on the way up.
    """
    if not isinstance(value, str):
        return value
    module, _, attribute = value.rpartition(".")
    if not module or not attribute:
        return None
    try:
        import importlib

        return getattr(importlib.import_module(module), attribute, None)
    except BaseException:  # noqa: BLE001
        return None


def report(client: Optional[Firstrun], message: str, error: Optional[BaseException] = None) -> None:
    """Say that OUR configuration is wrong, through the client's diagnostics.

    Misconfiguration is silent to the end user (rule 7): no dialog, no console
    spew, no exception on the way up. It is not silent to a customer who asked
    for diagnostics, which is what this is for. A middleware built before
    ``configure()`` has no client to tell, and then it really is silence: the
    README says to check ``.enabled`` when that matters.
    """
    if client is None:
        return
    try:
        client._report(INTERNAL_ERROR, message, error=error)
    except BaseException:  # noqa: BLE001
        pass


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        try:
            value = str(value)
        except BaseException:  # noqa: BLE001
            return None
    value = value.strip()
    return value or None


def _status(value: Any) -> Optional[int]:
    # A bool is an int in Python and `True` is not a status code.
    if value is None or isinstance(value, bool):
        return None
    try:
        code = int(value)
    except (TypeError, ValueError):
        return None
    return code if code > 0 else None
