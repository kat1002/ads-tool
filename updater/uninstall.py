#!/usr/bin/env python3
"""Remove the Playable Batch native messaging host registration for the current user."""
import os
import sys

import install

HOST_NAME = install.HOST_NAME
# Host name used before the rename to Playable Batch: remove its registration too.
LEGACY_HOST_NAMES = ["com.kat1002.adstool.updater"]
HERE = install.HERE


def main():
    names = [HOST_NAME] + LEGACY_HOST_NAMES
    if sys.platform == "win32":
        import winreg
        for label, reg, _w, _m, _l in install.BROWSERS:
            for name in names:
                key = reg + "\\NativeMessagingHosts\\" + name
                try:
                    winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
                    print("Removed %s" % label)
                except FileNotFoundError:
                    pass
                except OSError as e:
                    print("Skip %s: %s" % (label, e))
    else:
        for label, d in install.manifest_dirs():
            for name in names:
                p = os.path.join(d, name + ".json")
                if os.path.exists(p):
                    try:
                        os.remove(p)
                        print("Removed %s" % label)
                    except OSError as e:
                        print("Skip %s: %s" % (label, e))
    for n in ["allowed-origins.txt"] + [name + ".json" for name in names]:
        try:
            os.remove(os.path.join(HERE, n))
        except OSError:
            pass
    print("Da go cai dat. / Uninstalled.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
