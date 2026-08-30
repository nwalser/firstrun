using System;

namespace Firstrun
{
    /// <summary>
    /// When the client attempts a send. The SCHEDULE half of the delivery policy.
    /// </summary>
    /// <remarks>
    /// Scheduling and durability look like one setting and are not, which is why
    /// <see cref="FirstrunPersistence"/> is a second one. "Send once at startup" is a
    /// schedule that never fires during the run combined with a queue that survives it,
    /// and it cannot be expressed at all if the two are folded together.
    /// <para>
    /// Source of truth: <c>docs/delivery-policy.md</c>.
    /// </para>
    /// </remarks>
    public enum FirstrunDeliveryMode
    {
        /// <summary>
        /// Send as soon as a batch can be formed, without waiting for a timer.
        /// </summary>
        /// <remarks>
        /// <b>This is not one request per entry.</b> Entries produced in the same tick
        /// coalesce into one batch: a loop calling <c>Event()</c> a thousand times
        /// produces a handful of requests, not a thousand, because the sender takes
        /// everything queued when it wakes. It still never blocks the caller.
        /// </remarks>
        Immediate,

        /// <summary>
        /// Send every <see cref="FirstrunOptions.FlushInterval"/>, or as soon as
        /// <see cref="FirstrunOptions.MaxBatchSize"/> entries are waiting, whichever
        /// comes first.
        /// </summary>
        Interval,

        /// <summary>
        /// Drain whatever survived the last run at startup, then never send again
        /// during this run. The quietest mode: one burst of requests per launch.
        /// </summary>
        /// <remarks>
        /// Only meaningful with <see cref="FirstrunPersistence.Disk"/>, because with a
        /// memory queue nothing survives to be drained and the mode would send nothing,
        /// ever. Configured with memory, the client coerces it to disk and says so
        /// through <see cref="FirstrunOptions.Diagnostics"/>.
        /// </remarks>
        Startup,

        /// <summary>
        /// Send only when <see cref="FirstrunClient.Flush()"/> is called.
        /// </summary>
        /// <remarks>
        /// The desktop default, paired with <see cref="FirstrunOptions.FlushOnExit"/>:
        /// a run's telemetry goes out as one burst when the application closes, and
        /// nothing is written to the user's disk in between.
        /// <see cref="FirstrunOptions.FlushOnSeverity"/> still applies, which is what
        /// stops an error report waiting for an exit that a crash never reaches.
        /// </remarks>
        Manual,
    }

    /// <summary>
    /// What is still there after a crash or a kill. The DURABILITY half of the policy.
    /// </summary>
    public enum FirstrunPersistence
    {
        /// <summary>
        /// The queue lives in memory only. Nothing is written to the user's disk and
        /// nothing survives the process.
        /// </summary>
        Memory,

        /// <summary>
        /// The pending queue is mirrored to a file and drained on the next start, so an
        /// entry outlives the process that recorded it.
        /// </summary>
        /// <remarks>
        /// Bounded by <see cref="FirstrunOptions.MaxQueuedEntries"/> and
        /// <see cref="FirstrunOptions.MaxPersistedBytes"/>, dropping the oldest, so an
        /// app offline for a month cannot fill somebody's disk.
        /// </remarks>
        Disk,
    }

    /// <summary>The two axes after defaults and coercions have been applied.</summary>
    internal sealed class ResolvedDeliveryPolicy
    {
        internal ResolvedDeliveryPolicy(FirstrunDeliveryMode mode, FirstrunPersistence persistence,
                                        int flushOnSeverity, int persistFromSeverity,
                                        bool flushOnExit, TimeSpan exitFlushTimeout)
        {
            Mode = mode;
            Persistence = persistence;
            FlushOnSeverity = flushOnSeverity;
            PersistFromSeverity = persistFromSeverity;
            FlushOnExit = flushOnExit;
            ExitFlushTimeout = exitFlushTimeout;
        }

        internal FirstrunDeliveryMode Mode { get; }
        internal FirstrunPersistence Persistence { get; }

        /// <summary>1..24, or 0 when the host turned the severity flush off.</summary>
        internal int FlushOnSeverity { get; }

        /// <summary>1..24, or 0 when everything queued is written to the durable queue.</summary>
        internal int PersistFromSeverity { get; }

        internal bool FlushOnExit { get; }
        internal TimeSpan ExitFlushTimeout { get; }
    }

    /// <summary>
    /// Turns the options into the two axes the sender actually runs on.
    /// </summary>
    /// <remarks>
    /// A pure function of the options, so the interesting case (startup
    /// with a memory queue, which would send nothing at all) is decided in one place
    /// rather than discovered as silence in production.
    /// </remarks>
    internal static class DeliveryPolicy
    {
        /// <summary>
        /// Applies the defaults and the one coercion, reporting anything it changed.
        /// Never throws.
        /// </summary>
        /// <remarks>
        /// This used to take the surface the source key named, and default desktop and
        /// mobile to Manual: one burst at exit, nothing on the user's disk. A source has
        /// no kind now, so there is nothing left to infer that from and the client no
        /// longer guesses. Interval is the default for everything, because it is the one
        /// that keeps sending when a process is killed before it can flush; an app that
        /// wants the quiet shape sets Mode = Manual, which is what it always meant.
        /// </remarks>
        internal static ResolvedDeliveryPolicy Resolve(FirstrunOptions options, Action<string> report)
        {
            FirstrunDeliveryMode mode = options.Mode ?? FirstrunDeliveryMode.Interval;
            FirstrunPersistence persistence = options.Persistence;

            if (mode == FirstrunDeliveryMode.Startup && persistence == FirstrunPersistence.Memory)
            {
                // Nothing survives a memory queue, so a mode that only ever drains what
                // survived would send nothing for the life of the app. Silently sending
                // nothing is the worst of the available answers, so this one is loud.
                persistence = FirstrunPersistence.Disk;
                report("delivery mode Startup needs a durable queue: Persistence was Memory, "
                       + "which would never send anything, and has been coerced to Disk");
            }

            int flushOnSeverity = Wire.ClampSeverity(options.FlushOnSeverity);

            TimeSpan exitTimeout = options.ExitFlushTimeout;
            if (exitTimeout <= TimeSpan.Zero) exitTimeout = TimeSpan.Zero;
            // The exit flush is best effort and time bounded on purpose: a slow network
            // must never hold somebody's process open. Anything past a few seconds is
            // past the shutdown budget the runtime gives a ProcessExit handler anyway.
            if (exitTimeout > MaxExitFlushTimeout)
            {
                report("ExitFlushTimeout was " + (int)exitTimeout.TotalSeconds + "s, capped to "
                       + (int)MaxExitFlushTimeout.TotalSeconds + "s: a shutdown flush may not hold the process open");
                exitTimeout = MaxExitFlushTimeout;
            }

            return new ResolvedDeliveryPolicy(mode, persistence, flushOnSeverity,
                                              Wire.ClampSeverity(options.PersistFromSeverity),
                                              options.FlushOnExit, exitTimeout);
        }

        /// <summary>
        /// The longest a shutdown flush may take, whatever the host asked for.
        /// </summary>
        /// <remarks>
        /// .NET gives a <c>ProcessExit</c> handler roughly two seconds by default and
        /// then stops caring, so a longer budget is a promise the runtime will not keep.
        /// The bound is here rather than there because the same flush runs from
        /// <c>Dispose</c> and from a hosted service's <c>StopAsync</c>.
        /// </remarks>
        internal static readonly TimeSpan MaxExitFlushTimeout = TimeSpan.FromSeconds(10);
    }
}
