using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Firstrun
{
    /// <summary>
    /// Keeps the client alive for the lifetime of the host and flushes on shutdown.
    /// </summary>
    /// <remarks>
    /// <see cref="StartAsync"/> does nothing but return: the client is already running by
    /// the time DI has constructed it, and a hosted service that dials out on startup is
    /// a hosted service that can delay a deployment behind an analytics outage.
    ///
    /// <see cref="StopAsync"/> waits, briefly and with a timeout, for the queue to drain.
    /// It cannot delay shutdown past that timeout, and it never faults the shutdown path.
    /// <para>
    /// This is the ASP.NET half of <see cref="FirstrunOptions.FlushOnExit"/>. The other
    /// half is the client's own <c>ProcessExit</c> hook, which covers a desktop app that
    /// closes without a shutdown sequence. On a host that stops properly this one runs
    /// first, inside the graceful shutdown window, and the hook then finds nothing to do.
    /// </para>
    /// </remarks>
    public sealed class FirstrunHostedService : IHostedService
    {
        private readonly FirstrunClient _client;
        private readonly TimeSpan _shutdownFlushTimeout;
        private readonly ILogger<FirstrunHostedService>? _logger;

        public FirstrunHostedService(FirstrunClient client, ILogger<FirstrunHostedService>? logger = null)
            : this(client, client == null ? TimeSpan.FromSeconds(2) : client.ExitFlushTimeout, logger)
        {
        }

        public FirstrunHostedService(FirstrunClient client, TimeSpan shutdownFlushTimeout,
                                     ILogger<FirstrunHostedService>? logger = null)
        {
            _client = client;
            _shutdownFlushTimeout = shutdownFlushTimeout;
            _logger = logger;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            // A host that turned the exit flush off meant it. Draining here anyway would
            // put the setting's behaviour in two places and let one of them win.
            if (!_client.FlushOnExit) return;

            try
            {
                bool flushed = await _client.FlushAsync(_shutdownFlushTimeout).ConfigureAwait(false);
                if (!flushed && _logger != null)
                {
                    _logger.LogDebug("firstrun: shutdown flush did not complete within {Timeout}", _shutdownFlushTimeout);
                }
            }
            catch (Exception ex)
            {
                _logger?.LogDebug(ex, "firstrun: shutdown flush failed");
            }
        }
    }
}
