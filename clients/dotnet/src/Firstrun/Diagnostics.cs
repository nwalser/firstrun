using System;

namespace Firstrun
{
    /// <summary>What the library is doing, for a host that wants to know.</summary>
    public enum FirstrunDiagnosticKind
    {
        /// <summary>A batch was accepted by the server.</summary>
        BatchSent,

        /// <summary>A batch failed in a way that will be retried.</summary>
        BatchRetrying,

        /// <summary>The server rejected a batch permanently (4xx). It was discarded.</summary>
        BatchRejected,

        /// <summary>Events were dropped because the queue was full.</summary>
        QueueOverflow,

        /// <summary>An event was refused before it was queued (bad name, client disposed).</summary>
        EventRefused,

        /// <summary>Repeated failures opened the circuit. Nothing is sent until it closes.</summary>
        CircuitOpened,

        /// <summary>The circuit closed after a successful probe.</summary>
        CircuitClosed,

        /// <summary>
        /// A configured value was changed to a workable one: a batch size over the
        /// server's cap, or a delivery mode that would never have sent anything.
        /// </summary>
        ConfigAdjusted,

        /// <summary>Entries left over from a previous run were read back off the disk.</summary>
        QueueRestored,

        /// <summary>Something unexpected. The library carried on.</summary>
        InternalError,
    }

    /// <summary>
    /// One line of diagnostics. Delivered to <see cref="FirstrunOptions.Diagnostics"/> on
    /// the background thread, never printed anywhere by the library itself.
    /// </summary>
    public sealed class FirstrunDiagnosticEvent
    {
        public FirstrunDiagnosticEvent(FirstrunDiagnosticKind kind, string message, int count = 0, Exception? exception = null)
        {
            Kind = kind;
            Message = message;
            Count = count;
            Exception = exception;
        }

        public FirstrunDiagnosticKind Kind { get; }

        /// <summary>A short description. Never contains prop values.</summary>
        public string Message { get; }

        /// <summary>Number of events involved, when that is meaningful.</summary>
        public int Count { get; }

        public Exception? Exception { get; }

        public override string ToString()
        {
            return Count > 0 ? Kind + ": " + Message + " (" + Count + " events)" : Kind + ": " + Message;
        }
    }

    /// <summary>A snapshot of what the client has done so far. Cheap to read, safe from any thread.</summary>
    public sealed class FirstrunStats
    {
        public FirstrunStats(int queued, long accepted, long droppedFromOverflow, long droppedFromRejection,
                             long refused, bool circuitOpen, long consecutiveFailures)
        {
            Queued = queued;
            Accepted = accepted;
            DroppedFromOverflow = droppedFromOverflow;
            DroppedFromRejection = droppedFromRejection;
            Refused = refused;
            CircuitOpen = circuitOpen;
            ConsecutiveFailures = consecutiveFailures;
        }

        /// <summary>Events waiting in memory right now.</summary>
        public int Queued { get; }

        /// <summary>Events the server has accepted.</summary>
        public long Accepted { get; }

        /// <summary>Events thrown away because the queue hit <see cref="FirstrunOptions.MaxQueuedEntries"/>.</summary>
        public long DroppedFromOverflow { get; }

        /// <summary>Events thrown away because the server rejected them permanently.</summary>
        public long DroppedFromRejection { get; }

        /// <summary>Calls refused before queueing: an invalid event name, or a disposed client.</summary>
        public long Refused { get; }

        /// <summary>True while the circuit breaker is holding sends back.</summary>
        public bool CircuitOpen { get; }

        public long ConsecutiveFailures { get; }

        public override string ToString()
        {
            return "queued=" + Queued + " accepted=" + Accepted + " dropped_overflow=" + DroppedFromOverflow
                   + " dropped_rejected=" + DroppedFromRejection + " refused=" + Refused
                   + " circuit_open=" + CircuitOpen;
        }
    }
}
