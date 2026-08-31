"""Django middleware: the request's identity in scope, and one entry per request.

Django takes a dotted path in ``MIDDLEWARE`` and a dotted path cannot carry an
argument, so there are two spellings and they build the same object.

Name the class directly and it reads the extractors from settings::

    # settings.py
    MIDDLEWARE = [
        ...,
        "django.contrib.auth.middleware.AuthenticationMiddleware",
        "firstrun.integrations.django.FirstrunMiddleware",
    ]

    FIRSTRUN_DEVICE_ID = "myapp.telemetry.visitor_id"     # or the callable
    FIRSTRUN_USER_ID = "myapp.telemetry.account_id"         # optional
    FIRSTRUN_IGNORE_PATHS = ["/static/", "/healthz"]        # optional

Or build one in your own module and name that, which is the spelling that keeps
a lambda possible::

    # myapp/telemetry.py
    from firstrun.integrations.django import firstrun_middleware

    identity = firstrun_middleware(
        device_id=lambda request: request.session.session_key,
        user_id=lambda request: str(request.user.pk) if request.user.is_authenticated else None,
    )
    # settings.py: MIDDLEWARE = [..., "myapp.telemetry.identity"]

Put it AFTER ``AuthenticationMiddleware``, or ``request.user`` is not resolved
by the time an extractor asks for it.

Django is imported lazily and only where it is certainly installed, so this
module stays importable in an environment that has no Django in it.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional, Sequence

from . import _common

__all__ = ["FirstrunMiddleware", "firstrun_middleware"]


class FirstrunMiddleware:
    """One ``http.request`` entry per request, and the identity while it runs.

    Every extractor is OPTIONAL and is a callable of the ``HttpRequest``. There
    is no default: an id we invented would describe the server rather than
    whoever is on the other end of it, and deriving one from a cookie, a header
    or an address is the thing this library does not do.

    Without a usable extractor the middleware disables itself and passes every
    request through. Not an exception and not ``MiddlewareNotUsed``: a
    constructor in this library does not raise into a program that is trying to
    boot, the same choice :class:`firstrun.Firstrun` makes for a missing source
    key. Read ``.enabled`` if you would rather a startup check failed loudly.

    Both request modes are supported. Under WSGI Django hands us a synchronous
    ``get_response`` and this is a synchronous middleware; under ASGI it hands
    us an asynchronous one and this is an asynchronous middleware. Declaring
    only one of the two would make Django adapt the other with a thread hop per
    request, in the customer's critical path, which is not ours to spend.
    """

    #: Read by Django's ``load_middleware`` off whatever the dotted path names,
    #: to decide which kind of ``get_response`` to hand us.
    sync_capable = True
    async_capable = True

    def __init__(self, get_response: Any, **config: Any) -> None:
        """Django passes ``get_response`` and nothing else, so a bare instance
        takes its configuration from settings. :func:`firstrun_middleware`
        passes it here instead."""
        self.get_response = get_response
        if not config:
            config = _from_settings()

        device_id = config.get("device_id")
        user_id = config.get("user_id")
        ignore = config.get("ignore")
        self._device_id = device_id if callable(device_id) else None
        self._user_id = user_id if callable(user_id) else None
        self._ignore = ignore if callable(ignore) else None
        self._prefixes: Sequence[str] = _common.path_prefixes(config.get("ignore_paths"))
        self._client = config.get("client")

        # Always on. See the asgi middleware for why: identity is optional, and
        # a request measured without one beats a request not measured.
        self.enabled = True

        self._async = _is_async(get_response)
        if self._async:
            _mark_coroutine(self)

    def __call__(self, request: Any) -> Any:
        if self._async:
            # Returned rather than awaited: this method is synchronous, and the
            # marker set in __init__ is what tells Django to await what comes
            # back out of it.
            return self._acall(request)

        if not self.enabled or self._ignored(request):
            return self.get_response(request)

        tracked = _common.enter(self._device_id, self._user_id, request)
        response: Any = None
        error: Optional[BaseException] = None
        try:
            response = self.get_response(request)
            return response
        except BaseException as exc:  # noqa: BLE001 - re-raised untouched
            error = exc
            raise
        finally:
            self._leave(request, tracked, response, error)

    async def _acall(self, request: Any) -> Any:
        if not self.enabled or self._ignored(request):
            return await self.get_response(request)

        tracked = _common.enter(self._device_id, self._user_id, request)
        response: Any = None
        error: Optional[BaseException] = None
        try:
            response = await self.get_response(request)
            return response
        except BaseException as exc:  # noqa: BLE001 - re-raised untouched
            error = exc
            raise
        finally:
            self._leave(request, tracked, response, error)

    def _ignored(self, request: Any) -> bool:
        # Guarded because this one is asked BEFORE the view runs: an exception
        # here would be a request that never reached the app at all, which is
        # the one failure this middleware is not allowed to have.
        try:
            path = getattr(request, "path", None)
        except BaseException:  # noqa: BLE001
            path = None
        return _common.is_ignored(request, path, self._prefixes, self._ignore)

    def _leave(
        self,
        request: Any,
        tracked: _common.Tracked,
        response: Any,
        error: Optional[BaseException],
    ) -> None:
        # Django's own exception middleware turns a view that raised into a 500
        # response before it reaches us, so `error` is only ever an exception
        # that escaped the whole chain. Either way the entry is written and the
        # identity comes back down, and neither can raise on the way past a host
        # exception that is already travelling.
        #
        # Gathered separately from the call, so that a request or response
        # object that objects to being read cannot skip the reset below it. One
        # request's identity left ambient is the next request's entries stamped
        # with somebody else's, which is worse than an entry that says little.
        #
        # The client comes FIRST and on its own, because it is the only one of
        # these that cannot raise, and because a shared `try` around all five
        # would make one hostile property cost the entry rather than the one
        # attribute it refused: a request measured badly still beats a request
        # not measured at all. Every read below guards itself for the same
        # reason.
        client = _common.resolve_client(self._client)
        method = _common.attr(request, "method")
        path = _common.attr(request, "path")
        route = _route(request)
        status = _common.attr(response, "status_code")

        # Every argument below is a local by now, and `leave` itself cannot
        # raise, so this call and the reset inside it always happen.
        _common.leave(
            client,
            tracked,
            method=method,
            path=path,
            route=route,
            status=status,
            error=error,
        )


def firstrun_middleware(
    device_id: Optional[_common.Extractor] = None,
    *,
    user_id: Optional[_common.Extractor] = None,
    ignore_paths: Any = None,
    ignore: Optional[Callable[[Any], Any]] = None,
    client: Any = None,
) -> Callable[[Any], FirstrunMiddleware]:
    """A configured middleware, for a module of your own to name in ``MIDDLEWARE``.

    Returns the factory Django expects: something that takes ``get_response``
    and returns the middleware. The two capability flags are set on it because
    Django reads them off whatever the dotted path names, before it constructs
    anything.
    """
    config: Dict[str, Any] = {
        "device_id": device_id,
        "user_id": user_id,
        "ignore_paths": ignore_paths,
        "ignore": ignore,
        "client": client,
    }

    def factory(get_response: Any) -> FirstrunMiddleware:
        return FirstrunMiddleware(get_response, **config)

    factory.sync_capable = True  # type: ignore[attr-defined]
    factory.async_capable = True  # type: ignore[attr-defined]
    return factory


def _route(request: Any) -> Optional[str]:
    """``orders/<int:pk>``, from the resolver, or None.

    ``request.resolver_match`` is filled in by the URL resolver, which runs
    inside ``get_response``, so this is read on the way out rather than on the
    way in. ``route`` is the pattern as it was written in ``urls.py``, including
    a ``re_path`` regex, which is still a template even when it is an ugly one.

    A request that matched nothing (a 404) and a response returned by an outer
    middleware before routing both leave the key off. The resolved path is never
    substituted: it would put one row per id in a breakdown by route, and
    ``url.path`` already carries it.

    Read through :func:`_common.attr`, because this runs beside a reset that has
    to happen and both of these are attributes on the customer's own object.
    """
    match = _common.attr(request, "resolver_match")
    if match is None:
        return None
    return _common.attr(match, "route")


def _from_settings() -> Dict[str, Any]:
    """The configuration, from Django settings, for the string-path spelling.

    A dotted path is accepted as well as a callable, because a settings module
    that imports the view layer to name a function is a settings module with an
    import cycle waiting in it.
    """
    try:
        from django.conf import settings

        return {
            "device_id": _common.import_string(getattr(settings, "FIRSTRUN_DEVICE_ID", None)),
            "user_id": _common.import_string(getattr(settings, "FIRSTRUN_USER_ID", None)),
            "ignore_paths": getattr(settings, "FIRSTRUN_IGNORE_PATHS", None),
            "ignore": _common.import_string(getattr(settings, "FIRSTRUN_IGNORE", None)),
            "client": None,
        }
    except BaseException:  # noqa: BLE001
        # No Django, or settings that are not configured yet. Either way this is
        # an unconfigured middleware rather than a failed import.
        return {}


def _is_async(get_response: Any) -> bool:
    """Whether Django handed us the asynchronous chain.

    ``asgiref`` first, because it is the same question Django asked itself one
    line earlier and it knows about its own marker. ``inspect`` second rather
    than ``asyncio.iscoroutinefunction``, which is deprecated and would spend a
    warning on somebody's stderr for a question we can ask another way.
    """
    try:
        from asgiref.sync import iscoroutinefunction

        return bool(iscoroutinefunction(get_response))
    except BaseException:  # noqa: BLE001
        pass
    try:
        import inspect

        if inspect.iscoroutinefunction(get_response):
            return True
    except BaseException:  # noqa: BLE001
        return False
    # What asgiref marks a callable with when the callable is not itself an
    # `async def`, which is how the middleware next to this one says the same
    # thing about itself.
    return getattr(get_response, "_is_coroutine", None) is not None


def _mark_coroutine(instance: Any) -> None:
    """Tell Django this instance returns a coroutine.

    Django picks the kind of ``get_response`` to pass from the two class flags,
    but ``convert_exception_to_response`` wraps the INSTANCE by inspecting it.
    An instance that returns a coroutine without saying so gets a synchronous
    wrapper around an asynchronous chain, and the exception handling Django puts
    there stops seeing anything.

    ``asgiref`` ships the marker and Django cannot be installed without it, so
    this is not a new dependency. It is imported here rather than at module
    scope only so this file stays importable with no Django in the environment.
    """
    try:
        from asgiref.sync import markcoroutinefunction

        markcoroutinefunction(instance)
        return
    except BaseException:  # noqa: BLE001
        pass
    try:
        import inspect

        inspect.markcoroutinefunction(instance)
        return
    except BaseException:  # noqa: BLE001
        pass
    try:
        import asyncio

        # asgiref before 3.6 on Python before 3.12, where the marker was this.
        instance._is_coroutine = asyncio.coroutines._is_coroutine
    except BaseException:  # noqa: BLE001
        # Unmarked, and still asynchronous: __call__ returns the coroutine and
        # whoever called it awaits it. Django's exception conversion is the only
        # thing that degrades, and only on a combination that predates every
        # marker there has ever been.
        pass
