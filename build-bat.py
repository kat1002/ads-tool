"""Generate the HTML + run.bat bundle: dist-bat/playable-batch.html, dist-bat/run.bat, playable-batch-html-bat.zip.

Run:  python build-bat.py
Reads playable-batch.html, playable-batch.js and jszip.min.js from disk, inlines the scripts, adds a
chrome.storage shim (localStorage) and drops the extension-only pieces (update check, native
messaging, linked folder, version badge). The Store fetch (Play / App Store) is KEPT but goes through
a local PowerShell helper embedded in run.bat (HttpListener on 127.0.0.1:8765): Google Play answers 403
to requests with Sec-Fetch-Site: cross-site (any file:// page), so the page calls /fetch?url=... on the
helper, which fetches server-side. No browser security is disabled.
Source files are not modified. Fails loudly if an anchor changed.
"""
import io
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "dist-bat")
ZIP_PATH = os.path.join(HERE, "playable-batch-html-bat.zip")


def read(path):
    with open(os.path.join(HERE, path), encoding="utf-8", newline="") as fh:
        return fh.read().replace("\r\n", "\n")


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        sys.exit(f"anchor not found exactly once ({text.count(old)}): {label}")
    return text.replace(old, new, 1)


def cut_between(text, start, end, new, label):
    a = text.find(start)
    if a < 0:
        sys.exit(f"anchor missing: {label} (start)")
    b = text.find(end, a)
    if b < 0:
        sys.exit(f"anchor missing: {label} (end)")
    return text[:a] + new + text[b:]


SHIM = """(() => {
  // standalone build: emulate the extension APIs the page uses, backed by localStorage.
  const PREFIX = "playableBatch:";
  // migrate notes saved under the old product name (prefix "adsTool:", keys "adsTool...") to the new names
  try {
    const OLD_PREFIX = "adsTool:";
    for (const full of Object.keys(localStorage)) {
      if (!full.startsWith(OLD_PREFIX)) continue;
      const name = full.slice(OLD_PREFIX.length).replace(/^adsTool/, "playableBatch");
      if (localStorage.getItem(PREFIX + name) === null) localStorage.setItem(PREFIX + name, localStorage.getItem(full));
      localStorage.removeItem(full);
    }
  } catch (e) { /* ignore */ }
  const listeners = [];
  const local = {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys || {});
      const out = {};
      for (const k of list) {
        try { const v = localStorage.getItem(PREFIX + k); if (v !== null) out[k] = JSON.parse(v); } catch (e) { /* ignore */ }
      }
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        localStorage.setItem(PREFIX + k, JSON.stringify(v));
        changes[k] = { newValue: v };
      }
      listeners.forEach((fn) => fn(changes, "local"));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) localStorage.removeItem(PREFIX + k);
    }
  };
  window.chrome = {
    storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } }
  };
  window.addEventListener("storage", (e) => {
    if (!e.key || !e.key.startsWith(PREFIX) || e.newValue === null) return;
    try { listeners.forEach((fn) => fn({ [e.key.slice(PREFIX.length)]: { newValue: JSON.parse(e.newValue) } }, "local")); } catch (err) { /* ignore */ }
  });
  // heartbeat: the run.bat helper exits when the pings stop (window closed)
  const ping = () => { fetch("/ping", { cache: "no-store" }).catch(() => {}); };
  ping();
  setInterval(ping, 5000);
})();
"""


ART_CELL_OLD = """        let artCell;
        if (entry.iconDataUrl) artCell = `<img class="art" src="${entry.iconDataUrl}" alt="Icon của ${escapeHtml(entry.name || `dòng ${index + 1}`)}">`;
        else if (entry.status === "loading") artCell = '<span class="muted">…</span>';
        else artCell = '<span class="muted">Chưa có</span>';
"""

# Same as the original, plus a manual "Chọn ảnh" fallback for rows whose fetch failed (or to override the icon).
ART_CELL_NEW = ART_CELL_OLD + """        if (entry.status === "ok" || entry.status === "err") {
          const pickLabel = entry.iconDataUrl ? "Đổi ảnh" : "Chọn ảnh";
          artCell += `<div><button type="button" class="small" data-action="pick-art" aria-label="${pickLabel}, dòng ${index + 1}">${pickLabel}</button><input type="file" accept="image/*" class="hidden" data-role="entry-icon" aria-label="File icon, dòng ${index + 1}"></div>`;
        }
"""

PICK_ICON_LISTENER = """      elements.checkBody.addEventListener("change", async (event) => {
        const input = event.target.closest("[data-role='entry-icon']");
        if (!input || !input.files || !input.files[0]) return;
        const entry = findEntryFromRow(input.closest("tr"));
        if (!entry) return;
        try {
          entry.iconDataUrl = await normalizeIcon(input.files[0]);
          entry.manualIcon = true;
          replaceCheckRow(entry);
        } catch (error) {
          showMsg(`Không đọc được ảnh: ${error.message}`, "warn");
        }
      });
"""

RUN_BAT = r"""@echo off
setlocal
rem ===========================================================================
rem Playable Batch launcher = batch + PowerShell in ONE file (nothing to install).
rem   1. This batch part finds Edge/Chrome and starts the PowerShell part below.
rem   2. The PowerShell part runs a tiny local web server on http://127.0.0.1:8765/
rem      that serves playable-batch.html and fetches Google Play / App Store pages for it
rem      (server-side, because Google Play rejects requests coming straight from a file page).
rem   3. It opens the browser in app mode, and stops when the window is closed.
rem Keep the black helper window open while you use the tool.
rem ===========================================================================

if not exist "%~dp0playable-batch.html" goto nofile

set "PLAYABLE_BATCH_DIR=%~dp0"
set "PLAYABLE_BATCH_BAT=%~f0"
set "PLAYABLE_BATCH_BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "PLAYABLE_BATCH_BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined PLAYABLE_BATCH_BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "PLAYABLE_BATCH_BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined PLAYABLE_BATCH_BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "PLAYABLE_BATCH_BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined PLAYABLE_BATCH_BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "PLAYABLE_BATCH_BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined PLAYABLE_BATCH_BROWSER if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "PLAYABLE_BATCH_BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined PLAYABLE_BATCH_BROWSER if not defined PLAYABLE_BATCH_NO_BROWSER goto nobrowser

rem Run the PowerShell code that follows the marker line at the bottom of this file.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:PLAYABLE_BATCH_BAT); $m=':::'+'PS-CODE-BELOW'; iex ($t.Substring($t.IndexOf($m)+$m.Length))"
exit /b %errorlevel%

:nobrowser
echo.
echo Khong tim thay Microsoft Edge hoac Google Chrome tren may nay.
echo Hay cai Edge hoac Chrome roi chay lai run.bat.
echo (No Microsoft Edge or Google Chrome found. Install one of them and run this file again.)
echo.
pause
exit /b 1

:nofile
echo.
echo Khong tim thay playable-batch.html canh run.bat. Hay giai nen ca hai file vao cung mot thu muc.
echo (playable-batch.html not found next to run.bat. Keep both files in the same folder.)
echo.
pause
exit /b 1

:::PS-CODE-BELOW
# ---------------------------------------------------------------------------
# PowerShell part (Windows PowerShell 5.1). Executed with iex from run.bat.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$Port = 8765
$Prefix = "http://127.0.0.1:$Port/"
$HostHeader = "127.0.0.1:$Port"
$Dir = $env:PLAYABLE_BATCH_DIR
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- start the loopback-only listener (fail clearly if the port is taken) ---
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)
try {
  $listener.Start()
} catch {
  Write-Host ''
  Write-Host "Khong mo duoc cong $Port (co the Playable Batch dang chay, hoac chuong trinh khac dang dung cong nay)."
  Write-Host "Hay dong cua so Playable Batch / helper cu roi chay lai run.bat."
  Write-Host "(Cannot listen on port $Port. Playable Batch may already be running, or another program uses this port. Close it and run this file again.)"
  Write-Host ''
  cmd /c pause
  exit 1
}

# --- request handler: runs in a runspace pool so parallel requests do not block each other ---
$handler = {
  param($ctx, $state, $dir)
  $req = $ctx.Request
  $res = $ctx.Response
  $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

  function Send($code, $type, [byte[]]$bytes) {
    try {
      $res.StatusCode = $code
      $res.ContentType = $type
      $res.Headers['Cache-Control'] = 'no-store'
      $res.Headers['X-Content-Type-Options'] = 'nosniff'
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch { } finally { try { $res.Close() } catch { } }
  }
  function SendText($code, $text) {
    Send $code 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($text))
  }
  # Only https + these hosts may be fetched (no open proxy). Returns a [Uri] or $null.
  function Get-AllowedUri($s) {
    $u = $null
    if (-not [Uri]::TryCreate([string]$s, [UriKind]::Absolute, [ref]$u)) { return $null }
    if ($u.Scheme -ne 'https' -or $u.Port -ne 443 -or $u.UserInfo) { return $null }
    $h = $u.Host.ToLowerInvariant()
    if ($h -eq 'play.google.com' -or $h -eq 'itunes.apple.com' -or $h.EndsWith('.googleusercontent.com') -or $h.EndsWith('.mzstatic.com')) { return $u }
    return $null
  }

  try {
    # DNS-rebinding guard: only our own origin may talk to this server
    if ($req.Headers['Host'] -ne $state.HostHeader) { SendText 403 'bad host'; return }
    if ($req.HttpMethod -ne 'GET') { SendText 405 'method not allowed'; return }
    $path = $req.Url.AbsolutePath

    if ($path -eq '/ping') {
      $state.LastPing = [DateTime]::UtcNow.Ticks
      SendText 200 'ok'
      return
    }

    if ($path -eq '/' -or $path -eq '/playable-batch.html') {
      $file = Join-Path $dir 'playable-batch.html'
      if (-not (Test-Path -LiteralPath $file)) { SendText 404 'playable-batch.html not found'; return }
      Send 200 'text/html; charset=utf-8' ([IO.File]::ReadAllBytes($file))
      return
    }

    if ($path -eq '/fetch') {
      $origin = $req.Headers['Origin']
      if ($origin -and $origin -ne ('http://' + $state.HostHeader)) { SendText 403 'bad origin'; return }
      $cur = Get-AllowedUri $req.QueryString['url']
      if (-not $cur) { SendText 403 'url not allowed'; return }

      # follow redirects by hand so every hop is re-checked against the allow-list
      for ($hop = 0; $hop -le 5; $hop++) {
        $wr = [Net.HttpWebRequest]::Create($cur)
        $wr.Method = 'GET'
        $wr.AllowAutoRedirect = $false      # no CookieContainer is set, so no cookies are kept or sent
        $wr.Timeout = 15000
        $wr.ReadWriteTimeout = 15000
        $wr.UserAgent = $ua
        $wr.Accept = '*/*'
        $wr.Headers['Accept-Language'] = 'en-US,en;q=0.9'
        $wr.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
        try {
          $up = $wr.GetResponse()
        } catch [Net.WebException] {
          $up = $_.Exception.Response       # 4xx/5xx still carry a response we pass through
          if (-not $up) { SendText 502 ('upstream error: ' + $_.Exception.Message); return }
        }
        $code = [int]$up.StatusCode
        if ($code -in 301, 302, 303, 307, 308) {
          $loc = $up.Headers['Location']
          $up.Close()
          $next = $null
          if ($loc) { $next = Get-AllowedUri ([Uri]::new($cur, $loc)).AbsoluteUri }
          if (-not $next) { SendText 502 'upstream redirect to a host that is not allowed'; return }
          $cur = $next
          continue
        }
        $ms = New-Object IO.MemoryStream
        try { $up.GetResponseStream().CopyTo($ms) } finally { $up.Close() }
        $type = $up.ContentType
        if (-not $type) { $type = 'application/octet-stream' }
        Send $code $type $ms.ToArray()
        return
      }
      SendText 502 'too many redirects'
      return
    }

    SendText 404 'not found'
  } catch {
    SendText 502 ('error: ' + $_.Exception.Message)
  }
}

# --- shared state + runspace pool ---
$state = [hashtable]::Synchronized(@{ HostHeader = $HostHeader; LastPing = 0L })
$pool = [RunspaceFactory]::CreateRunspacePool(1, 16)
$pool.Open()
$jobs = New-Object System.Collections.ArrayList

# --- open the browser in app mode (no security flags; own profile keeps the notes) ---
$browser = $null
if ($env:PLAYABLE_BATCH_BROWSER) {
  $profileDir = Join-Path $env:LOCALAPPDATA 'PlayableBatchProfile'
  $browser = Start-Process -FilePath $env:PLAYABLE_BATCH_BROWSER -PassThru -ArgumentList @(
    "--app=${Prefix}playable-batch.html",
    "--user-data-dir=`"$profileDir`""
  )
}

Write-Host "Playable Batch dang chay tai $Prefix  -  giu cua so nay mo, dong cua so Playable Batch de thoat."
Write-Host "(Playable Batch is running. Keep this window open; it closes by itself when you close the app window.)"

# --- main loop: accept requests, reap finished ones, decide when to stop ---
$startTicks = [DateTime]::UtcNow.Ticks
$exitSeen = $null
$accept = $listener.GetContextAsync()
while ($true) {
  if ($accept.Wait(500)) {
    $ps = [PowerShell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($handler.ToString()).AddArgument($accept.Result).AddArgument($state).AddArgument($Dir)
    [void]$jobs.Add(@{ ps = $ps; h = $ps.BeginInvoke() })
    $accept = $listener.GetContextAsync()
  }
  for ($i = $jobs.Count - 1; $i -ge 0; $i--) {
    if ($jobs[$i].h.IsCompleted) {
      try { [void]$jobs[$i].ps.EndInvoke($jobs[$i].h) } catch { }
      $jobs[$i].ps.Dispose()
      $jobs.RemoveAt($i)
    }
  }

  $now = [DateTime]::UtcNow.Ticks
  $last = [long]$state.LastPing
  if ($last -gt 0) {
    # page was open: stop 20 s after the pings stop
    if (($now - $last) -gt 20 * 10000000) { break }
  } else {
    # page never pinged: browser exited (and no ping within 30 s) or nothing opened within 2 minutes
    if ($browser -and $browser.HasExited) {
      if (-not $exitSeen) { $exitSeen = $now }
      if (($now - $exitSeen) -gt 30 * 10000000) { break }
    }
    if (($now - $startTicks) -gt 120 * 10000000) { break }
  }
}

Write-Host 'Da dong Playable Batch. (Playable Batch closed.)'
# Hard exit: $listener.Stop()/$pool.Close() can block on in-flight requests and leave the helper hung.
# Ending the process releases the port.
[Environment]::Exit(0)
"""


def main():
    html = read("playable-batch.html")
    js = read("playable-batch.js")
    jszip = read("jszip.min.js")
    if "</script>" in js or "</script>" in jszip:
        sys.exit("inline script contains </script>")

    # --- JS: drop the update check, native messaging, linked folder and version badge ---
    js = cut_between(js, "        versionBadge: $(\"versionBadge\"),", "      };\n\n      const ICON_SIZE", "", "update elements")
    js = cut_between(js, "      // ---- update check ----", "      // ---- step 3: variant cards ----", "", "update section")
    js = cut_between(js, "      elements.checkUpdateBtn.addEventListener", "      addVariantRow();\n      updateFileMeta();", "", "update wiring")
    js = replace_once(js, "      elements.versionBadge.textContent = `v${currentVersion()}`;\n      checkForUpdate({ force: false });\n", "", "app tail")

    # --- JS: Store fetch goes through the run.bat helper (same origin /fetch?url=...) ---
    js = replace_once(js, "      // ---- Store fetch (direct; host_permissions in manifest.json lift CORS) ----",
                      "      // ---- Store fetch (via the run.bat local helper: /fetch?url=<encoded>, fetched server-side) ----", "store fetch comment")
    js = replace_once(js, """          response = await fetch(url, {
            credentials: "omit",
            cache: "no-store",
            ...init,
            headers: { "Accept-Language": "en-US,en;q=0.9", ...(init.headers || {}) },
          });
        } catch (err) {
          throw new Error("network/CORS error (có thể bị chuyển hướng tới trang đăng nhập Google)");
        }
        if (response.redirected && /accounts\\.google\\.com/.test(response.url)) {
          throw new Error("bị chuyển hướng tới trang đăng nhập Google");
        }
""", """          response = await fetch(`/fetch?url=${encodeURIComponent(url)}`, { cache: "no-store" });
        } catch (err) {
          throw new Error("không gọi được helper (run.bat còn mở không?)");
        }
""", "fetchText body")
    js = replace_once(js, "        const response = await fetch(`https://itunes.apple.com/lookup?id=${appId}&country=${country}`);",
                      "        const response = await fetch(`/fetch?url=${encodeURIComponent(`https://itunes.apple.com/lookup?id=${appId}&country=${country}`)}`, { cache: \"no-store\" });", "itunes lookup")
    js = replace_once(js, '        const response = await fetch(iconUrl, { credentials: "omit" });',
                      '        const response = await fetch(`/fetch?url=${encodeURIComponent(iconUrl)}`, { cache: "no-store" });', "icon fetch")

    # --- JS: manual icon fallback in the check table ---
    js = replace_once(js, ART_CELL_OLD, ART_CELL_NEW, "check row art cell")
    js = replace_once(js, "        entry.source = null;\n        entry.note = \"\";\n        replaceCheckRow(entry);",
                      "        entry.source = null;\n        entry.manualIcon = false;\n        entry.note = \"\";\n        replaceCheckRow(entry);", "refreshEntry reset")
    js = replace_once(js, "            iconSource: entry.source,\n", "            iconSource: entry.manualIcon ? \"file thủ công\" : entry.source,\n", "confirm icon source")
    js = replace_once(js, "          if (entry.status === \"ok\") {\n            setRowBadge(row, \"ok\", entry.source,",
                      "          if (entry.manualIcon) {\n            setRowBadge(row, \"manual\", \"Icon thủ công\", \"\");\n          } else if (entry.status === \"ok\") {\n            setRowBadge(row, \"ok\", entry.source,", "confirm badge")
    js = replace_once(js, "        } else if (action === \"refresh-entry\") {\n          refreshEntry(entry);\n        }\n",
                      "        } else if (action === \"refresh-entry\") {\n          refreshEntry(entry);\n"
                      "        } else if (action === \"pick-art\") {\n"
                      "          const fileInput = tr.querySelector(\"[data-role='entry-icon']\");\n"
                      "          if (fileInput) fileInput.click();\n        }\n", "check click handler")
    js = replace_once(js, "      elements.checkBody.addEventListener(\"keydown\", (event) => {",
                      PICK_ICON_LISTENER + "      elements.checkBody.addEventListener(\"keydown\", (event) => {", "check change handler")

    # --- HTML ---
    html = replace_once(html, "<title>Playable Batch</title>", "<title>Playable Batch — HTML + run.bat</title>", "title")
    html = replace_once(html, '  <script src="jszip.min.js"></script>', "  <script>\n" + jszip.rstrip("\n") + "\n  </script>", "jszip tag")
    html = cut_between(html, '      <div class="version-box">', "    </header>", "", "version box and update banners")
    html = replace_once(html, "kiểm tra tên/icon → “Xác nhận”. Mỗi app sẽ thành một variant ở bước 3.</p>",
                        "kiểm tra tên/icon → “Xác nhận”. Mỗi app sẽ thành một variant ở bước 3. "
                        "Tên và icon được tự lấy từ link store; bản này phải mở bằng <code>run.bat</code> "
                        "(helper cục bộ lấy tên/icon, không tắt bảo mật trình duyệt) và phải để cửa sổ helper mở. "
                        "Nếu lấy lỗi, nhập tên tay và bấm “Chọn ảnh”.</p>", "step 2 note")
    html = replace_once(html, '  <script src="playable-batch.js"></script>',
                        "  <script>\n" + SHIM + "\n" + js.rstrip("\n") + "\n  </script>", "app tag")

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "playable-batch.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)
    bat = RUN_BAT.replace("\r\n", "\n").replace("\n", "\r\n")
    with open(os.path.join(OUT_DIR, "run.bat"), "wb") as fh:
        fh.write(bat.encode("utf-8"))

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(os.path.join(OUT_DIR, "run.bat"), "run.bat")
        zf.write(os.path.join(OUT_DIR, "playable-batch.html"), "playable-batch.html")
    print(f"wrote dist-bat/playable-batch.html ({len(html)} bytes), dist-bat/run.bat, {os.path.basename(ZIP_PATH)}")


if __name__ == "__main__":
    main()
