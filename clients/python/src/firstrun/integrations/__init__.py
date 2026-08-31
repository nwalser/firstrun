"""HTTP middleware for the frameworks a Python server is actually written in.

One module per framework, and all three do the same three things:

* they put the request's identity in scope for the duration of it, so a view
  calls ``firstrun.event("order_placed")`` with no identity arguments at all.
  They ESTABLISH it rather than layer onto it: an id the extractor did not
  return means anonymous, and never means the one that happened to be ambient
  on this worker thread when the request arrived;
* they write ONE ``http.request`` entry per request, with the conventional
  ``http.*`` attributes and the route TEMPLATE rather than the resolved path;
* they take the identity back down afterwards, in a ``finally``, because one
  request's identity left ambient is the next request's entries stamped with
  somebody else's.

::

    from firstrun.integrations.asgi import FirstrunMiddleware
    from firstrun.integrations.django import FirstrunMiddleware, firstrun_middleware
    from firstrun.integrations.flask import FirstrunExtension

**Every identity extractor is optional and all of them are yours.** None of
these reads a cookie, a header, a session or an address on its own initiative,
and a ``user.id`` is only ever the string your own function returned. A
middleware configured with no extractors still records one entry per request,
carrying no identity at all, which is a legitimate way to run a backend. That is rule 6
and it is not a setting: an id we invented would describe the server rather than
whoever is on the other end of it, and an id we guessed at from a request would
be identity inference, which this product does not do anywhere.

None of these modules imports its framework at module scope, which is why they
are importable in an environment that has none of them installed, and why this
package still has no dependencies. Django, Flask and Starlette are read lazily,
structurally, and only where they are certainly present.

Every one of them holds to rule 7 as strictly as the client does: the
application downstream is called exactly once whatever fails in here, no
exception of ours ever reaches the host, and a middleware that cannot be
configured disables itself and passes requests through rather than refusing to
boot.
"""

from __future__ import annotations

__all__ = ["asgi", "django", "flask"]
