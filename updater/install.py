#!/usr/bin/env python3
"""Register the Playable Batch native messaging host for the current user.

Usage: python install.py [--dry-run]
"""
import json
import os
import re
import sys

HOST_NAME = "com.kat1002.playable_batch.updater"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ID_RE = re.compile(r"^[a-p]{32}$")

# (label, Windows registry subkey, User Data dir parts (Windows), macOS dir, Linux dir)
BROWSERS = [
    ("Chrome", r"Software\Google\Chrome", ("Google", "Chrome"),
     "Google/Chrome", "google-chrome"),
    ("Edge", r"Software\Microsoft\Edge", ("Microsoft", "Edge"),
     "Microsoft Edge", "microsoft-edge"),
    ("Brave", r"Software\BraveSoftware\Brave-Browser", ("BraveSoftware", "Brave-Browser"),
     "BraveSoftware/Brave-Browser", "BraveSoftware/Brave-Browser"),
    ("Chromium", r"Software\Chromium", ("Chromium",),
     "Chromium", "chromium"),
]


def norm(p):
    return os.path.normcase(os.path.normpath(p))


def is_playable_batch(folder):
    try:
        with open(os.path.join(folder, "manifest.json"), "r", encoding="utf-8-sig") as f:
            return json.load(f).get("name") == "Playable Batch"
    except Exception:
        return False


def user_data_dirs():
    out = []
    home = os.path.expanduser("~")
    for label, _reg, win, mac, lin in BROWSERS:
        if sys.platform == "win32":
            base = os.environ.get("LOCALAPPDATA", "")
            d = os.path.join(base, *win, "User Data") if base else None
        elif sys.platform == "darwin":
            d = os.path.join(home, "Library", "Application Support", *mac.split("/"))
        else:
            d = os.path.join(home, ".config", *lin.split("/"))
        if d and os.path.isdir(d):
            out.append((label, d))
    return out


def find_ids(folder):
    """Scan browser profiles for extensions whose path equals folder. Returns {id: label}."""
    want = norm(folder)
    found = {}
    for label, ud in user_data_dirs():
        try:
            profiles = [p for p in os.listdir(ud)
                        if p == "Default" or p.startswith("Profile ") or p == "Guest Profile"]
        except OSError:
            continue
        for prof in profiles:
            for fname in ("Secure Preferences", "Preferences"):
                fp = os.path.join(ud, prof, fname)
                try:
                    with open(fp, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    settings = data.get("extensions", {}).get("settings", {})
                except Exception:
                    continue
                for eid, s in settings.items():
                    p = s.get("path") if isinstance(s, dict) else None
                    if isinstance(p, str) and ID_RE.match(eid) and norm(p) == want:
                        found[eid] = label
    return found


def ask_id():
    print("Khong tim thay ID extension tu dong. / Could not find the extension ID automatically.")
    print("Mo Playable Batch, copy ID trong huong dan 'Cai tu cap nhat', roi dan vao day.")
    print("Open Playable Batch, copy the ID shown in the updater help, and paste it here.")
    while True:
        try:
            v = input("Extension ID (32 ky tu a-p / 32 chars a-p): ").strip()
        except EOFError:
            return None
        if ID_RE.match(v):
            return v
        print("ID khong hop le. / Invalid ID.")


def launcher_path():
    if sys.platform == "win32":
        return os.path.join(HERE, "updater-host.bat")
    p = os.path.join(HERE, "host.py")
    try:
        os.chmod(p, 0o755)
    except OSError:
        pass
    return p


def manifest_dirs():
    """Non-Windows NativeMessagingHosts dirs: [(label, dir)]."""
    home = os.path.expanduser("~")
    out = []
    for label, _reg, _win, mac, lin in BROWSERS:
        if sys.platform == "darwin":
            d = os.path.join(home, "Library", "Application Support", *mac.split("/"), "NativeMessagingHosts")
        else:
            d = os.path.join(home, ".config", *lin.split("/"), "NativeMessagingHosts")
        out.append((label, d))
    return out


def write_files(ids):
    with open(os.path.join(HERE, "allowed-origins.txt"), "w", encoding="utf-8") as f:
        for i in ids:
            f.write("chrome-extension://%s/\n" % i)
    doc = {
        "name": HOST_NAME,
        "description": "Playable Batch self-updater",
        "path": launcher_path(),
        "type": "stdio",
        "allowed_origins": ["chrome-extension://%s/" % i for i in ids],
    }
    jp = os.path.join(HERE, HOST_NAME + ".json")
    with open(jp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
    return jp


def register(jp, dry):
    if sys.platform == "win32":
        import winreg
        for label, reg, _w, _m, _l in BROWSERS:
            key = reg + "\\NativeMessagingHosts\\" + HOST_NAME
            if dry:
                print("[dry-run] HKCU\\%s = %s" % (key, jp))
                continue
            k = winreg.CreateKey(winreg.HKEY_CURRENT_USER, key)
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, jp)
            winreg.CloseKey(k)
            print("Registered %s" % label)
    else:
        for label, d in manifest_dirs():
            dest = os.path.join(d, HOST_NAME + ".json")
            if dry:
                print("[dry-run] copy %s -> %s" % (jp, dest))
                continue
            try:
                os.makedirs(d, exist_ok=True)
                with open(jp, "r", encoding="utf-8") as s, open(dest, "w", encoding="utf-8") as o:
                    o.write(s.read())
                print("Registered %s" % label)
            except OSError as e:
                print("Skip %s: %s" % (label, e))


def main():
    dry = "--dry-run" in sys.argv[1:]
    if not is_playable_batch(ROOT):
        print("Thu muc nay khong phai Playable Batch (khong thay manifest.json 'Playable Batch').")
        print("This folder is not Playable Batch.")
        return 1
    found = find_ids(ROOT)
    for eid, label in found.items():
        print("Tim thay / Found: %s (%s)" % (eid, label))
    ids = list(found)
    if not ids:
        v = ask_id()
        if not v:
            return 1
        ids = [v]
    jp = write_files(ids)
    register(jp, dry)
    print("")
    print("Xong. Hay tai lai (reload) extension / trang Playable Batch.")
    print("Done. Reload the extension / Playable Batch page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
