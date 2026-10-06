"""Generate playable-batch-standalone.html: the Playable Batch as one HTML file, no extension needed.

Run:  python build-standalone.py
Reads playable-batch.html, playable-batch.js and jszip.min.js from disk, inlines the scripts, adds a
chrome.storage shim (localStorage), drops the update check and all store fetching (app names and
icons are entered by hand; the page makes no network requests). Source files are not modified.
Fails loudly if an anchor changed.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


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
})();
"""

PARSE_LOOP = """          const tokens = line.split(/[\\s,;|]+/).filter(Boolean);
          let play = "";
          let ios = "";
          const nameParts = [];
          for (const token of tokens) {
            const kind = classifyCell(token);
            if (kind === "ios" && !ios) ios = cleanAppStoreUrl(token);
            else if (kind === "play" && !play) play = cleanPlayUrl(token);
            else if (kind !== "ios" && kind !== "play") nameParts.push(token);
          }
          if (!play && !ios) {
            entries.push({ raw: line, invalid: true });
          } else {
            // text left on the line after the links is the app name
            entries.push({ raw: line, invalid: false, androidUrl: play, iosUrl: ios, name: nameParts.join(" ") });
          }
        }
"""

CHECK_CELLS = """        let nameCell;
        if (entry.status === "invalid") {
          nameCell = `<span class="err-text">Link không hợp lệ: ${escapeHtml(entry.raw)}</span>`;
        } else {
          nameCell = `<input type="text" class="name-input" data-role="name" aria-label="Tên app, dòng ${index + 1}" value="${escapeHtml(entry.name)}" placeholder="Nhập tên">`;
        }

        let artCell;
        if (entry.status === "invalid") {
          artCell = '<span class="muted">—</span>';
        } else {
          const pickLabel = entry.iconDataUrl ? "Đổi ảnh" : "Chọn ảnh";
          artCell = (entry.iconDataUrl ? `<img class="art" src="${entry.iconDataUrl}" alt="Icon của ${escapeHtml(entry.name || `dòng ${index + 1}`)}">` : '<span class="muted">Chưa có</span>')
            + `<div><button type="button" class="small" data-action="pick-art" aria-label="${pickLabel}, dòng ${index + 1}">${pickLabel}</button><input type="file" accept="image/*" class="hidden" data-role="entry-icon" aria-label="File icon, dòng ${index + 1}"></div>`;
        }

"""

CHECK_FOOTER = """      function updateCheckFooter() {
        const total = state.entries.length;
        const invalid = state.entries.filter((entry) => entry.status === "invalid").length;
        const usableEntries = state.entries.filter((entry) => entry.status === "ready");
        const named = usableEntries.filter((entry) => entry.name.trim()).length;
        const withIcon = usableEntries.filter((entry) => entry.iconDataUrl).length;
        const editing = state.entries.filter((entry) => entry.editing).length;
        const usable = usableEntries.length;

        if (editing) elements.checkSummary.textContent = "Bấm “Lưu” hoặc “Huỷ” ở dòng đang sửa trước khi xác nhận.";
        else elements.checkSummary.textContent = `${total} dòng · ${named} có tên · ${withIcon} có icon${invalid ? ` · ${invalid} link không hợp lệ (sẽ bị bỏ qua)` : ""}`;
        elements.confirmBtn.disabled = editing > 0 || usable === 0;
        elements.confirmBtn.textContent = usable ? `Xác nhận (${usable})` : "Xác nhận";
      }

"""

REFRESH_TAIL = """        entry.editing = false;
        entry.editError = "";
        entry.status = "ready";
        replaceCheckRow(entry);
        updateCheckFooter();
      }

      function goToCheck() {
        const entries = parseBulkText(elements.bulkText.value);
        if (!entries.length) {
          elements.bulkHint.textContent = "Chưa có link nào. Dán ít nhất 1 link Google Play hoặc App Store.";
          elements.bulkHint.className = "hint warn";
          elements.bulkText.focus();
          return;
        }
        elements.bulkHint.className = "hint warn hidden";
        state.entries = entries;
        state.checkRun += 1;
        showStage("check");
        renderCheckTable();
        elements.confirmBtn.focus();

        elements.checkNotice.className = "hint warn hidden";
      }

"""

CONFIRM_FN = """      function confirmEntries() {
        const usable = state.entries.filter((entry) => entry.status === "ready");
        if (!usable.length) return;

        // Drop the untouched blank default card so it doesn't end up as an empty output.
        const existing = getRows();
        if (existing.length === 1 && isRowBlank(existing[0])) existing[0].remove();

        for (const entry of usable) {
          const row = addVariantRow({
            androidUrl: entry.androidUrl,
            iosUrl: entry.iosUrl,
            splashName: entry.name.trim(),
            splashLogoDataUrl: entry.iconDataUrl,
            iconSource: entry.iconDataUrl ? "file thủ công" : null
          });
          if (entry.iconDataUrl) setRowBadge(row, "manual", "Icon thủ công", "");
        }

        const skipped = state.entries.length - usable.length;
        const noIcon = usable.filter((entry) => !entry.iconDataUrl).length;
        elements.quickPlay.value = "";
        elements.quickIos.value = "";
        closeAddModal();
        state.entries = [];

        const parts = [`Đã thêm ${usable.length} variant`];
        if (noIcon) parts.push(`${noIcon} variant chưa có icon (bấm “Chỉnh sửa” để bổ sung)`);
        if (skipped) parts.push(`bỏ qua ${skipped} link không hợp lệ`);
        showMsg(`${parts.join(", ")}.`, noIcon || skipped ? "warn" : "ok");
      }

"""

PICK_ICON_LISTENER = """      elements.checkBody.addEventListener("change", async (event) => {
        const input = event.target.closest("[data-role='entry-icon']");
        if (!input || !input.files || !input.files[0]) return;
        const entry = findEntryFromRow(input.closest("tr"));
        if (!entry) return;
        try {
          entry.iconDataUrl = await normalizeIcon(input.files[0]);
          replaceCheckRow(entry);
        } catch (error) {
          showMsg(`Không đọc được ảnh: ${error.message}`, "warn");
        }
      });
"""


def main():
    html = read("playable-batch.html")
    js = read("playable-batch.js")
    jszip = read("jszip.min.js")
    if "</script>" in js or "</script>" in jszip:
        sys.exit("inline script contains </script>")

    # --- JS: drop the update check and everything wired to it ---
    js = cut_between(js, "        versionBadge: $(\"versionBadge\"),", "      };\n\n      const ICON_SIZE", "", "update elements")
    js = cut_between(js, "      // ---- update check ----", "      // ---- step 3: variant cards ----", "", "update section")
    js = cut_between(js, "      elements.checkUpdateBtn.addEventListener", "      addVariantRow();\n      updateFileMeta();", "", "update wiring")
    js = replace_once(js, "      elements.versionBadge.textContent = `v${currentVersion()}`;\n      checkForUpdate({ force: false });\n", "", "app tail")

    # --- JS: no store fetching; names and icons are entered by hand ---
    js = replace_once(js, "      const FETCH_CONCURRENCY = 3;\n", "", "fetch concurrency")
    js = cut_between(js, "      // ---- Store fetch (direct", "      // ---- step 2: add-links popup", "", "store fetch section")
    js = replace_once(js, "                  <button class=\"small\" data-action=\"refetch\" type=\"button\">Lấy lại từ link</button>\n", "", "card refetch button")
    js = replace_once(js, "        row.querySelector(\"[data-action='refetch']\").addEventListener(\"click\", () => fetchIntoRow(row));\n\n", "", "card refetch listener")

    js = replace_once(js, "          if (!line) continue;\n          const tokens = line.split(/[\\s,;|]+/).filter(Boolean);\n", "          if (!line) continue;\n          const tokens = line.split(/[\\s,;|]+/).filter(Boolean);\n", "parseBulkText anchor")
    js = cut_between(js, "          if (!line) continue;\n          const tokens = line.split(", "        return entries.map((entry, index) => ({", "          if (!line) continue;\n" + PARSE_LOOP, "parseBulkText loop")
    js = replace_once(js, "status: entry.invalid ? \"invalid\" : \"loading\"", "status: entry.invalid ? \"invalid\" : \"ready\"", "entry status")
    js = replace_once(js, "          source: null,\n          error: \"\",\n          note: \"\",\n", "", "entry fields")
    js = cut_between(js, "        let nameCell;\n", "        let playCell;\n", CHECK_CELLS, "check row cells")
    js = replace_once(js, "aria-label=\"Lấy lại tên và icon, dòng ${index + 1}\">Lấy lại</button>",
                      "aria-label=\"Lưu link, dòng ${index + 1}\">Lưu</button>", "save button")
    js = cut_between(js, "      function updateCheckFooter() {", "      function findEntryFromRow(tr) {", CHECK_FOOTER, "footer and fetch entries")
    js = replace_once(js, "      // \"Lấy lại\": validate the edited links, then refresh name + icon (Google Play first).\n",
                      "      // \"Lưu\": validate the edited links and keep the row.\n", "refresh comment")
    js = cut_between(js, "        entry.editing = false;\n        entry.editError = \"\";\n        entry.status = \"loading\";",
                     "      function confirmEntries() {", REFRESH_TAIL, "refreshEntry tail and goToCheck")
    js = cut_between(js, "      function confirmEntries() {", "      // ---- step 1: source files ----", CONFIRM_FN, "confirmEntries")
    js = replace_once(js, "        } else if (action === \"refresh-entry\") {\n          refreshEntry(entry);\n        }\n",
                      "        } else if (action === \"refresh-entry\") {\n          refreshEntry(entry);\n"
                      "        } else if (action === \"pick-art\") {\n"
                      "          const fileInput = tr.querySelector(\"[data-role='entry-icon']\");\n"
                      "          if (fileInput) fileInput.click();\n        }\n", "check click handler")
    js = replace_once(js, "      elements.checkBody.addEventListener(\"keydown\", (event) => {",
                      PICK_ICON_LISTENER + "      elements.checkBody.addEventListener(\"keydown\", (event) => {", "check change handler")

    # --- HTML ---
    html = replace_once(html, "<title>Playable Batch</title>", "<title>Playable Batch — HTML</title>", "title")
    html = replace_once(html, '  <script src="jszip.min.js"></script>', "  <script>\n" + jszip.rstrip("\n") + "\n  </script>", "jszip tag")
    html = cut_between(html, '      <div class="version-box">', "    </header>", "", "version box and update banners")
    html = replace_once(html, "kiểm tra tên/icon → “Xác nhận”. Mỗi app sẽ thành một variant ở bước 3.</p>",
                        "kiểm tra tên/icon → “Xác nhận”. Mỗi app sẽ thành một variant ở bước 3. Tên và icon nhập tay: ghi tên sau link trên cùng dòng hoặc sửa trong bảng, rồi bấm “Chọn ảnh”.</p>", "step 2 note")
    html = replace_once(html, '  <script src="playable-batch.js"></script>',
                        "  <script>\n" + SHIM + "\n" + js.rstrip("\n") + "\n  </script>", "app tag")

    with open(os.path.join(HERE, "playable-batch-standalone.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)
    print(f"wrote playable-batch-standalone.html ({len(html)} bytes)")


if __name__ == "__main__":
    main()
