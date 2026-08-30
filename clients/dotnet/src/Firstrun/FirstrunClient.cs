using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Firstrun
{
    /// <summary>
    /// The firstrun analytics client.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>This library is never in your application's critical path.</b> Every public
    /// method appends to a bounded in-memory queue and returns. Nothing here blocks on
    /// the network, nothing here throws into your code, and nothing here writes to your
    /// stdout or stderr. If the ingest host is unreachable, slow, or returning 500s, the
    /// worst that happens is that some analytics are lost.
    /// </para>
    /// <para>
    /// One instance per process. It owns a background thread and an
    /// <see cref="System.Net.Http.HttpClient"/>; creating one per call would be a socket
    /// per call.
    /// </para>
    /// </remarks>
    public sealed class FirstrunClient : IDisposable
#if NET8_0_OR_GREATER
        , IAsyncDisposable
#endif
    {
        private readonly FirstrunOptions _options;
        private readonly EventQueue _queue;
        private readonly Transport? _transport;
        private readonly Thread? _worker;
        private readonly CancellationTokenSource _cancellation = new CancellationTokenSource();
        private readonly ManualResetEventSlim _wake = new ManualResetEventSlim(false);
        private readonly Random _jitter = new Random();
        private readonly object _identityGate = new object();
        // One drain at a time. Dispose runs a final pass on the caller's thread while
        // the worker may still be mid-pass, and two senders would double-send a batch.
        private readonly object _drainGate = new object();

        private string _distinctId;
        private string? _userId;
        private string _sessionId;

        // The resource: what is true of this PROCESS rather than of one entry. Serialised
        // once, because none of it changes while the process runs, and sent once per body
        // rather than copied onto every entry. Keeping it as text also doubles as the
        // comparable key that decides which entries may share a request.
        private readonly string? _resourceJson;
        private readonly Dictionary<string, object?>? _defaultAttributes;

        // The two axes of the delivery policy, after the per-surface defaults and the one
        // coercion. See docs/delivery-policy.md and DeliveryPolicy.cs.
        private readonly ResolvedDeliveryPolicy _policy;
        private readonly DiskQueue? _journal;
        // How far into the queue the durable file has been written. Only the sender
        // thread touches it.
        private long _journaledThrough;
        // Set by flush(), by an entry at or above FlushOnSeverity, by the startup drain
        // and by shutdown. A send that is asked for happens whatever the schedule says.
        private int _sendRequested;
        private DateTime _nextIntervalUtc = DateTime.MinValue;
        private EventHandler? _processExit;

        private long _accepted;
        private long _droppedOverflow;
        private long _droppedRejected;
        private long _refused;
        private long _consecutiveFailures;
        private volatile bool _circuitOpen;
        private DateTime _nextAttemptUtc = DateTime.MinValue;
        private DateTime _circuitRetryUtc = DateTime.MinValue;

        private int _disposed;

        /// <summary>
        /// Starts the client. Never throws: a missing source key or host disables the
        /// client and reports a diagnostic rather than taking your process down at
        /// startup. Check <see cref="IsEnabled"/> in a test if you want that to be loud.
        /// </summary>
        public FirstrunClient(FirstrunOptions options)
        {
            _options = (options ?? new FirstrunOptions()).Clone();
            _sessionId = Guid.NewGuid().ToString("D");
            _distinctId = "";
            _queue = new EventQueue(_options.MaxQueuedEntries);

            bool configured = !string.IsNullOrWhiteSpace(_options.SourceKey)
                              && !string.IsNullOrWhiteSpace(_options.Host);

            if (!configured)
            {
                Report(FirstrunDiagnosticKind.InternalError,
                       "SourceKey and Host are required; the client is disabled and will discard every call");
                _options.Enabled = false;
            }
            else if (!Wire.IsValidSourceKey(_options.SourceKey))
            {
                // Not fatal: the server is the authority on whether a key resolves. This
                // is here so a typo shows up in diagnostics instead of as silence.
                Report(FirstrunDiagnosticKind.InternalError,
                       "SourceKey does not look like fr_<surface>_<16 chars>");
            }

            Surface = Wire.SurfaceFromSourceKey(_options.SourceKey) ?? FirstrunSurface.Other;
            _policy = DeliveryPolicy.Resolve(_options, Surface,
                                             m => Report(FirstrunDiagnosticKind.ConfigAdjusted, m));
            DeliveryMode = _policy.Mode;
            Persistence = _policy.Persistence;
            FlushOnExit = _policy.FlushOnExit;
            ExitFlushTimeout = _policy.ExitFlushTimeout;

            _options.ServiceVersion = _options.ServiceVersion ?? DetectAppVersion();
            _options.Os = _options.Os ?? SafeCall(Wire.OsName, "unknown");
            _options.Arch = _options.Arch ?? SafeCall(Wire.ArchName, "unknown");
            _options.Locale = _options.Locale ?? SafeCall(Wire.LocaleName, null);

            int batchSize = Clamp(_options.MaxBatchSize, 1, Wire.MaxBatchEntries);
            if (batchSize != _options.MaxBatchSize)
            {
                // Left silent, a batch over the cap is rejected by the schema before
                // anything is stored, so every request fails and the queue never drains.
                // That presents as the client not working at all.
                Report(FirstrunDiagnosticKind.ConfigAdjusted,
                       "MaxBatchSize was " + _options.MaxBatchSize + ", clamped to " + batchSize
                       + ": the server accepts 1.." + Wire.MaxBatchEntries + " entries per request");
            }
            _options.MaxBatchSize = batchSize;

            string appFolder = !string.IsNullOrWhiteSpace(_options.AppName) ? _options.AppName! : _options.SourceKey;

            bool firstRun = false;
            string? explicitId = Wire.ClampId(_options.DistinctId);
            if (explicitId != null)
            {
                _distinctId = explicitId;
            }
            else if (_options.PersistDistinctId)
            {
                (string id, bool created) = DistinctIdStore.LoadOrCreate(
                    appFolder,
                    ex => Report(FirstrunDiagnosticKind.InternalError, "could not persist the anonymous id", 0, ex));
                _distinctId = id;
                firstRun = created;
                DistinctIdPath = SafeCall(() => DistinctIdStore.ResolvePath(appFolder), null);
            }
            else
            {
                _distinctId = Guid.NewGuid().ToString("D");
                firstRun = true;
            }

            IsFirstRun = firstRun;

            _resourceJson = SerializeResource(BuildResource(_options));
            _defaultAttributes = Wire.ClampAttributes(_options.DefaultAttributes);

            if (!_options.Enabled) return;

            if (_policy.Persistence == FirstrunPersistence.Disk)
            {
                _journal = OpenJournal(appFolder);
                QueuePath = _journal?.FilePath;
            }

            _transport = new Transport(_options);
            _worker = new Thread(WorkerLoop)
            {
                // Background, so a host that exits without disposing us still exits.
                IsBackground = true,
                Name = "firstrun-sender",
            };
            _worker.Start();

            if (_policy.FlushOnExit) HookProcessExit();

            bool lifecycle = _options.TrackLifecycleEvents
                             ?? (Surface == FirstrunSurface.Desktop || Surface == FirstrunSurface.Mobile);
            if (lifecycle)
            {
                if (firstRun) Event(FirstrunNames.AppInstall);
                Event(FirstrunNames.AppLaunch);
            }

            // The one drain of a Startup run: whatever the last run left, sent now.
            // Everything recorded from here accumulates for the next launch.
            if (_policy.Mode == FirstrunDeliveryMode.Startup) RequestSend();
        }

        /// <summary>
        /// Reads the durable queue back into memory, or gives up quietly and runs in
        /// memory for this run.
        /// </summary>
        /// <remarks>
        /// The restored entries are enqueued before anything this run records, so they
        /// keep their place in front. Their <c>time</c> is whatever it was when they
        /// happened: an entry recorded on Friday and uploaded on Monday is a Friday entry,
        /// and the server buckets it that way.
        /// </remarks>
        private DiskQueue? OpenJournal(string appFolder)
        {
            try
            {
                string path = _options.QueuePath ?? DiskQueue.ResolvePath(appFolder);
                var journal = new DiskQueue(
                    path, _options.MaxQueuedEntries, _options.MaxPersistedBytes,
                    ex => Report(FirstrunDiagnosticKind.InternalError,
                                 "the durable queue is unusable, continuing in memory", 0, ex));

                List<QueuedEntry> restored = journal.RestoreAndCompact();
                foreach (QueuedEntry e in restored) _journaledThrough = Math.Max(_journaledThrough, Requeue(e));
                if (restored.Count > 0)
                {
                    Report(FirstrunDiagnosticKind.QueueRestored,
                           "read entries left by a previous run", restored.Count);
                }
                return journal;
            }
            catch (Exception ex)
            {
                Report(FirstrunDiagnosticKind.InternalError, "could not open the durable queue", 0, ex);
                return null;
            }
        }

        /// <summary>Puts a restored entry back in the queue and reports the seq it was given.</summary>
        private long Requeue(QueuedEntry e)
        {
            int dropped = _queue.Enqueue(e);
            if (dropped > 0) Interlocked.Add(ref _droppedOverflow, dropped);
            return e.Seq;
        }

        /// <summary>The surface the source key names. Advisory: the server uses its own record.</summary>
        public FirstrunSurface Surface { get; }

        /// <summary>False when the client was misconfigured or explicitly disabled. It still accepts every call.</summary>
        public bool IsEnabled { get { return _options.Enabled && _disposed == 0; } }

        /// <summary>True when this process created the anonymous id, i.e. nothing ran here before.</summary>
        public bool IsFirstRun { get; }

        /// <summary>Where the anonymous id is stored, or null when it is not persisted.</summary>
        public string? DistinctIdPath { get; }

        /// <summary>
        /// The schedule this client is running on, after the per-surface default was
        /// applied. Read it rather than assuming: the default depends on the surface in
        /// the source key.
        /// </summary>
        public FirstrunDeliveryMode DeliveryMode { get; }

        /// <summary>
        /// Whether the queue survives this process, after the one coercion
        /// (<see cref="FirstrunDeliveryMode.Startup"/> forces
        /// <see cref="FirstrunPersistence.Disk"/>, because with a memory queue it would
        /// send nothing at all).
        /// </summary>
        public FirstrunPersistence Persistence { get; }

        /// <summary>Where the durable queue is, or null when nothing is written to the disk.</summary>
        public string? QueuePath { get; }

        /// <summary>Whether shutdown gets one bounded pass at the queue.</summary>
        public bool FlushOnExit { get; }

        /// <summary>The budget for that pass.</summary>
        public TimeSpan ExitFlushTimeout { get; }

        /// <summary>The anonymous per-install id being sent. Not a person, not joined to anything.</summary>
        public string DistinctId { get { lock (_identityGate) { return _distinctId; } } }

        /// <summary>The id the host passed to <see cref="Identify"/>, or null.</summary>
        public string? UserId { get { lock (_identityGate) { return _userId; } } }

        /// <summary>The current session id. Rotated by <see cref="NewSession"/> and <see cref="Reset"/>.</summary>
        public string SessionId { get { lock (_identityGate) { return _sessionId; } } }

        /// <summary>Counters, for a health endpoint or a debug screen.</summary>
        public FirstrunStats Stats
        {
            get
            {
                return new FirstrunStats(
                    _queue.Count,
                    Interlocked.Read(ref _accepted),
                    Interlocked.Read(ref _droppedOverflow),
                    Interlocked.Read(ref _droppedRejected),
                    Interlocked.Read(ref _refused),
                    _circuitOpen,
                    Interlocked.Read(ref _consecutiveFailures));
            }
        }

        // -------------------------------------------------------------------
        // The API. None of these block, and none of these throw.
        // -------------------------------------------------------------------

        /// <summary>
        /// Records one log entry. Returns immediately; never throws.
        /// </summary>
        /// <remarks>
        /// <b>This is the whole API.</b> <see cref="Event"/>, <see cref="Error"/> and the
        /// level helpers are convenience helpers that call this one with the conventional
        /// fields filled in. There is nothing they can produce that you cannot write here
        /// by hand, and nothing they produce is privileged.
        /// <para>
        /// <paramref name="name"/> is any string matching the entry-name rule. There is no
        /// allowlist and no special-casing anywhere in the system:
        /// <c>Log("exported_csv")</c> and <c>Log("page_view")</c> are the same kind of
        /// thing to everything downstream.
        /// </para>
        /// <para>
        /// <paramref name="severity"/> is 1..24 on the OpenTelemetry ladder. Leave it 0
        /// when you have nothing to say: an entry with no severity is honestly
        /// unclassified, and one silently filed as INFO is a lie a filter will act on.
        /// </para>
        /// </remarks>
        public void Log(string name, string? body = null, int severity = 0,
                        IReadOnlyDictionary<string, object?>? attributes = null,
                        string? distinctId = null, string? userId = null, string? sessionId = null,
                        long timestampMs = 0, string? traceId = null, string? spanId = null)
        {
            Enqueue(name, body, severity, attributes, distinctId, userId, sessionId,
                    timestampMs, traceId, spanId);
        }

        /// <summary>
        /// Records a conventional product event: any name you like, at INFO.
        /// </summary>
        /// <remarks>
        /// One call to <see cref="Log"/> with the conventional fields filled in. An
        /// example of a good shape, not a schema: nothing it produces is privileged, and
        /// nothing you send without it is second class.
        /// </remarks>
        public void Event(string name, IReadOnlyDictionary<string, object?>? attributes = null,
                          string? distinctId = null, string? userId = null, string? sessionId = null)
        {
            Enqueue(name, null, FirstrunSeverity.Info, attributes, distinctId, userId, sessionId, 0, null, null);
        }

        /// <summary>
        /// Records a conventional exception entry, at ERROR, with the exception unwrapped.
        /// </summary>
        /// <remarks>
        /// The single most valuable helper here, because it does the work the caller would
        /// otherwise do at every catch site: the concrete type, the message and the stack
        /// trace including the inner-exception chain, as <c>exception.type</c>,
        /// <c>exception.message</c> and <c>exception.stacktrace</c>.
        /// <para>
        /// The name is <c>exception</c> for every one of them and the attributes say what
        /// happened, which is OpenTelemetry's shape. It means "all exceptions" is one name
        /// and "this exception" is a filter on a path, rather than a thousand names nobody
        /// can enumerate.
        /// </para>
        /// <para>
        /// This is a log entry like every other one. There is no error table and no error
        /// pipeline: it is only an error because of its severity and its attributes.
        /// </para>
        /// </remarks>
        public void Error(Exception error, IReadOnlyDictionary<string, object?>? attributes = null,
                          string? distinctId = null, string? userId = null, string? sessionId = null)
        {
            if (error == null) return;

            Dictionary<string, object?> unwrapped;
            string? message;
            try
            {
                unwrapped = Wire.ExceptionAttributes(error);
                message = unwrapped.TryGetValue(FirstrunAttr.ExceptionMessage, out object? m) ? m as string : null;
            }
            catch
            {
                // Unwrapping is best effort. An entry saying only that something threw is
                // still worth more than no entry at all.
                unwrapped = new Dictionary<string, object?>(StringComparer.Ordinal);
                message = null;
            }

            Enqueue(FirstrunNames.Exception, message, FirstrunSeverity.Error,
                    Wire.MergeAttributes(unwrapped, Wire.ClampAttributes(attributes)),
                    distinctId, userId, sessionId, 0, null, null);
        }

        /// <summary>A line at TRACE.</summary>
        public void Trace(string body, IReadOnlyDictionary<string, object?>? attributes = null)
        {
            Enqueue(FirstrunNames.Log, body, FirstrunSeverity.Trace, attributes, null, null, null, 0, null, null);
        }

        /// <summary>A line at DEBUG.</summary>
        public void Debug(string body, IReadOnlyDictionary<string, object?>? attributes = null)
        {
            Enqueue(FirstrunNames.Log, body, FirstrunSeverity.Debug, attributes, null, null, null, 0, null, null);
        }

        /// <summary>A line at INFO.</summary>
        public void Info(string body, IReadOnlyDictionary<string, object?>? attributes = null)
        {
            Enqueue(FirstrunNames.Log, body, FirstrunSeverity.Info, attributes, null, null, null, 0, null, null);
        }

        /// <summary>A line at WARN.</summary>
        public void Warn(string body, IReadOnlyDictionary<string, object?>? attributes = null)
        {
            Enqueue(FirstrunNames.Log, body, FirstrunSeverity.Warn, attributes, null, null, null, 0, null, null);
        }

        /// <summary>
        /// A line at ERROR with no exception to unwrap.
        /// </summary>
        /// <remarks>
        /// <see cref="Error"/> is taken by the helper that unwraps a thrown thing, which is
        /// the one worth the shorter name. This is for the case where you have a sentence
        /// and no exception.
        /// </remarks>
        public void ErrorLog(string body, IReadOnlyDictionary<string, object?>? attributes = null)
        {
            Enqueue(FirstrunNames.Log, body, FirstrunSeverity.Error, attributes, null, null, null, 0, null, null);
        }

        /// <summary>A line at FATAL.</summary>
        public void Fatal(string body, IReadOnlyDictionary<string, object?>? attributes = null)
        {
            Enqueue(FirstrunNames.Log, body, FirstrunSeverity.Fatal, attributes, null, null, null, 0, null, null);
        }

        /// <summary>
        /// Records a page or screen view as <c>page_view</c>.
        /// </summary>
        /// <remarks>
        /// The path travels as the conventional <c>url.path</c> attribute. There is no url
        /// column: everything that is not one of the five promoted columns lives in
        /// attributes and is queried from there.
        /// </remarks>
        public void Page(string path, IReadOnlyDictionary<string, object?>? attributes = null)
        {
            var bag = new FirstrunAttributes();
            if (attributes != null)
            {
                foreach (KeyValuePair<string, object?> kv in attributes) bag[kv.Key] = kv.Value;
            }
            if (!string.IsNullOrEmpty(path)) bag[FirstrunAttr.UrlPath] = path;
            Event(FirstrunNames.PageView, bag);
        }

        /// <summary>
        /// Attaches the customer's own user id to everything sent from now on, and records
        /// an <c>identify</c> entry so the id lands on a row immediately.
        /// </summary>
        /// <remarks>
        /// This is the only way a user id ever appears. Nothing is inferred, nothing is
        /// merged, and this surface is never linked to any other surface's ids.
        /// Pass null to go back to anonymous.
        /// </remarks>
        public void Identify(string? userId, IReadOnlyDictionary<string, object?>? attributes = null)
        {
            string? clamped = Wire.ClampId(userId);
            lock (_identityGate) { _userId = clamped; }
            if (clamped != null) Event(FirstrunNames.Identify, attributes);
        }

        /// <summary>
        /// Forgets the user id and starts a new session. The anonymous id is kept: it
        /// belongs to this installation, not to whoever was signed in.
        /// </summary>
        public void Reset()
        {
            lock (_identityGate)
            {
                _userId = null;
                _sessionId = Guid.NewGuid().ToString("D");
            }
        }

        /// <summary>Starts a new session id without touching the user id.</summary>
        public void NewSession()
        {
            lock (_identityGate) { _sessionId = Guid.NewGuid().ToString("D"); }
        }

        /// <summary>
        /// Asks the worker to send now, whatever the schedule says. Fire and forget: it
        /// returns immediately and the send happens on the background thread.
        /// </summary>
        /// <remarks>
        /// Under <see cref="FirstrunDeliveryMode.Manual"/> this is the only trigger there
        /// is, apart from <see cref="FirstrunOptions.FlushOnSeverity"/> and shutdown.
        /// </remarks>
        public void Flush()
        {
            RequestSend();
        }

        /// <summary>
        /// Waits, at most <paramref name="timeout"/>, for everything queued before this
        /// call to reach the server.
        /// </summary>
        /// <returns>
        /// True when it all went. False on timeout, when the client is disabled, or when
        /// the circuit is open. <b>You never have to call this</b>: it exists for a
        /// process about to exit that would rather not lose the last few events.
        /// </returns>
        public bool Flush(TimeSpan timeout)
        {
            try
            {
                return FlushAsync(timeout).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                Report(FirstrunDiagnosticKind.InternalError, "flush failed", 0, ex);
                return false;
            }
        }

        /// <summary>The awaitable form of <see cref="Flush(TimeSpan)"/>. Never throws.</summary>
        public async Task<bool> FlushAsync(TimeSpan timeout)
        {
            if (!_options.Enabled || _disposed != 0) return false;

            var marker = new FlushMarker();
            _queue.EnqueueMarker(marker);
            RequestSend();

            try
            {
                Task completed = await Task.WhenAny(
                    marker.Completion.Task,
                    Task.Delay(timeout < TimeSpan.Zero ? TimeSpan.Zero : timeout)).ConfigureAwait(false);

                if (!ReferenceEquals(completed, marker.Completion.Task)) return false;
                return await marker.Completion.Task.ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                Report(FirstrunDiagnosticKind.InternalError, "flush failed", 0, ex);
                return false;
            }
        }

        // -------------------------------------------------------------------
        // Enqueue
        // -------------------------------------------------------------------

        private void Enqueue(string name, string? body, int severity,
                             IReadOnlyDictionary<string, object?>? attributes,
                             string? distinctId, string? userId, string? sessionId,
                             long timestampMs, string? traceId, string? spanId)
        {
            try
            {
                if (_disposed != 0 || !_options.Enabled)
                {
                    Interlocked.Increment(ref _refused);
                    return;
                }

                if (!Wire.IsValidLogName(name))
                {
                    Interlocked.Increment(ref _refused);
                    Report(FirstrunDiagnosticKind.EventRefused, "invalid entry name");
                    return;
                }

                int resolvedSeverity = Wire.ClampSeverity(severity);
                // A threshold filters entries the caller CLASSIFIED. One with no severity
                // is unclassified rather than quiet, so it is never dropped here.
                if (resolvedSeverity != 0 && resolvedSeverity < _options.MinSeverity) return;

                string resolvedDistinct;
                string? resolvedUser;
                string resolvedSession;
                lock (_identityGate)
                {
                    resolvedDistinct = Wire.ClampId(distinctId) ?? _distinctId;
                    resolvedUser = Wire.ClampId(userId) ?? _userId;
                    resolvedSession = Wire.ClampId(sessionId) ?? _sessionId;
                }

                if (resolvedDistinct.Length == 0)
                {
                    Interlocked.Increment(ref _refused);
                    Report(FirstrunDiagnosticKind.EventRefused, "no distinct id");
                    return;
                }

                // Identity sits UNDER the caller's own attributes, so an entry that names
                // user.id explicitly wins over the client-level default. Anything else
                // would make a per-call override silently ineffective.
                var identity = new Dictionary<string, object?>(2, StringComparer.Ordinal);
                if (resolvedUser != null) identity[FirstrunAttr.UserId] = resolvedUser;
                if (resolvedSession.Length > 0) identity[FirstrunAttr.SessionId] = resolvedSession;

                // body, trace_id and span_id are attributes, not columns: this product
                // promotes five columns and no more, and the spec's vocabulary is not ours
                // to promote. The dedicated argument wins over a same-named attribute,
                // because naming it explicitly is the more specific statement.
                var spec = new Dictionary<string, object?>(3, StringComparer.Ordinal);
                string? clampedBody = Wire.ClampBody(body);
                if (clampedBody != null) spec[FirstrunAttr.Body] = clampedBody;
                string? clampedTrace = Wire.ClampId(traceId);
                if (clampedTrace != null) spec[FirstrunAttr.TraceId] = clampedTrace;
                string? clampedSpan = Wire.ClampId(spanId);
                if (clampedSpan != null) spec[FirstrunAttr.SpanId] = clampedSpan;

                // Copied here, on the caller's thread, so a caller who reuses and mutates
                // their dictionary cannot rewrite an entry we already recorded.
                Dictionary<string, object?>? merged = Wire.MergeAttributes(
                    _defaultAttributes,
                    identity,
                    Wire.ClampAttributes(attributes),
                    spec);

                var e = new QueuedEntry(
                    Guid.NewGuid().ToString("D"),
                    name,
                    timestampMs > 0 ? timestampMs : Wire.NowMs(),
                    resolvedSeverity,
                    resolvedDistinct,
                    merged,
                    _resourceJson,
                    null,
                    IsDurable(resolvedSeverity));

                int dropped = _queue.Enqueue(e);
                if (dropped > 0)
                {
                    Interlocked.Add(ref _droppedOverflow, dropped);
                    Report(FirstrunDiagnosticKind.QueueOverflow, "queue full, dropped the oldest", dropped);
                }

                // An entry at or above FlushOnSeverity goes now, whatever the schedule
                // says. A crash report that waits for the next tick is a crash report that
                // usually does not arrive, because the process is gone by then. An
                // unclassified entry never triggers it: no severity is not urgency.
                if (_policy.FlushOnSeverity != 0 && resolvedSeverity >= _policy.FlushOnSeverity)
                {
                    RequestSend();
                    return;
                }

                // Waking the sender is not the same as sending one entry: it takes
                // everything queued by the time it gets there, which is what makes
                // Immediate coalesce a loop of a thousand calls into a handful of
                // requests. The durable queue wakes on every entry too, because an entry
                // that is only in memory is an entry a crash takes with it.
                bool wake = _policy.Mode == FirstrunDeliveryMode.Immediate
                            || _journal != null
                            || _queue.Count >= _options.MaxBatchSize;
                if (wake && !_wake.IsSet) _wake.Set();
            }
            catch (Exception ex)
            {
                // The contract is that Log never throws. That has to hold even for the
                // failures we did not think of.
                Interlocked.Increment(ref _refused);
                Report(FirstrunDiagnosticKind.InternalError, "could not queue an entry", 0, ex);
            }
        }

        // -------------------------------------------------------------------
        // The worker
        // -------------------------------------------------------------------

        private void WorkerLoop()
        {
            try
            {
                while (_disposed == 0)
                {
                    TimeSpan wait = TimeUntilNextWork();
                    try
                    {
                        _wake.Wait(wait, _cancellation.Token);
                    }
                    catch (OperationCanceledException)
                    {
                        break;
                    }
                    _wake.Reset();
                    if (_disposed != 0) break;
                    PassOnce();
                }
            }
            catch (Exception ex)
            {
                Report(FirstrunDiagnosticKind.InternalError, "sender thread stopped", 0, ex);
            }
            finally
            {
                // Nobody is left to complete these, and a caller blocked in Flush should
                // get its answer rather than its timeout.
                _queue.ReleaseAllMarkers(false);
            }
        }

        /// <summary>
        /// How long the sender may sleep before it has work again.
        /// </summary>
        /// <remarks>
        /// The earliest of the deadlines that exist, and no deadline at all under
        /// Immediate, Manual and Startup: those three are woken by an enqueue or by a
        /// flush rather than by a clock, and a timer that fires every second to find an
        /// empty queue is a wakeup on somebody's battery.
        /// <para>
        /// A backoff or an open breaker counts as a deadline, so a retry happens when the
        /// backoff expires. It is never shortened by one, which is the rule that stops a
        /// timer firing on schedule into a network that is down.
        /// </para>
        /// </remarks>
        private TimeSpan TimeUntilNextWork()
        {
            DateTime now = DateTime.UtcNow;
            DateTime? deadline = null;

            if (_policy.Mode == FirstrunDeliveryMode.Interval) deadline = _nextIntervalUtc;

            if (_queue.Count > 0)
            {
                DateTime blocked = _circuitOpen && _circuitRetryUtc > _nextAttemptUtc
                    ? _circuitRetryUtc
                    : _nextAttemptUtc;
                if (blocked > now && (deadline == null || blocked < deadline.Value)) deadline = blocked;
            }

            if (deadline == null) return Timeout.InfiniteTimeSpan;
            TimeSpan until = deadline.Value - now;
            return until > TimeSpan.Zero ? until : TimeSpan.Zero;
        }

        /// <summary>
        /// One pass of the sender: mirror the queue to the disk, decide whether the policy
        /// says to send, then send.
        /// </summary>
        /// <remarks>
        /// Persisting comes first and happens on every pass, including the passes that
        /// send nothing because the schedule says not to or because the breaker is open.
        /// An entry only in memory during an outage is an entry the outage takes with it.
        /// </remarks>
        private void PassOnce()
        {
            lock (_drainGate)
            {
                PersistPending();

                DateTime now = DateTime.UtcNow;
                if (!ShouldSend(now)) return;

                if (_circuitOpen)
                {
                    if (now < _circuitRetryUtc) return;
                    // Half open: let exactly one batch through. If it fails, the failure
                    // count is still over the threshold, so the circuit opens again.
                    _circuitOpen = false;
                    Report(FirstrunDiagnosticKind.CircuitClosed, "circuit half open, probing");
                }

                if (now < _nextAttemptUtc) return;

                if (_policy.Mode == FirstrunDeliveryMode.Interval)
                {
                    TimeSpan interval = _options.FlushInterval;
                    if (interval <= TimeSpan.Zero) interval = TimeSpan.FromSeconds(1);
                    _nextIntervalUtc = now.Add(interval);
                }

                // Consumed here rather than where it is read, so a pass that the breaker
                // or the backoff turned away still has its request pending afterwards.
                Interlocked.Exchange(ref _sendRequested, 0);

                bool allSent = DrainOnceLocked();

                // Either the send that was asked for failed, or one pass did not empty the
                // queue because a pass only takes MaxBatchSize entries. Both mean the
                // request is still outstanding: keep it, so finishing the job does not
                // depend on somebody calling flush a second time. Under Manual, where
                // nothing else would ever ask, that is the difference between a flush of
                // 500 entries sending all of them and sending the first 200.
                if (!allSent || _queue.Count > 0)
                {
                    Interlocked.Exchange(ref _sendRequested, 1);
                    if (allSent && !_wake.IsSet) _wake.Set();
                }
            }
        }

        /// <summary>
        /// Whether the policy wants a send attempt now. The reliability gates are checked
        /// after this and outrank it: a schedule never overrides a backoff.
        /// </summary>
        private bool ShouldSend(DateTime now)
        {
            if (Interlocked.CompareExchange(ref _sendRequested, 0, 0) != 0) return true;

            switch (_policy.Mode)
            {
                // Not one request per entry: everything queued when the sender wakes goes
                // in one batch, and only the batch cap splits it.
                case FirstrunDeliveryMode.Immediate:
                    return _queue.Count > 0;

                case FirstrunDeliveryMode.Interval:
                    return _queue.Count >= _options.MaxBatchSize || now >= _nextIntervalUtc;

                // Startup drained at init and Manual waits for flush(). Both still send on
                // a severity trigger and on exit, which is what sets _sendRequested.
                default:
                    return false;
            }
        }

        /// <summary>Writes the entries the durable queue has not seen yet. A no-op in memory mode.</summary>
        private void PersistPending()
        {
            DiskQueue? journal = _journal;
            if (journal == null || !journal.IsUsable) return;

            var pending = new List<QueuedEntry>();
            // The watermark advances past everything seen, including the entries a
            // severity threshold keeps in memory. They are not pending writes; they are
            // never going to be written.
            _journaledThrough = _queue.SnapshotSince(_journaledThrough, pending);

            List<QueuedEntry> durable = OnlyDurable(pending);
            if (durable.Count == 0) return;
            journal.Append(durable);
        }

        /// <summary>Rewrites the durable queue to what is still waiting, after a send.</summary>
        /// <remarks>
        /// Entries the server accepted have to stop being on the disk, or the next launch
        /// replays them. Doing it as a rewrite of what remains rather than a delete of what
        /// went keeps the file honest even if the two disagree.
        /// </remarks>
        private void CompactJournal()
        {
            DiskQueue? journal = _journal;
            if (journal == null || !journal.IsUsable) return;

            var pending = new List<QueuedEntry>();
            _journaledThrough = _queue.SnapshotAll(pending);
            journal.Rewrite(OnlyDurable(pending));
        }

        /// <summary>
        /// Whether an entry of this severity belongs on the disk.
        /// </summary>
        /// <remarks>
        /// An unclassified entry is never durable under a threshold. No severity is not
        /// importance, and a threshold that let it through would write everything for
        /// anyone who calls Log without one.
        /// </remarks>
        private bool IsDurable(int severity)
        {
            if (_policy.PersistFromSeverity == 0) return true;
            return severity != 0 && severity >= _policy.PersistFromSeverity;
        }

        private static List<QueuedEntry> OnlyDurable(List<QueuedEntry> entries)
        {
            var kept = new List<QueuedEntry>(entries.Count);
            foreach (QueuedEntry e in entries) { if (e.Durable) kept.Add(e); }
            return kept;
        }

        /// <summary>Asks for a send whatever the schedule says, and wakes the sender.</summary>
        private void RequestSend()
        {
            Interlocked.Exchange(ref _sendRequested, 1);
            _wake.Set();
        }

        /// <summary>Takes what is queued, sends it, settles the flush markers.</summary>
        /// <returns>True when everything taken reached the server or was permanently rejected.</returns>
        private bool DrainOnceLocked()
        {
            var events = new List<QueuedEntry>();
            var markers = new List<FlushMarker>();
            _queue.Drain(_options.MaxBatchSize, events, markers);

            if (events.Count == 0)
            {
                CompleteMarkers(markers, true);
                return true;
            }

            bool allSent = true;
            // By reference, not by id: an entry restored from the durable queue carries
            // its wire id inside the JSON it was stored as, so the only identity this
            // pass can rely on is the object itself.
            var settled = new HashSet<QueuedEntry>();

            foreach (List<QueuedEntry> batch in BatchWriter.Group(events, _options.MaxBatchSize))
            {
                SendResult result = SendBatch(batch);

                if (result.Outcome == SendOutcome.Accepted)
                {
                    Interlocked.Add(ref _accepted, batch.Count);
                    foreach (QueuedEntry e in batch) settled.Add(e);
                    OnSuccess();
                    continue;
                }

                if (result.Outcome == SendOutcome.Rejected)
                {
                    Interlocked.Add(ref _droppedRejected, batch.Count);
                    foreach (QueuedEntry e in batch) settled.Add(e);
                    Report(FirstrunDiagnosticKind.BatchRejected, "server rejected a batch: " + result.Detail, batch.Count);
                    // A rejection is a working connection, so it is not a transport
                    // failure and must not push the circuit towards open.
                    OnSuccess();
                    continue;
                }

                OnFailure(result);
                allSent = false;
                break;
            }

            if (!allSent)
            {
                var remaining = new List<QueuedEntry>();
                foreach (QueuedEntry e in events)
                {
                    if (!settled.Contains(e)) remaining.Add(e);
                }

                int dropped = _queue.RequeueFront(remaining);
                if (dropped > 0)
                {
                    Interlocked.Add(ref _droppedOverflow, dropped);
                    Report(FirstrunDiagnosticKind.QueueOverflow, "queue full while retrying, dropped the oldest", dropped);
                }
            }

            // After the requeue, never before it: the file has to be rewritten from a
            // queue that already holds whatever did not go, or a failed send would erase
            // the entries it was retrying.
            if (settled.Count > 0) CompactJournal();

            CompleteMarkers(markers, allSent);
            return allSent;
        }

        private SendResult SendBatch(List<QueuedEntry> batch)
        {
            if (_transport == null) return new SendResult(SendOutcome.Rejected, "no transport");
            try
            {
                string body = BatchWriter.Write(_options, batch);
                // Blocking on a dedicated thread with no synchronization context. This is
                // the one place in the library that waits, and nothing the host owns is
                // waiting on it.
                return _transport.SendAsync(body, _cancellation.Token).ConfigureAwait(false).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                return new SendResult(SendOutcome.Transient, ex.GetType().Name + ": " + ex.Message);
            }
        }

        private void OnSuccess()
        {
            long previous = Interlocked.Exchange(ref _consecutiveFailures, 0);
            _nextAttemptUtc = DateTime.MinValue;
            if (previous > 0) Report(FirstrunDiagnosticKind.BatchSent, "recovered after " + previous + " failures");
        }

        private void OnFailure(SendResult result)
        {
            long failures = Interlocked.Increment(ref _consecutiveFailures);

            // Capped exponential with equal jitter: half the delay is fixed so it still
            // grows, half is random so a thousand clients that went offline together do
            // not come back in lockstep and finish the outage for us.
            double baseMs = _options.RetryBaseDelay.TotalMilliseconds;
            double capMs = _options.RetryMaxDelay.TotalMilliseconds;
            double exponent = Math.Min(failures - 1, 20);
            double delayMs = Math.Min(capMs, baseMs * Math.Pow(2, exponent));

            double jittered;
            lock (_jitter) { jittered = delayMs / 2 + _jitter.NextDouble() * (delayMs / 2); }

            if (result.RetryAfter.HasValue)
            {
                double asked = result.RetryAfter.Value.TotalMilliseconds;
                if (asked > jittered) jittered = Math.Min(asked, capMs * 5);
            }

            _nextAttemptUtc = DateTime.UtcNow.AddMilliseconds(jittered);
            Report(FirstrunDiagnosticKind.BatchRetrying,
                   "send failed (" + result.Detail + "), retrying in " + (int)jittered + "ms");

            if (failures >= _options.CircuitBreakerThreshold && !_circuitOpen)
            {
                _circuitOpen = true;
                _circuitRetryUtc = DateTime.UtcNow.Add(_options.CircuitBreakerCooldown);
                Report(FirstrunDiagnosticKind.CircuitOpened,
                       "giving up for " + (int)_options.CircuitBreakerCooldown.TotalSeconds + "s after "
                       + failures + " consecutive failures");
            }
        }

        private static void CompleteMarkers(List<FlushMarker> markers, bool result)
        {
            foreach (FlushMarker m in markers) m.Completion.TrySetResult(result);
        }

        // -------------------------------------------------------------------
        // Shutdown
        // -------------------------------------------------------------------

        /// <summary>
        /// Stops the worker, giving it <see cref="FirstrunOptions.ExitFlushTimeout"/> to
        /// land whatever is queued. Never throws, never hangs the host on exit.
        /// </summary>
        public void Dispose()
        {
            Shutdown(false);
        }

        /// <summary>
        /// Hooks process exit, so an application that never disposes anything still sends
        /// its run when it closes.
        /// </summary>
        /// <remarks>
        /// This is what makes the desktop default work: a WPF or WinForms app closes
        /// without an explicit teardown far more often than not, and a queue that only
        /// leaves on Dispose would be a queue that usually does not leave. On a host that
        /// does shut down properly (ASP.NET stopping the hosted service, an app calling
        /// Dispose) this handler finds the client already disposed and does nothing.
        /// </remarks>
        private void HookProcessExit()
        {
            try
            {
                _processExit = (sender, e) => Shutdown(true);
                AppDomain.CurrentDomain.ProcessExit += _processExit;
            }
            catch (Exception ex)
            {
                // A host that forbids the hook (a restricted AppDomain) still gets
                // everything else. Losing the exit flush is losing analytics.
                _processExit = null;
                Report(FirstrunDiagnosticKind.InternalError, "could not hook process exit", 0, ex);
            }
        }

        private void Shutdown(bool fromProcessExit)
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;

            try
            {
                if (_processExit != null)
                {
                    AppDomain.CurrentDomain.ProcessExit -= _processExit;
                    _processExit = null;
                }
            }
            catch (Exception)
            {
                // Unhooking is tidiness. It is not worth an exception out of Dispose.
            }

            try
            {
                // One last pass on this thread rather than the worker's, so a host that
                // disposes and immediately exits still gets its final batch away. Bounded,
                // because a slow network must not hold somebody's process open.
                if (_options.Enabled && _transport != null && _policy.FlushOnExit)
                {
                    DateTime deadline = DateTime.UtcNow.Add(_policy.ExitFlushTimeout);
                    _nextAttemptUtc = DateTime.MinValue;
                    while (_queue.Count > 0 && DateTime.UtcNow < deadline && !_circuitOpen)
                    {
                        int before = _queue.Count;
                        Interlocked.Exchange(ref _sendRequested, 1);
                        PassOnce();
                        // A pass that moved nothing means we are in a backoff window or
                        // offline. Spinning on it until the deadline would burn a core
                        // for no events, so stop and let the queue go.
                        if (_queue.Count >= before) break;
                    }
                }

                // Whatever is left goes to the disk, if there is a disk. This is the half
                // of "flush on exit" that survives an exit nobody got to finish.
                if (_journal != null) { lock (_drainGate) { PersistPending(); } }
            }
            catch (Exception ex)
            {
                Report(FirstrunDiagnosticKind.InternalError, "shutdown flush failed", 0, ex);
            }

            try
            {
                _wake.Set();
                _cancellation.Cancel();
                // The worker is a background thread: if it is stuck in a socket read the
                // process still exits. Joining briefly is a courtesy, not a requirement,
                // and the courtesy is shorter on the way out of a process that is already
                // being torn down around us.
                _worker?.Join(fromProcessExit ? TimeSpan.FromMilliseconds(200) : TimeSpan.FromSeconds(1));
            }
            catch (Exception)
            {
                // Nothing here is worth an exception out of Dispose.
            }

            _queue.ReleaseAllMarkers(false);

            try { _transport?.Dispose(); } catch (Exception) { }
            try { _cancellation.Dispose(); } catch (Exception) { }
            try { _wake.Dispose(); } catch (Exception) { }
        }

#if NET8_0_OR_GREATER
        /// <summary>
        /// Flushes with a bounded wait and then disposes. Awaiting this on shutdown is the
        /// nicest thing you can do for your numbers; skipping it costs you at most the
        /// events still in memory.
        /// </summary>
        public async ValueTask DisposeAsync()
        {
            if (_disposed == 0 && _options.Enabled && _policy.FlushOnExit)
            {
                try { await FlushAsync(_policy.ExitFlushTimeout).ConfigureAwait(false); }
                catch (Exception) { }
            }
            Dispose();
        }
#endif

        // -------------------------------------------------------------------
        // Helpers
        // -------------------------------------------------------------------

        private void Report(FirstrunDiagnosticKind kind, string message, int count = 0, Exception? exception = null)
        {
            Action<FirstrunDiagnosticEvent>? sink = _options.Diagnostics;
            if (sink == null) return;
            try
            {
                sink(new FirstrunDiagnosticEvent(kind, message, count, exception));
            }
            catch (Exception)
            {
                // A diagnostics handler that throws is the host's bug, and it is still not
                // allowed to become our crash.
            }
        }

        private static int Clamp(int value, int min, int max)
        {
            return value < min ? min : (value > max ? max : value);
        }

        private static T SafeCall<T>(Func<T> f, T fallback)
        {
            try { return f(); } catch (Exception) { return fallback; }
        }

        /// <summary>
        /// The resource attributes for this client: what is true of the process.
        /// </summary>
        /// <remarks>
        /// Returned null when there is nothing to say, so an empty map is never sent as an
        /// empty object. The caller's own <see cref="FirstrunOptions.Resource"/> sits
        /// underneath the named options, which win on a clash.
        /// </remarks>
        private static Dictionary<string, object?>? BuildResource(FirstrunOptions options)
        {
            var named = new Dictionary<string, object?>(6, StringComparer.Ordinal);
            if (!string.IsNullOrEmpty(options.ServiceName)) named[FirstrunAttr.ServiceName] = options.ServiceName;
            if (!string.IsNullOrEmpty(options.ServiceVersion)) named[FirstrunAttr.ServiceVersion] = options.ServiceVersion;
            if (!string.IsNullOrEmpty(options.Channel)) named[FirstrunAttr.Channel] = options.Channel;
            if (!string.IsNullOrEmpty(options.Os)) named[FirstrunAttr.OsType] = options.Os;
            if (!string.IsNullOrEmpty(options.Arch)) named[FirstrunAttr.HostArch] = options.Arch;
            if (!string.IsNullOrEmpty(options.Locale)) named[FirstrunAttr.BrowserLanguage] = options.Locale;
            // Boxed as a bool rather than a string, so the serialiser writes JSON true.
            // Absent on a production client: silence is what says "not test data".
            if (options.TestMode) named[FirstrunAttr.Test] = true;

            return Wire.MergeAttributes(Wire.ClampAttributes(options.Resource), named);
        }

        /// <summary>
        /// Serialises the resource once, for the life of the client.
        /// </summary>
        /// <remarks>
        /// The resource sits once per request body rather than on every entry, and none of
        /// it changes while the process runs, so building it per batch would be the same
        /// string built again every few seconds. Holding it as text is also what lets an
        /// entry read back off the disk be posted without a JSON reader, and what makes
        /// "may these two entries share a request" a string comparison.
        /// </remarks>
        private static string? SerializeResource(Dictionary<string, object?>? resource)
        {
            if (resource == null || resource.Count == 0) return null;
            var sb = new StringBuilder(128);
            Json.WriteValue(sb, resource);
            return sb.ToString();
        }

        private static string? DetectAppVersion()
        {
            try
            {
                Assembly? entry = Assembly.GetEntryAssembly();
                if (entry == null) return null;
                var info = entry.GetCustomAttribute<AssemblyInformationalVersionAttribute>();
                if (info != null && !string.IsNullOrEmpty(info.InformationalVersion))
                {
                    // "1.2.3+abcdef" from SourceLink. The build metadata is noise in a
                    // breakdown by version and would split one release into many rows.
                    string v = info.InformationalVersion;
                    int plus = v.IndexOf('+');
                    return plus > 0 ? v.Substring(0, plus) : v;
                }
                return entry.GetName().Version?.ToString();
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
