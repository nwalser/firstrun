using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Firstrun
{
    /// <summary>
    /// The durable queue: the pending entries, mirrored to a file, drained on next start.
    /// </summary>
    /// <remarks>
    /// Only in use when <see cref="FirstrunOptions.Persistence"/> is
    /// <see cref="FirstrunPersistence.Disk"/>. It is the only thing that makes a crash
    /// report survive the crash that produced it, and it is off by default because a
    /// desktop app leaving telemetry on somebody's disk between runs is a promise we would
    /// rather not make on their behalf.
    ///
    /// Design, and why:
    ///
    /// - <b>Line per entry, append only.</b> A crash can therefore only ever damage the
    ///   final line, and a final line with no terminator is discarded on read. A format
    ///   with a header, a footer or an index can be left in a state where the whole file
    ///   is unreadable, which loses a month of queue instead of one entry.
    ///
    /// - <b>Entries are stored as the JSON we already wrote.</b> A line is the distinct
    ///   id, the resource object and the entry object, separated by a control character
    ///   that this library's JSON writer escapes and therefore cannot emit inside a value.
    ///   Storing what we serialised means replaying it needs no JSON reader, which is the
    ///   difference between this file and a parser nobody wants to own.
    ///
    /// - <b>Bounded, dropping the oldest.</b> An app offline for a month must not fill
    ///   somebody's disk, and what survives should be recent behaviour rather than the
    ///   first hour of the outage.
    ///
    /// - <b>Rewrites go through a temp file and a rename.</b> Truncating in place and
    ///   writing over it leaves a queue that is neither the old one nor the new one if the
    ///   process dies halfway.
    ///
    /// - <b>Flushed, not fsynced.</b> Losing the last entries to a power cut is analytics.
    ///   An fsync per entry is a stall on somebody's laptop, and the trade is not close.
    ///
    /// Every method is best effort. A read-only directory or a full disk reports one
    /// diagnostic, marks the queue unusable, and leaves the client running in memory.
    /// </remarks>
    internal sealed class DiskQueue
    {
        /// <summary>The file name inside the per-app folder.</summary>
        internal const string FileName = "queue.ndjson";

        // Unit separator. Json.WriteString escapes every character below 0x20, so this
        // cannot appear inside a serialised value and splitting on it is unambiguous.
        private const char FieldSeparator = (char)0x1f;
        private const char LineFeed = (char)10;

        private readonly string _path;
        private readonly int _maxEntries;
        private readonly long _maxBytes;
        private readonly Action<Exception> _onError;
        private bool _broken;

        internal DiskQueue(string path, int maxEntries, long maxBytes, Action<Exception> onError)
        {
            _path = path;
            _maxEntries = maxEntries < 1 ? 1 : maxEntries;
            _maxBytes = maxBytes < 4096 ? 4096 : maxBytes;
            _onError = onError;
        }

        /// <summary>
        /// The queue file, beside the anonymous id: <c>%LOCALAPPDATA%\firstrun\{app}\queue.ndjson</c>
        /// on Windows, and the same folder <see cref="DeviceIdStore.ResolvePath"/> uses
        /// everywhere else.
        /// </summary>
        internal static string ResolvePath(string appFolder)
        {
            return Path.Combine(DeviceIdStore.RootDirectory(), "firstrun",
                                DeviceIdStore.Slug(appFolder), FileName);
        }

        internal string FilePath { get { return _path; } }

        /// <summary>False once a write has failed. The client then runs in memory for the rest of the run.</summary>
        internal bool IsUsable { get { return !_broken; } }

        /// <summary>
        /// Reads back what the last run left, newest first dropped to the bounds, and
        /// rewrites the file to exactly what it returned.
        /// </summary>
        /// <remarks>
        /// The rewrite is what makes a corrupt or oversized file self-healing: whatever
        /// could not be read is gone after the first launch that saw it, rather than
        /// being re-read and re-skipped on every launch forever.
        /// </remarks>
        internal List<QueuedEntry> RestoreAndCompact()
        {
            var restored = new List<QueuedEntry>();
            if (_broken) return restored;

            try
            {
                if (!File.Exists(_path)) return restored;

                string text = ReadTail();
                var lines = new List<string>();
                int start = 0;
                for (int i = 0; i < text.Length; i++)
                {
                    if (text[i] != LineFeed) continue;
                    lines.Add(text.Substring(start, i - start));
                    start = i + 1;
                }
                // Anything after the last terminator was being written when the process
                // died. It is not a line yet, so it is not an entry.

                foreach (string line in lines)
                {
                    QueuedEntry? e = Parse(line);
                    if (e != null) restored.Add(e);
                }

                if (restored.Count > _maxEntries)
                {
                    // The newest survive: a dashboard reads recent behaviour, and the
                    // first ten thousand entries of a month-long outage are not it.
                    restored.RemoveRange(0, restored.Count - _maxEntries);
                }

                Rewrite(restored);
            }
            catch (Exception ex)
            {
                Fail(ex);
                restored.Clear();
            }

            return restored;
        }

        /// <summary>Appends entries that are not on the disk yet. Never throws.</summary>
        internal void Append(List<QueuedEntry> entries)
        {
            if (_broken || entries.Count == 0) return;

            try
            {
                EnsureDirectory();
                var sb = new StringBuilder(entries.Count * 160);
                foreach (QueuedEntry e in entries) WriteLine(sb, e);

                using (var stream = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.Read))
                using (var writer = new StreamWriter(stream, Utf8))
                {
                    writer.Write(sb.ToString());
                    writer.Flush();
                }

                TrimIfOversized();
            }
            catch (Exception ex)
            {
                Fail(ex);
            }
        }

        /// <summary>
        /// Replaces the file with exactly <paramref name="entries"/>. Called after a
        /// successful send, so what the server accepted stops being replayed next launch.
        /// </summary>
        internal void Rewrite(List<QueuedEntry> entries)
        {
            if (_broken) return;

            try
            {
                EnsureDirectory();

                if (entries.Count == 0)
                {
                    if (File.Exists(_path)) File.Delete(_path);
                    return;
                }

                var sb = new StringBuilder(entries.Count * 160);
                foreach (QueuedEntry e in entries) WriteLine(sb, e);

                string tmp = _path + ".tmp";
                using (var stream = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream, Utf8))
                {
                    writer.Write(sb.ToString());
                    writer.Flush();
                }

                if (File.Exists(_path)) File.Delete(_path);
                File.Move(tmp, _path);
            }
            catch (Exception ex)
            {
                Fail(ex);
            }
        }

        // -------------------------------------------------------------------

        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        private void EnsureDirectory()
        {
            string? dir = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir!);
        }

        private void Fail(Exception ex)
        {
            // One report, then quiet. A disk that refused one write will refuse the next
            // ten thousand, and a diagnostics handler is not a place to put a loop.
            if (_broken) return;
            _broken = true;
            _onError(ex);
        }

        /// <summary>
        /// Reads the file, or its last <see cref="_maxBytes"/> when something has grown it
        /// past the bound. The first partial line of a tail read is dropped by the caller,
        /// because it starts mid-entry.
        /// </summary>
        private string ReadTail()
        {
            using (var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                long length = stream.Length;
                if (length > _maxBytes) stream.Seek(length - _maxBytes, SeekOrigin.Begin);
                using (var reader = new StreamReader(stream, Utf8))
                {
                    string text = reader.ReadToEnd();
                    if (length <= _maxBytes) return text;
                    int firstLine = text.IndexOf(LineFeed);
                    return firstLine < 0 ? "" : text.Substring(firstLine + 1);
                }
            }
        }

        private void TrimIfOversized()
        {
            var info = new FileInfo(_path);
            if (!info.Exists || info.Length <= _maxBytes) return;
            Rewrite(RestoreLines());
        }

        private List<QueuedEntry> RestoreLines()
        {
            var kept = new List<QueuedEntry>();
            string text = ReadTail();
            int start = 0;
            for (int i = 0; i < text.Length; i++)
            {
                if (text[i] != LineFeed) continue;
                QueuedEntry? e = Parse(text.Substring(start, i - start));
                if (e != null) kept.Add(e);
                start = i + 1;
            }
            if (kept.Count > _maxEntries) kept.RemoveRange(0, kept.Count - _maxEntries);
            return kept;
        }

        private static void WriteLine(StringBuilder sb, QueuedEntry e)
        {
            sb.Append(e.ResourceJson ?? "");
            sb.Append(FieldSeparator);
            BatchWriter.WriteEntry(sb, e);
            sb.Append(LineFeed);
        }

        /// <summary>
        /// Reads one line back into a sendable entry, or null when the line is not one.
        /// </summary>
        /// <remarks>
        /// The two JSON halves are carried through as text and never inspected: whatever
        /// this client serialised is what it posts, so a line written by a newer version
        /// with fields this one has never heard of still sends correctly.
        /// </remarks>
        private static QueuedEntry? Parse(string line)
        {
            if (line.Length == 0) return null;

            int first = line.IndexOf(FieldSeparator);
            if (first < 0) return null;

            string resource = line.Substring(0, first);
            string entry = line.Substring(first + 1);

            // A line the writer did not finish, or one a text editor has been through.
            if (entry.Length < 2 || entry[0] != '{' || entry[entry.Length - 1] != '}') return null;
            if (resource.Length > 0 && (resource[0] != '{' || resource[resource.Length - 1] != '}')) return null;

            return new QueuedEntry(
                Guid.NewGuid().ToString("D"),
                FirstrunNames.Log,
                0,
                0,
                null,
                resource.Length == 0 ? null : resource,
                entry);
        }
    }
}
