"""ASGI middleware: the request's identity in scope, and one entry per request.

Written as a plain three-argument callable rather than as a Starlette
``BaseHTTPMiddleware`` subclass, for two reasons. Starlette is not a dependency
of this package and is not going to become one. And ``BaseHTTPMiddleware`` buys
its friendlier API by running the endpoint in a separate task with a stream
between the two, which changes how context variables, background tasks and
streaming responses behave; a middleware whose whole job is to put a context
variable in scope has no business using the one wrapper that moves the endpoint
somewhere else.

The three-argument callable is the interface every ASGI server and framework
already takes, so this is the same object under FastAPI, Starlette, Litestar,
Quart, Django's ASGI handler, or an app somebody wrote by hand::

    from fastapi import FastAPI
    from firstrun.integrations.asgi import FirstrunMiddleware

    app = FastAPI()
    app.add_middleware(
        FirstrunMiddleware,
        device_id=lambda scope: scope["state"].get("visitor_id"),
    )

Nothing here reads a cookie, a header or an address to find an id. The
extractor is the customer's and is the only source of one.
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Sequence

from . import _common

__all__ = ["FirstrunMiddleware"]


class FirstrunMiddleware:
    """One ``http.request`` entry per request, and the identity while it runs.

    Every extractor is OPTIONAL and is a callable of the ASGI scope. There is no
    default for it: an anonymous id we invented would be an id for the server
    rather than for whoever is on the other end of the socket, and inventing one
    from a header or an address is the thing this library does not do.

    ``user_id`` is optional and is the same shape. It is only ever the string
    the customer's own function returns.

    ``ignore_paths`` is a path prefix or a list of them, and ``ignore`` is a
    predicate over the scope. An ignored request gets no entry and no context:
    it is a request this middleware was told is not interesting.

    ``client`` names a specific :class:`firstrun.Firstrun`; without one this
    writes to the process-wide client, resolved per request so the order of
    ``configure()`` and the app's construction does not matter.

    A non-callable extractor is ignored, which
    then passes every request straight through. Not an exception: a constructor
    in this library does not raise into a program that is trying to boot, and
    the same choice is made in :class:`firstrun.Firstrun` for a missing source
    key. Read ``.enabled`` if you would rather a test failed loudly.
    """

    def __init__(
        self,
        app: Any,
        device_id: Optional[_common.Extractor] = None,
        *,
        user_id: Optional[_common.Extractor] = None,
        ignore_paths: Any = None,
        ignore: Optional[Callable[[Any], Any]] = None,
        client: Any = None,
    ) -> None:
        self.app = app
        self._device_id = device_id if callable(device_id) else None
        self._user_id = user_id if callable(user_id) else None
        self._ignore = ignore if callable(ignore) else None
        self._prefixes: Sequence[str] = _common.path_prefixes(ignore_paths)
        self._client = client
        # Always on. There is nothing left to be missing: identity is three
        # optional attributes, and an entry carrying none of them counts as an
        # entry and in no unique. That is the honest answer for a backend that
        # never said who a request was for, and a much smaller loss than not
        # measuring the request at all.
        self.enabled = True

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        # A lifespan or websocket scope is not a served request and has no entry
        # to write. It still has to reach the app, untouched and exactly once.
        if not self.enabled or _scope_type(scope) != "http":
            await self.app(scope, receive, send)
            return

        if _common.is_ignored(scope, _get(scope, "path"), self._prefixes, self._ignore):
            await self.app(scope, receive, send)
            return

        tracked = _common.enter(self._device_id, self._user_id, scope)

        async def _send(message: Any) -> None:
            # The status on its way past. The message belongs to the app: one
            # number is read out of it and the object itself is forwarded
            # unchanged, so this cannot alter a response.
            try:
                if message.get("type") == "http.response.start":
                    tracked.status = message.get("status")
            except BaseException:  # noqa: BLE001
                pass
            await send(message)

        error: Optional[BaseException] = None
        try:
            await self.app(scope, receive, _send)
        except BaseException as exc:  # noqa: BLE001 - re-raised below, untouched
            # The host's exception, on its way to the host's handler. We note
            # that the request failed and get out of its way: swallowing it here
            # would turn a 500 into a hang, which is exactly the kind of harm
            # rule 7 exists to prevent.
            error = exc
            raise
        finally:
            # Gathered on their own lines rather than in the argument list, and
            # inside a guard, because this is a `finally`. An exception raised
            # from here does not travel beside the host's exception, it REPLACES
            # it: the app's ValueError becomes our RuntimeError with the real one
            # demoted to __context__, and every handler that dispatches on the
            # type sees ours instead. It would also skip the `leave` below it and
            # leave this request's identity ambient. The scope is the customer's
            # dict and anything in it can be a property that throws, so nothing
            # here is trusted to return quietly.
            client = method = path = route = None
            try:
                method = _get(scope, "method")
                path = _get(scope, "path")
                route = _route(scope)
                client = _common.resolve_client(self._client)
            except BaseException:  # noqa: BLE001
                pass

            # Every argument below is a local by now, and `leave` itself cannot
            # raise, so this call and the reset inside it always happen.
            _common.leave(
                client,
                tracked,
                method=method,
                path=path,
                route=route,
                error=error,
            )


def _scope_type(scope: Any) -> Optional[str]:
    try:
        return scope.get("type")
    except BaseException:  # noqa: BLE001
        return None


def _get(scope: Any, key: str) -> Any:
    try:
        return scope.get(key)
    except BaseException:  # noqa: BLE001
        return None


def _route(scope: Any) -> Optional[str]:
    """The route TEMPLATE this request matched, or None.

    Starlette, and so FastAPI, puts the matched route object in
    ``scope["route"]`` on the way through its router, which is why this is read
    on the way OUT: at the front door nothing has been matched yet. The scope is
    one dict all the way down, so the value is there by the time the app returns.
    ``Route.path`` is the template with its converters intact (``/users/{id}``),
    which is the string this key wants.

    Nothing is substituted when there is no route, because ``/users/12345`` here
    would put one row per user in a breakdown by route and make the breakdown
    useless. An app that does not name its routes is measured by ``url.path``,
    which is honest about being a path.

    Only the ROUTE OBJECT a router put there is read, never a bare string. A
    router's ``.path`` is by construction the string the endpoint was registered
    under, so it is a template whatever it looks like; a bare string under this
    key is somebody's note to themselves, and a resolved path is indistinguishable
    from a template with no converter in it. Absent beats wrong, so it is absent.
    """
    route = _get(scope, "route")
    if route is None:
        return None
    try:
        # `path` can be a property on somebody's route class, and a property can
        # raise anything. getattr's default only covers AttributeError, which is
        # the one exception such a property is least likely to raise.
        path = getattr(route, "path", None)
    except BaseException:  # noqa: BLE001
        return None
    if not isinstance(path, str) or not path:
        return None

    # Under a Mount the route's path is relative to the mount and ``root_path``
    # is the rest of it, so an app mounted at /api reports ``/api/users/{id}``
    # instead of sharing rows with the app mounted next to it. The guard is for
    # the servers and versions where the mount prefix is already in the path.
    root = _get(scope, "root_path")
    if isinstance(root, str) and root and not path.startswith(root):
        return root.rstrip("/") + path
    return path
