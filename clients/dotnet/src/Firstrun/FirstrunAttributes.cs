using System.Collections.Generic;

namespace Firstrun
{
    /// <summary>
    /// An attribute bag that builds fluently and is already the right shape for the wire.
    /// </summary>
    /// <remarks>
    /// Attributes are everything about a log entry that is not one of the five promoted
    /// columns. The backend does not know what any key means, which is the point: a
    /// closed set of columns is a closed set of questions, and the one thing we cannot
    /// know in advance is which question you need answered.
    /// <para>
    /// Unlike the string-only property bag this replaced, values keep their type: a
    /// duration is a number and stays one, so a query can average it without casting
    /// every row out of text. The <see cref="FirstrunAttr"/> constants are the
    /// conventional spellings, so two projects that mean the same thing agree.
    /// </para>
    /// </remarks>
    public sealed class FirstrunAttributes : Dictionary<string, object?>
    {
        public FirstrunAttributes() { }

        public FirstrunAttributes(int capacity) : base(capacity) { }

        public static FirstrunAttributes New()
        {
            return new FirstrunAttributes();
        }

        /// <summary>Sets a value, or removes the key when the value is null.</summary>
        public FirstrunAttributes Set(string key, string? value)
        {
            if (value == null) Remove(key);
            else this[key] = value;
            return this;
        }

        public FirstrunAttributes Set(string key, long value)
        {
            this[key] = value;
            return this;
        }

        public FirstrunAttributes Set(string key, double value)
        {
            this[key] = value;
            return this;
        }

        public FirstrunAttributes Set(string key, bool value)
        {
            this[key] = value;
            return this;
        }

        /// <summary>Sets a nested object or array. Bounded on the way to the wire.</summary>
        public FirstrunAttributes Set(string key, object? value)
        {
            if (value == null) Remove(key);
            else this[key] = value;
            return this;
        }
    }
}
