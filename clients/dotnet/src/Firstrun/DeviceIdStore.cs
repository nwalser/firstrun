using System;
using System.IO;
using System.Text;

namespace Firstrun
{
    /// <summary>
    /// The anonymous per-install id, and where it lives.
    /// </summary>
    /// <remarks>
    /// One id per (user account, machine, app). It is generated here, it is never
    /// received from the server, and it is never joined to another source's id: a
    /// browser visitor and this install are two different anonymous people, always.
    ///
    /// Whether this is a first run is decided by whether the file existed, not by a
    /// flag written afterwards, so a crash between the two cannot make a second run
    /// look like a first one.
    /// </remarks>
    public static class DeviceIdStore
    {
        /// <summary>The file name inside the per-app folder.</summary>
        public const string FileName = "device_id";

        /// <summary>
        /// The exact file the id is read from and written to.
        ///
        /// <list type="bullet">
        /// <item>Windows: <c>%LOCALAPPDATA%\firstrun\{app}\device_id</c>
        /// (local, NOT roaming, e.g.
        /// <c>C:\Users\you\AppData\Local\firstrun\my-app\device_id</c>)</item>
        /// <item>macOS: <c>~/Library/Application Support/firstrun/{app}/device_id</c></item>
        /// <item>Linux and other Unix: <c>$XDG_DATA_HOME/firstrun/{app}/device_id</c>,
        /// or <c>~/.local/share/firstrun/{app}/device_id</c> when XDG_DATA_HOME is unset</item>
        /// </list>
        ///
        /// <c>{app}</c> is <see cref="FirstrunOptions.AppName"/> slugged, or the source
        /// key when AppName is unset.
        /// </summary>
        public static string ResolvePath(string appFolder)
        {
            return Path.Combine(RootDirectory(), "firstrun", Slug(appFolder), FileName);
        }

        internal static string RootDirectory()
        {
            string os = Wire.OsName();
            if (os == "windows")
            {
                // LOCALAPPDATA, deliberately, and not APPDATA.
                //
                // A roaming profile syncs the roaming AppData folder between machines, so one
                // person signing in to three of them would share a single device_id and read
                // as one installation instead of three. device_id identifies an INSTALLATION,
                // and the Local folder is what means "this machine" on Windows. Tying somebody
                // across machines is what User() is for.
                string? local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
                if (!string.IsNullOrEmpty(local)) return local!;
                return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            }

            string home = Environment.GetEnvironmentVariable("HOME")
                          ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

            if (os == "macos" || os == "ios") return Path.Combine(home, "Library", "Application Support");

            string? xdg = Environment.GetEnvironmentVariable("XDG_DATA_HOME");
            if (!string.IsNullOrEmpty(xdg)) return xdg!;
            return Path.Combine(home, ".local", "share");
        }

        /// <summary>A folder name that is safe on every filesystem we target.</summary>
        internal static string Slug(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "default";
            var sb = new StringBuilder(raw.Length);
            foreach (char c in raw)
            {
                if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_')
                    sb.Append(c);
                else if (c >= 'A' && c <= 'Z')
                    sb.Append((char)(c + 32));
                else
                    sb.Append('-');
            }
            string slug = sb.ToString().Trim('-', '.');
            return slug.Length == 0 ? "default" : (slug.Length > 64 ? slug.Substring(0, 64) : slug);
        }

        /// <summary>
        /// Reads the id, creating it on first run. Never throws: a read-only or full
        /// disk gets a per-process id and a diagnostic, not an exception in the host's
        /// constructor.
        /// </summary>
        public static (string Id, bool FirstRun) LoadOrCreate(string appFolder, Action<Exception>? onError)
        {
            string path;
            try
            {
                path = ResolvePath(appFolder);
            }
            catch (Exception ex)
            {
                onError?.Invoke(ex);
                return (Guid.NewGuid().ToString("D"), true);
            }

            try
            {
                if (File.Exists(path))
                {
                    string existing = File.ReadAllText(path).Trim();
                    if (existing.Length > 0 && existing.Length <= Wire.IdMaxLength) return (existing, false);
                }
            }
            catch (Exception ex)
            {
                onError?.Invoke(ex);
            }

            string id = Guid.NewGuid().ToString("D");
            try
            {
                string? dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir!);

                // Write then move, so a crash leaves either no file or a complete one.
                // A half-written id read on the next launch would be a second install.
                string tmp = path + ".tmp";
                File.WriteAllText(tmp, id);
                if (File.Exists(path)) File.Delete(path);
                File.Move(tmp, path);
            }
            catch (Exception ex)
            {
                onError?.Invoke(ex);
                // The id still works for this process. Losing it on exit is a worse
                // number, not a broken app.
            }

            return (id, true);
        }
    }
}
