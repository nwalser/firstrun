"""The anonymous per-install id, and where it lives.

One id per (user account, machine, app). It is generated here, it is never
received from the server, and it is never joined to another source's id: a
browser visitor and this installation are two different anonymous people,
always.

Whether this is a first run is decided by whether the file existed, not by a
flag written afterwards, so a crash between the two cannot make a second run
look like a first one.
"""

from __future__ import annotations

import os
import re
import uuid
from typing import Callable, Optional, Tuple

from ._wire import ID_MAX, os_name

FILE_NAME = "distinct_id"

_SLUG_RE = re.compile(r"[^a-z0-9._-]+")


def _root_directory() -> str:
    system = os_name()

    if system == "windows":
        # LOCALAPPDATA, deliberately, and not APPDATA.
        #
        # A roaming profile syncs the roaming AppData folder between machines, so one
        # person signing in to three of them would share a single distinct_id and read
        # as one installation instead of three. distinct_id identifies an INSTALLATION,
        # and the Local folder is what means "this machine" on Windows. Tying somebody
        # across machines is what identify() is for.
        local = os.environ.get("LOCALAPPDATA")
        if local:
            return local
        return os.path.join(os.path.expanduser("~"), "AppData", "Local")

    if system == "macos":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support")

    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        return xdg
    return os.path.join(os.path.expanduser("~"), ".local", "share")


def slug(raw: str) -> str:
    """A folder name that is safe on every filesystem this library targets."""
    if not raw:
        return "default"
    cleaned = _SLUG_RE.sub("-", raw.lower()).strip("-.")
    return (cleaned or "default")[:64]


def resolve_path(app_folder: str) -> str:
    r"""The exact file the anonymous id is read from and written to.

    - Windows: ``%LOCALAPPDATA%\firstrun\{app}\distinct_id`` (local, NOT
      roaming, e.g. ``C:\Users\you\AppData\Local\firstrun\my-app\distinct_id``)
    - macOS: ``~/Library/Application Support/firstrun/{app}/distinct_id``
    - Linux and other Unix: ``$XDG_DATA_HOME/firstrun/{app}/distinct_id``, or
      ``~/.local/share/firstrun/{app}/distinct_id`` when XDG_DATA_HOME is unset

    ``{app}`` is ``app_name`` slugged, or the source key when ``app_name`` is unset.
    """
    return os.path.join(_root_directory(), "firstrun", slug(app_folder), FILE_NAME)


def load_or_create(
    app_folder: str,
    on_error: Optional[Callable[[BaseException], None]] = None,
) -> Tuple[str, bool, Optional[str]]:
    """Return ``(distinct_id, is_first_run, path)``.

    Never raises. A read-only filesystem, a full disk or a container without a
    home directory gets a per-process id and a diagnostic, not an exception in
    the caller's import path.
    """
    try:
        path: Optional[str] = resolve_path(app_folder)
    except BaseException as exc:  # pragma: no cover - a broken HOME is rare
        if on_error:
            on_error(exc)
        return str(uuid.uuid4()), True, None

    assert path is not None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            existing = handle.read().strip()
        if existing and len(existing) <= ID_MAX:
            return existing, False, path
    except FileNotFoundError:
        pass
    except BaseException as exc:
        if on_error:
            on_error(exc)

    new_id = str(uuid.uuid4())
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # Write then replace, so a crash leaves either no file or a complete
        # one. A half-written id read on the next launch would be a second
        # install, and os.replace is atomic on both Windows and POSIX.
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(new_id)
        os.replace(tmp, path)
    except BaseException as exc:
        if on_error:
            on_error(exc)
        # The id still works for this process. Losing it on exit is a worse
        # number, not a broken program.
        return new_id, True, None

    return new_id, True, path
