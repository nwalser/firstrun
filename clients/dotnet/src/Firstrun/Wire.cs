using System;
using System.Collections.Generic;
using System.Globalization;

namespace Firstrun
{
    /// <summary>The kind of thing an event came from. Mirrors the server's Surface enum.</summary>
    public enum FirstrunSurface
    {
        Web,
        Desktop,
        Mobile,
        Server,
        Other,
    }

    /// <summary>
    /// Conventional entry names. SUGGESTIONS, NOT LAW: any name matching
    /// <see cref="Wire.IsValidLogName"/> is stored, counted, grouped and filtered
    /// identically by the whole system, and nothing here is special-cased anywhere.
    /// </summary>
    public static class FirstrunNames
    {
        public const string PageView = "page_view";
        public const string SessionStart = "session_start";
        public const string AppInstall = "app_install";
        public const string AppLaunch = "app_launch";
        public const string Identify = "identify";
        public const string Exception = "exception";
        public const string HttpRequest = "http.request";
        public const string Measurement = "measurement";

        /// <summary>
        /// What the level helpers name an entry. A free-form line still needs a name,
        /// because <c>name</c> is the column a dashboard groups on.
        /// </summary>
        public const string Log = "log";
    }

    /// <summary>
    /// The OpenTelemetry severity ladder: twenty-four numbers in six bands of four.
    /// </summary>
    /// <remarks>
    /// The number is authoritative and is what the server stores; text is derived from
    /// it for display and never travels. Two entries that sorted differently because one
    /// said "warn" and the other said "WARNING" would be a bug nobody could see.
    /// <para>
    /// The three spare steps inside each band exist so a program whose own logger has
    /// nine levels can map onto this without losing the ordering:
    /// <c>FirstrunSeverity.Warn + 1</c> is a slightly worse warning and still filters as
    /// a warning.
    /// </para>
    /// </remarks>
    public static class FirstrunSeverity
    {
        public const int Trace = 1;
        public const int Debug = 5;
        public const int Info = 9;
        public const int Warn = 13;
        public const int Error = 17;
        public const int Fatal = 21;

        public const int Min = 1;
        public const int Max = 24;
    }

    /// <summary>
    /// Conventional attribute keys, from <c>packages/schema/src/conventions.ts</c>.
    /// </summary>
    /// <remarks>
    /// The exception, session, user, service, os, http and url keys are OpenTelemetry's,
    /// used verbatim. The <c>firstrun.*</c> keys are ours, namespaced so it is obvious at
    /// a glance which half of the vocabulary we can change.
    /// <para>
    /// Nothing here is enforced. An entry using keys nobody has heard of gets exactly the
    /// same storage, the same indexing and the same query surface; what it loses is only
    /// the suggestions a picker offers.
    /// </para>
    /// </remarks>
    public static class FirstrunAttr
    {
        /// <summary>
        /// The human-readable line. OpenTelemetry's log model has <c>body</c> as a
        /// top-level field; this product promotes five columns and no more, so it travels
        /// as an attribute under the spec's own name. Same for <see cref="TraceId"/> and
        /// <see cref="SpanId"/>: they are part of the spec's vocabulary, not ours, and
        /// promoting one later is a generated column rather than a schema break.
        /// </summary>
        public const string Body = "body";
        public const string TraceId = "trace_id";
        public const string SpanId = "span_id";

        public const string ExceptionType = "exception.type";
        public const string ExceptionMessage = "exception.message";
        public const string ExceptionStacktrace = "exception.stacktrace";
        public const string ExceptionEscaped = "exception.escaped";

        public const string SessionId = "session.id";
        public const string UserId = "user.id";

        public const string ServiceName = "service.name";
        public const string ServiceVersion = "service.version";

        public const string OsType = "os.type";
        public const string HostArch = "host.arch";
        public const string BrowserLanguage = "browser.language";

        public const string UrlPath = "url.path";
        public const string UrlFull = "url.full";

        public const string HttpRequestMethod = "http.request.method";
        public const string HttpResponseStatusCode = "http.response.status_code";
        public const string HttpRoute = "http.route";

        public const string Channel = "firstrun.channel";

        /// <summary>
        /// Marks test data. Written only as the JSON boolean <c>true</c>, and only when
        /// true: the dashboard matches it with jsonb containment, where the string
        /// <c>"true"</c> is a different value and would match neither world. A production
        /// entry omits the key rather than sending <c>false</c>.
        /// </summary>
        public const string Test = "firstrun.test";
        public const string DurationMs = "firstrun.duration_ms";
        public const string Value = "firstrun.value";
        public const string Metric = "firstrun.metric";
        public const string Unit = "firstrun.unit";
    }

    /// <summary>Shapes shared with the server: source keys, event names, os/arch spelling.</summary>
    public static class Wire
    {
        /// <summary>The longest entry name the server will accept.</summary>
        public const int LogNameMaxLength = 128;

        /// <summary>The longest a distinct_id or user_id may be.</summary>
        public const int IdMaxLength = 512;

        /// <summary>
        /// How many entries one POST may carry.
        /// <see cref="FirstrunOptions.MaxBatchSize"/> is clamped to it.
        /// </summary>
        /// <remarks>
        /// Read out of the wire format rather than guessed: this is
        /// <c>MAX_BATCH_ENTRIES</c> in <c>packages/schema/src/log.ts</c>, where the body
        /// schema declares <c>e: z.array(WireEntry).min(1).max(MAX_BATCH_ENTRIES)</c>.
        /// Exceeding it is not a partial success. The whole request is rejected, so the
        /// queue never drains and the failure looks like a client that is not sending at
        /// all.
        /// </remarks>
        public const int MaxBatchEntries = 500;

        /// <summary>
        /// The server's LOG_NAME_RE, hand-written so there is no Regex allocation on
        /// the caller's thread: <c>^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$</c>.
        /// </summary>
        /// <remarks>
        /// ':' and '&gt;' are excluded on the server on purpose: they separate the parts
        /// of a dashboard's snapshot keys, so allowing them in a name would let one
        /// entry forge another's results. Keep this in step with the server regex.
        /// </remarks>
        public static bool IsValidLogName(string? name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            if (name!.Length > LogNameMaxLength) return false;
            char head = name[0];
            bool headOk = (head >= 'A' && head <= 'Z') || (head >= 'a' && head <= 'z') || (head >= '0' && head <= '9');
            if (!headOk) return false;
            for (int i = 1; i < name.Length; i++)
            {
                char c = name[i];
                bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                          || c == '_' || c == '.' || c == '-';
                if (!ok) return false;
            }
            return true;
        }

        /// <summary><c>fr_(web|desktop|mobile|server|other)_[0-9a-z]{16}</c>.</summary>
        public static bool IsValidSourceKey(string? key)
        {
            return SurfaceFromSourceKey(key) != null;
        }

        /// <summary>
        /// The surface a source key claims, or null when the key is malformed.
        /// Advisory only: the server trusts the stored source row, never the key text.
        /// </summary>
        public static FirstrunSurface? SurfaceFromSourceKey(string? key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            if (!key!.StartsWith("fr_", StringComparison.Ordinal)) return null;
            int second = key.IndexOf('_', 3);
            if (second < 0) return null;

            string surface = key.Substring(3, second - 3);
            string suffix = key.Substring(second + 1);
            if (suffix.Length != 16) return null;
            foreach (char c in suffix)
            {
                bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z');
                if (!ok) return null;
            }

            switch (surface)
            {
                case "web": return FirstrunSurface.Web;
                case "desktop": return FirstrunSurface.Desktop;
                case "mobile": return FirstrunSurface.Mobile;
                case "server": return FirstrunSurface.Server;
                case "other": return FirstrunSurface.Other;
                default: return null;
            }
        }

        /// <summary>Milliseconds since the Unix epoch, which is what an entry timestamp is.</summary>
        public static long NowMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        /// <summary>
        /// The os string, spelled the way the Rust SDK spells it so a breakdown by os
        /// does not split one platform across two rows.
        /// </summary>
        public static string OsName()
        {
#if NET8_0_OR_GREATER
            if (OperatingSystem.IsWindows()) return "windows";
            if (OperatingSystem.IsMacOS()) return "macos";
            if (OperatingSystem.IsLinux()) return "linux";
            if (OperatingSystem.IsAndroid()) return "android";
            if (OperatingSystem.IsIOS()) return "ios";
            if (OperatingSystem.IsFreeBSD()) return "freebsd";
            return "other";
#else
            switch (Environment.OSVersion.Platform)
            {
                case PlatformID.Win32NT:
                case PlatformID.Win32S:
                case PlatformID.Win32Windows:
                case PlatformID.WinCE:
                    return "windows";
                case PlatformID.MacOSX:
                    return "macos";
                case PlatformID.Unix:
                    // Mono reports macOS as Unix often enough that the directory is the
                    // more reliable tell than the PlatformID.
                    return System.IO.Directory.Exists("/System/Library/CoreServices") ? "macos" : "linux";
                default:
                    return "other";
            }
#endif
        }

        /// <summary>The process architecture, spelled the way the Rust SDK spells it.</summary>
        public static string ArchName()
        {
            switch (System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture)
            {
                case System.Runtime.InteropServices.Architecture.X64: return "x86_64";
                case System.Runtime.InteropServices.Architecture.X86: return "x86";
                case System.Runtime.InteropServices.Architecture.Arm64: return "aarch64";
                case System.Runtime.InteropServices.Architecture.Arm: return "arm";
                default: return "other";
            }
        }

        /// <summary>BCP-47 tag for the current UI culture, or null for the invariant culture.</summary>
        public static string? LocaleName()
        {
            try
            {
                string name = CultureInfo.CurrentUICulture.Name;
                return string.IsNullOrEmpty(name) ? null : name;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>Truncates an id to what the server accepts, or null when it is empty.</summary>
        internal static string? ClampId(string? id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            return id!.Length <= IdMaxLength ? id : id.Substring(0, IdMaxLength);
        }

        // The bounds the edge enforces, mirrored here so one oversized attribute costs
        // itself rather than costing the whole batch its existence. The edge rejects a
        // body that breaks any of these, and a rejected body is a permanent failure that
        // takes every entry travelling beside it down too.
        internal const int MaxAttributes = 64;
        internal const int MaxAttributeDepth = 4;
        internal const int MaxAttributeKey = 128;
        internal const int MaxAttributeString = 4096;
        internal const int MaxAttributeItems = 128;

        /// <summary>The longest body this client sends. Truncated, never dropped.</summary>
        internal const int MaxBody = 16384;

        /// <summary>Keeps a caller's severity on the ladder. Zero means they said nothing.</summary>
        internal static int ClampSeverity(int severity)
        {
            if (severity == 0) return 0;
            if (severity < FirstrunSeverity.Min) return FirstrunSeverity.Min;
            if (severity > FirstrunSeverity.Max) return FirstrunSeverity.Max;
            return severity;
        }

        /// <summary>Bounds a body string. Truncated rather than dropped: half a line still says something.</summary>
        internal static string? ClampBody(string? body)
        {
            if (string.IsNullOrEmpty(body)) return null;
            return body!.Length <= MaxBody ? body : body.Substring(0, MaxBody);
        }

        /// <summary>
        /// Copies and bounds an attribute map, returning null when nothing survived.
        /// </summary>
        /// <remarks>
        /// Copying matters as much as clamping: a caller who reuses and mutates their
        /// dictionary after the call must not be able to rewrite an entry this library
        /// has already recorded.
        /// </remarks>
        internal static Dictionary<string, object?>? ClampAttributes(IReadOnlyDictionary<string, object?>? input)
        {
            if (input == null || input.Count == 0) return null;
            var output = new Dictionary<string, object?>(input.Count, StringComparer.Ordinal);
            foreach (KeyValuePair<string, object?> kv in input)
            {
                if (output.Count >= MaxAttributes) break;
                if (string.IsNullOrEmpty(kv.Key) || kv.Key.Length > MaxAttributeKey) continue;
                if (!TryClampValue(kv.Value, MaxAttributeDepth, out object? cleaned)) continue;
                output[kv.Key] = cleaned;
            }
            return output.Count > 0 ? output : null;
        }

        /// <summary>
        /// Returns a value the edge will accept, and false when there is nothing sendable.
        /// </summary>
        /// <remarks>
        /// Non-finite numbers go because NaN and Infinity are not JSON and would arrive as
        /// the bare literal a parser rejects, taking every entry beside them down.
        /// Anything past the depth limit is dropped rather than flattened: a truncated
        /// object that still looks like an object is worse to debug than a key that is
        /// honestly absent.
        /// </remarks>
        private static bool TryClampValue(object? value, int depth, out object? cleaned)
        {
            cleaned = null;
            switch (value)
            {
                case null:
                    return true;
                case string s:
                    cleaned = s.Length <= MaxAttributeString ? s : s.Substring(0, MaxAttributeString);
                    return true;
                case bool b:
                    cleaned = b;
                    return true;
                case double d:
                    if (double.IsNaN(d) || double.IsInfinity(d)) return false;
                    cleaned = d;
                    return true;
                case float f:
                    if (float.IsNaN(f) || float.IsInfinity(f)) return false;
                    cleaned = f;
                    return true;
                case sbyte or byte or short or ushort or int or uint or long or ulong or decimal:
                    cleaned = value;
                    return true;
                case DateTime dt:
                    cleaned = dt.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
                    return true;
                case DateTimeOffset dto:
                    cleaned = dto.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
                    return true;
                case Guid g:
                    cleaned = g.ToString("D");
                    return true;
            }

            if (depth <= 1) return false;

            if (value is IReadOnlyDictionary<string, object?> map)
            {
                var nested = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (KeyValuePair<string, object?> kv in map)
                {
                    if (nested.Count >= MaxAttributeItems) break;
                    if (string.IsNullOrEmpty(kv.Key) || kv.Key.Length > MaxAttributeKey) continue;
                    if (!TryClampValue(kv.Value, depth - 1, out object? item)) continue;
                    nested[kv.Key] = item;
                }
                cleaned = nested;
                return true;
            }

            if (value is System.Collections.IEnumerable list)
            {
                var items = new List<object?>();
                foreach (object? entry in list)
                {
                    if (items.Count >= MaxAttributeItems) break;
                    // A hole in an array shifts every later index, so a member that did
                    // not survive becomes null rather than disappearing.
                    items.Add(TryClampValue(entry, depth - 1, out object? item) ? item : null);
                }
                cleaned = items;
                return true;
            }

            // A type this client cannot vouch for. Its text is usually the useful part,
            // and a ToString that throws is the caller's bug, not ours to propagate.
            try
            {
                string? text = value.ToString();
                if (text == null) return false;
                cleaned = text.Length <= MaxAttributeString ? text : text.Substring(0, MaxAttributeString);
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Merges bounded maps. Later maps win, and the count stays bounded.</summary>
        internal static Dictionary<string, object?>? MergeAttributes(params IReadOnlyDictionary<string, object?>?[] maps)
        {
            var output = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (IReadOnlyDictionary<string, object?>? map in maps)
            {
                if (map == null) continue;
                foreach (KeyValuePair<string, object?> kv in map)
                {
                    if (!output.ContainsKey(kv.Key) && output.Count >= MaxAttributes) continue;
                    output[kv.Key] = kv.Value;
                }
            }
            return output.Count > 0 ? output : null;
        }

        /// <summary>
        /// Unwraps an exception into the conventional <c>exception.*</c> attributes.
        /// </summary>
        /// <remarks>
        /// The single most valuable helper in the library, so it does the work the caller
        /// would otherwise do at every catch site: the concrete type, the message, and the
        /// stack trace including the inner-exception chain, which is what
        /// <see cref="Exception.ToString"/> already produces.
        /// </remarks>
        internal static Dictionary<string, object?> ExceptionAttributes(Exception error)
        {
            var output = new Dictionary<string, object?>(StringComparer.Ordinal);

            string type;
            try { type = error.GetType().FullName ?? error.GetType().Name; }
            catch { type = "Exception"; }
            output[FirstrunAttr.ExceptionType] = Truncate(type);

            string message;
            try { message = error.Message ?? ""; }
            catch { message = ""; }
            output[FirstrunAttr.ExceptionMessage] = Truncate(message);

            string? stack = null;
            try { stack = error.ToString(); }
            catch { }
            if (!string.IsNullOrEmpty(stack))
            {
                // Truncated from the FRONT, because the innermost frames and the
                // exception line itself are what a reader looks at first.
                stack = stack!.Length <= MaxAttributeString
                    ? stack
                    : stack.Substring(stack.Length - MaxAttributeString);
                output[FirstrunAttr.ExceptionStacktrace] = stack;
            }

            return output;
        }

        private static string Truncate(string value)
        {
            return value.Length <= MaxAttributeString ? value : value.Substring(0, MaxAttributeString);
        }
    }
}
