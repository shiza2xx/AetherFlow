using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using System.Runtime.InteropServices;

internal static class Program
{
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("AFSETUP1");
    private const int FooterBytes = 144;
    private const long FreeSpaceReserve = 64L * 1024L * 1024L;
    private const int StdOutputHandle = -11;
    private const int StdErrorHandle = -12;
    private const int MoveFileDelayUntilReboot = 4;
    private const string AppGuid = "fadcbce3-4900-5ea1-939d-c6fb355a92fb";

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteFile(IntPtr handle, byte[] bytes, int count, out int written, IntPtr overlapped);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(string existingFile, string newFile, int flags);

    [DllImport("kernel32.dll", EntryPoint = "LCMapStringW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int LCMapStringW(uint locale, uint flags, string source, int sourceLength, StringBuilder destination, int destinationLength);

    [STAThread]
    private static int Main(string[] args)
    {
        string executablePath = Process.GetCurrentProcess().MainModule.FileName;
        bool diagnoseUninstallerArguments = args.Length > 0 && String.Equals(args[0], "--diagnose-uninstaller-args", StringComparison.OrdinalIgnoreCase);
        if (diagnoseUninstallerArguments)
        {
            string[] diagnosticArgs = new string[args.Length - 1];
            Array.Copy(args, 1, diagnosticArgs, 0, diagnosticArgs.Length);
            WriteDiagnostic(StdOutputHandle, JoinUninstallerArguments(diagnosticArgs));
            return 0;
        }
        if (args.Length > 0 && String.Equals(args[0], "--diagnose-uninstaller-cleanup", StringComparison.OrdinalIgnoreCase))
        {
            if (args.Length != 5) { WriteDiagnostic(StdErrorHandle, "Usage: --diagnose-uninstaller-cleanup <bootstrap> <installRoot> <tempRoot> <token>"); return 2; }
            try
            {
                UninstallerCleanupPlan plan = CreateUninstallerCleanupPlan(args[1], args[2], args[3], args[4]);
                WriteDiagnostic(StdOutputHandle, "source=" + plan.Source + "\r\nstaged=" + plan.Staged + "\r\ndeferred=" + plan.Deferred);
                return 0;
            }
            catch (Exception error) { WriteDiagnostic(StdErrorHandle, error.Message); return 2; }
        }
        if (args.Length > 0 && String.Equals(args[0], "--diagnose-uninstaller-lifecycle", StringComparison.OrdinalIgnoreCase))
        {
            if (args.Length < 4) { WriteDiagnostic(StdErrorHandle, "Usage: --diagnose-uninstaller-lifecycle <bootstrap> <installRoot> <tempRoot> [arguments ...]"); return 2; }
            try
            {
                UninstallerLaunchPlan plan = PrepareUninstallerLaunch(args[1], args[2], args[3], Slice(args, 4));
                WriteDiagnostic(StdOutputHandle, "source=" + plan.Source + "\r\nsession=" + plan.Session + "\r\nstaged=" + plan.Staged + "\r\narguments=" + plan.Arguments + "\r\npayloadSha256=" + plan.PayloadSha256);
                RemoveOwnedSession(plan.Session, args[3]);
                return 0;
            }
            catch (Exception error) { WriteDiagnostic(StdErrorHandle, error.Message); return 2; }
        }
        if (args.Length > 0 && String.Equals(args[0], "--diagnose-uninstaller-execute", StringComparison.OrdinalIgnoreCase))
        {
            if (args.Length < 4) { WriteDiagnostic(StdErrorHandle, "Usage: --diagnose-uninstaller-execute <bootstrap> <installRoot> <tempRoot> [arguments ...]"); return 2; }
            try
            {
                UninstallerLaunchPlan plan = PrepareUninstallerLaunch(args[1], args[2], args[3], Slice(args, 4));
                int exitCode = RunStagedUninstaller(plan, args[3]);
                WriteDiagnostic(StdOutputHandle, "staged=" + plan.Staged + "\r\nsession=" + plan.Session + "\r\narguments=" + plan.Arguments + "\r\nchildExitCode=" + exitCode);
                return exitCode;
            }
            catch (Exception error) { WriteDiagnostic(StdErrorHandle, error.Message); return 2; }
        }
        bool setupDiagnostic = Array.Exists(args, delegate(string value) { return value != null && (value.StartsWith("--verify-only", StringComparison.OrdinalIgnoreCase) || value.StartsWith("--extract-only", StringComparison.OrdinalIgnoreCase) || value.StartsWith("--diagnose-join", StringComparison.OrdinalIgnoreCase)); });
        bool isUninstallerBootstrap = String.Equals(Path.GetFileNameWithoutExtension(executablePath), "Uninstall AetherFlow", StringComparison.OrdinalIgnoreCase) || !setupDiagnostic && Array.Exists(args, delegate(string value) { return value != null && value.StartsWith("_?=", StringComparison.OrdinalIgnoreCase); });
        if (isUninstallerBootstrap)
        {
            try { return RunUninstallerBootstrap(executablePath, args); }
            catch (Exception error)
            {
                MessageBox.Show("The AetherFlow uninstaller could not continue.\r\n\r\n" + error.Message, "AetherFlow Uninstall", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }
        }
        bool diagnostic = setupDiagnostic;
        try
        {
            Footer footer = ReadFooter();
            int verifyCount = 0;
            foreach (string argument in args) if (argument.StartsWith("--verify-only", StringComparison.OrdinalIgnoreCase))
            {
                verifyCount++;
                if (!String.Equals(argument, "--verify-only", StringComparison.OrdinalIgnoreCase) || args.Length != 1) throw new ArgumentException("Use --verify-only by itself.");
            }
            if (verifyCount > 1) throw new ArgumentException("Specify --verify-only only once.");
            if (Array.Exists(args, delegate(string value) { return String.Equals(value, "--verify-only", StringComparison.OrdinalIgnoreCase); }))
            {
                VerifyPayload(footer);
                Console.WriteLine("verified-payload-bytes=" + footer.Length.ToString(CultureInfo.InvariantCulture) + " sha512=" + footer.Hash);
                return 0;
            }
            string extractionOnly = null;
            int extractCount = 0;
            foreach (string argument in args) if (argument.StartsWith("--extract-only", StringComparison.OrdinalIgnoreCase))
            {
                extractCount++;
                if (!argument.StartsWith("--extract-only=", StringComparison.OrdinalIgnoreCase) || argument.Length == "--extract-only=".Length) throw new ArgumentException("Diagnostic extraction requires --extract-only=<absolute file path>.");
                extractionOnly = argument.Substring("--extract-only=".Length);
            }
            if (extractCount > 1) throw new ArgumentException("Specify diagnostic extraction only once.");
            if (extractionOnly != null)
            {
                if (!Path.IsPathRooted(extractionOnly) || String.Equals(Path.GetFullPath(extractionOnly), Path.GetPathRoot(Path.GetFullPath(extractionOnly)), StringComparison.OrdinalIgnoreCase)) throw new IOException("Diagnostic extraction needs an absolute file path below a normal local folder.");
                string parent = Path.GetDirectoryName(Path.GetFullPath(extractionOnly));
                VerifyRegularPath(parent);
                ExtractAndVerify(footer, extractionOnly);
                Console.WriteLine("extracted-and-verified=true bytes=" + footer.Length.ToString(CultureInfo.InvariantCulture) + " sha512=" + footer.Hash);
                return 0;
            }
            if (Array.Exists(args, delegate(string value) { return value.StartsWith("--diagnose-join", StringComparison.OrdinalIgnoreCase); }))
            {
                WriteDiagnostic(StdOutputHandle, JoinArguments(args));
                return 0;
            }
            string root = ChooseSessionRoot(footer.Length);
            string session = Path.Combine(root, "session-" + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(session);
            VerifyRegularPath(session);
            string payload = Path.Combine(session, "AetherFlow-NSIS.exe");
            try
            {
                ExtractAndVerify(footer, payload);
                ProcessStartInfo start = new ProcessStartInfo();
                start.FileName = payload;
                start.WorkingDirectory = session;
                start.UseShellExecute = false;
                start.CreateNoWindow = false;
                start.EnvironmentVariables["TEMP"] = session;
                start.EnvironmentVariables["TMP"] = session;
                start.EnvironmentVariables["TMPDIR"] = session;
                start.Arguments = JoinArguments(args);
                using (Process child = Process.Start(start))
                {
                    if (child == null) throw new InvalidOperationException("Windows did not start the AetherFlow setup payload.");
                    child.WaitForExit();
                    return child.ExitCode;
                }
            }
            finally
            {
                SafeDeleteOwnedFile(payload, session);
                try { Directory.Delete(session, false); } catch { }
            }
        }
        catch (Exception error)
        {
            if (diagnostic)
            {
                WriteDiagnostic(StdErrorHandle, error.Message);
                return 2;
            }
            MessageBox.Show("AetherFlow setup could not continue.\r\n\r\n" + error.Message, "AetherFlow Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }
    }

    private static int RunUninstallerBootstrap(string bootstrapPath, string[] args)
    {
        string installRoot = ReconstructUninstallerInstallRoot(args);
        bool updated = false;
        foreach (string argument in args)
        {
            if (argument != null && String.Equals(argument, "--updated", StringComparison.OrdinalIgnoreCase)) updated = true;
        }
        if (String.IsNullOrWhiteSpace(installRoot)) installRoot = Path.GetDirectoryName(Path.GetFullPath(bootstrapPath));
        string tempRoot = Path.Combine(installRoot, "data", "temp");
        UninstallerLaunchPlan launchPlan = PrepareUninstallerLaunch(bootstrapPath, installRoot, tempRoot, args);
        int exitCode = RunStagedUninstaller(launchPlan, tempRoot);

        if (exitCode != 0) return exitCode;
        string payload = Path.Combine(installRoot, "AetherFlow-Uninstall-Payload.exe");
        if (File.Exists(payload)) { RequireRegularFile(payload); File.Delete(payload); }
        string canonicalInstall = Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string canonicalBootstrap = Path.GetFullPath(bootstrapPath);
        bool bootstrapInsideInstall = String.Equals(Path.GetDirectoryName(canonicalBootstrap).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), canonicalInstall, StringComparison.OrdinalIgnoreCase);
        if (bootstrapInsideInstall && !updated && File.Exists(canonicalBootstrap))
        {
            UninstallerCleanupPlan plan = CreateUninstallerCleanupPlan(canonicalBootstrap, canonicalInstall, tempRoot, Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(plan.Directory);
            VerifyRegularPath(plan.Directory);
            RequireRegularFile(plan.Source);
            try { File.Move(plan.Source, plan.Staged); }
            catch (IOException) { return 0; } // Leave the reusable canonical path intact; never queue its deletion.
            catch (UnauthorizedAccessException) { return 0; }
            if (!MoveFileEx(plan.Staged, null, MoveFileDelayUntilReboot))
                return 0; // The canonical path is already vacant; a unique staged orphan is safer than a risky retry.
            try { Directory.Delete(plan.Directory, false); } catch { }
        }
        return 0;
    }

    private static int RunStagedUninstaller(UninstallerLaunchPlan launchPlan, string tempRoot)
    {
        try
        {
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = launchPlan.Staged;
            start.WorkingDirectory = launchPlan.Session;
            start.UseShellExecute = false;
            start.CreateNoWindow = false;
            start.EnvironmentVariables["TEMP"] = launchPlan.Session;
            start.EnvironmentVariables["TMP"] = launchPlan.Session;
            start.EnvironmentVariables["TMPDIR"] = launchPlan.Session;
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            start.Arguments = launchPlan.Arguments;
            using (Process child = Process.Start(start))
            {
                if (child == null) throw new InvalidOperationException("Windows did not start the local AetherFlow uninstall payload.");
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        finally { RemoveOwnedSession(launchPlan.Session, tempRoot); }
    }

    private sealed class UninstallerLaunchPlan
    {
        public string Source;
        public string Session;
        public string Staged;
        public string Arguments;
        public string PayloadSha256;
    }

    private static UninstallerLaunchPlan PrepareUninstallerLaunch(string bootstrapPath, string installRoot, string tempRoot, string[] args)
    {
        string root = Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        VerifyRegularPath(root);
        string canonicalBootstrap = Path.GetFullPath(bootstrapPath);
        if (!String.Equals(Path.GetDirectoryName(canonicalBootstrap).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), root, StringComparison.OrdinalIgnoreCase) || !String.Equals(Path.GetFileName(canonicalBootstrap), "Uninstall AetherFlow.exe", StringComparison.OrdinalIgnoreCase))
            throw new IOException("The AetherFlow uninstaller bootstrap is outside its verified install folder.");
        RequireRegularFile(canonicalBootstrap);
        ValidateInstallIdentity(root);
        string source = Path.Combine(root, "AetherFlow-Uninstall-Payload.exe");
        RequireRegularFile(source);
        string temporaryRoot = Path.GetFullPath(tempRoot);
        EnsureContainedPath(root, temporaryRoot);
        Directory.CreateDirectory(temporaryRoot);
        VerifyRegularPath(temporaryRoot);
        string session = Path.Combine(temporaryRoot, "uninstall-" + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(session);
        VerifyRegularPath(session);
        string staged = Path.Combine(session, "AetherFlow-Uninstall-Payload.exe");
        try
        {
            File.Copy(source, staged, false);
            RequireRegularFile(staged);
            string arguments = JoinUninstallerArguments(args, root);
            return new UninstallerLaunchPlan { Source = source, Session = session, Staged = staged, Arguments = arguments, PayloadSha256 = HashFile(staged) };
        }
        catch
        {
            RemoveOwnedSession(session, temporaryRoot);
            throw;
        }
    }

    private static void ValidateInstallIdentity(string root)
    {
        VerifyRegularPath(Path.Combine(root, "data"));
        string marker = Path.Combine(root, "data", "aetherflow-install.identity");
        RequireRegularFile(marker);
        string value;
        using (FileStream stream = new FileStream(marker, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (StreamReader reader = new StreamReader(stream, new UTF8Encoding(false, true), true))
            value = reader.ReadToEnd().TrimEnd('\r', '\n');
        string[] parts = value.Split('|');
        if (parts.Length != 3 || !String.Equals(parts[1], AppGuid, StringComparison.OrdinalIgnoreCase))
            throw new IOException("The AetherFlow install identity marker is invalid; no uninstall payload was started.");
        string canonicalRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (String.Equals(parts[0], "AETHERFLOW_INSTALL_V1", StringComparison.Ordinal))
        {
            if (!String.Equals(parts[2], canonicalRoot, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The AetherFlow install identity marker belongs to another folder.");
            return;
        }
        if (!String.Equals(parts[0], "AETHERFLOW_INSTALL_V2", StringComparison.Ordinal) || !IsHex(parts[2], 64))
            throw new IOException("The AetherFlow install identity marker is invalid; no uninstall payload was started.");
        string expected = HashText(InvariantLowercase(canonicalRoot));
        if (!String.Equals(parts[2], expected, StringComparison.OrdinalIgnoreCase))
            throw new IOException("The AetherFlow install identity marker belongs to another folder.");
    }

    private static string HashText(string value)
    {
        using (SHA256 hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", String.Empty);
    }

    private static string InvariantLowercase(string value)
    {
        StringBuilder mapped = new StringBuilder(value.Length + 1);
        int written = LCMapStringW(0x007F, 0x00000100, value, -1, mapped, mapped.Capacity);
        if (written != value.Length + 1) throw new IOException("The AetherFlow install path could not be normalized using the installer identity protocol.");
        return mapped.ToString(0, written - 1);
    }

    private static string HashFile(string file)
    {
        using (FileStream stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (SHA256 hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", String.Empty);
    }

    private static void EnsureContainedPath(string root, string child)
    {
        string prefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!Path.GetFullPath(child).StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new IOException("The local AetherFlow uninstall session is outside the verified install data folder.");
    }

    private static string[] Slice(string[] values, int start)
    {
        string[] result = new string[Math.Max(0, values.Length - start)];
        Array.Copy(values, start, result, 0, result.Length);
        return result;
    }

    private sealed class UninstallerCleanupPlan
    {
        public string Source;
        public string Directory;
        public string Staged;
        public string Deferred;
    }

    private static UninstallerCleanupPlan CreateUninstallerCleanupPlan(string bootstrapPath, string installRoot, string tempRoot, string token)
    {
        if (String.IsNullOrWhiteSpace(token) || token.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new ArgumentException("The cleanup diagnostic token is invalid.");
        string source = Path.GetFullPath(bootstrapPath);
        string root = Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (!String.Equals(Path.GetDirectoryName(source).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), root, StringComparison.OrdinalIgnoreCase))
            throw new IOException("The uninstaller bootstrap is not the canonical file directly inside its installation root.");
        string temporaryRoot = Path.GetFullPath(tempRoot);
        string directory = Path.Combine(temporaryRoot, "uninstall-bootstrap-removal-" + token);
        string staged = Path.Combine(directory, "Uninstall-AetherFlow-" + token + ".exe");
        return new UninstallerCleanupPlan { Source = source, Directory = directory, Staged = staged, Deferred = staged };
    }

    private static void RequireRegularFile(string file)
    {
        FileAttributes attributes = File.GetAttributes(file);
        if ((attributes & FileAttributes.Directory) != 0 || (attributes & FileAttributes.ReparsePoint) != 0 || !String.Equals(Path.GetFullPath(file), file, StringComparison.OrdinalIgnoreCase))
            throw new IOException("An AetherFlow uninstaller file is missing or unsafe: " + file);
    }

    private static string JoinUninstallerArguments(string[] args, string fallbackInstallRoot = null)
    {
        StringBuilder result = new StringBuilder();
        int overrideIndex = FindUninstallerInstallRootIndex(args);
        for (int i = 0; i < (overrideIndex < 0 ? args.Length : overrideIndex); i++)
        {
            string argument = args[i];
            if (result.Length != 0) result.Append(' ');
            result.Append(IsUnquotedNsiControl(argument) ? argument : QuoteArgument(argument));
        }
        string installOverride = ReconstructUninstallerInstallRoot(args);
        if (String.IsNullOrWhiteSpace(installOverride)) installOverride = fallbackInstallRoot;
        if (String.IsNullOrWhiteSpace(installOverride)) throw new IOException("The original AetherFlow install folder could not be reconstructed.");
        if (result.Length != 0)
        {
            result.Append(' ');
        }
        result.Append("_?=").Append(Path.GetFullPath(installOverride));
        return result.ToString();
    }

    private static int FindUninstallerInstallRootIndex(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
            if (args[i] != null && args[i].StartsWith("_?=", StringComparison.OrdinalIgnoreCase)) return i;
        return -1;
    }

    private static string ReconstructUninstallerInstallRoot(string[] args)
    {
        int index = FindUninstallerInstallRootIndex(args);
        if (index < 0) return null;
        StringBuilder path = new StringBuilder(args[index].Substring(3));
        for (int i = index + 1; i < args.Length; i++)
        {
            if (path.Length != 0) path.Append(' ');
            path.Append(args[i]);
        }
        string value = path.ToString();
        if (String.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value)) throw new IOException("The NSIS uninstaller install path is missing or not absolute.");
        return Path.GetFullPath(value);
    }

    private static bool IsUnquotedNsiControl(string argument)
    {
        return !String.IsNullOrEmpty(argument) && argument[0] == '/' && argument.IndexOfAny(new char[] { ' ', '\t', '\r', '\n', '"' }) < 0;
    }

    private static void RemoveOwnedSession(string session, string tempRoot)
    {
        string root = Path.GetFullPath(tempRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(session);
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new IOException("The local uninstaller session changed path; leaving it for inspection.");
        RemoveOwnedSessionContents(full);
        Directory.Delete(full, false);
    }

    private static void RemoveOwnedSessionContents(string directory)
    {
        foreach (string child in Directory.GetFileSystemEntries(directory))
        {
            FileAttributes attributes = File.GetAttributes(child);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("A reparse point appeared in the owned uninstaller session; leaving it for inspection.");
            if ((attributes & FileAttributes.Directory) != 0)
            {
                RemoveOwnedSessionContents(child);
                Directory.Delete(child, false);
            }
            else File.Delete(child);
        }
    }

    private static void WriteDiagnostic(int standardHandle, string value)
    {
        byte[] bytes = new UTF8Encoding(false).GetBytes(value + "\r\n");
        IntPtr handle = GetStdHandle(standardHandle);
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return;
        int offset = 0;
        while (offset < bytes.Length)
        {
            int written;
            if (!WriteFile(handle, bytes, bytes.Length - offset, out written, IntPtr.Zero) || written <= 0) return;
            offset += written;
            if (offset < bytes.Length) Array.Copy(bytes, offset, bytes, 0, bytes.Length - offset);
        }
    }

    private sealed class Footer
    {
        public long Length;
        public string Hash;
        public long PayloadOffset;
    }

    private static Footer ReadFooter()
    {
        string path = Process.GetCurrentProcess().MainModule.FileName;
        using (FileStream input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (input.Length < FooterBytes + 1024) throw new InvalidDataException("The setup payload footer is missing.");
            input.Position = input.Length - FooterBytes;
            byte[] footer = new byte[FooterBytes];
            ReadExactly(input, footer, 0, footer.Length);
            for (int i = 0; i < Magic.Length; i++) if (footer[i] != Magic[i]) throw new InvalidDataException("The setup payload footer is invalid.");
            long length = BitConverter.ToInt64(footer, 8);
            string hash = Encoding.ASCII.GetString(footer, 16, 128);
            if (length <= 0 || length > input.Length - FooterBytes - 1024 || !IsHex(hash, 128)) throw new InvalidDataException("The setup payload length or SHA-512 footer is invalid.");
            return new Footer { Length = length, Hash = hash.ToUpperInvariant(), PayloadOffset = input.Length - FooterBytes - length };
        }
    }

    private static void ExtractAndVerify(Footer footer, string destination)
    {
        string source = Process.GetCurrentProcess().MainModule.FileName;
        byte[] buffer = new byte[1024 * 1024];
        using (FileStream input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (FileStream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        using (SHA512 hash = SHA512.Create())
        {
            input.Position = footer.PayloadOffset;
            long remaining = footer.Length;
            while (remaining > 0)
            {
                int count = input.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                if (count <= 0) throw new EndOfStreamException("The setup payload ended before its signed footer length.");
                hash.TransformBlock(buffer, 0, count, buffer, 0);
                output.Write(buffer, 0, count);
                remaining -= count;
            }
            hash.TransformFinalBlock(new byte[0], 0, 0);
            output.Flush(true);
            string actual = BitConverter.ToString(hash.Hash).Replace("-", String.Empty);
            if (!String.Equals(actual, footer.Hash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The extracted setup payload failed its SHA-512 check.");
        }
    }

    private static void VerifyPayload(Footer footer)
    {
        string source = Process.GetCurrentProcess().MainModule.FileName;
        byte[] buffer = new byte[1024 * 1024];
        using (FileStream input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (SHA512 hash = SHA512.Create())
        {
            input.Position = footer.PayloadOffset;
            long remaining = footer.Length;
            while (remaining > 0)
            {
                int count = input.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                if (count <= 0) throw new EndOfStreamException("The setup payload ended before its signed footer length.");
                hash.TransformBlock(buffer, 0, count, buffer, 0);
                remaining -= count;
            }
            hash.TransformFinalBlock(new byte[0], 0, 0);
            string actual = BitConverter.ToString(hash.Hash).Replace("-", String.Empty);
            if (!String.Equals(actual, footer.Hash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The setup payload failed its SHA-512 check.");
        }
    }

    private static string ChooseSessionRoot(long payloadBytes)
    {
        string explicitRoot = Environment.GetEnvironmentVariable("AETHERFLOW_SETUP_TEMP_ROOT");
        string adjacent = Path.Combine(Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName), ".aetherflow-setup-sessions");
        if (!String.IsNullOrEmpty(explicitRoot)) return PrepareRoot(explicitRoot, payloadBytes);
        try { return PrepareRoot(adjacent, payloadBytes); } catch { }
        using (FolderBrowserDialog dialog = new FolderBrowserDialog())
        {
            dialog.Description = "Choose a normal writable folder for the temporary AetherFlow setup session. The installed program and its data will remain in the installation folder you choose on the next page.";
            dialog.ShowNewFolderButton = true;
            if (dialog.ShowDialog() != DialogResult.OK || String.IsNullOrEmpty(dialog.SelectedPath)) throw new IOException("No writable setup session folder was selected.");
            return PrepareRoot(dialog.SelectedPath, payloadBytes);
        }
    }

    private static string PrepareRoot(string value, long payloadBytes)
    {
        if (String.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value)) throw new IOException("The setup session root must be an absolute local folder.");
        string full = Path.GetFullPath(value);
        if (String.Equals(full, Path.GetPathRoot(full), StringComparison.OrdinalIgnoreCase)) throw new IOException("Choose a folder below the volume root for temporary setup files.");
        Directory.CreateDirectory(full);
        VerifyRegularPath(full);
        DriveInfo drive = new DriveInfo(Path.GetPathRoot(full));
        if (!drive.IsReady || drive.AvailableFreeSpace < payloadBytes + FreeSpaceReserve) throw new IOException("The chosen volume does not have enough free space for this setup session.");
        string probe = Path.Combine(full, ".aetherflow-write-check-" + Guid.NewGuid().ToString("N"));
        using (new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { }
        File.Delete(probe);
        return full;
    }

    private static void VerifyRegularPath(string path)
    {
        string full = Path.GetFullPath(path);
        DirectoryInfo cursor = new DirectoryInfo(full);
        while (cursor != null)
        {
            if ((cursor.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Setup temporary paths cannot use junctions or symbolic links.");
            cursor = cursor.Parent;
        }
        if (!Directory.Exists(full)) throw new IOException("The setup temporary folder is not a directory.");
    }

    private static void SafeDeleteOwnedFile(string file, string session)
    {
        try
        {
            string full = Path.GetFullPath(file), parent = Path.GetFullPath(session) + Path.DirectorySeparatorChar;
            if (full.StartsWith(parent, StringComparison.OrdinalIgnoreCase) && String.Equals(Path.GetDirectoryName(full), Path.GetFullPath(session), StringComparison.OrdinalIgnoreCase) && File.Exists(full)) File.Delete(full);
        }
        catch { }
    }

    private static string JoinArguments(string[] args)
    {
        StringBuilder result = new StringBuilder();
        string installDirectory = null;
        foreach (string argument in args) if (argument.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) installDirectory = argument.Substring(3);
        foreach (string argument in args)
        {
            if (argument.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) continue;
            if (result.Length != 0) result.Append(' ');
            result.Append(IsUnquotedNsiControl(argument) ? argument : QuoteArgument(argument));
        }
        if (installDirectory != null)
        {
            if (result.Length != 0) result.Append(' ');
            // NSIS requires /D= as the final, unquoted command-line token. It consumes
            // the rest of the command line as the path, including spaces and Unicode.
            result.Append("/D=").Append(installDirectory);
        }
        return result.ToString();
    }

    private static string QuoteArgument(string argument)
    {
        if (argument == null) return "\"\"";
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in argument)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes); slashes = 0; result.Append(character);
        }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }

    private static bool IsHex(string text, int length)
    {
        if (text == null || text.Length != length) return false;
        foreach (char value in text) if (!Uri.IsHexDigit(value)) return false;
        return true;
    }

    private static void ReadExactly(Stream stream, byte[] buffer, int offset, int count)
    {
        while (count > 0)
        {
            int read = stream.Read(buffer, offset, count);
            if (read <= 0) throw new EndOfStreamException("The setup footer was truncated.");
            offset += read; count -= read;
        }
    }
}
