"""firstrun: one analytics backend for everything you ship.

    import firstrun

    firstrun.configure(source_key="fr_server_9f3a2b1c4d5e6f70", host="https://t.example.com")
    firstrun.track("exported_csv", {"rows": 1200})

**This library is never in your program's critical path.** Every call appends to
a bounded in-memory queue and returns. Nothing blocks on the network, nothing
raises into your code, and nothing is written to your stdout or stderr. If the
ingest host is unreachable, slow, or returning errors, the worst that happens is
that some analytics are lost.

The module-level functions above are a convenience over a single process-wide
:class:`Firstrun`. Before :func:`configure` they are silent no-ops, so a program
that never configures one never notices this library exists. Construct
:class:`Firstrun` directly when you want more than one, or when you would rather
not have process-global state.
"""

from __future__ import annotations

import threading
from typing import Any, Mapping, Optional

from ._client import (
    DELIVERY_MODES,
    DISK,
    IMMEDIATE,
    INTERVAL,
    MANUAL,
    MEMORY,
    PERSISTENCE_MODES,
    STARTUP,
    Diagnostic,
    Firstrun,
    Stats,
)
from ._ids import resolve_path as distinct_id_path
from ._spool import resolve_path as queue_path
from ._wire import (
    APP_INSTALL,
    APP_LAUNCH,
    ATTR_BODY,
    ATTR_CHANNEL,
    ATTR_DURATION_MS,
    ATTR_EXCEPTION_MESSAGE,
    ATTR_EXCEPTION_STACKTRACE,
    ATTR_EXCEPTION_TYPE,
    ATTR_HTTP_REQUEST_METHOD,
    ATTR_HTTP_RESPONSE_STATUS_CODE,
    ATTR_HTTP_ROUTE,
    ATTR_METRIC,
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
    ATTR_SESSION_ID,
    ATTR_UNIT,
    ATTR_URL_PATH,
    ATTR_USER_ID,
    ATTR_VALUE,
    DEBUG,
    ERROR,
    EXCEPTION,
    FATAL,
    HTTP_REQUEST,
    IDENTIFY,
    INFO,
    LOG,
    LOG_NAME_MAX,
    LOG_NAME_RE,
    MEASUREMENT,
    PAGE_VIEW,
    SESSION_START,
    SOURCE_KEY_RE,
    SURFACES,
    TRACE,
    WARN,
    is_log_name,
    severity_number,
    severity_text,
    surface_from_source_key,
)

__version__ = "0.1.0"

__all__ = [
    "Firstrun",
    "Diagnostic",
    "Stats",
    "configure",
    "get_client",
    "log",
    "event",
    "error",
    "trace",
    "debug",
    "info",
    "warn",
    "error_log",
    "fatal",
    "page",
    "identify",
    "reset",
    "flush",
    "shutdown",
    "stats",
    "distinct_id_path",
    "queue_path",
    "IMMEDIATE",
    "INTERVAL",
    "STARTUP",
    "MANUAL",
    "DELIVERY_MODES",
    "MEMORY",
    "DISK",
    "PERSISTENCE_MODES",
    "is_log_name",
    "severity_number",
    "severity_text",
    "surface_from_source_key",
    "SURFACES",
    "SOURCE_KEY_RE",
    "LOG_NAME_RE",
    "LOG_NAME_MAX",
    "TRACE",
    "DEBUG",
    "INFO",
    "WARN",
    "ERROR",
    "FATAL",
    "PAGE_VIEW",
    "SESSION_START",
    "APP_INSTALL",
    "APP_LAUNCH",
    "IDENTIFY",
    "EXCEPTION",
    "HTTP_REQUEST",
    "MEASUREMENT",
    "LOG",
    "ATTR_BODY",
    "ATTR_CHANNEL",
    "ATTR_DURATION_MS",
    "ATTR_EXCEPTION_MESSAGE",
    "ATTR_EXCEPTION_STACKTRACE",
    "ATTR_EXCEPTION_TYPE",
    "ATTR_HTTP_REQUEST_METHOD",
    "ATTR_HTTP_RESPONSE_STATUS_CODE",
    "ATTR_HTTP_ROUTE",
    "ATTR_METRIC",
    "ATTR_SERVICE_NAME",
    "ATTR_SERVICE_VERSION",
    "ATTR_SESSION_ID",
    "ATTR_UNIT",
    "ATTR_URL_PATH",
    "ATTR_USER_ID",
    "ATTR_VALUE",
    "__version__",
]

_default: Optional[Firstrun] = None
_default_lock = threading.Lock()


def configure(source_key: str, host: str, **options: Any) -> Firstrun:
    """Create the process-wide client. Returns it, so you can keep a reference.

    Calling this twice closes the previous client first: a reconfigure is a
    reconfigure, not a second sender quietly running alongside the first.
    Accepts every keyword :class:`Firstrun` accepts.
    """
    global _default
    with _default_lock:
        previous = _default
        _default = Firstrun(source_key, host, **options)
    if previous is not None:
        try:
            previous.close(timeout=1.0)
        except BaseException:
            pass
    return _default


def get_client() -> Optional[Firstrun]:
    """The process-wide client, or None when :func:`configure` has not been called."""
    return _default


def log(name: str, **kwargs: Any) -> None:
    """Record one log entry on the process-wide client.

    A no-op before :func:`configure`, so a program that never configures one
    never notices this library exists.
    """
    client = _default
    if client is not None:
        client.log(name, **kwargs)


def event(name: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
    """A conventional product event, at INFO."""
    client = _default
    if client is not None:
        client.event(name, attributes, **kwargs)


def error(err: BaseException, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
    """A conventional exception entry, at ERROR, with the exception unwrapped."""
    client = _default
    if client is not None:
        client.error(err, attributes, **kwargs)


def trace(body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
    """A line at TRACE."""
    client = _default
    if client is not None:
        client.trace(body, attributes, **kwargs)


def debug(body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
    """A line at DEBUG."""
    client = _default
    if client is not None:
        client.debug(body, attributes, **kwargs)


def info(body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
    """A line at INFO."""
    client = _default
    if client is not None:
        client.info(body, attributes, **kwargs)


def warn(body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
    """A line at WARN."""
    client = _default
    if client is not None:
        client.warn(body, attributes, **kwargs)


def error_log(body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
    """A line at ERROR with no exception to unwrap."""
    client = _default
    if client is not None:
        client.error_log(body, attributes, **kwargs)


def fatal(body: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
    """A line at FATAL."""
    client = _default
    if client is not None:
        client.fatal(body, attributes, **kwargs)


def page(path: str, attributes: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> None:
    """A server-rendered page view, with the path as the ``url.path`` attribute."""
    client = _default
    if client is not None:
        client.page(path, attributes, **kwargs)


def identify(user_id: Optional[str], attributes: Optional[Mapping[str, Any]] = None) -> None:
    """Attach your own user id to everything sent from now on."""
    client = _default
    if client is not None:
        client.identify(user_id, attributes)


def reset() -> None:
    """Forget the user id and start a new session. The anonymous id is kept."""
    client = _default
    if client is not None:
        client.reset()


def flush(timeout: Optional[float] = None) -> bool:
    """Send now. With a timeout, wait up to that long and report whether it all went."""
    client = _default
    return client.flush(timeout) if client is not None else False


def shutdown(timeout: float = 3.0) -> bool:
    """Flush with a bounded wait and stop the worker. Optional: atexit does this too."""
    client = _default
    return client.close(timeout) if client is not None else True


def stats() -> Optional[Stats]:
    """Counters from the process-wide client, or None when there is not one."""
    client = _default
    return client.stats() if client is not None else None
