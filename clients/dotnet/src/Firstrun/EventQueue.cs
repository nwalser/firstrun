using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Firstrun
{
    /// <summary>One log entry, already bounded, waiting to be sent.</summary>
    internal sealed class QueuedEntry
    {
        /// <summary>
        /// Separates the two halves of <see cref="GroupKey"/>. A control character rather
        /// than punctuation, because both halves are customer data and could contain any
        /// separator we might have picked: a collision would file one install's entries
        /// under another's.
        /// </summary>
        private const char Separator = (char)1;

        internal QueuedEntry(string id, string name, long timestamp, int severity,
                             Dictionary<string, object?>? attributes,
                             string? resourceJson, string? rawEntryJson = null,
                             bool durable = true)
        {
            Durable = durable;
            Id = id;
            Name = name;
            Timestamp = timestamp;
            Severity = severity;
            Attributes = attributes;
            ResourceJson = resourceJson;
            RawEntryJson = rawEntryJson;
            GroupKey = resourceJson ?? "";
        }

        /// <summary>Client-generated, so a request that times out and is retried dedups.</summary>
        internal string Id { get; }

        internal string Name { get; }

        /// <summary>When it happened, ms since epoch. Client-stamped and authoritative.</summary>
        internal long Timestamp { get; }

        /// <summary>1..24 on the ladder, or 0 for an entry nobody classified.</summary>
        internal int Severity { get; }

        /// <summary>
        /// The resource object, already serialised, or null when there is nothing to say.
        /// </summary>
        /// <remarks>
        /// Serialised once per client rather than per entry: none of it changes while the
        /// process runs. Keeping it as text is also what lets an entry read back off the
        /// disk be sent without a JSON reader.
        /// </remarks>
        internal string? ResourceJson { get; }

        /// <summary>The resource flattened into one comparable key. Identity lives in it.</summary>
        internal string GroupKey { get; }

        internal Dictionary<string, object?>? Attributes { get; }

        /// <summary>
        /// The entry object as it was written to the durable queue, for an entry restored
        /// from a previous run. Null for one recorded in this process.
        /// </summary>
        internal string? RawEntryJson { get; }

        /// <summary>
        /// Whether this entry belongs in the durable queue. False for one below
        /// <see cref="FirstrunOptions.PersistFromSeverity"/>, which stays in memory even
        /// while the client is persisting everything else.
        /// </summary>
        internal bool Durable { get; }

        /// <summary>
        /// Position in the queue, assigned under the queue's lock so it is monotonic in
        /// enqueue order. The durable queue uses it to know what it has already written.
        /// </summary>
        internal long Seq { get; set; }
    }

    /// <summary>A flush barrier: completes once everything queued before it has been sent or dropped.</summary>
    internal sealed class FlushMarker
    {
        internal readonly TaskCompletionSource<bool> Completion =
            new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    /// <summary>
    /// The bounded in-memory queue.
    /// </summary>
    /// <remarks>
    /// A ring in a list. Enqueue takes a lock, appends, and returns: that is the whole
    /// cost on the caller's thread, and it is why <c>Track</c> cannot block on the
    /// network no matter what the network is doing.
    ///
    /// When it is full the OLDEST events go. An app that has been offline for a week
    /// should report this week's behaviour, not the first ten thousand events after
    /// the outage started. Flush markers are never dropped, or a caller awaiting one
    /// would wait for the timeout every time.
    /// </remarks>
    internal sealed class EventQueue
    {
        private readonly object _gate = new object();
        private readonly LinkedList<object> _items = new LinkedList<object>();
        private readonly int _capacity;
        private int _entryCount;
        private long _dropped;
        // Assigned here rather than by the caller so it is monotonic in the order entries
        // actually landed in the queue. The durable queue writes everything past a
        // watermark, and a watermark only works if nothing can arrive behind it.
        private long _seq;

        internal EventQueue(int capacity)
        {
            _capacity = capacity < 1 ? 1 : capacity;
        }

        internal int Count { get { lock (_gate) { return _entryCount; } } }

        internal long Dropped { get { lock (_gate) { return Interlocked.Read(ref _dropped); } } }

        /// <summary>Appends an event, dropping the oldest if that puts us over capacity.</summary>
        /// <returns>How many events were dropped to make room.</returns>
        internal int Enqueue(QueuedEntry e)
        {
            int dropped = 0;
            lock (_gate)
            {
                e.Seq = ++_seq;
                _items.AddLast(e);
                _entryCount++;
                while (_entryCount > _capacity)
                {
                    if (!DropOldestEntryLocked()) break;
                    dropped++;
                }
                _dropped += dropped;
            }
            return dropped;
        }

        internal void EnqueueMarker(FlushMarker marker)
        {
            lock (_gate) { _items.AddLast(marker); }
        }

        /// <summary>
        /// Puts a failed batch back at the front, keeping its order. If that overflows,
        /// the oldest go: the requeued events are the oldest, so a queue under sustained
        /// pressure sheds the stale batch rather than the events that just happened.
        /// </summary>
        internal int RequeueFront(List<QueuedEntry> batch)
        {
            int dropped = 0;
            lock (_gate)
            {
                for (int i = batch.Count - 1; i >= 0; i--)
                {
                    _items.AddFirst(batch[i]);
                    _entryCount++;
                }
                while (_entryCount > _capacity)
                {
                    if (!DropOldestEntryLocked()) break;
                    dropped++;
                }
                _dropped += dropped;
            }
            return dropped;
        }

        private bool DropOldestEntryLocked()
        {
            for (LinkedListNode<object>? node = _items.First; node != null; node = node.Next)
            {
                if (node.Value is QueuedEntry)
                {
                    _items.Remove(node);
                    _entryCount--;
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Takes up to <paramref name="max"/> events off the front, plus every flush
        /// marker up to the last event taken. The markers are returned so the worker can
        /// complete them once the events ahead of them have actually gone.
        /// </summary>
        internal void Drain(int max, List<QueuedEntry> events, List<FlushMarker> markers)
        {
            lock (_gate)
            {
                while (_items.First != null && events.Count < max)
                {
                    object value = _items.First.Value;
                    _items.RemoveFirst();
                    if (value is QueuedEntry e)
                    {
                        events.Add(e);
                        _entryCount--;
                    }
                    else
                    {
                        markers.Add((FlushMarker)value);
                    }
                }

                // A marker sitting immediately behind the batch limit still only
                // guarantees what was queued before it, and everything before it is in
                // this batch. Taking it now saves a whole flush interval of waiting.
                while (_items.First != null && _items.First.Value is FlushMarker m)
                {
                    _items.RemoveFirst();
                    markers.Add(m);
                }
            }
        }

        /// <summary>
        /// Copies every pending entry whose <see cref="QueuedEntry.Seq"/> is past
        /// <paramref name="since"/>, in queue order, and reports the highest seq it saw.
        /// </summary>
        /// <remarks>
        /// This is how the durable queue learns what it has not written yet without
        /// holding a second copy of the queue. A requeued batch keeps its original seq, so
        /// entries that already reached the disk are not written twice.
        /// </remarks>
        internal long SnapshotSince(long since, List<QueuedEntry> into)
        {
            long highest = since;
            lock (_gate)
            {
                for (LinkedListNode<object>? node = _items.First; node != null; node = node.Next)
                {
                    if (node.Value is QueuedEntry e && e.Seq > since)
                    {
                        into.Add(e);
                        if (e.Seq > highest) highest = e.Seq;
                    }
                }
            }
            return highest;
        }

        /// <summary>Copies every pending entry, in queue order, and reports the highest seq.</summary>
        internal long SnapshotAll(List<QueuedEntry> into)
        {
            return SnapshotSince(0, into);
        }

        /// <summary>Completes every outstanding marker. Used on shutdown so nobody awaits forever.</summary>
        internal void ReleaseAllMarkers(bool result)
        {
            var pending = new List<FlushMarker>();
            lock (_gate)
            {
                LinkedListNode<object>? node = _items.First;
                while (node != null)
                {
                    LinkedListNode<object>? next = node.Next;
                    if (node.Value is FlushMarker m)
                    {
                        pending.Add(m);
                        _items.Remove(node);
                    }
                    node = next;
                }
            }
            foreach (FlushMarker m in pending) m.Completion.TrySetResult(result);
        }
    }

    /// <summary>Turns a run of queued entries into the LogBatch JSON the server parses.</summary>
    internal static class BatchWriter
    {
        /// <summary>
        /// Groups by identity and resource, because those two sit on the batch and not on
        /// the entry. Order within a group is preserved; groups keep the order their first
        /// entry appeared in.
        /// </summary>
        internal static List<List<QueuedEntry>> Group(List<QueuedEntry> entries, int maxBatch)
        {
            var order = new List<string>();
            var groups = new Dictionary<string, List<QueuedEntry>>(StringComparer.Ordinal);

            foreach (QueuedEntry e in entries)
            {
                if (!groups.TryGetValue(e.GroupKey, out List<QueuedEntry>? bucket))
                {
                    bucket = new List<QueuedEntry>();
                    groups[e.GroupKey] = bucket;
                    order.Add(e.GroupKey);
                }
                bucket.Add(e);
            }

            var result = new List<List<QueuedEntry>>();
            foreach (string key in order)
            {
                List<QueuedEntry> bucket = groups[key];
                for (int i = 0; i < bucket.Count; i += maxBatch)
                {
                    int take = Math.Min(maxBatch, bucket.Count - i);
                    result.Add(bucket.GetRange(i, take));
                }
            }
            return result;
        }

        /// <summary>
        /// The LogBatch body, exactly. Field names are the contract; do not add any.
        /// </summary>
        /// <remarks>
        /// The keys are one letter because this is the same body the browser tag posts
        /// from <c>sendBeacon</c> on a page being unloaded, where bytes are the
        /// constraint: one shape for every client rather than a compact browser dialect
        /// beside a verbose SDK one.
        /// <para>
        /// <c>r</c> is the resource: what is true of the whole PROCESS rather than of one
        /// entry. It sits once per body because it does not change between two entries in
        /// the same request, and repeating it 250 times is 250 copies of one string. The
        /// edge merges it UNDER each entry's own attributes, so an entry that sets the
        /// same key wins.
        /// </para>
        /// <para>
        /// Source of truth: <c>LogBatch</c> in <c>packages/schema/src/log.ts</c>.
        /// </para>
        /// </remarks>
        internal static string Write(FirstrunOptions options, List<QueuedEntry> batch)
        {
            var sb = new StringBuilder(256 + batch.Count * 128);
            sb.Append('{');
            bool first = true;

            Json.WriteRequired(sb, "k", options.SourceKey, ref first);

            string? resource = batch[0].ResourceJson;
            if (!string.IsNullOrEmpty(resource))
            {
                if (!first) sb.Append(',');
                first = false;
                Json.WriteString(sb, "r");
                sb.Append(':').Append(resource);
            }

            if (!first) sb.Append(',');
            Json.WriteString(sb, "e");
            sb.Append(":[");
            for (int i = 0; i < batch.Count; i++)
            {
                if (i > 0) sb.Append(',');
                WriteEntry(sb, batch[i]);
            }
            sb.Append("]}");
            return sb.ToString();
        }

        /// <summary>
        /// One entry object, the same bytes whether it is going to the socket or to the
        /// durable queue.
        /// </summary>
        /// <remarks>
        /// An entry read back from a previous run is already serialised, and is written
        /// through verbatim. That is what lets the durable queue exist without a JSON
        /// reader: the client writes JSON, stores what it wrote, and posts it later.
        /// </remarks>
        internal static void WriteEntry(StringBuilder sb, QueuedEntry e)
        {
            if (e.RawEntryJson != null)
            {
                sb.Append(e.RawEntryJson);
                return;
            }

            sb.Append('{');
            bool inner = true;
            Json.WriteRequired(sb, "i", e.Id, ref inner);
            Json.WriteNumber(sb, "t", e.Timestamp, ref inner);
            Json.WriteRequired(sb, "n", e.Name, ref inner);
            // Omitted rather than guessed when nobody classified it: an entry with no
            // severity is honestly unclassified, and one silently filed as INFO is a
            // lie a filter will act on.
            if (e.Severity != 0) Json.WriteNumber(sb, "s", e.Severity, ref inner);
            Json.WriteAttributes(sb, "a", e.Attributes, ref inner);
            sb.Append('}');
        }
    }
}
