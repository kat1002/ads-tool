#!/usr/bin/env python3
"""Ads Tool native messaging host (Python 3, stdlib only).

Protocol: 4-byte little-endian length + UTF-8 JSON on stdin/stdout, one reply
per request. Nothing else may ever be written to stdout.
"""
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

HOST_VERSION = "1.0.6"
RELEASE_BASE = "https://github.com/kat1002/ads-tool/releases/download"
ZIP_NAME = "ads-tool-extension.zip"
MAX_ZIP = 20 * 1024 * 1024
MAX_FILE = 10 * 1024 * 1024
LOG_CAP = 200 * 1024
APP_NAME = "Ads Tool"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ALLOWED = re.compile(
    r"^(manifest\.json|background\.js|ads-tool\.html|ads-tool\.js|jszip\.min\.js"
    r"|icons/[A-Za-z0-9._-]+\.png"
    r"|updater/host\.py|updater/install\.py|updater/uninstall\.py"
    r"|install-updater\.bat|uninstall-updater\.bat)$"
)
NEVER = {"updater/updater-host.bat"}


class HostError(Exception):
    def __init__(self, code, msg):
        Exception.__init__(self, msg)
        self.code = code
        self.msg = msg


def log(msg):
    try:
        base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
        d = os.path.join(base, "AdsTool")
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "updater.log")
        if os.path.exists(p) and os.path.getsize(p) > LOG_CAP:
            with open(p, "rb") as f:
                f.seek(-(LOG_CAP // 2), os.SEEK_END)
                tail = f.read()
            with open(p, "wb") as f:
                f.write(tail)
        with open(p, "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    except Exception:
        pass


def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = int.from_bytes(raw, "little")
    if n <= 0 or n > 1024 * 1024:
        raise HostError("BAD_VERSION", "bad message size")
    data = sys.stdin.buffer.read(n)
    return json.loads(data.decode("utf-8"))


def send_msg(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(len(data).to_bytes(4, "little") + data)
    sys.stdout.buffer.flush()


def read_manifest(folder):
    with open(os.path.join(folder, "manifest.json"), "r", encoding="utf-8-sig") as f:
        return json.load(f)


def check_root():
    try:
        m = read_manifest(ROOT)
    except Exception:
        raise HostError("NOT_ADS_TOOL", "manifest.json not found in host folder")
    if m.get("name") != APP_NAME:
        raise HostError("NOT_ADS_TOOL", "host folder is not Ads Tool")
    return m


def check_origin():
    origin = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        with open(os.path.join(HERE, "allowed-origins.txt"), "r", encoding="utf-8") as f:
            allowed = [l.strip() for l in f if l.strip()]
    except Exception:
        allowed = []
    if not origin or origin not in allowed:
        raise HostError("ORIGIN", "origin not allowed")


def fetch(url, cap):
    """Return bytes. HTTPError propagates (caller decides); other failures -> DOWNLOAD."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AdsToolUpdater/" + HOST_VERSION})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read(cap + 1)
    except urllib.error.HTTPError:
        raise
    except Exception as e:
        raise HostError("DOWNLOAD", "download failed: %s" % e)
    if len(data) > cap:
        raise HostError("DOWNLOAD", "download too large")
    return data


def safe_name(name):
    if not name or name.startswith("/") or "\\" in name or ":" in name:
        return False
    return ".." not in name.split("/")


def do_update(version):
    if not isinstance(version, str) or not re.match(r"^\d+\.\d+\.\d+$", version):
        raise HostError("BAD_VERSION", "invalid version")
    check_root()
    url = "%s/v%s/%s" % (RELEASE_BASE, version, ZIP_NAME)
    try:
        blob = fetch(url, MAX_ZIP)
    except urllib.error.HTTPError as e:
        raise HostError("DOWNLOAD", "HTTP %s" % e.code)
    want = None
    try:
        want = fetch(url + ".sha256", 1024).decode("ascii", "replace").split()[0].lower()
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise HostError("DOWNLOAD", "sha256 HTTP %s" % e.code)
    except IndexError:
        raise HostError("HASH", "empty sha256 file")
    if want is not None and hashlib.sha256(blob).hexdigest() != want:
        raise HostError("HASH", "sha256 mismatch")
    try:
        z = zipfile.ZipFile(io.BytesIO(blob))
    except Exception as e:
        raise HostError("ZIP", "bad zip: %s" % e)
    tmp = tempfile.mkdtemp(prefix="adstool-upd-")
    try:
        files = {}
        for info in z.infolist():
            name = info.filename
            if name.endswith("/"):
                continue
            if not safe_name(name) or name in NEVER or not ALLOWED.match(name):
                log("skip entry %r" % name)
                continue
            if info.file_size > MAX_FILE:
                raise HostError("ZIP", "file too large: %s" % name)
            data = z.read(name)
            if len(data) > MAX_FILE:
                raise HostError("ZIP", "file too large: %s" % name)
            files[name] = data
        if "manifest.json" not in files:
            raise HostError("MANIFEST", "manifest.json missing in zip")
        try:
            nm = json.loads(files["manifest.json"].decode("utf-8-sig"))
        except Exception:
            raise HostError("MANIFEST", "manifest.json unreadable")
        if nm.get("name") != APP_NAME or nm.get("version") != version:
            raise HostError("MANIFEST", "manifest name/version mismatch")
        for name, data in files.items():
            p = os.path.join(tmp, *name.split("/"))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as f:
                f.write(data)
        order = sorted(files, key=lambda n: (n == "manifest.json", n))
        written = 0
        rootreal = os.path.realpath(ROOT)
        for name in order:
            dest = os.path.join(ROOT, *name.split("/"))
            if not os.path.realpath(dest).startswith(rootreal + os.sep):
                raise HostError("WRITE", "path escape: %s" % name)
            try:
                with open(dest, "rb") as f:
                    if f.read() == files[name]:
                        continue
            except OSError:
                pass
            try:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                part = dest + ".part"
                shutil.copyfile(os.path.join(tmp, *name.split("/")), part)
                os.replace(part, dest)
            except Exception as e:
                raise HostError("WRITE", "write %s failed: %s" % (name, e))
            written += 1
        log("updated to %s, %d files" % (version, written))
        return {"ok": True, "version": version, "written": written}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def handle(msg):
    check_origin()
    cmd = msg.get("cmd") if isinstance(msg, dict) else None
    if cmd == "ping":
        m = check_root()
        return {"ok": True, "host": HOST_VERSION, "extVersion": m.get("version"), "dir": ROOT}
    if cmd == "update":
        return do_update(msg.get("version"))
    raise HostError("BAD_VERSION", "unknown cmd")


def main():
    if sys.platform == "win32":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    try:
        msg = read_msg()
        if msg is None:
            return
        reply = handle(msg)
    except HostError as e:
        log("error %s: %s" % (e.code, e.msg))
        reply = {"ok": False, "code": e.code, "error": e.msg}
    except Exception as e:
        log("unexpected: %r" % e)
        reply = {"ok": False, "code": "WRITE", "error": "unexpected: %s" % e}
    send_msg(reply)


if __name__ == "__main__":
    main()
