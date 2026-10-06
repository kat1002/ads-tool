"""Build the Chrome Web Store package of Playable Batch (no self-update system).

Run:  python build-store.py
Reads manifest.json, playable-batch.html, playable-batch.js, jszip.min.js and icons/ from disk (the GitHub
version, which keeps self-update), strips the update system, writes the folder store-build/ and the
zip playable-batch-store.zip. Source files are not modified. Fails loudly if an anchor changed.
"""
import json
import os
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "store-build")
OUT_ZIP = os.path.join(HERE, "playable-batch-store.zip")


def read(path):
    with open(os.path.join(HERE, path), encoding="utf-8", newline="") as fh:
        return fh.read().replace("\r\n", "\n")


def write(path, text):
    full = os.path.join(OUT_DIR, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


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


BACKGROUND = """function openTool() {
  chrome.tabs.create({ url: chrome.runtime.getURL("playable-batch.html") });
}

chrome.action.onClicked.addListener(openTool);
"""

DESCRIPTION = "Batch tool for ads playables: read app name and icon from store links, rename and export."

HOSTS = [
    "https://play.google.com/*",
    "https://itunes.apple.com/*",
    "https://*.googleusercontent.com/*",
    "https://*.mzstatic.com/*",
]


def build_manifest():
    src = json.loads(read("manifest.json"))
    for key in ("name", "version", "action", "icons"):
        if key not in src:
            sys.exit(f"manifest.json missing key: {key}")
    return {
        "manifest_version": 3,
        "name": src["name"],
        "version": src["version"],
        "description": DESCRIPTION,
        "action": src["action"],
        "icons": src["icons"],
        "background": {"service_worker": "background.js"},
        "permissions": ["storage"],
        "host_permissions": HOSTS,
    }


def build_js():
    js = read("playable-batch.js")
    # elements: keep only the version badge
    js = cut_between(js, '        versionBadge: $("versionBadge"),', "      };\n\n      const ICON_SIZE",
                     '        versionBadge: $("versionBadge")\n', "update elements")
    # the whole update / native messaging / linked folder section
    js = cut_between(js, "      // ---- update check ----", "      // ---- step 3: variant cards ----", "", "update section")
    # update wiring at the tail
    js = cut_between(js, "      elements.checkUpdateBtn.addEventListener", "      addVariantRow();\n      updateFileMeta();", "", "update wiring")
    js = replace_once(js, "      elements.versionBadge.textContent = `v${currentVersion()}`;\n      checkForUpdate({ force: false });\n",
                      "      try {\n        elements.versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;\n      } catch (e) {\n        elements.versionBadge.textContent = \"\";\n      }\n",
                      "app tail")
    return js


def build_html():
    html = read("playable-batch.html")
    html = cut_between(html, '      <div class="version-box">', "    </header>",
                       '      <div class="version-box">\n        <span id="versionBadge" class="badge ok"></span>\n      </div>\n', "version box and update banners")
    return html


def main():
    manifest = build_manifest()
    js = build_js()
    html = build_html()

    if os.path.isdir(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    os.makedirs(OUT_DIR)
    write("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    write("background.js", BACKGROUND)
    write("playable-batch.html", html)
    write("playable-batch.js", js)
    write("jszip.min.js", read("jszip.min.js"))
    icons_src = os.path.join(HERE, "icons")
    if not os.path.isdir(icons_src):
        sys.exit("icons/ missing")
    shutil.copytree(icons_src, os.path.join(OUT_DIR, "icons"))

    if os.path.exists(OUT_ZIP):
        os.remove(OUT_ZIP)
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(OUT_DIR):
            for name in sorted(files):
                full = os.path.join(root, name)
                zf.write(full, os.path.relpath(full, OUT_DIR).replace(os.sep, "/"))
    print(f"wrote store-build/ and playable-batch-store.zip (version {manifest['version']})")


if __name__ == "__main__":
    main()
