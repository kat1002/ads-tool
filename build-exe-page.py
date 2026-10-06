"""Generate the exe-branch playable-batch.html from the extension files in a source ref.

Run on the exe branch:  python build-exe-page.py [ref]
The ref is the first CLI argument, else $PLAYABLE_BATCH_SRC_REF, else `main`.
Reads playable-batch.html, playable-batch.js (or ads-tool.* if the ref still has the old
names), jszip.min.js and the version from `git show <ref>:...`,
inlines the scripts, adds a chrome.storage shim (localStorage) and swaps the direct store
fetch for calls to the local store-helper.py. Fails loudly if a main anchor changed.
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


SRC_REF = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PLAYABLE_BATCH_SRC_REF")) or "main"


def show_named(new, old):
    """Return (name, text) of `new` in the source ref, falling back to the pre-rename file name."""
    for name in (new, old):
        if subprocess.run(["git", "cat-file", "-e", f"{SRC_REF}:{name}"], cwd=HERE, capture_output=True).returncode == 0:
            return name, show(name)
    sys.exit(f"neither {new} nor {old} exists in {SRC_REF}")


def show(path):
    out = subprocess.run(["git", "show", f"{SRC_REF}:{path}"], cwd=HERE, capture_output=True, check=True).stdout
    return out.decode("utf-8").replace("\r\n", "\n")


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
  window.PLAYABLE_BATCH_EXE = true;
  window.ADS_TOOL_EXE = true; // flag name read by sources from before the rename
  // exe build: emulate the extension APIs the page uses, backed by localStorage.
  const PREFIX = "playableBatch:";
  // Move values saved by the pre-rename build ("adsTool:" prefix) so existing notes survive.
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("adsTool:")) continue;
      const next = PREFIX + k.slice("adsTool:".length);
      if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(k));
      localStorage.removeItem(k);
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
    storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } },
    runtime: { getManifest: () => ({ version: "__VERSION__" }) }
  };
  window.addEventListener("storage", (e) => {
    if (!e.key || !e.key.startsWith(PREFIX) || e.newValue === null) return;
    try { listeners.forEach((fn) => fn({ [e.key.slice(PREFIX.length)]: { newValue: JSON.parse(e.newValue) } }, "local")); } catch (err) { /* ignore */ }
  });
})();
"""

CSS = """    .helper-status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); font-size: 12px; color: var(--muted); }
    .helper-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--warn); }
    .helper-dot.ok { background: var(--ok); }
    .helper-dot.off { background: var(--err); }
"""

STATUS = '      <div class="helper-status" title="Helper là store-helper.py, dùng để lấy tên và icon từ store"><span id="helperDot" class="helper-dot"></span><span id="helperText">đang kiểm tra helper…</span></div>\n'

FETCH = """// ---- Store fetch (via local store-helper.py) ----
      async function helperJson(path) {
        const response = await fetch(`${HELPER_BASE}${path}`);
        const data = await response.json();
        if (!data.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
      }

      async function fetchIconDataUrl(iconUrl) {
        const response = await fetch(`${HELPER_BASE}/api/image?url=${encodeURIComponent(iconUrl)}`);
        if (!response.ok) throw new Error(`icon HTTP ${response.status}`);
        return normalizeIcon(await response.blob());
      }

"""

CHECK_HELPER = """      async function checkHelper() {
        try {
          await helperJson("/api/ping");
          state.helperOnline = true;
          elements.helperDot.className = "helper-dot ok";
          elements.helperText.textContent = "helper đang chạy";
        } catch (error) {
          state.helperOnline = false;
          elements.helperDot.className = "helper-dot off";
          elements.helperText.textContent = "helper chưa chạy — mở PlayableBatch.exe";
        }
      }

"""

NOTICE = """        await checkHelper();
        if (run !== state.checkRun) return;
        if (state.helperOnline) {
          elements.checkNotice.className = "hint warn hidden";
        } else {
          elements.checkNotice.textContent = "Helper chưa chạy nên không lấy được tên và icon. Mở PlayableBatch.exe rồi bấm “Quay lại” → “Tiếp theo”, hoặc bấm “Xác nhận” và nhập tay ở bước 3.";
          elements.checkNotice.className = "hint warn";
        }
"""


def main():
    html_name, html = show_named("playable-batch.html", "ads-tool.html")
    js_name, js = show_named("playable-batch.js", "ads-tool.js")
    jszip = show("jszip.min.js")
    version = re.search(r'"version":\s*"([^"]+)"', show("manifest.json")).group(1)
    if "</script>" in js or "</script>" in jszip:
        sys.exit("inline script contains </script>")

    js = replace_once(js, "        busy: false,\n", "        busy: false,\n        helperOnline: false,\n", "state.busy")
    js = replace_once(js, '        progressText: $("progressText"),\n',
                      '        progressText: $("progressText"),\n        helperDot: $("helperDot"),\n        helperText: $("helperText"),\n',
                      "elements.progressText")
    js = cut_between(js, "// ---- Store fetch", "      // Google Play first, App Store as fallback.", FETCH, "store fetch block")
    js = replace_once(js, 'attempts.push({ source: "Play", load: () => fetchPlay(playId) });',
                      'attempts.push({ source: "Play", path: `/api/play?id=${encodeURIComponent(playId)}` });', "play attempt")
    js = replace_once(js, 'attempts.push({ source: "App Store", load: () => fetchAppStore(apple.id, apple.country) });',
                      'attempts.push({ source: "App Store", path: `/api/appstore?id=${apple.id}&country=${apple.country}` });',
                      "appstore attempt")
    js = replace_once(js, "const info = await attempt.load();", "const info = await helperJson(attempt.path);", "attempt.load")
    js = replace_once(js, "      // ---- step 2: add-links popup", CHECK_HELPER + "      // ---- step 2: add-links popup", "checkHelper insert")
    js = replace_once(js, '        elements.checkNotice.className = "hint warn hidden";\n        await fetchEntries(run);',
                      NOTICE + "        await fetchEntries(run);", "check notice")
    js = replace_once(js, "      checkForUpdate({ force: false });\n    })();",
                      "      checkForUpdate({ force: false });\n      checkHelper();\n      setInterval(checkHelper, 20000);\n    })();", "app tail")
    if js.count("const HELPER_BASE") != 1:
        sys.exit("HELPER_BASE must be defined exactly once in main's js")

    html = replace_once(html, '  <script src="jszip.min.js"></script>', "  <script>\n" + jszip.rstrip("\n") + "\n  </script>", "jszip tag")
    html = replace_once(html, "\n    .layout {", "\n" + CSS + "\n    .layout {", "css anchor")
    html = replace_once(html, "    </header>\n", STATUS + "    </header>\n", "header end")
    tag = next((t for t in (f'  <script src="{js_name}"></script>', '  <script src="ads-tool.js"></script>',
                            '  <script src="playable-batch.js"></script>') if t in html), None)
    if tag is None:
        sys.exit("app script tag not found in the source html")
    html = replace_once(html, tag,
                        "  <script>\n" + SHIM.replace("__VERSION__", version) + "\n" + js.rstrip("\n") + "\n  </script>", "app tag")
    with open(os.path.join(HERE, "playable-batch.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)
    print(f"wrote playable-batch.html (from {SRC_REF}, version {version}, {len(html)} bytes)")


if __name__ == "__main__":
    main()
