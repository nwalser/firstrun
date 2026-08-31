"""Where this library is allowed to write on each platform.

It used to mint and persist an anonymous per-install id here. It does not any
more: `user.id`, `device.id` and `session.id` are three OPTIONAL things the
host states, and a library that invented one so that every entry had something
to be attributed to was inventing data. A server process is not a machine and
not a person, and an id that says otherwise is worse than no id.

What is left is the directory, which the disk queue still needs.
"""

from __future__ import annotations

import os
import re

from ._wire import os_name

_SLUG_RE = re.compile(r"[^a-z0-9._-]+")


def _root_directory() -> str:
    system = os_name()

    if system == "windows":
        # LOCALAPPDATA, deliberately, and not APPDATA. A roaming profile syncs
        # the roaming AppData folder between machines, and a queue of unsent
        # entries following somebody onto a second machine is a queue sent twice.
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


def app_dir(app_folder: str) -> str:
    r"""The directory this library may write in, for one app.

    - Windows: ``%LOCALAPPDATA%\firstrun\{app}`` (local, NOT roaming)
    - macOS: ``~/Library/Application Support/firstrun/{app}``
    - Linux and other Unix: ``$XDG_DATA_HOME/firstrun/{app}``, or
      ``~/.local/share/firstrun/{app}`` when XDG_DATA_HOME is unset

    ``{app}`` is ``app_name`` slugged, or the source key when ``app_name`` is unset.
    """
    return os.path.join(_root_directory(), "firstrun", slug(app_folder))
