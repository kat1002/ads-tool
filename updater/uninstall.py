#!/usr/bin/env python3
"""Remove the Ads Tool native messaging host registration for the current user."""
import os
import sys

import install

HOST_NAME = install.HOST_NAME
HERE = install.HERE


def main():
    if sys.platform == "win32":
        import winreg
        for label, reg, _w, _m, _l in install.BROWSERS:
            key = reg + "\\NativeMessagingHosts\\" + HOST_NAME
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
                print("Removed %s" % label)
            except FileNotFoundError:
                pass
            except OSError as e:
                print("Skip %s: %s" % (label, e))
    else:
        for label, d in install.manifest_dirs():
            p = os.path.join(d, HOST_NAME + ".json")
            if os.path.exists(p):
                try:
                    os.remove(p)
                    print("Removed %s" % label)
                except OSError as e:
                    print("Skip %s: %s" % (label, e))
    for n in ("allowed-origins.txt", HOST_NAME + ".json"):
        try:
            os.remove(os.path.join(HERE, n))
        except OSError:
            pass
    print("Da go cai dat. / Uninstalled.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
