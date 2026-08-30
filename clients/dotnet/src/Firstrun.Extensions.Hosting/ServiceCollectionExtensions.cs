using System;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Firstrun
{
    /// <summary>DI wiring: one singleton client, flushed on host shutdown.</summary>
    public static class FirstrunServiceCollectionExtensions
    {
        /// <summary>
        /// Registers a singleton <see cref="FirstrunClient"/> and the hosted service that
        /// flushes it on shutdown.
        /// </summary>
        /// <remarks>
        /// Singleton on purpose. The client owns a thread, an HttpClient and a queue; one
        /// per request would be one socket per request, which is how a telemetry library
        /// ends up being the reason a server ran out of ports.
        ///
        /// Nothing registered here can fail a startup: the client's constructor does not
        /// throw, and the hosted service does no work in StartAsync.
        /// </remarks>
        public static IServiceCollection AddFirstrun(this IServiceCollection services,
                                                     Action<FirstrunOptions> configure)
        {
            if (services == null) throw new ArgumentNullException(nameof(services));
            if (configure == null) throw new ArgumentNullException(nameof(configure));

            services.AddSingleton(provider =>
            {
                var options = new FirstrunOptions();
                configure(options);

                if (options.Diagnostics == null)
                {
                    // Only wired when the host did not supply its own sink, and only at
                    // Debug: analytics has no business in a production error log.
                    ILoggerFactory? factory = provider.GetService<ILoggerFactory>();
                    if (factory != null)
                    {
                        ILogger logger = factory.CreateLogger("Firstrun");
                        options.Diagnostics = d => logger.Log(
                            d.Kind == FirstrunDiagnosticKind.InternalError ? LogLevel.Debug : LogLevel.Trace,
                            d.Exception, "firstrun: {Message}", d.Message);
                    }
                }

                return new FirstrunClient(options);
            });

            services.TryAddEnumerable(
                ServiceDescriptor.Singleton<IHostedService, FirstrunHostedService>(
                    provider => new FirstrunHostedService(
                        provider.GetRequiredService<FirstrunClient>(),
                        provider.GetService<ILogger<FirstrunHostedService>>())));

            return services;
        }

        /// <summary>
        /// The overload for a server: the anonymous id is not a property of the machine,
        /// so it is not persisted and every call is expected to pass its own.
        /// </summary>
        public static IServiceCollection AddFirstrunServer(this IServiceCollection services,
                                                           string sourceKey, string host,
                                                           Action<FirstrunOptions>? configure = null)
        {
            return services.AddFirstrun(options =>
            {
                options.SourceKey = sourceKey;
                options.Host = host;
                options.PersistDistinctId = false;
                options.TrackLifecycleEvents = false;
                configure?.Invoke(options);
            });
        }
    }
}
