using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Firstrun
{
    /// <summary>
    /// Opens the request's identity scope, times the pipeline, and records one
    /// <c>http.request</c> entry.
    /// </summary>
    /// <remarks>
    /// <b>The contract this file is written against: the pipeline below runs exactly
    /// once, whatever happens up here.</b> Every line of our own code is inside a guard,
    /// the customer's exception is caught only long enough to be named on the entry and
    /// is rethrown unchanged, and the <c>finally</c> that cleans up is itself wrapped,
    /// because a <c>finally</c> that throws while an exception is unwinding replaces it.
    /// An analytics library that swapped a customer's stack trace for its own would cost
    /// somebody a week of looking in the wrong place.
    /// <para>
    /// The entry it produces is an ordinary log entry. There is no request table and no
    /// request pipeline: it is a name, a severity and an attribute map like everything
    /// else, and it is only "an http request" because of the attributes on it.
    /// </para>
    /// </remarks>
    internal sealed class FirstrunMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly FirstrunClient _client;
        private readonly Func<HttpContext, string?>? _deviceId;
        private readonly Func<HttpContext, string?>? _userId;
        private readonly Func<HttpContext, string?>? _sessionId;
        private readonly Func<HttpContext, bool>? _ignore;

        internal FirstrunMiddleware(RequestDelegate next, FirstrunClient client,
                                    Func<HttpContext, string?>? deviceId,
                                    Func<HttpContext, string?>? userId,
                                    Func<HttpContext, string?>? sessionId,
                                    Func<HttpContext, bool>? ignore)
        {
            _next = next;
            _client = client;
            _deviceId = deviceId;
            _userId = userId;
            _sessionId = sessionId;
            _ignore = ignore;
        }

        public async Task Invoke(HttpContext context)
        {
            IDisposable? scope = null;
            string? deviceId = null;
            string? userId = null;
            string? sessionId = null;
            string? route = null;
            long startedAtMs = 0;
            long startedTicks = 0;
            bool measured = false;

            try
            {
                // IsEnabled first, so a client that is disabled (no source key, or
                // disposed) does not spend the customer's delegates once per request to
                // produce an entry that would be discarded on arrival.
                if (_client.IsEnabled && !Ignored(context))
                {
                    // Every extractor is optional and a request with no identity is
                    // still measured: its entries count as entries and in no unique,
                    // which is the honest answer for a backend that was never told who
                    // the request was for.
                    deviceId = _deviceId != null ? Resolve(_deviceId, context) : null;
                    userId = _userId != null ? Resolve(_userId, context) : null;
                    sessionId = _sessionId != null ? Resolve(_sessionId, context) : null;
                    {

                        // This middleware owns the request scope, so it pushes exactly
                        // what the delegates returned and does not merge with whatever
                        // was ambient: a null field on FirstrunIdentity already means
                        // "fall back to the client", never "fall back to the scope
                        // outside me", and inventing a second meaning for it here would
                        // make the same null behave differently depending on wiring
                        // nobody can see from the call site. Nothing is pushed at all
                        // when there is nothing to say, so an outer scope survives.
                        scope = FirstrunContext.Push(new FirstrunIdentity(deviceId, userId, sessionId));

                        // A re-executed request goes through here twice. The scope opens on
                        // both passes and the entry is written only on the first: one
                        // request is one entry, but anything the error page records is
                        // still the same visitor's, and dropping the scope on the second
                        // pass is how a customer's own Event() inside /error ends up filed
                        // under whatever the client falls back to.
                        if (!Reexecuting(context))
                        {
                            // Read on the way DOWN, while the endpoint on the context is
                            // still the one this request matched. See RouteTemplate.
                            route = RouteTemplate(context);

                            // Stamped at arrival rather than at completion. `time` is the
                            // client's clock and is what every bucket and every partition
                            // boundary uses, so filing a request at the moment it arrived
                            // makes "requests per minute" mean requests that arrived per
                            // minute, and keeps a thirty-second request out of the bucket
                            // thirty seconds later. Late is a case this system is built for.
                            startedAtMs = Wire.NowMs();
                            startedTicks = Stopwatch.GetTimestamp();
                            measured = true;
                        }
                    }
                }
            }
            catch
            {
                // Setting up our own measurement is not worth one of their requests.
                // Whatever failed, the pipeline below still runs, unmeasured. `scope` is
                // deliberately left as it is rather than dropped: if the push had already
                // succeeded, forgetting the handle here is how a scope never gets closed.
                measured = false;
            }

            Exception? failure = null;
            try
            {
                await _next(context).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                // Caught to name it on the entry and rethrown on the next line, unchanged
                // and unhandled. `throw;` rather than `throw ex;`: the second one resets
                // the stack trace to this frame and loses where it actually came from.
                failure = ex;
                throw;
            }
            finally
            {
                try
                {
                    try
                    {
                        // Recorded INSIDE the request's own scope, before it is handed
                        // back. Our entry is the one entry of the request that names every
                        // id explicitly, so today the only thing this changes is that a
                        // missing session resolves against the request rather than against
                        // the process. It is still the right order: an entry built after
                        // its own scope closed is an entry that silently misses anything
                        // the scope carries, and the next person to put an attribute on a
                        // FirstrunIdentity would find it on every entry in the request
                        // except this one.
                        if (measured)
                        {
                            Record(context, deviceId!, userId, sessionId, route,
                                   startedAtMs, startedTicks, failure);
                        }
                    }
                    finally
                    {
                        // The scope goes back whatever happened above, so nothing that
                        // fails while recording can leave the request's identity standing.
                        // Because Invoke is itself async the push never escaped upward into
                        // the server's own frame; what this undoes is the scope for the
                        // rest of THIS frame and for anything started from it once the
                        // pipeline has returned.
                        scope?.Dispose();
                    }
                }
                catch
                {
                    // A throw from here would REPLACE the exception currently unwinding
                    // out of their handler. Losing the entry is a rounding error. Losing
                    // their stack trace is not.
                }
            }
        }

        /// <summary>Builds and records the one entry this middleware exists to produce.</summary>
        private void Record(HttpContext context, string deviceId, string? userId, string? sessionId,
                            string? routeAtArrival, long startedAtMs, long startedTicks,
                            Exception? failure)
        {
            var attributes = new FirstrunAttributes(8);
            attributes[FirstrunAttr.HttpRequestMethod] = context.Request.Method;
            attributes[FirstrunAttr.DurationMs] = ElapsedMs(startedTicks);

            string? route = routeAtArrival ?? RouteTemplate(context);
            if (route != null) attributes[FirstrunAttr.HttpRoute] = route;

            string? path = RequestPath(context);
            if (path != null) attributes[FirstrunAttr.UrlPath] = path;

            // The caller went away. Not a failure of theirs, and not a 5xx.
            bool aborted = failure != null && Aborted(context, failure);
            if (aborted) attributes[FirstrunAttr.ClientAborted] = true;

            // A status code read while an exception is unwinding is whatever nobody has
            // overwritten yet, which is 200 until their exception handler runs several
            // frames above us. Recording that would put a crashed request on the board as
            // a success, so the key is omitted instead: the same rule http.route follows
            // when there is no template, and for the same reason. If the response had
            // already started, the number really did go out and is worth having.
            bool statusWasSent = failure == null || context.Response.HasStarted;
            int status = context.Response.StatusCode;
            if (statusWasSent) attributes[FirstrunAttr.HttpResponseStatusCode] = status;

            if (failure != null && !aborted)
            {
                // Not a second exception entry: it is what makes "this request failed"
                // answerable without joining to one. Guarded because Message and GetType
                // are overridable and a custom exception can throw from either, and an
                // entry saying only that something threw still beats no entry at all.
                //
                // Nothing is named for an abort. The TaskCanceledException there is our own
                // observation of a socket closing, not a thing that went wrong in their
                // code, and putting it under exception.type would fill an exception
                // breakdown with a type nobody wrote.
                try
                {
                    Type type = failure.GetType();
                    attributes[FirstrunAttr.ExceptionType] = type.FullName ?? type.Name;
                    attributes[FirstrunAttr.ExceptionMessage] = failure.Message;
                }
                catch
                {
                }
            }

            // 5xx is ours and reads as an error. A 4xx is the caller's mistake, and a
            // board where every 404 is an ERROR is a board nobody can read past. An abort
            // is neither: nothing failed, somebody left. It stays at INFO even though it
            // reached us as a thrown exception, because an app with SSE, long polling,
            // streaming downloads or humans who close tabs would otherwise have an error
            // board that is mostly cancellations, and a board that is mostly noise is a
            // board nobody opens when something real breaks.
            int severity = (failure != null && !aborted) || (statusWasSent && status >= 500)
                ? FirstrunSeverity.Error
                : FirstrunSeverity.Info;

            _client.Log(FirstrunNames.HttpRequest,
                        severity: severity,
                        attributes: attributes,
                        deviceId: deviceId,
                        userId: userId,
                        sessionId: sessionId,
                        timestampMs: startedAtMs);
        }

        /// <summary>Whether this exception is the caller hanging up rather than a fault.</summary>
        /// <remarks>
        /// Both halves are needed. An <see cref="OperationCanceledException"/> on its own
        /// proves nothing: the customer's own timeout, a cancelled database call and a
        /// <see cref="CancellationTokenSource"/> they own all raise it, and those really are
        /// failures. <see cref="HttpContext.RequestAborted"/> being cancelled is what says
        /// the socket went away, and reading it costs nothing.
        /// <para>
        /// Guarded because it is a property on a server-owned object read while a request
        /// is unwinding, and no server implementation is worth a customer's exception being
        /// replaced by ours. Unknown reads as "not an abort", which files the entry the way
        /// it was filed before.
        /// </para>
        /// </remarks>
        private static bool Aborted(HttpContext context, Exception failure)
        {
            if (!(failure is OperationCanceledException)) return false;
            try
            {
                return context.RequestAborted.IsCancellationRequested;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Whether the framework is running the pipeline a second time over one request.
        /// </summary>
        /// <remarks>
        /// <b>Checked on the way down, and it has to be.</b> The default ASP.NET Core
        /// template puts <c>UseExceptionHandler("/error")</c> ABOVE <c>UseRouting</c>, and
        /// this middleware is documented as going after routing, so a handled exception
        /// sends the whole pipeline below the handler through a second time: one failed
        /// request, two <c>http.request</c> entries, request counts and error counts both
        /// inflated, and a phantom <c>/error</c> row attributed to the real visitor.
        /// <c>UseStatusCodePagesWithReExecute</c> does the same thing for a 404.
        /// <para>
        /// The reason the check cannot happen at recording time is that both features are
        /// left on the context afterwards rather than cleared. With the handler registered
        /// BELOW this middleware the feature is set during the call to <c>next</c> and is
        /// still there when the pipeline returns, so a check made then would read a
        /// first-and-only pass as a re-execution and drop the entry for every handled
        /// exception. On the way down the two arrangements are distinguishable: nothing has
        /// set either feature yet on a first pass.
        /// </para>
        /// </remarks>
        private static bool Reexecuting(HttpContext context)
        {
            return context.Features.Get<IExceptionHandlerFeature>() != null
                   || context.Features.Get<IStatusCodeReExecuteFeature>() != null;
        }

        /// <summary>The route TEMPLATE this request matched, or null when there is none.</summary>
        /// <remarks>
        /// <b>Called on the way DOWN, and the after-value is only a fallback for when that
        /// was null.</b> An earlier version of this file read the endpoint after the
        /// pipeline returned, on the reasoning that routing puts it on the context on the
        /// way down and nothing takes it off on the way back. The second half of that is
        /// not true. <c>ExceptionHandlerMiddleware</c> calls <c>SetEndpoint(null)</c>,
        /// clears the route values, re-routes to its error path and restores
        /// <c>Request.Path</c> in a finally but NOT the endpoint, so with the handler
        /// registered below this middleware the read came back with the error page's
        /// template beside the original path: one entry whose <c>http.route</c> and
        /// <c>url.path</c> describe two different requests, which is worse than a missing
        /// route because it is a plausible-looking wrong answer.
        /// <c>UseStatusCodePagesWithReExecute</c> rewrites the endpoint the same way.
        /// <para>
        /// The fallback is what keeps a middleware registered ahead of <c>UseRouting</c>
        /// working: nothing has matched yet on the way down there, and the after-value is
        /// the only one available. Registered where it is documented to go, the way-down
        /// read wins and the fallback never runs.
        /// </para>
        /// <para>
        /// The template and never the resolved path. <c>/orders/{id}</c> is one row on a
        /// breakdown; <c>/orders/8812</c> is one row per order, which is a breakdown
        /// nobody can read. When there is no endpoint (a static file, a request that
        /// short-circuited ahead of routing) the key is left off entirely rather than
        /// filled in with the path, because a path masquerading as a template is worse
        /// than an honest gap: it poisons the one column this is grouped on.
        /// </para>
        /// </remarks>
        private static string? RouteTemplate(HttpContext context)
        {
            var endpoint = context.GetEndpoint() as RouteEndpoint;
            string? raw = endpoint?.RoutePattern.RawText;
            if (raw == null) return null;

            // Attribute routes come back as "api/orders/{id}" and minimal-API routes as
            // "/orders/{id}". An app with both would split one route across two rows on a
            // breakdown over a leading slash, and url.path always has one.
            return raw.Length == 0 || raw[0] != '/' ? "/" + raw : raw;
        }

        /// <summary>The path that was asked for, prefix included.</summary>
        private static string? RequestPath(HttpContext context)
        {
            // PathBase is part of what the caller typed. An app mounted at /admin is
            // asked for /admin/orders, and that is what its access log says, even though
            // its route templates are relative to the mount point.
            string? basePath = context.Request.PathBase.Value;
            string? path = context.Request.Path.Value;
            if (string.IsNullOrEmpty(basePath)) return string.IsNullOrEmpty(path) ? null : path;
            return string.IsNullOrEmpty(path) ? basePath : basePath + path;
        }

        /// <summary>
        /// Whether the customer's predicate wants this request left alone.
        /// </summary>
        /// <remarks>
        /// Its own guard rather than the caller's, so a predicate that throws costs the
        /// request its entry and not its identity scope. False on a throw: we cannot know
        /// what they meant, and an unwanted row can be filtered on a board while a row
        /// that was never written cannot be recovered.
        /// </remarks>
        private bool Ignored(HttpContext context)
        {
            if (_ignore == null) return false;
            try
            {
                return _ignore(context);
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Runs one of the customer's extractors. Empty is absent, and so is a throw.</summary>
        /// <remarks>
        /// Guarded here rather than only by the caller's backstop, so a delegate that
        /// fails costs its own field and not the whole entry. Every identity is optional,
        /// so a broken extractor leaves that one key off the entry and the request is
        /// still recorded: blinding the request board over a field that was optional to
        /// begin with is the worse trade. Nothing is substituted for what the delegate
        /// did not return.
        /// </remarks>
        private static string? Resolve(Func<HttpContext, string?> extractor, HttpContext context)
        {
            try
            {
                string? value = extractor(context);
                return string.IsNullOrEmpty(value) ? null : value;
            }
            catch
            {
                return null;
            }
        }

        private static double ElapsedMs(long startedTicks)
        {
            // Stopwatch rather than the wall clock: an NTP correction mid-request would
            // otherwise show up as a negative or an implausible duration on the board.
            long elapsed = Stopwatch.GetTimestamp() - startedTicks;
            if (elapsed < 0) elapsed = 0;

            // Three decimals. Microseconds are past what any of this measures, and every
            // digit past them is bytes in a batch that buys nothing.
            return Math.Round(elapsed * 1000.0 / Stopwatch.Frequency, 3);
        }
    }
}
