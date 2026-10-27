# HARMONY desktop helper (Windows PowerShell 5.1). A fixed script: it accepts only the commands below, as JSON lines on
# stdin, with every value checked here. Model text is never run as code.
#   look      -> active window (skipping HARMONY's own), its title and app, and the text on it via Windows' built-in OCR.
#                The screenshot exists only in memory and is discarded before the reply is sent.
#   apps      -> Start menu apps (Get-StartApps).          launch -> start one of those apps by its exact AppID.
#   windows   -> visible app windows.                       focus  -> bring one forward.   close -> ask windows to close.
#   key       -> media and volume keys.                     url    -> open an http(s) address in the default browser.
#   foreground -> where the window you're using is (position and size only), for floating HARMONY.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
public static class HarmonyDesktop {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);

  public static void Init() { try { SetProcessDPIAware(); } catch { } }
  public static long Foreground() { return GetForegroundWindow().ToInt64(); }
  public static string Title(long h) { var p = new IntPtr(h); int n = GetWindowTextLength(p); if (n <= 0) return ""; var s = new StringBuilder(Math.Min(n, 1000) + 1); GetWindowText(p, s, s.Capacity); return s.ToString(); }
  public static int Pid(long h) { uint pid; GetWindowThreadProcessId(new IntPtr(h), out pid); return (int)pid; }
  public static int[] Bounds(long h) {
    var p = new IntPtr(h); RECT r;
    if (DwmGetWindowAttribute(p, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(p, out r);
    return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
  }
  /** A real, visible app window: top level, shown, not minimized, not cloaked (hidden UWP), not a tool window, titled. */
  public static bool IsAppWindow(long h) {
    var p = new IntPtr(h);
    if (!IsWindow(p) || !IsWindowVisible(p) || IsIconic(p)) return false;
    if (GetAncestor(p, 3) != p) return false;
    int cloaked; if (DwmGetWindowAttribute(p, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
    if ((GetWindowLong(p, -20) & 0x80) != 0) return false;
    if (GetWindowTextLength(p) == 0) return false;
    var b = Bounds(h); return b[2] >= 120 && b[3] >= 80;
  }
  /** The window the person is looking at: the foreground one, or the next one down if that belongs to HARMONY. */
  public static long Target(int excludePid) {
    long h = Foreground();
    if (h != 0 && IsAppWindow(h) && Pid(h) != excludePid) return h;
    var p = h != 0 ? new IntPtr(h) : GetWindow(GetForegroundWindow(), 0);
    for (int i = 0; i < 500 && p != IntPtr.Zero; i++) {
      p = GetWindow(p, 2);
      if (p != IntPtr.Zero && IsAppWindow(p.ToInt64()) && Pid(p.ToInt64()) != excludePid) return p.ToInt64();
    }
    return 0;
  }
  public static List<long> Windows(int excludePid) {
    var list = new List<long>();
    EnumWindows((p, l) => { long h = p.ToInt64(); if (list.Count < 200 && IsAppWindow(h) && Pid(h) != excludePid) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  static bool Blank(Bitmap b) {
    int dark = 0, n = 0;
    for (int y = 0; y < b.Height; y += Math.Max(1, b.Height / 16)) for (int x = 0; x < b.Width; x += Math.Max(1, b.Width / 16)) { var c = b.GetPixel(x, y); n++; if (c.R + c.G + c.B < 12) dark++; }
    return n > 0 && dark == n;
  }
  /** The window's own pixels (even if HARMONY is on top of it); if the app doesn't draw that way, what is on screen. */
  public static Bitmap Capture(long h) {
    var b = Bounds(h); int w = Math.Max(1, Math.Min(b[2], 7680)), ht = Math.Max(1, Math.Min(b[3], 4320));
    var bmp = new Bitmap(w, ht);
    using (var g = Graphics.FromImage(bmp)) {
      IntPtr dc = g.GetHdc(); bool ok = false;
      try { ok = PrintWindow(new IntPtr(h), dc, 2); } finally { g.ReleaseHdc(dc); }
      if (!ok || Blank(bmp)) g.CopyFromScreen(b[0], b[1], 0, 0, new Size(w, ht));
    }
    return bmp;
  }
  public static bool Focus(long h) {
    var p = new IntPtr(h); if (!IsWindow(p)) return false;
    if (IsIconic(p)) ShowWindow(p, 9);
    // Windows only lets the foreground app hand focus over; a harmless Alt tap makes this process eligible.
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    BringWindowToTop(p); return SetForegroundWindow(p);
  }
  public static bool Close(long h) { var p = new IntPtr(h); return IsWindow(p) && PostMessage(p, 0x0010, IntPtr.Zero, IntPtr.Zero); }
  public static void Key(byte vk) { keybd_event(vk, 0, 1, UIntPtr.Zero); keybd_event(vk, 0, 3, UIntPtr.Zero); }
}
'@
[HarmonyDesktop]::Init()

# Windows' own OCR engine through WinRT (no download, nothing leaves the PC).
$script:ocr = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $script:ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
} catch { $script:ocr = $null }

function Await($operation, [Type]$type) {
  $task = $script:asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  if (-not $task.Wait(15000)) { throw 'timeout' }
  $task.Result
}

function Read-Text([System.Drawing.Bitmap]$bitmap) {
  if (-not $script:ocr) { return $null }
  $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $source = $bitmap
  if ($bitmap.Width -gt $max -or $bitmap.Height -gt $max) {
    $scale = [Math]::Min($max / $bitmap.Width, $max / $bitmap.Height)
    $source = New-Object System.Drawing.Bitmap $bitmap, ([int]($bitmap.Width * $scale)), ([int]($bitmap.Height * $scale))
  }
  $memory = New-Object System.IO.MemoryStream
  try {
    $source.Save($memory, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $memory.Position = 0
    $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory)
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $soft = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($script:ocr.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
    $lines = @($result.Lines | ForEach-Object { $_.Text })
    $soft.Dispose()
    return $lines
  } finally {
    $memory.Dispose()
    if ($source -ne $bitmap) { $source.Dispose() }
  }
}

function App-Name([int]$processId) {
  try {
    $p = [System.Diagnostics.Process]::GetProcessById($processId)
    $name = $p.ProcessName
    try { $d = $p.MainModule.FileVersionInfo.FileDescription; if ($d) { $name = $d } } catch { }
    return $name
  } catch { return '' }
}

function Send($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }
function Window-Info([long]$h) { @{ hwnd = $h; title = [HarmonyDesktop]::Title($h); app = (App-Name ([HarmonyDesktop]::Pid($h))) } }

$script:startApps = $null
function Start-Apps {
  if (-not $script:startApps -or ((Get-Date) - $script:startAppsAt).TotalMinutes -gt 10) {
    $script:startApps = @(Get-StartApps | Where-Object { $_.Name -and $_.AppID } | Select-Object -First 800 | ForEach-Object { @{ name = [string]$_.Name; id = [string]$_.AppID } })
    $script:startAppsAt = Get-Date
  }
  return $script:startApps
}
$keys = @{ play_pause = 0xB3; next = 0xB0; previous = 0xB1; volume_up = 0xAF; volume_down = 0xAE; mute = 0xAD }

Send @{ type = 'ready'; version = 1; ocr = [bool]$script:ocr }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Length -gt 4000) { Send @{ type = 'error' }; continue }
  try { $m = $line | ConvertFrom-Json } catch { Send @{ type = 'error' }; continue }
  if ($m.type -eq 'stop') { break }
  $id = $m.id
  if (-not ($id -is [int] -or $id -is [long]) -or $id -lt 0) { Send @{ type = 'error' }; continue }
  try {
    switch ($m.type) {
      'look' {
        $started = Get-Date
        $exclude = [int]$m.exclude_pid
        $h = [HarmonyDesktop]::Target($exclude)
        if ($h -eq 0) { Send @{ type = 'look'; id = $id; found = $false }; break }
        $info = Window-Info $h
        $bitmap = [HarmonyDesktop]::Capture($h)
        try { $lines = Read-Text $bitmap } finally { $bitmap.Dispose() }
        $text = if ($lines) { ($lines -join "`n") } else { '' }
        if ($text.Length -gt 8000) { $text = $text.Substring(0, 8000) }
        Send @{ type = 'look'; id = $id; found = $true; hwnd = $h; app = $info.app; title = $info.title; text = $text; ocr = [bool]$script:ocr; ms = [int]((Get-Date) - $started).TotalMilliseconds }
      }
      'foreground' {
        # Only where the window you're using is (for floating HARMONY to keep out of its way): no title, no pixels.
        $h = [HarmonyDesktop]::Target([int]$m.exclude_pid)
        if ($h -eq 0) { Send @{ type = 'foreground'; id = $id; found = $false }; break }
        Send @{ type = 'foreground'; id = $id; found = $true; bounds = @([HarmonyDesktop]::Bounds($h)) }
      }
      'apps' { Send @{ type = 'apps'; id = $id; apps = @(Start-Apps) } }
      'windows' {
        $list = @([HarmonyDesktop]::Windows([int]$m.exclude_pid) | ForEach-Object { Window-Info $_ })
        Send @{ type = 'windows'; id = $id; windows = $list }
      }
      'launch' {
        $appId = [string]$m.app_id
        $app = @(Start-Apps | Where-Object { $_.id -ceq $appId })
        if ($app.Count -ne 1 -or $appId -match '["\r\n]') { Send @{ type = 'error'; id = $id; reason = 'unknown app' }; break }
        $before = @{}; foreach ($w in [HarmonyDesktop]::Windows(0)) { $before[$w] = $true }
        Start-Process -FilePath "$env:WINDIR\explorer.exe" -ArgumentList ('shell:AppsFolder\' + $appId)
        $new = @()
        for ($i = 0; $i -lt 25 -and $new.Count -eq 0; $i++) {
          Start-Sleep -Milliseconds 300
          $new = @([HarmonyDesktop]::Windows(0) | Where-Object { -not $before.ContainsKey($_) } | Select-Object -First 5)
        }
        Send @{ type = 'launched'; id = $id; name = $app[0].name; windows = @($new) }
      }
      'focus' {
        $h = [long]$m.hwnd; $previous = [HarmonyDesktop]::Foreground()
        Send @{ type = 'focused'; id = $id; ok = [HarmonyDesktop]::Focus($h); previous = $previous }
      }
      'close' {
        $closed = 0; foreach ($h in @($m.hwnds | Select-Object -First 5)) { if ([HarmonyDesktop]::Close([long]$h)) { $closed++ } }
        Send @{ type = 'closed'; id = $id; closed = $closed }
      }
      'key' {
        $name = [string]$m.key; $times = [int]$m.times
        if (-not $keys.ContainsKey($name) -or $times -lt 1 -or $times -gt 25) { Send @{ type = 'error'; id = $id }; break }
        for ($i = 0; $i -lt $times; $i++) { [HarmonyDesktop]::Key([byte]$keys[$name]); Start-Sleep -Milliseconds 30 }
        Send @{ type = 'pressed'; id = $id }
      }
      'url' {
        $url = [string]$m.url
        $uri = $null
        if ($url.Length -gt 2000 -or $url -notmatch '^https?://[A-Za-z0-9.-]+(:\d{1,5})?(/[^\s"''`<>^|]*)?$' -or
            -not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri) -or $uri.UserInfo) { Send @{ type = 'error'; id = $id; reason = 'bad address' }; break }
        Start-Process -FilePath $uri.AbsoluteUri
        Send @{ type = 'opened'; id = $id }
      }
      default { Send @{ type = 'error'; id = $id } }
    }
  } catch { Send @{ type = 'error'; id = $id } }
}
