"""Ambient identity for one request, so a handler stops repeating itself.

A server writes entries on behalf of whoever is on the other end of the socket,
so the identity belongs to the REQUEST and not to the process: this client's own
A process-wide identity describes the box, which is the wrong answer for every entry a
view produces. Passing it per call works, and :meth:`Firstrun.log` has always
accepted it. It also means every single call inside a handler repeats two
keyword arguments that were already known at the front door.

This module holds that identity in a :class:`contextvars.ContextVar`, and the
choice of primitive is most of the design:

* A module global is shared by every request in the process, so two concurrent
  requests take turns overwriting each other's user id and both report the
  wrong one. That failure is silent, constant under load, and produces data
  nobody can tell is wrong afterwards.
* A :class:`threading.local` fixes threads and nothing else. Two coroutines
  interleaved on ONE thread share it, which is the ordinary case for an async
  framework and the case a server most needs to get right.
* A context variable is copied into each :class:`asyncio.Task` at the moment
  the task is created, so a value set by an ASGI middleware reaches everything
  the handler awaits, and reaches nothing being served concurrently beside it.
  It is stdlib from 3.7, so this costs no dependency.

**Nothing here is ever inferred.** What the context carries is what the caller
put in it: no cookie is read, no header is parsed, no session is looked up, no
address is hashed. ``user.id`` is only ever a string the customer chose, which
is the same rule the rest of the library follows and the reason a middleware
built on this takes an extractor function rather than guessing.

The context is read when :meth:`Firstrun.log` is called and never afterwards, so
the entry keeps the identity that was in force where it was recorded. The sender
thread drains a queue of finished entries and has no use for any of this.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass, field
from typing import Any, List, Mapping, Optional

from . import _wire

__all__ = [
    "RequestContext",
    "context",
    "current_context",
    "set_context",
    "replace_context",
    "reset_context",
]


@dataclass(frozen=True)
class RequestContext:
    """Who this request is on behalf of, and what is true of all of it.

    Frozen because it is shared with everything the request touches, including
    tasks and threads it spawns: a value that can be edited in place is a value
    one of them can rewrite under the others. Entering a nested context builds a
    new one instead of changing this one.

    ``attributes`` has already been through ``clean_attributes``, which bounds it
    and copies it: bounding once per request rather than once per entry, and
    copying so a caller who mutates the dict they passed cannot rewrite an
    identity that is already in force. Treat it as read only.
    """

    device_id: Optional[str] = None
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    attributes: Mapping[str, Any] = field(default_factory=dict)


#: The context of a program that has not set one. It exists so a caller
#: resolving an id can write one ``or`` chain rather than branching on None
#: first, which is what the client does for every entry.
EMPTY = RequestContext()


_current: "contextvars.ContextVar[Optional[RequestContext]]" = contextvars.ContextVar(
    "firstrun_request_context",
    default=None,
)


def current_context() -> Optional[RequestContext]:
    """The context in force here, or None when there is not one.

    None rather than :data:`EMPTY`, so a caller can tell "nobody set one" apart
    from "somebody set one carrying nothing".
    """
    return _current.get()


def set_context(
    device_id: Optional[str] = None,
    *,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    attributes: Optional[Mapping[str, Any]] = None,
    **attrs: Any,
) -> Optional["contextvars.Token[Optional[RequestContext]]"]:
    """Install an ambient context and return the token that undoes it.

    For middleware that has nowhere to put a ``with``: an ASGI or WSGI callable
    sets on the way in and resets in a ``finally`` on the way out. Everything
    else should prefer :func:`context`, which cannot forget the reset::

        token = firstrun.set_context(device_id=visitor_id, user_id=account_id)
        try:
            return await call_next(request)
        finally:
            firstrun.reset_context(token)

    Layers onto whatever context is already in force, the same way
    :func:`context` does, so an id it is not given keeps the one the surrounding
    scope had. **That is the wrong default at a front door**, where an id the
    extractor did not return means the request is anonymous rather than that it
    inherits the last one: a middleware wants :func:`replace_context`, and the
    one shipped in ``firstrun.integrations`` uses it.

    Returns None if the context could not be installed, which
    :func:`reset_context` accepts, so the ``finally`` above needs no branch
    either way.
    """
    try:
        installed = _merge(current_context(), device_id, user_id, session_id, attributes, attrs)
        return _current.set(installed)
    except BaseException:  # noqa: BLE001 - a request is never failed by this library
        # The entries written under this scope fall back to the client's own
        # identity, which is the trade this library takes everywhere: losing
        # telemetry beats affecting the program that produced it.
        return None


def replace_context(
    device_id: Optional[str] = None,
    *,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    attributes: Optional[Mapping[str, Any]] = None,
    **attrs: Any,
) -> Optional["contextvars.Token[Optional[RequestContext]]"]:
    """Establish the context for one request, DISCARDING whatever was in force.

    What a front door needs, and the one thing :func:`set_context` deliberately
    does not do. Layering is right for a handler adding a detail to what the
    middleware already said; it is wrong for the middleware itself, because an
    id it was not given would fall back on whatever happened to be ambient: a
    ``user.id`` left over from a previous request on this worker thread, or one
    put there by a second middleware in the same chain. Either way it is an
    identity the customer never passed for THIS request, which rule 6 does not
    allow whether or not the value looks plausible::

        token = firstrun.replace_context(device_id=visitor_id, user_id=account_id)
        try:
            return handle(request)
        finally:
            firstrun.reset_context(token)

    **None here means anonymous, not "keep what was there".** An extractor that
    returned nothing has answered the question, and a request with no user id is
    a request with no user id.

    Attributes are replaced for the same reason: what this installs describes
    one request, and whatever was in force before it describes something else.
    What is true of the whole process belongs on the client instead
    (``configure(default_attributes=...)``), which every entry picks up anyway.

    Returns the token that undoes it, or None when it could not be installed,
    which :func:`reset_context` accepts either way.
    """
    try:
        bag = _wire.clean_attributes(attributes)
        if attrs:
            # Same precedence as _merge: naming a key at the call beats passing
            # it in the mapping.
            bag = _wire.merge_attributes(bag, _wire.clean_attributes(attrs))
        installed = RequestContext(
            device_id=_wire.clamp_id(device_id),
            user_id=_wire.clamp_id(user_id),
            session_id=_wire.clamp_id(session_id),
            attributes=bag,
        )
        return _current.set(installed)
    except BaseException:  # noqa: BLE001 - a request is never failed by this library
        # Nothing installed, so nothing to undo. The entries written under this
        # request fall back to the client's own identity, which is the trade
        # this library takes everywhere.
        return None


def reset_context(token: Optional["contextvars.Token[Optional[RequestContext]]"]) -> None:
    """Put back whatever was in force before the matching set.

    Takes the token from either :func:`set_context` or :func:`replace_context`,
    and accepts None, so middleware can keep one variable and reset it without
    checking whether the set worked.
    """
    if token is None:
        return
    try:
        _current.reset(token)
    except BaseException:  # noqa: BLE001
        # A token resets only in the Context it was created in, and only once,
        # so the two ways to land here are a token used twice and a token that
        # crossed tasks. Clearing is deliberate, and it is not free: if the
        # caller had an outer `with firstrun.context(...)` in force HERE, this
        # takes that down as well and it does not come back when the block that
        # failed returns. A context we did not install is destroyed to be sure a
        # context we did install is not left behind, because entries stamped
        # with somebody else's user id are worse than entries stamped with
        # nobody's.
        #
        # `token.old_value` would put back the right thing for the used-twice
        # case and exactly the wrong thing for the crossed-tasks one, where the
        # value it holds was in force in ANOTHER task and installing it here is
        # the inference this whole branch exists to prevent. So the used-twice
        # road is closed at the source instead: `firstrun.integrations` releases
        # each request once, and never asks a spent token to reset again.
        try:
            _current.set(None)
        except BaseException:  # noqa: BLE001
            pass


def context(
    device_id: Optional[str] = None,
    *,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    attributes: Optional[Mapping[str, Any]] = None,
    **attrs: Any,
) -> "_Scope":
    """Make an ambient identity for a block, so calls inside it stop repeating it.

    ::

        with firstrun.context(device_id=session_key, user_id=account_id):
            firstrun.event("order_placed", {"total": order.total})
            firstrun.event("email_queued")

    Both entries carry the identity and neither call names it. An entry that
    names its own ``user_id``, ``device_id`` or ``session_id`` still wins:
    the order is the call, then the context, then the client's own.

    Nesting ADDS rather than replaces, because the common shape is a middleware
    stating the identity at the front door and a handler adding a detail deeper
    in::

        with firstrun.context(attributes={"tenant": tenant.slug}):
            ...

    So None here means "keep what the surrounding context said" rather than
    "clear it", and there is deliberately no spelling for "no user id": whoever
    owns the outer scope decided that, and a call that wants something else says
    so on the call.

    ``**attrs`` is the convenient half and only reaches keys that are Python
    identifiers. The conventional keys are dotted (``http.route``,
    ``service.name``), so pass those in ``attributes``.

    Usable from a coroutine: the value is copied into every task the block
    creates, and is invisible to anything running concurrently beside it.
    """
    return _Scope(device_id, user_id, session_id, attributes, attrs)


class _Scope:
    """What :func:`context` returns. Re-enterable, and it never raises."""

    __slots__ = ("_device_id", "_user_id", "_session_id", "_attributes", "_attrs", "_tokens")

    def __init__(
        self,
        device_id: Optional[str],
        user_id: Optional[str],
        session_id: Optional[str],
        attributes: Optional[Mapping[str, Any]],
        attrs: Mapping[str, Any],
    ) -> None:
        self._device_id = device_id
        self._user_id = user_id
        self._session_id = session_id
        self._attributes = attributes
        self._attrs = attrs
        # A stack rather than one token, so entering the same scope object again
        # from inside itself unwinds in the right order instead of overwriting
        # the outer token with the inner one and resetting to the wrong place.
        self._tokens: List[Optional["contextvars.Token[Optional[RequestContext]]"]] = []

    def __enter__(self) -> Optional[RequestContext]:
        # Merged on the way in rather than in context(), so a scope held in a
        # variable and entered later layers onto what is actually in force at
        # that moment rather than onto what was in force where it was written.
        token = None
        installed: Optional[RequestContext] = None
        try:
            installed = _merge(
                current_context(),
                self._device_id,
                self._user_id,
                self._session_id,
                self._attributes,
                self._attrs,
            )
            token = _current.set(installed)
        except BaseException:  # noqa: BLE001
            token = None
            installed = None
        self._tokens.append(token)
        return installed

    def __exit__(self, *exc: Any) -> None:
        # Returns None, never True: an exception raised inside the block is the
        # host's and travels on. This only takes the identity back down.
        token = self._tokens.pop() if self._tokens else None
        reset_context(token)


def _merge(
    base: Optional[RequestContext],
    device_id: Optional[str],
    user_id: Optional[str],
    session_id: Optional[str],
    attributes: Optional[Mapping[str, Any]],
    extra: Mapping[str, Any],
) -> RequestContext:
    """Layer one set of arguments onto the context already in force."""
    bag = _wire.clean_attributes(attributes)
    if extra:
        # The keyword half wins over the mapping half, on the grounds that
        # naming a key at the call is the more deliberate of the two.
        bag = _wire.merge_attributes(bag, _wire.clean_attributes(extra))
    if base is not None and base.attributes:
        # The inner scope wins, and the outer one survives every key it did not
        # mention. Anything else would make a nested context that adds one
        # attribute silently drop the tenant the middleware set.
        bag = _wire.merge_attributes(base.attributes, bag)

    # Identity is ONE UNIT. A nested scope that states any of the three replaces
    # all of them rather than merging field by field: a block that names its own
    # device must not keep the outer scope's person, because a unique coalesces
    # `user.id` first and that block's entries would be counted as that person.
    # Attributes merge, because two layers adding a key are describing the same
    # request; ids do not, because they are describing WHO.
    stated = _wire.clamp_id(user_id), _wire.clamp_id(device_id), _wire.clamp_id(session_id)
    if not any(stated) and base is not None:
        stated = base.user_id, base.device_id, base.session_id

    return RequestContext(
        user_id=stated[0],
        device_id=stated[1],
        session_id=stated[2],
        attributes=bag,
    )
