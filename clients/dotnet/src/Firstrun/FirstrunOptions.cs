using System;

using System.Collections.Generic;

namespace Firstrun
{
    /// <summary>
    /// What a <see cref="FirstrunClient"/> needs to know. Every value has a default
    /// that is safe in production; only <see cref="SourceKey"/> and <see cref="Host"/>
    /// have to be set.
    /// </summary>
    public sealed class FirstrunOptions
    {
        /// <summary>
        /// The public source key for this app, e.g. <c>fr_desktop_9f3a2b1c4d5e6f70</c>.
        /// It ships inside your binary, identifies which ingestion site is sending, and
        /// authorises nothing.
        /// </summary>
        public string SourceKey { get; set; } = "";

        /// <summary>
        /// The ingest origin, e.g. <c>https://t.example.com</c>. Trailing slash optional.
        /// </summary>
        public string Host { get; set; } = "";

        /// <summary>
        /// Names the folder the anonymous id is kept in. Defaults to
        /// <see cref="SourceKey"/> when unset. Set it to your product name so the id
        /// survives a source key rotation.
        /// </summary>
        public string? AppName { get; set; }

        /// <summary>Sent as the <c>service.name</c> resource attribute. Optional.</summary>
        public string? ServiceName { get; set; }

        /// <summary>
        /// Sent as the <c>service.version</c> resource attribute. Defaults to the entry
        /// assembly's version.
        /// </summary>
        public string? ServiceVersion { get; set; }

        /// <summary>Sent as <c>firstrun.channel</c>, e.g. "stable", "beta". Optional.</summary>
        public string? Channel { get; set; }

        /// <summary>Sent as <c>os.type</c>. Defaults to <see cref="Wire.OsName"/>.</summary>
        public string? Os { get; set; }

        /// <summary>Sent as <c>host.arch</c>. Defaults to <see cref="Wire.ArchName"/>.</summary>
        public string? Arch { get; set; }

        /// <summary>
        /// Sent as <c>browser.language</c>, which is what the convention calls it.
        /// Defaults to the current UI culture.
        /// </summary>
        public string? Locale { get; set; }

        /// <summary>
        /// Extra resource attributes: anything true of this PROCESS rather than of one
        /// entry. Merged under the named options above, which win on a clash.
        /// </summary>
        public IReadOnlyDictionary<string, object?>? Resource { get; set; }

        /// <summary>
        /// Marks everything this client sends as test data, via <c>firstrun.test</c>.
        /// </summary>
        /// <remarks>
        /// The dashboard shows one world or the other and never both, so a debug or CI
        /// build with this set cannot move a number anybody is looking at. Wire it to
        /// whatever the build already knows, such as <c>#if DEBUG</c>. Nothing is
        /// inferred: a client that guessed would eventually guess wrong on somebody's
        /// production machine, silently and in the direction nobody checks.
        /// </remarks>
        public bool TestMode { get; set; }

        /// <summary>
        /// Attributes stamped onto every entry this client sends, for what is true of
        /// every entry but is not a property of the process: a tenant, a region, a
        /// deployment id. An entry's own attributes win.
        /// </summary>
        public IReadOnlyDictionary<string, object?>? DefaultAttributes { get; set; }

        /// <summary>
        /// Entries below this severity are dropped before they are queued. Default 0,
        /// which sends everything.
        /// </summary>
        /// <remarks>
        /// Entries with no severity are never dropped by this: an unclassified entry is
        /// not a quiet one, and silently discarding it would make the threshold a filter
        /// on a field the caller did not set.
        /// </remarks>
        public int MinSeverity { get; set; }

        /// <summary>
        /// The anonymous per-install id. Leave null to load or create one under the
        /// per-user app-data directory (see <see cref="DistinctIdStore.ResolvePath"/>).
        /// Set it explicitly on a server, where the id belongs to the request, not the box.
        /// </summary>
        public string? DistinctId { get; set; }

        /// <summary>
        /// Whether to keep the anonymous id on disk. Default true. Set false in a
        /// container or on a read-only filesystem: the client then makes a fresh id per
        /// process instead, and never touches the disk.
        /// </summary>
        public bool PersistDistinctId { get; set; } = true;

        /// <summary>
        /// Emits <c>app_install</c> on the run that created the anonymous id, and
        /// <c>app_launch</c> on every run. Defaults to true for desktop and mobile source
        /// keys, false for server and everything else. Nothing else is ever sent for you.
        /// </summary>
        public bool? TrackLifecycleEvents { get; set; }

        // -------------------------------------------------------------------
        // Delivery policy: two axes, and conflating them is the mistake.
        // Schedule decides WHEN a send is attempted; durability decides what is
        // still there after a crash. See docs/delivery-policy.md.
        // -------------------------------------------------------------------

        /// <summary>
        /// When the client attempts a send. Leave null for the per-surface default:
        /// <see cref="FirstrunDeliveryMode.Manual"/> for a desktop or mobile source key
        /// (one burst at exit), <see cref="FirstrunDeliveryMode.Interval"/> for
        /// everything else.
        /// </summary>
        /// <remarks>
        /// <see cref="FirstrunDeliveryMode.Immediate"/> means "do not wait for a timer",
        /// never one request per entry: entries produced in the same tick coalesce into
        /// one batch, and no mode blocks the caller.
        /// </remarks>
        public FirstrunDeliveryMode? Mode { get; set; }

        /// <summary>
        /// Whether the pending queue survives the process. Default
        /// <see cref="FirstrunPersistence.Memory"/> on every surface: nothing is written
        /// to the user's disk, and a run's telemetry goes out during that run.
        /// </summary>
        /// <remarks>
        /// <see cref="FirstrunPersistence.Disk"/> mirrors the pending queue to
        /// <see cref="QueuePath"/> and drains it on the next start, which is the only
        /// thing that makes a crash report survive the crash that produced it.
        /// <see cref="FirstrunDeliveryMode.Startup"/> requires it and coerces to it.
        /// </remarks>
        public FirstrunPersistence Persistence { get; set; } = FirstrunPersistence.Memory;

        /// <summary>
        /// Any entry at or above this severity is sent at once, whatever the schedule
        /// says. Default <see cref="FirstrunSeverity.Error"/> (17). Set 0 to turn it off.
        /// </summary>
        /// <remarks>
        /// The single most valuable setting here, and the mitigation for a memory queue
        /// that flushes at exit: a crash report that waits for the next tick usually
        /// never arrives, because the process is gone by then. An entry at this level
        /// leaves while the process still exists.
        /// <para>
        /// An entry with no severity at all never triggers it: unclassified is not the
        /// same as urgent.
        /// </para>
        /// </remarks>
        public int FlushOnSeverity { get; set; } = FirstrunSeverity.Error;

        /// <summary>
        /// Whether <see cref="FirstrunClient.Dispose"/> and process exit get one
        /// best-effort, time-bounded pass at the queue. Default true.
        /// </summary>
        /// <remarks>
        /// With this on, the client hooks <c>AppDomain.ProcessExit</c> so a desktop app
        /// that never disposes anything still sends its run when it closes. Set it false
        /// and a shutdown drops whatever is still queued, immediately.
        /// </remarks>
        public bool FlushOnExit { get; set; } = true;

        /// <summary>
        /// The budget for that exit flush. Default 2s, capped at 10s.
        /// </summary>
        /// <remarks>
        /// Bounded because a slow network must not hold somebody's process open, and
        /// because the runtime gives a <c>ProcessExit</c> handler about two seconds
        /// before it stops waiting.
        /// </remarks>
        public TimeSpan ExitFlushTimeout { get; set; } = TimeSpan.FromSeconds(2);

        /// <summary>
        /// The file the durable queue lives in when <see cref="Persistence"/> is
        /// <see cref="FirstrunPersistence.Disk"/>. Defaults to <c>queue.ndjson</c> in the
        /// same folder as the anonymous id, so one folder holds everything this library
        /// keeps. Read the resolved path at runtime from
        /// <see cref="FirstrunClient.QueuePath"/>.
        /// </summary>
        public string? QueuePath { get; set; }

        /// <summary>
        /// Ceiling for the durable queue file. Default 8 MiB. Past it the oldest entries
        /// go, exactly as they do in memory.
        /// </summary>
        public long MaxPersistedBytes { get; set; } = 8L * 1024 * 1024;

        /// <summary>
        /// With <see cref="FirstrunPersistence.Disk"/>, write only entries at or above
        /// this severity. Default 0, which persists everything. Ignored in memory mode.
        /// </summary>
        /// <remarks>
        /// The narrow answer to the one thing a memory queue cannot do. Setting it to
        /// <see cref="FirstrunSeverity.Error"/> keeps ordinary telemetry in memory, where
        /// it leaves no trace between runs, and writes a few bytes only on the rare
        /// occasion something has already gone wrong. An entry with no severity is never
        /// persisted under a threshold: unclassified is not important.
        /// </remarks>
        public int PersistFromSeverity { get; set; }

        /// <summary>
        /// How many events may wait in memory. Past this the oldest are dropped and
        /// counted in <see cref="FirstrunStats.DroppedFromOverflow"/>. Default 10000.
        /// </summary>
        /// <remarks>
        /// The newest events survive, because a dashboard reads recent behaviour and an
        /// app offline for a week should not be able to grow the host's heap without
        /// limit. This is the single most important number in the library.
        /// </remarks>
        public int MaxQueuedEntries { get; set; } = 10_000;

        /// <summary>
        /// How many events go in one request. Default 200, clamped to
        /// <see cref="Wire.MaxBatchEntries"/>, which is the server's per-request cap.
        /// </summary>
        /// <remarks>
        /// The clamp is not politeness. A batch over the cap is rejected by the schema
        /// before anything is stored, so every request fails, the queue never drains, and
        /// it presents as total silence rather than as an error.
        /// </remarks>
        public int MaxBatchSize { get; set; } = 200;

        /// <summary>
        /// How long a partial batch waits under <see cref="FirstrunDeliveryMode.Interval"/>.
        /// Default 15s. Ignored by the other three modes.
        /// </summary>
        public TimeSpan FlushInterval { get; set; } = TimeSpan.FromSeconds(15);

        /// <summary>
        /// Whole-request timeout, connect included. Default 10s. There is no such thing
        /// as an analytics request worth waiting longer than this for.
        /// </summary>
        public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(10);

        /// <summary>
        /// Connect timeout. Honoured on net8.0 (SocketsHttpHandler.ConnectTimeout). On
        /// netstandard2.0 there is no separate connect timeout and
        /// <see cref="RequestTimeout"/> bounds the whole attempt. Default 5s.
        /// </summary>
        public TimeSpan ConnectTimeout { get; set; } = TimeSpan.FromSeconds(5);

        /// <summary>First retry delay. Doubles per consecutive failure. Default 1s.</summary>
        public TimeSpan RetryBaseDelay { get; set; } = TimeSpan.FromSeconds(1);

        /// <summary>Ceiling for the retry delay before jitter. Default 60s.</summary>
        public TimeSpan RetryMaxDelay { get; set; } = TimeSpan.FromSeconds(60);

        /// <summary>
        /// Consecutive transient failures before the circuit opens and the client stops
        /// dialling at all. Default 5.
        /// </summary>
        public int CircuitBreakerThreshold { get; set; } = 5;

        /// <summary>
        /// How long the circuit stays open. After it, exactly one probe request is
        /// allowed through. Default 5 minutes.
        /// </summary>
        public TimeSpan CircuitBreakerCooldown { get; set; } = TimeSpan.FromMinutes(5);

        /// <summary>
        /// Where the library reports what it is doing. Never Console, never a logger it
        /// picked for you: analytics has no business writing to your app's stderr.
        /// Exceptions thrown by your handler are caught and ignored.
        /// </summary>
        public Action<FirstrunDiagnosticEvent>? Diagnostics { get; set; }

        /// <summary>
        /// Set false to build a client that accepts calls and sends nothing. Useful in
        /// tests and in development builds. Default true.
        /// </summary>
        public bool Enabled { get; set; } = true;

        /// <summary>
        /// Supply your own <see cref="System.Net.Http.HttpClient"/>. When set, the
        /// client does not dispose it and does not apply the timeout options to it.
        /// </summary>
        public System.Net.Http.HttpClient? HttpClient { get; set; }

        internal FirstrunOptions Clone()
        {
            return (FirstrunOptions)MemberwiseClone();
        }
    }
}
