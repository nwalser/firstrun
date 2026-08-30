using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Firstrun
{
    internal enum SendOutcome
    {
        /// <summary>Accepted. Drop the batch.</summary>
        Accepted,

        /// <summary>The server will say no again in an hour. Drop the batch, do not retry.</summary>
        Rejected,

        /// <summary>Offline, timed out, rate limited, or the server is having a bad day. Keep the batch.</summary>
        Transient,
    }

    internal readonly struct SendResult
    {
        internal SendResult(SendOutcome outcome, string detail, TimeSpan? retryAfter = null)
        {
            Outcome = outcome;
            Detail = detail;
            RetryAfter = retryAfter;
        }

        internal SendOutcome Outcome { get; }
        internal string Detail { get; }

        /// <summary>What the server asked us to wait, when it said so.</summary>
        internal TimeSpan? RetryAfter { get; }
    }

    /// <summary>
    /// One POST to <c>/v1/e</c>.
    /// </summary>
    /// <remarks>
    /// A single <see cref="HttpClient"/> for the life of the client, never one per call:
    /// a per-call HttpClient burns a socket per batch and leaves it in TIME_WAIT, which
    /// is how a telemetry library ends up exhausting the ports of the app it is measuring.
    ///
    /// The response body is read and discarded. There is nothing in it the client can
    /// act on that the status code has not already said, and reading it into a string is
    /// bounded work we do not need to do.
    /// </remarks>
    internal sealed class Transport : IDisposable
    {
        private readonly HttpClient _http;
        private readonly bool _ownsHttp;
        private readonly string _url;

        internal Transport(FirstrunOptions options)
        {
            _url = options.Host.TrimEnd('/') + "/v1/e";

            if (options.HttpClient != null)
            {
                _http = options.HttpClient;
                _ownsHttp = false;
                return;
            }

            _ownsHttp = true;
#if NET8_0_OR_GREATER
            var handler = new SocketsHttpHandler
            {
                ConnectTimeout = options.ConnectTimeout,
                // A telemetry client makes one request every few seconds at most. Holding
                // a pooled connection open for minutes across an idle app is a socket the
                // host is not using for its own work.
                PooledConnectionIdleTimeout = TimeSpan.FromSeconds(90),
                MaxConnectionsPerServer = 2,
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            };
            _http = new HttpClient(handler, disposeHandler: true);
#else
            _http = new HttpClient();
#endif
            _http.Timeout = options.RequestTimeout;
        }

        internal async Task<SendResult> SendAsync(string body, CancellationToken cancellation)
        {
            try
            {
                using (var request = new HttpRequestMessage(HttpMethod.Post, _url))
                {
                    request.Content = new StringContent(body, new UTF8Encoding(false), "application/json");
                    // No cookies, no auth, nothing identifying. The source key in the body
                    // is the whole of what we tell the server about the caller.
                    request.Headers.TryAddWithoutValidation("User-Agent", "firstrun-dotnet");

                    using (HttpResponseMessage response = await _http
                        .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation)
                        .ConfigureAwait(false))
                    {
                        int code = (int)response.StatusCode;

                        if (code >= 200 && code < 300)
                        {
                            return new SendResult(SendOutcome.Accepted, code.ToString());
                        }

                        // 408 and 429 are the two 4xx that mean "later", not "never".
                        if (code == 408 || code == 429)
                        {
                            return new SendResult(SendOutcome.Transient, "http " + code, RetryAfter(response));
                        }

                        if (code >= 400 && code < 500)
                        {
                            // A malformed batch, or a source key that no longer exists.
                            // Retrying forever would wedge every later event behind it.
                            return new SendResult(SendOutcome.Rejected, "http " + code);
                        }

                        return new SendResult(SendOutcome.Transient, "http " + code, RetryAfter(response));
                    }
                }
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
            {
                return new SendResult(SendOutcome.Transient, "cancelled");
            }
            catch (OperationCanceledException)
            {
                // HttpClient reports its own timeout as a cancellation on most runtimes.
                return new SendResult(SendOutcome.Transient, "timeout");
            }
            catch (HttpRequestException ex)
            {
                return new SendResult(SendOutcome.Transient, Describe(ex));
            }
            catch (Exception ex)
            {
                // Whatever this was, it is not worth an unhandled exception on a
                // background thread of somebody else's application.
                return new SendResult(SendOutcome.Transient, Describe(ex));
            }
        }

        private static TimeSpan? RetryAfter(HttpResponseMessage response)
        {
            try
            {
                System.Net.Http.Headers.RetryConditionHeaderValue? header = response.Headers.RetryAfter;
                if (header == null) return null;
                if (header.Delta.HasValue) return header.Delta.Value;
                if (header.Date.HasValue)
                {
                    TimeSpan delta = header.Date.Value - DateTimeOffset.UtcNow;
                    return delta > TimeSpan.Zero ? delta : TimeSpan.Zero;
                }
            }
            catch
            {
                // A malformed header is not worth a failed send path.
            }
            return null;
        }

        private static string Describe(Exception ex)
        {
            Exception root = ex;
            while (root.InnerException != null) root = root.InnerException;
            return root.GetType().Name + ": " + root.Message;
        }

        public void Dispose()
        {
            if (_ownsHttp) _http.Dispose();
        }
    }
}
