using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Firstrun
{
    /// <summary>
    /// The smallest JSON writer that can produce a LogBatch.
    /// </summary>
    /// <remarks>
    /// Hand-rolled rather than System.Text.Json because that is a NuGet package on
    /// netstandard2.0, and a telemetry library has no business dragging a
    /// serializer version into a host app's dependency graph where it can conflict
    /// with the one the host already pinned. This library only ever writes JSON and
    /// never reads it (the ingest response body is discarded), so the surface that
    /// has to be correct is escaping, and that is the whole of this file.
    /// </remarks>
    internal static class Json
    {
        /// <summary>Appends a JSON string literal, quotes included.</summary>
        internal static void WriteString(StringBuilder sb, string value)
        {
            sb.Append('"');
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        // Control characters and lone surrogates both have to go out as
                        // \uXXXX: a lone surrogate is not valid UTF-8, and the encoder
                        // would silently replace it with U+FFFD on the way to the socket.
                        if (c < 0x20 || char.IsSurrogate(c))
                        {
                            if (char.IsHighSurrogate(c) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
                            {
                                sb.Append(c).Append(value[i + 1]);
                                i++;
                            }
                            else
                            {
                                sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                            }
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }

        /// <summary>Appends <c>"name":"value"</c>, or nothing at all when value is null.</summary>
        internal static void WriteOptional(StringBuilder sb, string name, string? value, ref bool first)
        {
            if (value == null) return;
            WriteRequired(sb, name, value, ref first);
        }

        internal static void WriteRequired(StringBuilder sb, string name, string value, ref bool first)
        {
            if (!first) sb.Append(',');
            first = false;
            WriteString(sb, name);
            sb.Append(':');
            WriteString(sb, value);
        }

        internal static void WriteNumber(StringBuilder sb, string name, long value, ref bool first)
        {
            if (!first) sb.Append(',');
            first = false;
            WriteString(sb, name);
            sb.Append(':');
            sb.Append(value.ToString(CultureInfo.InvariantCulture));
        }

        /// <summary>Appends an attribute map under <paramref name="name"/>, or nothing when it is empty.</summary>
        internal static void WriteAttributes(StringBuilder sb, string name, IReadOnlyDictionary<string, object?>? attributes, ref bool first)
        {
            if (attributes == null || attributes.Count == 0) return;
            if (!first) sb.Append(',');
            first = false;
            WriteString(sb, name);
            sb.Append(':');
            WriteMap(sb, attributes);
        }

        private static void WriteMap(StringBuilder sb, IReadOnlyDictionary<string, object?> map)
        {
            sb.Append('{');
            bool inner = true;
            foreach (KeyValuePair<string, object?> kv in map)
            {
                if (kv.Key == null) continue;
                if (!inner) sb.Append(',');
                inner = false;
                WriteString(sb, kv.Key);
                sb.Append(':');
                WriteValue(sb, kv.Value);
            }
            sb.Append('}');
        }

        /// <summary>
        /// Appends one attribute value.
        /// </summary>
        /// <remarks>
        /// Everything reaching here has already been through
        /// <see cref="Wire.ClampAttributes"/>, so the shapes are known and the depth is
        /// bounded. Anything this method does not recognise is written as null rather
        /// than skipped: a key that is present with no value is honest, and dropping it
        /// here would leave a dangling comma to reason about.
        /// <para>
        /// Numbers use the invariant culture. A German locale turning 1.5 into "1,5"
        /// would be invalid JSON, and it is the kind of bug that only shows up in one
        /// country's data.
        /// </para>
        /// </remarks>
        internal static void WriteValue(StringBuilder sb, object? value)
        {
            switch (value)
            {
                case null:
                    sb.Append("null");
                    return;
                case string s:
                    WriteString(sb, s);
                    return;
                case bool b:
                    sb.Append(b ? "true" : "false");
                    return;
                case double d:
                    // Non-finite numbers never survive ClampAttributes, so this is
                    // belt and braces rather than the defence itself.
                    sb.Append(double.IsNaN(d) || double.IsInfinity(d)
                        ? "null"
                        : d.ToString("R", CultureInfo.InvariantCulture));
                    return;
                case float f:
                    sb.Append(float.IsNaN(f) || float.IsInfinity(f)
                        ? "null"
                        : f.ToString("R", CultureInfo.InvariantCulture));
                    return;
                case decimal m:
                    sb.Append(m.ToString(CultureInfo.InvariantCulture));
                    return;
                case sbyte or byte or short or ushort or int or uint or long:
                    sb.Append(System.Convert.ToInt64(value, CultureInfo.InvariantCulture)
                        .ToString(CultureInfo.InvariantCulture));
                    return;
                case ulong u:
                    sb.Append(u.ToString(CultureInfo.InvariantCulture));
                    return;
                case IReadOnlyDictionary<string, object?> map:
                    WriteMap(sb, map);
                    return;
                case System.Collections.IEnumerable list:
                    sb.Append('[');
                    bool firstItem = true;
                    foreach (object? item in list)
                    {
                        if (!firstItem) sb.Append(',');
                        firstItem = false;
                        WriteValue(sb, item);
                    }
                    sb.Append(']');
                    return;
                default:
                    sb.Append("null");
                    return;
            }
        }
    }
}
