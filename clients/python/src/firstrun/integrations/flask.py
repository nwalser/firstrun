"""Flask extension: the request's identity in scope, and one entry per request.

The ordinary Flask extension shape, so it fits an application factory as well
as a module-level app::

    import firstrun
    from flask import Flask, request
    from firstrun.integrations.flask import FirstrunExtension

    firstrun.configure(source_key="fr_9f3a2b1c4d5e6f70", host="https://t.example.com")

    telemetry = FirstrunExtension(
        device_id=lambda: request.cookies.get("visitor"),
        ignore_paths=["/static/"],
    )

    def create_app():
        app = Flask(__name__)
        telemetry.init_app(app)
        return app

The extractors take no argument, because Flask's ``request`` is already the
thing you would have been handed. Anything you can read in a view you can read
in an extractor, and nothing is read for you: no cookie, no header, no session.

Flask is imported lazily inside :meth:`FirstrunExtension.init_app`, where it is
certainly installed, so this module stays importable in an environment that has
no Flask in it.

**The one thing this extension cannot promise.** Flask walks both teardown lists
in reverse registration order, in a bare loop with nothing catching what a hook
raises, and an extension registers before an app's own hooks rather than after
them. Ours therefore runs LAST in both lists, and a teardown hook of yours that
raises skips everything behind it, ours included. The ``teardown_appcontext``
backstop closes that for a raising ``teardown_request`` hook, because Flask pops
the app context in a ``finally`` around the request teardown and that list runs
even when the first one stopped halfway. It does not close it for a raising
``teardown_appcontext`` hook: there is no list after that one, nothing later to
register in, and no position we could take that a hook registered after us could
not get in front of. In that case the request's identity stays in scope on that
worker thread.

The damage is bounded rather than absent. An identity this extension installs
REPLACES what was in scope rather than layering onto it, so the next request it
measures on that thread is stamped with its own and nothing else. What a leak
can still reach is an entry you write yourself between requests on that thread,
and a request on an ignored path. The backstop reports once through the client's
diagnostics the first time it fires, because a teardown chain that raises is
invisible from in here and every request served under it goes unmeasured.
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Sequence

from . import _common

__all__ = ["FirstrunExtension"]

#: Where the request's state lives while it is in flight. On ``g``, which is
#: request scoped and torn down with it, rather than on the extension, which is
#: shared by every request the app is serving at once.
_STATE = "_firstrun_tracked"


class FirstrunExtension:
    """One ``http.request`` entry per request, and the identity while it runs.

    Every extractor is OPTIONAL and is a callable taking no arguments, resolved
    inside the request context. There is no default: an id we invented would
    describe the server rather than whoever is on the other end of it, and
    deriving one from a cookie, a header or an address is the thing this library
    does not do.

    ``user_id`` is optional and is the same shape. ``ignore_paths`` is a path
    prefix or a list of them and ``ignore`` is a predicate; an ignored request
    gets no entry and no context. ``client`` names a specific
    :class:`firstrun.Firstrun`, and without one this writes to the process-wide
    client, resolved per request.

    Without a usable extractor the extension disables itself and registers
    nothing. Not an exception: a Flask app that cannot take our hooks is an app
    that runs without telemetry, not an app that fails to boot. Read
    ``.enabled`` if you would rather a startup check failed loudly.

    ``enabled`` is that startup check and nothing else. It answers "is this
    configured, and did every ``init_app`` take", which is worth failing a boot
    over; it is not consulted while a request is being served, because one app
    in a process refusing our hooks is not a reason for an app that took them to
    stop measuring. See :meth:`init_app`.
    """

    def __init__(
        self,
        app: Any = None,
        device_id: Optional[Callable[[], Any]] = None,
        *,
        user_id: Optional[Callable[[], Any]] = None,
        ignore_paths: Any = None,
        ignore: Optional[Callable[[Any], Any]] = None,
        client: Any = None,
    ) -> None:
        self._device_id = device_id if callable(device_id) else None
        self._user_id = user_id if callable(user_id) else None
        # Adapted once here rather than twice per request: Flask's extractors
        # take no argument and the shared helper passes one.
        self._pull_device_id = _wrap(self._device_id)
        self._pull_user_id = _wrap(self._user_id)
        self._ignore = ignore if callable(ignore) else None
        self._prefixes: Sequence[str] = _common.path_prefixes(ignore_paths)
        self._client = client
        self._flask: Any = None
        # Said once rather than once a request: the hook that skipped our
        # teardown will skip it again on every request after this one. Set
        # without a lock, because two worker threads racing to say the same
        # thing twice is not worth one on the request path.
        self._reported_backstop = False
        # Always on. See the asgi middleware for why: identity is optional, and
        # a request measured without one beats a request not measured.
        self.enabled = True
        if app is not None:
            self.init_app(app)

    def init_app(self, app: Any) -> None:
        """Register the hooks on one app. Never raises.

        Call it before the app registers its own ``after_request`` hooks, which
        an application factory does naturally. Flask walks those in reverse, so
        the one registered first runs last and reads the status after everybody
        else has finished with the response.

        **That argument does not carry over to teardown, where it is backwards.**
        Flask reverses the teardown list too and runs it in a bare loop with no
        ``try`` around the calls, so registering early puts our reset LAST: one
        customer teardown hook that raises and the identity stays ambient on a
        worker thread the server is about to reuse. We cannot register later
        than an app's own hooks from in here, so the reset has a second home on
        ``teardown_appcontext``. Flask pops the app context in a ``finally``
        around ``do_teardown_request``, so that list runs even when this one
        stopped halfway through. **That backstop is not a guarantee**, and the
        module docstring says exactly how far it goes.

        **Registration is per app, and so is what a failure costs.** This can be
        called for several apps in one process, an application factory being the
        ordinary way that happens, and one app that would not take our hooks is
        not a reason to stop measuring one that already did. Nothing here reads
        or writes a flag that a later call could flip under an app that is
        serving.
        """
        try:
            import flask

            self._flask = flask
            # The undo is registered before the thing it undoes, and
            # `before_request` LAST **on purpose**: these four calls are not
            # atomic, and the one outcome that must not survive a failure is a
            # live `before_request` with nothing behind it, an identity
            # installed on every request and never taken back down. Registered
            # last, a hook of ours is live on an app only when every hook behind
            # it registered on that same app, which makes the guarantee a
            # property of THIS app rather than of a flag on the extension.
            app.teardown_appcontext(self._teardown_appcontext)
            app.teardown_request(self._teardown)
            app.after_request(self._after)
            app.before_request(self._before)
        except BaseException as exc:  # noqa: BLE001
            # Left False afterwards so a startup check can see that something
            # did not register. It is a report, not a switch: the hooks already
            # live on other apps keep working, and so does a later `init_app`.
            self.enabled = False
            _common.report(
                _common.resolve_client(self._client),
                "flask extension could not register its hooks on this app; this app is "
                "not measured",
                error=exc,
            )

    # ------------------------------------------------------------------
    # The hooks. Every one of them returns what Flask expects even when every
    # line of ours has failed, and none of them raises into Flask's own loops:
    # the teardown lists are walked without a `try`, so a hook that throws takes
    # every hook behind it down with it, including somebody else's.
    # ------------------------------------------------------------------

    def _before(self) -> None:
        """Identity in scope, clock started. Returns None, always.

        Returning anything else from a ``before_request`` hook would ANSWER the
        request, so this returns None down every branch including the failed
        ones: a telemetry hook is not allowed to become somebody's response.

        It consults no extension-wide flag, and must not. ``init_app`` registers
        this hook LAST, so its being called at all is already the proof that the
        app it is running on took the teardown that undoes it. A flag would say
        something else: that some OTHER app refused our hooks a moment ago, and
        an app already serving would go quiet for a failure that was never its
        own.
        """
        try:
            request = self._flask.request
            if _common.is_ignored(
                request, getattr(request, "path", None), self._prefixes, self._ignore
            ):
                return None
            # Installed first, handed over second, and the handover is a line of
            # its own: `g` is a proxy and setting on it can raise, and written as
            # one expression the side effect happens before the record of it.
            # Losing the Tracked loses the token inside it, and a token nobody
            # holds is a token nothing ever resets, so that case takes the
            # identity straight back down instead of leaving it ambient.
            tracked = _common.enter(self._pull_device_id, self._pull_user_id, request)
            try:
                setattr(self._flask.g, _STATE, tracked)
            except BaseException:  # noqa: BLE001
                _common.abandon(tracked)
        except BaseException:  # noqa: BLE001
            pass
        return None

    def _after(self, response: Any) -> Any:
        """Remember the status. Returns the response untouched.

        The entry is written in teardown rather than here, because teardown runs
        for a request whose view raised and this does not, and because by then
        every other ``after_request`` hook has finished with the response. All
        this one does is read the number while it exists.
        """
        try:
            tracked = self._tracked()
            if tracked is not None:
                tracked.status = getattr(response, "status_code", None)
        except BaseException:  # noqa: BLE001
            pass
        return response

    def _teardown(self, error: Any = None) -> None:
        """Write the entry and take the identity back down.

        Teardown is the half that matters: it runs whether the view returned or
        raised, so a failed request cannot leave its identity ambient for the
        next one to be stamped with.

        An unhandled exception reaches here after Flask has already turned it
        into a 500 somewhere we cannot see, so the status is whatever
        ``after_request`` saw, which for that path is nothing. A 500 written in
        here would be a guess, and with ``propagate_exceptions`` on it would be
        a wrong one: there is no response at all in that case.
        """
        tracked = self._tracked()
        if tracked is None:
            return None
        try:
            delattr(self._flask.g, _STATE)
        except BaseException:  # noqa: BLE001
            pass

        # Gathered separately from the call below, and defensively: `request` is
        # a proxy that raises rather than returning None once its context is
        # gone, and an exception on THIS line would skip the reset and leave one
        # request's identity ambient for the next one. Describing the request
        # badly is recoverable; leaking the identity is not.
        #
        # The client comes FIRST and on its own, because it is the only one of
        # these that cannot raise. Under a shared `try` it would be lost to the
        # very case the guard is here for: a teardown hook of the customer's,
        # registered later and so run earlier, that has already popped the
        # request context. That is a real arrangement, and it turned every
        # request served under it into no entry at all rather than into an entry
        # that knows the duration and not the path.
        client = _common.resolve_client(self._client)
        request = _common.attr(self._flask, "request")
        method = _common.attr(request, "method")
        path = _common.attr(request, "path")
        route = _route(request)

        # Every argument below is a local by now, and `leave` itself cannot
        # raise, so this call, the reset inside it, and the hooks Flask has
        # queued behind this one all still happen.
        _common.leave(
            client,
            tracked,
            method=method,
            path=path,
            route=route,
            error=error if isinstance(error, BaseException) else None,
        )
        return None

    def _teardown_appcontext(self, error: Any = None) -> None:
        """The backstop for the reset. It writes nothing.

        Ours is the last ``teardown_request`` hook to run and Flask's loop over
        them has no ``try`` in it, so one customer hook that raises skips it. The
        app context pops in a ``finally`` around that loop, so this list still
        runs, and ``g`` is still readable here because ``g`` belongs to the app
        context rather than to the request.

        It is reached only when :meth:`_teardown` was not, which is why it takes
        the identity down and leaves it at that: the request context is gone by
        now, so the entry it could write would carry no method, no path and no
        route, and an entry that says nothing is not worth what it is metered
        as. The half that had to happen is that the next request on this thread
        does not inherit an identity nobody passed for it.

        **It is a backstop and not a guarantee**, and the module docstring says
        where it stops: registered first, it runs last in its own list too, so a
        ``teardown_appcontext`` hook of yours that raises gets in front of it and
        the identity stays in scope. There is no later hook to move to.

        Reaching this at all means a teardown hook of yours raised, and that
        every request served in that state is a request nobody is measuring, so
        it says so once through the client's diagnostics. Once, because the hook
        that raised will raise on every request after this one as well, and a
        diagnostic per request is how a customer's sink becomes the thing
        slowing their service down.
        """
        try:
            tracked = self._tracked()
            if tracked is None:
                return None
            try:
                delattr(self._flask.g, _STATE)
            except BaseException:  # noqa: BLE001
                pass
            _common.abandon(tracked)
            if not self._reported_backstop:
                self._reported_backstop = True
                _common.report(
                    _common.resolve_client(self._client),
                    "flask teardown_request did not reach this extension, so this request "
                    "and any like it are not measured: a teardown hook registered after it "
                    "raised, and flask walks that list in reverse with no try around the "
                    "calls. The request's identity was taken back down anyway",
                )
        except BaseException:  # noqa: BLE001
            pass
        return None

    def _tracked(self) -> Optional[_common.Tracked]:
        try:
            value = getattr(self._flask.g, _STATE, None)
        except BaseException:  # noqa: BLE001
            # Outside an application context, which is where a teardown hook can
            # end up if the context was torn down under it.
            return None
        return value if isinstance(value, _common.Tracked) else None


def _wrap(extractor: Optional[Callable[[], Any]]) -> Optional[_common.Extractor]:
    """Flask's extractors take no argument; the shared helper passes one."""
    if extractor is None:
        return None
    return lambda _request: extractor()


def _route(request: Any) -> Optional[str]:
    """``/orders/<int:order_id>``, the matched rule, or None.

    ``request.url_rule`` is set by the router, so it exists by the time the
    request is being torn down and does not exist for a 404 that matched
    nothing. Werkzeug's rule is the template with its converters intact, which
    is the string this key wants.

    The resolved path is never substituted for a missing one: it would put one
    row per id in a breakdown by route, and ``url.path`` already carries it.

    Read through :func:`_common.attr`, because this runs beside a reset that has
    to happen and the proxy raises once its context is gone.
    """
    rule = _common.attr(request, "url_rule")
    if rule is None:
        return None
    return _common.attr(rule, "rule")
