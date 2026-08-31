using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Firstrun
{
    /// <summary>Pipeline wiring: one identity scope per request, one entry per request.</summary>
    public static class FirstrunApplicationBuilderExtensions
    {
        /// <summary>
        /// Opens a <see cref="FirstrunIdentity"/> scope for every request and records one
        /// <c>http.request</c> entry when it completes.
        /// </summary>
        /// <remarks>
        /// <para>
        /// <b>Register it after <c>UseRouting</c>.</b> The route template comes from the
        /// endpoint routing matched, so a middleware placed ahead of routing on a pipeline
        /// that short-circuits before routing runs records no <c>http.route</c> at all:
        /// the entries still arrive, and the one column a request breakdown is grouped on
        /// is silently missing from them. Register it after <c>UseAuthentication</c> too
        /// if <see cref="FirstrunMiddlewareOptions.UserId"/> reads
        /// <see cref="HttpContext.User"/>, because the scope opens on the way down and the
        /// principal is not populated before authentication has run.
        /// </para>
        /// <para>
        /// That ordering puts it below <c>UseExceptionHandler</c>, where the template puts
        /// it, so a handled exception drives the pipeline through here a SECOND time on the
        /// way to the error page. The second pass records nothing: one request is one
        /// entry, and the phantom <c>/error</c> row it used to add inflated request counts
        /// and error counts alike. The identity scope is still opened on that pass, so
        /// anything your error page records is still the visitor's.
        /// </para>
        /// <para>
        /// Everything inside the request is guarded: the pipeline below this runs exactly
        /// once whatever our own code does, an exception from a handler propagates
        /// unchanged, and nothing here is awaited on a path a person is waiting on beyond
        /// the handler itself. The entry is queued in memory and sent later by the
        /// client's own thread.
        /// </para>
        /// <para>
        /// Two wiring mistakes disable it rather than failing anything:
        /// <see cref="FirstrunMiddlewareOptions.DeviceId"/> left unset (there is nothing
        /// to attribute a request to, and this library will not invent one), and no
        /// <see cref="FirstrunClient"/> in the container (call
        /// <c>AddFirstrunServer</c> first). Both write one line to the host's logger at
        /// startup and then leave the pipeline exactly as it was.
        /// </para>
        /// </remarks>
        /// <param name="app">The application pipeline.</param>
        /// <param name="configure">
        /// Fills in the delegates the middleware is allowed to call.
        /// every identity extractor is optional.
        /// </param>
        public static IApplicationBuilder UseFirstrun(this IApplicationBuilder app,
                                                      Action<FirstrunMiddlewareOptions>? configure = null)
        {
            // Deliberately a throw, and the one in this package. Rule 7 is about not
            // breaking a program that works; a null `this` on an extension method is a
            // program that is already broken, and the alternative is returning null into
            // their builder chain so the framework raises the same thing one line later
            // with our name nowhere near it. It also matches AddFirstrun and
            // AddFirstrunServer, which guard their arguments the same way. The house rule
            // it does not contradict (FirstrunClient's constructor: report, disable,
            // discard) is about a misconfigured runtime object whose failure mode is no
            // telemetry, which this is not.
            if (app == null) throw new ArgumentNullException(nameof(app));

            var options = new FirstrunMiddlewareOptions();
            // Their lambda, on their thread, during their startup, and deliberately not
            // guarded. A throw from it is their bug in their own Program.cs: swallowing it
            // would leave them with a half-configured middleware and no idea why, and the
            // exception a customer sees is the one their own code raised, at their own
            // call site, before a single request has been served. The cost is real and is
            // accepted: a mistake in an options lambda aborts startup.
            configure?.Invoke(options);

            FirstrunClient? client = Resolve(app);
            if (client == null)
            {
                Notice(app, "UseFirstrun found no FirstrunClient in the container and did nothing. "
                            + "Call services.AddFirstrunServer(sourceKey, host) first.");
                return app;
            }

            // Copied out of the options object now, so the pipeline cannot be rewired by
            // a later mutation of an instance the caller happens to have kept.
            Func<HttpContext, string?>? deviceId = options.DeviceId;
            Func<HttpContext, string?>? userId = options.UserId;
            Func<HttpContext, string?>? sessionId = options.SessionId;
            Func<HttpContext, bool>? ignore = options.Ignore;

            // A client wired with AddFirstrun rather than AddFirstrunServer still holds the
            // desktop default: one session id minted at construction, for a process that on
            // a server is not a sitting but a box serving thousands of unrelated callers.
            // Left alone it lands on every entry the process ever sends, so a session count
            // on their board counts restarts and a value this library minted for itself is
            // reported as a property of the caller. Nothing here can fix it (the client's
            // options were sealed when it was built), so it is said once, at startup, to
            // the person who can.
            if (sessionId == null && HasProcessSession(client))
            {
                Notice(app, "UseFirstrun is running against a client with a process-wide session id, so "
                            + "session.id will be the same value on every request this process serves. "
                            + "Use services.AddFirstrunServer(...), or set SessionPerProcess = false, and "
                            + "supply FirstrunMiddlewareOptions.SessionId if your requests have sessions.");
            }

            // Resolved once here rather than per request: the client is a singleton that
            // owns a thread, an HttpClient and a queue, and looking it up on every request
            // would be a container hit on a path a person is waiting on.
            return app.Use(next =>
                new FirstrunMiddleware(next, client, deviceId, userId, sessionId, ignore).Invoke);
        }

        /// <summary>Whether this client holds a session id of its own.</summary>
        /// <remarks>
        /// Guarded like everything else that touches the client from startup: reading a
        /// property is not worth a boot failure, and unknown reads as "no", which says
        /// nothing rather than saying the wrong thing.
        /// </remarks>
        private static bool HasProcessSession(FirstrunClient client)
        {
            try
            {
                return client.SessionId.Length > 0;
            }
            catch
            {
                return false;
            }
        }

        private static FirstrunClient? Resolve(IApplicationBuilder app)
        {
            try
            {
                return app.ApplicationServices.GetService<FirstrunClient>();
            }
            catch
            {
                // A container that throws while resolving is a problem in their
                // registrations, and it is not this library's business to be the thing
                // that surfaces it by taking startup down.
                return null;
            }
        }

        /// <summary>
        /// The one place in this library that raises its voice, and only at startup.
        /// </summary>
        /// <remarks>
        /// Rule 7's silence is about the customer's END USERS, and about conditions nobody
        /// reading a log can act on: a wrong host, a wrong key, a 500 from us. This is
        /// neither. It is a wiring mistake in their own Program.cs whose entire symptom is
        /// that nothing at all arrives, it fires once before any request is served, and
        /// the person who sees the line is the person who fixes it in one line. A Debug
        /// entry nobody has enabled would have made "I installed it and got nothing" a
        /// support conversation instead.
        /// </remarks>
        private static void Notice(IApplicationBuilder app, string message)
        {
            try
            {
                ILoggerFactory? factory = app.ApplicationServices.GetService<ILoggerFactory>();
                factory?.CreateLogger("Firstrun").LogWarning("firstrun: {Message}", message);
            }
            catch
            {
            }
        }
    }
}
