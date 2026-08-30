"""The durable half of the queue: what is still there after the process is gone.

Only reached when ``persistence="disk"``. Scheduling and durability are two
axes, not one (``docs/delivery-policy.md``): this file is the whole of the
durability axis, and it knows nothing about when a send is attempted.

Two properties matter more than speed here.

**It never raises.** A read-only filesystem, a full disk, a container with no
home directory: all of it is a diagnostic and a client that carries on in
memory. Telemetry is never worth an exception in the host program.

**A crash leaves either the old file or the new one.** The spool is rewritten
temp-then-``os.replace``, which is atomic on POSIX and on Windows, so a kill in
the middle of a write cannot produce a half-line that eats the entries beside
it on the next launch.

The file is NOT deleted once it has been read. It is overwritten by the next
save with whatever is still pending, so a crash between load and the first save
replays entries rather than losing them. Replaying is safe because every entry
carries the id it was created with and the server deduplicates on it; losing a
crash report because we tidied up first is not.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import _ids

FILE_NAME = "queue.jsonl"

#: One queued entry: the distinct id it belongs to, and the wire entry itself.
Item = Tuple[str, Dict[str, Any]]


def resolve_path(app_folder: str) -> str:
    r"""Where the pending queue lives, beside the anonymous id.

    - Windows: ``%LOCALAPPDATA%\firstrun\{app}\queue.jsonl``
    - macOS: ``~/Library/Application Support/firstrun/{app}/queue.jsonl``
    - Linux and other Unix: ``$XDG_DATA_HOME/firstrun/{app}/queue.jsonl``, or
      ``~/.local/share/firstrun/{app}/queue.jsonl`` when XDG_DATA_HOME is unset
    """
    return os.path.join(os.path.dirname(_ids.resolve_path(app_folder)), FILE_NAME)


class Spool:
    """A bounded, line-delimited file holding the entries not yet sent."""

    def __init__(
        self,
        path: str,
        max_entries: int,
        max_bytes: int,
        on_error: Optional[Callable[[str, BaseException], None]] = None,
    ) -> None:
        self.path = path
        self.max_entries = max(1, int(max_entries))
        # Bounded on disk as well as in count, because one entry may carry a 16KB
        # body and a bound on the count alone is not a bound on the disk.
        self.max_bytes = max(4096, int(max_bytes))
        self._on_error = on_error

    def open(self) -> bool:
        """Make sure the directory exists. False means fall back to memory."""
        try:
            directory = os.path.dirname(self.path)
            if directory:
                os.makedirs(directory, exist_ok=True)
            return True
        except BaseException as exc:  # noqa: BLE001 - a spool is never worth an exception
            self._report("could not create the queue directory", exc)
            return False

    def load(self) -> List[Item]:
        """Everything that survived the last run, oldest first. Never raises."""
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                lines = handle.read().splitlines()
        except FileNotFoundError:
            return []
        except BaseException as exc:  # noqa: BLE001
            self._report("could not read the queued entries", exc)
            return []

        items: List[Item] = []
        for line in lines:
            if not line:
                continue
            try:
                # A truncated last line, or a file somebody edited, loses itself
                # rather than the entries around it.
                record = json.loads(line)
                distinct_id = record["d"]
                entry = record["e"]
                if isinstance(distinct_id, str) and distinct_id and isinstance(entry, dict):
                    items.append((distinct_id, entry))
            except BaseException:
                continue

        # The bound applies to what was read as well as to what is written: a
        # file grown by an older build with a larger limit is not a licence to
        # load all of it into memory.
        if len(items) > self.max_entries:
            items = items[-self.max_entries :]
        return items

    def save(self, items: List[Item]) -> int:
        """Rewrite the spool as exactly ``items``. Returns how many were dropped.

        Over either bound the OLDEST go, which is the same rule the in-memory
        queue uses: a process that has been offline for a week should report this
        week, not the first few thousand entries of the outage.
        """
        if not items:
            self.clear()
            return 0

        kept: List[bytes] = []
        total = 0
        dropped = 0
        # Backwards, so the entries that survive a bound are the newest ones.
        for distinct_id, entry in reversed(items):
            try:
                line = json.dumps(
                    {"d": distinct_id, "e": entry},
                    separators=(",", ":"),
                    ensure_ascii=False,
                    allow_nan=False,
                ).encode("utf-8")
            except BaseException:
                # One unserialisable entry costs itself and not the file.
                dropped += 1
                continue
            if len(kept) >= self.max_entries or total + len(line) + 1 > self.max_bytes:
                dropped += 1
                continue
            kept.append(line)
            total += len(line) + 1
        kept.reverse()

        if not kept:
            self.clear()
            return dropped

        tmp = self.path + ".tmp"
        try:
            directory = os.path.dirname(self.path)
            if directory:
                os.makedirs(directory, exist_ok=True)
            with open(tmp, "wb") as handle:
                handle.write(b"\n".join(kept) + b"\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
        except BaseException as exc:  # noqa: BLE001
            self._report("could not write the queued entries", exc)
            try:
                os.remove(tmp)
            except BaseException:
                pass
            return dropped

        return dropped

    def clear(self) -> None:
        """Remove the spool. An empty file and no file mean the same thing."""
        try:
            os.remove(self.path)
        except FileNotFoundError:
            pass
        except BaseException as exc:  # noqa: BLE001
            self._report("could not clear the queued entries", exc)

    def _report(self, message: str, error: BaseException) -> None:
        if self._on_error is not None:
            try:
                self._on_error(message, error)
            except BaseException:
                pass
