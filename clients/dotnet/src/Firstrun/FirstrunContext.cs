using System;
using System.Collections.Generic;
using System.Threading;

namespace Firstrun
{
    /// <summary>
    /// The identity of the work currently in flight: one request, one job, one message.
    /// </summary>
    /// <remarks>
    /// <b>Immutable, and that is the whole trick.</b> An ambient value is handed to every
    /// asynchronous call that flows out of the one that set it, by reference. A mutable
    /// identity would therefore let a nested handler rewrite what its own caller sees, and
    /// the bug it produces (a user id from one request appearing on another's entries) is
    /// the kind nobody reproduces on a laptop. Nothing here has a setter: to change a
    /// value you build a new identity with <see cref="WithUserId"/> and push that, which
    /// affects the flow doing the pushing and no other.
    /// <para>
    /// Every field is optional and none of them is invented. A null field means "this
    /// scope has nothing to say about that", and the client falls back to the next thing
    /// it knows. <see cref="UserId"/> in particular is only ever a string you passed here
    /// yourself: nothing in this library reads a cookie, a header, an IP or a principal on
    /// its own initiative, and nothing joins one surface's ids to another's.
    /// </para>
    /// <para>
    /// <see cref="DeviceId"/> is the anonymous per-install id, which on a server is a
    /// property of the caller rather than of the machine. That is exactly what this class
    /// is for: set it once where the request arrives instead of threading it through every
    /// signature between there and the call that records something.
    /// </para>
    /// </remarks>
    public sealed class FirstrunIdentity
    {
        /// <summary>Builds an identity. Every argument is optional: null means no opinion.</summary>
        public FirstrunIdentity(string? deviceId = null,
                                string? userId = null,
                                string? sessionId = null,
                                IReadOnlyDictionary<string, object?>? attributes = null)
        {
            DeviceId = deviceId;
            UserId = userId;
            SessionId = sessionId;
            Attributes = CopyAttributes(attributes);
        }

        /// <summary>The anonymous id for this scope, or null to use the client's own.</summary>
        public string? DeviceId { get; }

        /// <summary>The customer's own user id for this scope, or null for anonymous.</summary>
        public string? UserId { get; }

        /// <summary>The session id for this scope, or null to use the client's own.</summary>
        public string? SessionId { get; }

        /// <summary>
        /// Attributes every entry recorded inside this scope carries, or null.
        /// </summary>
        /// <remarks>
        /// A copy, taken and bounded when the identity was built, so a caller who reuses
        /// and mutates the dictionary they passed cannot rewrite entries already recorded.
        /// The route, the tenant, the correlation id: whatever is true of the whole
        /// request and would otherwise be repeated at every call site inside it.
        /// </remarks>
        public IReadOnlyDictionary<string, object?>? Attributes { get; }

        /// <summary>Returns a copy of this identity with a different anonymous id.</summary>
        public FirstrunIdentity WithDeviceId(string? deviceId)
        {
            return new FirstrunIdentity(deviceId, UserId, SessionId, Attributes);
        }

        /// <summary>
        /// Returns a copy of this identity carrying a user id, for the usual case: the
        /// request scope opened before authentication ran, and now the id is known.
        /// </summary>
        /// <remarks>
        /// The copy is not ambient until you push it. Mutating in place would have been
        /// shorter and is the thing this class exists to prevent: see the note on the
        /// class itself.
        /// </remarks>
        public FirstrunIdentity WithUserId(string? userId)
        {
            return new FirstrunIdentity(DeviceId, userId, SessionId, Attributes);
        }

        /// <summary>Returns a copy of this identity with a different session id.</summary>
        public FirstrunIdentity WithSessionId(string? sessionId)
        {
            return new FirstrunIdentity(DeviceId, UserId, sessionId, Attributes);
        }

        /// <summary>
        /// Returns a copy of this identity carrying one more attribute. A null value
        /// removes the key.
        /// </summary>
        public FirstrunIdentity WithAttribute(string key, object? value)
        {
            if (string.IsNullOrEmpty(key)) return this;

            var next = new Dictionary<string, object?>(StringComparer.Ordinal);
            if (Attributes != null)
            {
                foreach (KeyValuePair<string, object?> kv in Attributes) next[kv.Key] = kv.Value;
            }
            if (value == null) next.Remove(key);
            else next[key] = value;

            return new FirstrunIdentity(DeviceId, UserId, SessionId, next);
        }

        /// <summary>
        /// Snapshots and bounds an attribute map, and never throws while doing it.
        /// </summary>
        /// <remarks>
        /// This runs on the caller's thread, inside their constructor call, where the
        /// library's outer try/catch is not there to save them. Clamping walks whatever
        /// was handed in, and an enumerable that throws while being walked is a bug in
        /// somebody's code that this library will not turn into a failed request. Losing
        /// the attributes is the right trade; taking down the scope that was going to
        /// carry them is not.
        /// </remarks>
        private static IReadOnlyDictionary<string, object?>? CopyAttributes(
            IReadOnlyDictionary<string, object?>? attributes)
        {
            try
            {
                return Wire.ClampAttributes(attributes);
            }
            catch
            {
                return null;
            }
        }
    }

    /// <summary>
    /// The ambient <see cref="FirstrunIdentity"/> for the current asynchronous flow, so a
    /// call five frames deep can be attributed without five signatures carrying an id.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why <see cref="AsyncLocal{T}"/> and not a thread-static.</b> An await resumes on
    /// whatever pooled thread is free, so an identity parked on a thread is gone after the
    /// first await, and worse, it is still sitting there for whichever unrelated request
    /// lands on that thread next. An ambient value flows with the execution context, which
    /// means it follows the work rather than the thread: it survives every await in the
    /// scope, and two requests running concurrently on the same pool each see their own.
    /// </para>
    /// <para>
    /// <b>Push where the scope begins, not inside a helper.</b> Assigning an ambient value
    /// copies the execution context of the frame doing the assigning, so a push performed
    /// inside an <c>async</c> method is invisible to that method's caller once it returns.
    /// Call <see cref="Push"/> in the frame that owns the scope (middleware, the handler,
    /// the consumer loop) and dispose it there.
    /// </para>
    /// <para>
    /// Work started inside a scope captures the identity as it was at that moment, by
    /// copy. A background task spawned mid-request keeps the identity it was started with
    /// even after the request scope is disposed, which is what you want and is also why
    /// the identity has to be immutable.
    /// </para>
    /// <para>
    /// Nothing here is filled in for you. This class reads no cookie, no header and no
    /// principal: it holds the values you pushed and nothing else.
    /// </para>
    /// </remarks>
    public static class FirstrunContext
    {
        // AsyncLocal<T> is netstandard2.0 (.NET Framework 4.6 and up), so nothing in this
        // file needs a per-target branch.
        private static readonly AsyncLocal<FirstrunIdentity?> Ambient =
            new AsyncLocal<FirstrunIdentity?>();

        /// <summary>The identity in force for this flow, or null when nothing was pushed.</summary>
        public static FirstrunIdentity? Current { get { return Ambient.Value; } }

        /// <summary>
        /// Makes <paramref name="identity"/> ambient until the returned handle is
        /// disposed, which restores whatever was in force before.
        /// </summary>
        /// <remarks>
        /// Restoring rather than clearing is what makes scopes nest: an inner scope that
        /// added a user id to an outer request scope hands the request scope back on the
        /// way out, instead of leaving the rest of the request anonymous.
        /// <para>
        /// A null identity is not an error, it is an anonymous scope: this library does
        /// not throw an <see cref="ArgumentNullException"/> into a request pipeline over
        /// an analytics call. Use it where a scope must deliberately not inherit the one
        /// around it.
        /// </para>
        /// </remarks>
        public static IDisposable Push(FirstrunIdentity? identity)
        {
            FirstrunIdentity? previous = Ambient.Value;
            Ambient.Value = identity;
            return new Scope(previous);
        }

        private sealed class Scope : IDisposable
        {
            private readonly FirstrunIdentity? _previous;
            private int _disposed;

            internal Scope(FirstrunIdentity? previous)
            {
                _previous = previous;
            }

            public void Dispose()
            {
                // Disposed twice (a using block plus an explicit call, or a finally that
                // runs after one) would restore the old value a second time and undo a
                // push that happened in between. Once, or not at all.
                if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
                Ambient.Value = _previous;
            }
        }
    }
}
