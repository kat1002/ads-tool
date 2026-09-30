"""Local helper for ads-tool.html: fetches app name + icon from Google Play / App Store.

Run:  python store-helper.py     (opens Edge in app mode; closing the window stops the helper)
Python 3 stdlib only. Binds to localhost.
"""
import html
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.5"
PORT = 8765
REPO = "kat1002/ads-tool"
EXE_NAME = "AdsTool.exe"
if getattr(sys, "frozen", False):
    ROOT = sys._MEIPASS  # PyInstaller unpack dir holding the bundled ads-tool.html
else:
    ROOT = os.path.dirname(os.path.abspath(__file__))
LAST_PING = [time.time()]
URL = f"http://127.0.0.1:{PORT}/ads-tool.html"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
IMAGE_HOSTS = (".googleusercontent.com", ".mzstatic.com")


def http_get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(), resp.headers.get("Content-Type", "")


def fetch_play(pkg):
    if not re.fullmatch(r"[A-Za-z0-9_.]+", pkg or ""):
        raise ValueError("invalid package id")
    url = f"https://play.google.com/store/apps/details?id={pkg}&hl=en&gl=us"
    page = http_get(url)[0].decode("utf-8", "replace")

    name = icon = None

    # 1) ld+json SoftwareApplication
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', page, re.S):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("@type") == "SoftwareApplication":
            name = data.get("name")
            icon = data.get("image")
            break

    # 2) itemprop fallbacks
    if not name:
        m = re.search(r'itemprop="name"[^>]*>([^<]+)<', page)
        name = m.group(1) if m else None
    if not icon:
        m = re.search(r'<img[^>]+alt="Icon image"[^>]+src="([^"]+)"', page)
        icon = m.group(1) if m else None

    # 3) og fallbacks
    if not name:
        m = re.search(r'property="og:title"\s+content="([^"]+)"', page)
        name = re.sub(r"\s*-\s*Apps on Google Play\s*$", "", m.group(1)) if m else None
    if not icon:
        m = re.search(r'property="og:image"\s+content="([^"]+)"', page)
        icon = m.group(1) if m else None

    if not name or not icon:
        raise ValueError("could not parse name/icon (app not found?)")

    icon = html.unescape(icon).split("=")[0] + "=s512"
    return {"name": html.unescape(name).strip(), "iconUrl": icon}


def fetch_appstore(app_id, country="us"):
    if not re.fullmatch(r"\d+", app_id or ""):
        raise ValueError("invalid app id")
    if not re.fullmatch(r"[a-zA-Z]{2}", country or ""):
        country = "us"
    body = http_get(f"https://itunes.apple.com/lookup?id={app_id}&country={country}")[0]
    results = json.loads(body).get("results") or []
    if not results:
        raise ValueError("app not found")
    item = results[0]
    icon = item.get("artworkUrl512") or item.get("artworkUrl100", "")
    icon = re.sub(r"/\d+x\d+bb\.(jpg|png|webp)$", r"/512x512bb.\1", icon)
    return {"name": item.get("trackName", "").strip(), "iconUrl": icon}


def version_tuple(text):
    parts = re.findall(r"\d+", str(text).lstrip("vV"))
    if not parts:
        raise ValueError(f"bad version: {text}")
    return tuple(int(p) for p in parts)


def self_update():
    """Download the latest release exe and swap it in place of the running one."""
    if not getattr(sys, "frozen", False):
        raise ValueError("chỉ cập nhật được khi chạy bản AdsTool.exe")
    release = json.loads(http_get(f"https://api.github.com/repos/{REPO}/releases/latest")[0])
    latest = str(release.get("tag_name", ""))
    if version_tuple(latest) <= version_tuple(VERSION):
        raise ValueError("đã là bản mới nhất")
    asset = next((a for a in release.get("assets") or [] if a.get("name") == EXE_NAME), None)
    if not asset or not asset.get("browser_download_url"):
        raise ValueError(f"release không có {EXE_NAME}")
    exe = sys.executable
    folder = os.path.dirname(exe)
    new_path = os.path.join(folder, "AdsTool.new.exe")
    old_path = os.path.join(folder, "AdsTool.old.exe")
    try:
        data = http_get(asset["browser_download_url"], timeout=300)[0]
        if not data.startswith(b"MZ") or len(data) < 1_000_000:
            raise ValueError("file tải về không hợp lệ")
        with open(new_path, "wb") as fh:
            fh.write(data)
        if os.path.exists(old_path):
            os.remove(old_path)
        os.replace(exe, old_path)  # a running exe can be renamed but not overwritten
        try:
            os.replace(new_path, exe)
        except OSError:
            os.replace(old_path, exe)  # roll back
            raise
    except (OSError, ValueError, urllib.error.URLError):
        try:
            if os.path.exists(new_path):
                os.remove(new_path)
        except OSError:
            pass
        raise
    # A onefile child inherits our PyInstaller env and would reuse our (soon deleted) unpack dir.
    env = {k: v for k, v in os.environ.items() if k != "_MEIPASS2" and not k.startswith("_PYI_")}
    env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    subprocess.Popen([exe, "--after-update"], close_fds=True, env=env, cwd=folder,
                     creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)


def stop_soon(server):
    def run():
        time.sleep(0.5)
        try:
            server.shutdown()
            server.server_close()
        finally:
            os._exit(0)
    threading.Thread(target=run, daemon=True).start()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()
        q = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        try:
            if parsed.path == "/api/ping":
                LAST_PING[0] = time.time()
                return self.send_json({"ok": True})
            if parsed.path == "/api/version":
                return self.send_json({"ok": True, "version": VERSION})
            if parsed.path == "/api/play":
                return self.send_json({"ok": True, **fetch_play(q.get("id", ""))})
            if parsed.path == "/api/appstore":
                return self.send_json({"ok": True, **fetch_appstore(q.get("id", ""), q.get("country", "us"))})
            if parsed.path == "/api/image":
                url = q.get("url", "")
                host = urllib.parse.urlparse(url).hostname or ""
                if not url.startswith("https://") or not host.endswith(IMAGE_HOSTS):
                    return self.send_json({"ok": False, "error": "host not allowed"}, 400)
                data, ctype = http_get(url)
                self.send_response(200)
                self.send_header("Content-Type", ctype or "application/octet-stream")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            return self.send_json({"ok": False, "error": "unknown endpoint"}, 404)
        except (ValueError, urllib.error.URLError, OSError) as exc:
            return self.send_json({"ok": False, "error": str(exc)}, 502)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if self.headers.get("Origin") != f"http://127.0.0.1:{PORT}":
            return self.send_json({"ok": False, "error": "forbidden"}, 403)
        if parsed.path != "/api/update":
            return self.send_json({"ok": False, "error": "unknown endpoint"}, 404)
        try:
            self_update()
        except (ValueError, urllib.error.URLError, OSError) as exc:
            return self.send_json({"ok": False, "error": str(exc)}, 502)
        self.send_json({"ok": True})
        stop_soon(self.server)

    def log_message(self, fmt, *args):
        if sys.stderr:
            sys.stderr.write("[helper] " + fmt % args + "\n")


def find_edge():
    candidates = []
    try:
        import winreg
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe") as key:
                    candidates.append(winreg.QueryValue(key, None))
            except OSError:
                pass
    except ImportError:
        pass
    for var in ("ProgramFiles(x86)", "ProgramFiles"):
        base = os.environ.get(var)
        if base:
            candidates.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
    return next((c for c in candidates if c and os.path.isfile(c)), None)


def open_app_window():
    """Open Edge in chromeless app mode; returns the process, or None if Edge is missing."""
    edge = find_edge()
    if not edge:
        return None
    profile = os.path.join(os.environ.get("LOCALAPPDATA", ROOT), "AdsTool", "edge-profile")
    return subprocess.Popen([edge, f"--app={URL}", f"--user-data-dir={profile}",
                             "--no-first-run", "--no-default-browser-check", "--window-size=1400,900"])


def cleanup_old_exe():
    if not getattr(sys, "frozen", False):
        return
    old_path = os.path.join(os.path.dirname(sys.executable), "AdsTool.old.exe")
    for _ in range(60):  # the old bootloader process keeps the file locked until it exits
        try:
            if os.path.exists(old_path):
                os.remove(old_path)
            return
        except OSError:
            time.sleep(1)


def watch_pings():
    """Quit once the page stops pinging."""
    LAST_PING[0] = time.time()
    while time.time() - LAST_PING[0] < 60:
        time.sleep(2)


if __name__ == "__main__":
    threading.Thread(target=cleanup_old_exe, daemon=True).start()
    after_update = "--after-update" in sys.argv
    server = None
    for _ in range(10 if after_update else 1):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
            break
        except OSError:
            time.sleep(1)
    if server is None:
        if after_update:
            sys.exit(1)
        # Port busy: the tool is already running, so just open another window.
        if not open_app_window():
            webbrowser.open(URL)
        sys.exit(0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    if after_update:
        # The existing page keeps its window open and pings us; no new window.
        watch_pings()
    else:
        window = open_app_window()
        if window:
            window.wait()  # closing the app window stops the tool
        else:
            # No Edge: open the default browser and quit once the page stops pinging.
            webbrowser.open(URL)
            watch_pings()
    server.shutdown()
