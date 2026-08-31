"""One POST to ``/v1/e``, using only the standard library.

``urllib.request`` rather than ``requests`` because a telemetry library has no
business adding a dependency to the program it is measuring, and no business
being the reason two packages disagree about a urllib3 version.

The cost is that urllib opens a fresh connection per batch rather than pooling
one. At one batch every few seconds that is a handshake we can afford, and it
removes the whole class of bugs where a pooled socket went stale during an
outage and the first send after recovery fails for no visible reason.
"""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from typing import Any, Dict, List, NamedTuple, Optional

ACCEPTED = "accepted"
"""The server took it. Drop the batch."""

REJECTED = "rejected"
"""The server will say no again in an hour. Drop the batch, do not retry."""

TRANSIENT = "transient"
"""Offline, timed out, rate limited, or a bad day at the server. Keep the batch."""


class SendResult(NamedTuple):
    outcome: str
    detail: str
    retry_after: Optional[float] = None


def build_batch(
    source_key: str,
    resource: Optional[Dict[str, Any]],
    entries: List[Dict[str, Any]],
) -> bytes:
    """The LogBatch body, as UTF-8 JSON.

    The keys are one letter because this is the same body the browser tag posts
    from ``sendBeacon`` on a page being unloaded, where bytes are the constraint:
    one shape for every client rather than a compact browser dialect beside a
    verbose SDK one. ``k`` is the source key, ``r`` the resource and ``e`` the
    entries. There is no top-level id field: identity is three optional
    attributes and they travel in ``r`` like everything else about the client.

    ``r`` carries what is true of the whole PROCESS rather than of one entry: the
    service, the build, the operating system. It sits once per body because it
    does not change between two entries in the same request, and repeating it 200
    times is 200 copies of the same strings. The edge merges it UNDER each
    entry's own attributes, so an entry that sets the same key wins.

    Keys the server does not define are never added, and an empty resource is
    left out rather than sent as an empty object.

    Source of truth: ``LogBatch`` in ``packages/schema/src/log.ts``.
    """
    body: Dict[str, Any] = {"k": source_key, "e": entries}
    if resource:
        body["r"] = resource

    # allow_nan=False so a NaN that slipped through the attribute cleaner raises
    # here, where the caller can drop one batch, rather than being written as the
    # bare literal `NaN` that the server's JSON parser rejects along with every
    # entry travelling beside it.
    return json.dumps(
        body, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


class Transport:
    """Sends one batch. Returns a result; never raises."""

    def __init__(self, host: str, timeout: float, ssl_context: Optional[ssl.SSLContext] = None) -> None:
        self.url = host.rstrip("/") + "/v1/e"
        self.timeout = timeout
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ssl_context) if ssl_context else urllib.request.HTTPSHandler(),
            # No redirects. An analytics POST that gets 302'd somewhere is a
            # misconfiguration, not something to follow.
            _NoRedirect(),
        )

    def send(self, body: bytes) -> SendResult:
        request = urllib.request.Request(
            self.url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
                # No cookies, no auth, no identifying header. The source key in
                # the body is the whole of what we tell the server about us.
                "User-Agent": "firstrun-python",
                "Connection": "close",
            },
        )

        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                # Read and discard. There is nothing in the body the client can
                # act on that the status code has not already said.
                try:
                    response.read(4096)
                except Exception:
                    pass
                status = int(getattr(response, "status", None) or response.getcode() or 0)
                if 200 <= status < 300:
                    return SendResult(ACCEPTED, str(status))
                return SendResult(TRANSIENT, "http %d" % status)

        except urllib.error.HTTPError as exc:
            status = int(exc.code)
            retry_after = _retry_after(exc)
            try:
                exc.read()
                exc.close()
            except Exception:
                pass

            # A redirect we refused to follow. The host is misconfigured, and it
            # will still be misconfigured in an hour, so this is not a retry.
            if 300 <= status < 400:
                return SendResult(REJECTED, "http %d (redirect)" % status)

            # 408 and 429 are the two 4xx that mean "later", not "never".
            if status in (408, 429):
                return SendResult(TRANSIENT, "http %d" % status, retry_after)
            if 400 <= status < 500:
                # A malformed batch, or a source key that no longer exists.
                # Retrying it forever would wedge every later event behind it.
                return SendResult(REJECTED, "http %d" % status)
            return SendResult(TRANSIENT, "http %d" % status, retry_after)

        except Exception as exc:
            # Offline, DNS failure, TLS failure, timeout, a proxy having
            # opinions. All of it is "try again later" and none of it is the
            # host program's problem.
            return SendResult(TRANSIENT, "%s: %s" % (type(exc).__name__, exc))


def _retry_after(exc: "urllib.error.HTTPError") -> Optional[float]:
    try:
        raw = exc.headers.get("Retry-After") if exc.headers else None
        if not raw:
            return None
        return float(int(str(raw).strip()))
    except Exception:
        # A date-form Retry-After, or nonsense. The backoff covers us either way.
        return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None
