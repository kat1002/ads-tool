    (() => {
      const state = {
        sources: [],
        outputs: [],
        outputBlob: null,
        reportBlob: null,
        batchReport: null,
        outputName: null,
        reportName: null,
        busy: false,
        checkRun: 0,
        entries: []
      };

      const $ = (id) => document.getElementById(id);
      const elements = {
        dropZone: $("dropZone"),
        fileInput: $("fileInput"),
        fileMeta: $("fileMeta"),
        quickPlay: $("quickPlay"),
        quickIos: $("quickIos"),
        openAddBtn: $("openAddBtn"),
        addVariantBtn: $("addVariantBtn"),
        variantList: $("variantList"),
        variantCount: $("variantCount"),
        variantEmpty: $("variantEmpty"),
        autoDownloadCheckbox: $("autoDownloadCheckbox"),
        networkRenameCheckbox: $("networkRenameCheckbox"),
        innerRenameCheckbox: $("innerRenameCheckbox"),
        stepNo1: $("stepNo1"),
        stepNo2: $("stepNo2"),
        stepNo3: $("stepNo3"),
        summary: $("summary"),
        nextHint: $("nextHint"),
        msg: $("msg"),
        processBtn: $("processBtn"),
        downloadOutputBtn: $("downloadOutputBtn"),
        downloadReportBtn: $("downloadReportBtn"),
        outputList: $("outputList"),
        log: $("log"),
        logDetails: $("logDetails"),
        statOutputs: $("statOutputs"),
        statHtml: $("statHtml"),
        statFail: $("statFail"),
        progressBar: $("progressBar"),
        progressText: $("progressText"),
        modal: $("addModal"),
        modalStep: $("modalStep"),
        closeModalBtn: $("closeModalBtn"),
        stageInput: $("stageInput"),
        stageCheck: $("stageCheck"),
        bulkText: $("bulkText"),
        bulkHint: $("bulkHint"),
        cancelBtn: $("cancelBtn"),
        nextBtn: $("nextBtn"),
        backBtn: $("backBtn"),
        confirmBtn: $("confirmBtn"),
        checkBody: $("checkBody"),
        checkNotice: $("checkNotice"),
        checkSummary: $("checkSummary")
      };

      const ICON_SIZE = 512;
      const FETCH_CONCURRENCY = 3;
      const NETWORK_RULES = {
        googleads: "GGA",
        google: "GGA",
        mintergral: "Minter",
        mintegral: "Minter",
        facebook: "FB",
        meta: "FB",
        tiktok: "Tiktok",
        applovin: "Applovin"
      };

      // ---- log / messages / progress ----
      function log(message, mode) {
        const prefix = mode === "error" ? "[ERROR]" : mode === "warn" ? "[WARN]" : "[INFO]";
        elements.log.textContent += `\n${prefix} ${message}`;
        elements.log.scrollTop = elements.log.scrollHeight;
        if (mode === "error") elements.logDetails.open = true;
      }

      function resetLog() {
        elements.log.textContent = "Đang xử lý...";
      }

      function showMsg(text, kind) {
        elements.msg.textContent = text || "";
        elements.msg.className = `msg${kind ? ` ${kind}` : ""}${text ? "" : " hidden"}`;
      }

      function setProgress(done, total) {
        const percent = total ? Math.round((done / total) * 100) : 0;
        elements.progressBar.style.width = `${percent}%`;
        elements.progressText.textContent = total ? `Đang chạy job ${Math.min(done + 1, total)} / ${total}` : "";
      }

      function setStats(outputs, failures) {
        const list = Array.isArray(outputs) ? outputs : [];
        elements.statOutputs.textContent = String(list.length);
        elements.statHtml.textContent = String(list.reduce((sum, output) => sum + (output.report ? output.report.stats.htmlChanged : 0), 0));
        elements.statFail.textContent = String(failures || 0);
      }

      // ---- generic helpers ----
      function getExtension(name) {
        const dotIndex = name.lastIndexOf(".");
        return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
      }

      function formatBytes(size) {
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
        return `${(size / (1024 * 1024)).toFixed(2)} MB`;
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function splitFileName(name) {
        const extension = getExtension(name);
        return {
          extension,
          base: extension ? name.slice(0, -extension.length) : name
        };
      }

      function sanitizeOutputName(name) {
        const sanitized = String(name || "")
          .replace(/[\\/:*?"<>|]/g, "_")
          .replace(/^\.+/, "")
          .trim();
        return sanitized || "output.zip";
      }

      // Keeps spaces (matches the reference naming); only drops characters illegal in file names.
      function slugifyAppName(name) {
        return String(name || "")
          .replace(/[\\/:*?"<>|]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      function buildOutputName(sourceName, template, variantIndex, appName) {
        const { base, extension } = splitFileName(sourceName);
        const trailingNumber = base.match(/^(.*?)(\d+)$/);
        const nextNumber = trailingNumber
          ? Number(trailingNumber[2]) + variantIndex + 1
          : variantIndex + 1;
        const appSlug = slugifyAppName(appName);

        let outputName = String(template || "").trim();
        if (outputName) {
          outputName = outputName
            .replace(/\{base\}/gi, base)
            .replace(/\{app\}/gi, appSlug)
            .replace(/\{index\}/gi, String(variantIndex + 1))
            .replace(/\{next\}/gi, String(nextNumber))
            .replace(/\{ext\}/gi, extension);
        } else if (appSlug) {
          outputName = `${base}_${appSlug}${extension}`;
        } else if (trailingNumber) {
          outputName = `${trailingNumber[1]}${nextNumber}${extension}`;
        } else {
          outputName = `${base}-${variantIndex + 1}${extension}`;
        }

        if (!getExtension(outputName) && extension) outputName += extension;
        return sanitizeOutputName(outputName);
      }

      function ensureUniqueOutputName(name, usedNames) {
        if (!usedNames.has(name.toLowerCase())) {
          usedNames.add(name.toLowerCase());
          return name;
        }

        const { base, extension } = splitFileName(name);
        let suffix = 2;
        let candidate = `${base}-${suffix}${extension}`;
        while (usedNames.has(candidate.toLowerCase())) {
          suffix += 1;
          candidate = `${base}-${suffix}${extension}`;
        }
        usedNames.add(candidate.toLowerCase());
        return candidate;
      }

      function getSelectedMode() {
        const selected = document.querySelector('input[name="mode"]:checked');
        return selected ? selected.value : "re-store";
      }

      // ---- store link parsing / cleaning ----
      function parsePlayId(text) {
        const value = String(text || "").trim();
        if (!value) return null;
        const fromQuery = value.match(/[?&]id=([A-Za-z0-9_.]+)/);
        if (fromQuery) return fromQuery[1];
        return /^[A-Za-z0-9_.]+$/.test(value) ? value : null;
      }

      function parseAppStore(text) {
        const value = String(text || "").trim();
        const idMatch = value.match(/id(\d{5,})/);
        if (!idMatch) return null;
        const countryMatch = value.match(/apps\.apple\.com\/([a-z]{2})\//i);
        return { id: idMatch[1], country: countryMatch ? countryMatch[1].toLowerCase() : "us" };
      }

      function cleanPlayUrl(text) {
        const value = String(text || "").trim();
        const id = parsePlayId(value);
        return id ? `https://play.google.com/store/apps/details?id=${id}` : value;
      }

      function cleanAppStoreUrl(text) {
        const value = String(text || "").trim();
        if (!parseAppStore(value)) return value;
        return value.split(/[?#]/)[0];
      }

      function classifyCell(cell) {
        if (/apps\.apple\.com|itunes\.apple\.com/i.test(cell)) return "ios";
        if (/play\.google\.com/i.test(cell) || /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(cell)) return "play";
        return null;
      }

      // Short, readable link chip. withLabel adds "Play" / "App Store" so two chips side by side stay distinguishable.
      function linkChip(kind, url, withLabel) {
        const value = String(url || "").trim();
        if (!value) return '<span class="dash">—</span>';
        const label = withLabel ? (kind === "play" ? "Play: " : "App Store: ") : "";
        if (kind === "play") {
          const id = parsePlayId(value);
          if (!id) return `<span class="chip-link bad" title="${escapeHtml(value)}">${label}link không hợp lệ</span>`;
          return `<a class="chip-link play" href="${escapeHtml(cleanPlayUrl(value))}" target="_blank" rel="noopener" title="${escapeHtml(value)}">${label}${escapeHtml(id)}</a>`;
        }
        const apple = parseAppStore(value);
        if (!apple) return `<span class="chip-link bad" title="${escapeHtml(value)}">${label}link không hợp lệ</span>`;
        return `<a class="chip-link ios" href="${escapeHtml(cleanAppStoreUrl(value))}" target="_blank" rel="noopener" title="${escapeHtml(value)}">${label}${escapeHtml(apple.country.toUpperCase())} · id${escapeHtml(apple.id)}</a>`;
      }

      // ---- step 3: variant cards ----
      function getRows() {
        return [...elements.variantList.querySelectorAll(".variant-card")];
      }

      function isRowBlank(row) {
        const values = readVariantRow(row);
        return !values.outputName && !values.androidUrl && !values.iosUrl && !values.splashName && !values.splashLogoDataUrl;
      }

      function sourceNameForPreview() {
        return state.sources.length ? state.sources[0].file.name : "playable.zip";
      }

      function refreshRowPreview(row) {
        const values = readVariantRow(row);
        const index = getRows().indexOf(row);
        row.querySelector("[data-role='title']").textContent = values.splashName || "(chưa có tên)";
        const name = buildOutputName(sourceNameForPreview(), values.outputName, Math.max(index, 0), values.splashName);
        const extra = state.sources.length > 1 ? ` (+${state.sources.length - 1} nguồn khác)` : "";
        row.querySelector("[data-role='out-preview']").innerHTML = `Output: <b>${escapeHtml(name)}</b>${escapeHtml(extra)}`;
      }

      function renderRowChips(row) {
        const values = readVariantRow(row);
        row.querySelector("[data-role='chips']").innerHTML = [
          values.androidUrl ? linkChip("play", values.androidUrl, true) : "",
          values.iosUrl ? linkChip("ios", values.iosUrl, true) : ""
        ].join("");
      }

      function updateVariantNumbers() {
        const rows = getRows();
        rows.forEach((row, index) => {
          const number = row.querySelector("[data-role='variant-number']");
          if (number) number.textContent = `#${index + 1}`;
          refreshRowPreview(row);
        });
        elements.variantCount.textContent = rows.length ? `(${rows.length})` : "";
        elements.variantEmpty.classList.toggle("hidden", rows.length > 0);
      }

      function setStepDone(element, done, number) {
        element.classList.toggle("done", done);
        element.textContent = done ? "✓" : number;
      }

      // Tells the user what to do next, based on the current state.
      function updateGuide() {
        const rows = getRows();
        const sources = state.sources.length;
        const variants = rows.length;
        setStepDone(elements.stepNo1, sources > 0, "1");
        setStepDone(elements.stepNo2, variants > 0, "2");
        setStepDone(elements.stepNo3, variants > 0, "3");

        elements.summary.textContent = sources
          ? `${sources} nguồn × ${variants} variant = ${sources * variants} output`
          : "Chưa chọn file nguồn.";

        let hint;
        if (state.busy) hint = "Đang xử lý, vui lòng chờ…";
        else if (state.outputBlob) hint = "Xong. Bấm “Tải tất cả” để tải file, hoặc “Tải” từng file ở cột Kết quả.";
        else if (!sources) hint = "Bước 1: chọn file nguồn (.zip hoặc .html).";
        else if (!variants) hint = "Bước 2: nhập link store rồi bấm “Thêm”.";
        else if (rows.some((row) => !readVariantRow(row).splashName && !row._iconDataUrl)) hint = "Có variant chưa có tên hoặc icon. Bấm “Chỉnh sửa” trên variant để bổ sung, hoặc bấm “Xử lý” nếu cố ý bỏ trống.";
        else hint = `Sẵn sàng. Bấm “Xử lý” để tạo ${sources * variants} output.`;
        elements.nextHint.textContent = hint;
      }

      function setButtonsEnabled() {
        const ready = state.sources.length > 0 && getRows().length > 0 && !state.busy;
        elements.processBtn.disabled = !ready;
      }

      function refreshAll() {
        updateVariantNumbers();
        updateGuide();
        setButtonsEnabled();
      }

      // Draws any image blob onto a 512x512 canvas (cover-fit) and returns a data URL (lossless webp, png fallback).
      async function normalizeIcon(blob) {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = ICON_SIZE;
        canvas.height = ICON_SIZE;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(ICON_SIZE / bitmap.width, ICON_SIZE / bitmap.height);
        const w = bitmap.width * scale;
        const h = bitmap.height * scale;
        ctx.drawImage(bitmap, (ICON_SIZE - w) / 2, (ICON_SIZE - h) / 2, w, h);
        bitmap.close();
        // quality 1.0 makes Chrome encode lossless WebP (matches the reference output)
        const webp = canvas.toDataURL("image/webp", 1.0);
        return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
      }

      function setRowIcon(row, dataUrl, source) {
        row._iconDataUrl = dataUrl || null;
        row._iconSource = dataUrl ? source : null;
        const preview = row.querySelector("[data-role='icon-preview']");
        const label = row.querySelector("[data-role='logo-name']");
        if (dataUrl) preview.src = dataUrl;
        else preview.removeAttribute("src");
        if (label) label.textContent = dataUrl ? `${source} · ${ICON_SIZE}×${ICON_SIZE}` : "Chưa có icon";
      }

      function setRowBadge(row, kind, text, detail) {
        const badge = row.querySelector("[data-role='badge']");
        badge.className = `badge${kind ? ` ${kind}` : ""}${text ? "" : " hidden"}`;
        badge.textContent = text || "";
        badge.title = detail || "";
        const status = row.querySelector("[data-role='fetch-status']");
        status.textContent = detail || "";
        status.className = `fetch-status${kind === "err" ? " err" : kind === "ok" ? " ok" : ""}`;
      }

      function readVariantRow(row) {
        return {
          outputName: row.querySelector("[data-field='outputName']").value.trim(),
          androidUrl: row.querySelector("[data-field='androidUrl']").value.trim(),
          iosUrl: row.querySelector("[data-field='iosUrl']").value.trim(),
          splashName: row.querySelector("[data-field='splashName']").value.trim(),
          splashLogoDataUrl: row._iconDataUrl || null,
          iconSource: row._iconSource || null,
          fetchedName: row._fetchedName || null
        };
      }

      function createVariantRow(initial = {}) {
        const row = document.createElement("div");
        row.className = "variant-card";
        row.innerHTML = `
          <div class="v-head">
            <img class="icon-preview" data-role="icon-preview" alt="" title="Bấm để đổi icon">
            <div class="v-main">
              <div class="v-title">
                <span class="v-num" data-role="variant-number"></span>
                <strong data-role="title"></strong>
                <span class="badge hidden" data-role="badge"></span>
              </div>
              <div class="v-out" data-role="out-preview"></div>
              <div class="v-chips" data-role="chips"></div>
            </div>
            <div class="v-actions">
              <button class="small" data-action="duplicate" type="button">Nhân bản</button>
              <button class="small danger" data-action="remove" type="button">Xoá</button>
            </div>
          </div>
          <details class="v-edit">
            <summary>Chỉnh sửa</summary>
            <div class="variant-grid">
              <div class="full">
                <label>Tên output (tuỳ chọn)</label>
                <input data-field="outputName" type="text" placeholder="Để trống = {nguồn}_{tên app}.zip">
              </div>
              <div>
                <label>Link Google Play</label>
                <input data-field="androidUrl" type="text" placeholder="https://play.google.com/store/apps/details?id=...">
              </div>
              <div>
                <label>Link App Store</label>
                <input data-field="iosUrl" type="text" placeholder="https://apps.apple.com/...">
              </div>
              <div>
                <label>Tên splash</label>
                <input data-field="splashName" type="text" placeholder="House Cleaning ASMR">
              </div>
              <div>
                <label>Icon splash (${ICON_SIZE}×${ICON_SIZE})</label>
                <input data-field="splashLogo" class="hidden" type="file" accept="image/*" aria-label="Chọn icon splash">
                <div class="actions">
                  <button class="small" data-action="pick-icon" type="button">Đổi icon</button>
                  <span class="file-name" data-role="logo-name">Chưa có icon</span>
                </div>
              </div>
              <div class="full">
                <div class="actions">
                  <button class="small" data-action="refetch" type="button">Lấy lại từ link</button>
                  <span class="fetch-status" data-role="fetch-status"></span>
                </div>
              </div>
            </div>
          </details>
        `;

        row.querySelector("[data-field='outputName']").value = initial.outputName || "";
        row.querySelector("[data-field='androidUrl']").value = initial.androidUrl || "";
        row.querySelector("[data-field='iosUrl']").value = initial.iosUrl || "";
        row.querySelector("[data-field='splashName']").value = initial.splashName || "";
        row._fetchedName = initial.fetchedName || null;
        setRowIcon(row, initial.splashLogoDataUrl || null, initial.iconSource || "thủ công");
        renderRowChips(row);

        for (const field of ["outputName", "splashName"]) {
          row.querySelector(`[data-field='${field}']`).addEventListener("input", () => {
            refreshRowPreview(row);
            updateGuide();
          });
        }
        for (const [field, cleaner] of [["androidUrl", cleanPlayUrl], ["iosUrl", cleanAppStoreUrl]]) {
          const input = row.querySelector(`[data-field='${field}']`);
          input.addEventListener("input", () => renderRowChips(row));
          input.addEventListener("blur", () => {
            input.value = cleaner(input.value);
            renderRowChips(row);
          });
        }

        const fileInput = row.querySelector("[data-field='splashLogo']");
        const pickIcon = () => fileInput.click();
        row.querySelector("[data-action='pick-icon']").addEventListener("click", pickIcon);
        row.querySelector("[data-role='icon-preview']").addEventListener("click", pickIcon);
        fileInput.addEventListener("change", (event) => {
          const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
          if (!file) return;
          setRowBadge(row, "loading", "Đang xử lý icon", "Đang xử lý icon…");
          row._iconPending = normalizeIcon(file)
            .then((dataUrl) => {
              setRowIcon(row, dataUrl, "file thủ công");
              setRowBadge(row, "manual", "Icon thủ công", "");
              updateGuide();
            })
            .catch((error) => setRowBadge(row, "err", "Icon lỗi", `Icon lỗi: ${error.message}`))
            .finally(() => { row._iconPending = null; });
        });

        row.querySelector("[data-action='refetch']").addEventListener("click", () => fetchIntoRow(row));

        row.querySelector("[data-action='duplicate']").addEventListener("click", () => {
          addVariantRow(readVariantRow(row), row);
        });

        row.querySelector("[data-action='remove']").addEventListener("click", () => {
          row.remove();
          refreshAll();
        });

        return row;
      }

      function addVariantRow(initial = {}, afterRow = null) {
        const row = createVariantRow(initial);
        if (afterRow && afterRow.parentNode === elements.variantList) {
          afterRow.insertAdjacentElement("afterend", row);
        } else {
          elements.variantList.appendChild(row);
        }
        refreshAll();
        return row;
      }

      function collectVariantDefinitions() {
        return getRows().map((row, index) => ({
          index,
          ...readVariantRow(row)
        }));
      }

      function validateVariantDefinitions(definitions) {
        if (!definitions.length) throw new Error("Cần ít nhất 1 variant.");
        for (const definition of definitions) {
          const hasChange = Boolean(
            definition.androidUrl ||
            definition.iosUrl ||
            definition.splashName ||
            definition.splashLogoDataUrl
          );
          if (!hasChange) {
            throw new Error(`Variant ${definition.index + 1} chưa có link, tên splash hoặc icon splash.`);
          }
        }
      }

      async function materializeVariantRequests(definitions, mode) {
        return definitions.map((definition) => ({
          index: definition.index,
          outputName: definition.outputName,
          splashLogoFileName: definition.iconSource || null,
          store: {
            iconSource: definition.iconSource || null,
            fetchedName: definition.fetchedName || null
          },
          request: {
            mode,
            androidUrl: cleanPlayUrl(definition.androidUrl) || null,
            iosUrl: cleanAppStoreUrl(definition.iosUrl) || null,
            splashName: definition.splashName || null,
            splashLogoDataUrl: definition.splashLogoDataUrl || null
          }
        }));
      }

      // ---- results ----
      function renderOutputList() {
        if (!state.outputs.length) {
          elements.outputList.innerHTML = '<div class="output-empty">Không có output thành công.</div>';
          return;
        }

        elements.outputList.innerHTML = "";
        for (const output of state.outputs) {
          const item = document.createElement("div");
          item.className = "output-item";
          item.innerHTML = `
            <div>
              <strong>${escapeHtml(output.name)}</strong>
              <div class="output-meta">Nguồn: ${escapeHtml(output.sourceName)} · Variant ${output.variantIndex + 1} · ${formatBytes(output.blob.size)}${output.report.changed ? "" : " · Cảnh báo: không có thay đổi"}</div>
            </div>
          `;
          const button = document.createElement("button");
          button.className = "small";
          button.type = "button";
          button.textContent = "Tải";
          button.addEventListener("click", () => downloadBlob(output.blob, output.name));
          item.appendChild(button);
          elements.outputList.appendChild(item);
        }
      }

      function updateFileMeta() {
        if (!state.sources.length) {
          elements.fileMeta.innerHTML = '<div class="meta">Chưa chọn file.</div>';
          return;
        }

        const totalBytes = state.sources.reduce((sum, source) => sum + source.file.size, 0);
        const dis = state.busy ? " disabled" : "";
        const lines = state.sources.map((source, index) => (
          `<div class="source-line"><span class="source-name">${escapeHtml(source.file.name)}</span><span class="source-size">${formatBytes(source.file.size)}</span><button class="small" type="button" data-remove-index="${index}"${dis} aria-label="Xoá ${escapeHtml(source.file.name)}">Xoá</button></div>`
        )).join("");

        elements.fileMeta.innerHTML = [
          `<div class="meta source-head"><span><strong>${state.sources.length}</strong> file · ${formatBytes(totalBytes)}</span><button class="small" type="button" data-clear-all="1"${dis}>Xoá tất cả</button></div>`,
          `<div class="source-list">${lines}</div>`
        ].join("");
      }

      function removeSource(index) {
        if (state.busy || !state.sources[index]) return;
        clearOutputState();
        state.sources.splice(index, 1);
        updateFileMeta();
        refreshAll();
      }

      function clearSources() {
        if (state.busy) return;
        clearOutputState();
        state.sources = [];
        updateFileMeta();
        refreshAll();
      }

      function clearOutputState() {
        state.outputs = [];
        state.outputBlob = null;
        state.reportBlob = null;
        state.batchReport = null;
        state.outputName = null;
        state.reportName = null;
        elements.downloadOutputBtn.disabled = true;
        elements.downloadReportBtn.disabled = true;
        elements.downloadOutputBtn.textContent = "Tải tất cả";
        elements.outputList.innerHTML = '<div class="output-empty">Chưa có output. Sau khi bấm Xử lý, file sẽ hiện ở đây.</div>';
        setStats([], 0);
        setProgress(0, 0);
        showMsg("");
      }


      function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }

      function normalizeMode(mode) {
        const normalized = String(mode || "").trim().toLowerCase().replace(/_/g, "-");
        if (normalized === "add") return "add";
        if (normalized === "restore" || normalized === "re-store" || normalized === "replace") return "restore";
        throw new Error(`Unsupported mode: ${mode}`);
      }

      function escapeQuotedValue(value, quote = '"') {
        const quotePattern = quote === "'" ? /'/g : /"/g;
        return String(value)
          .replace(/\\/g, "\\\\")
          .replace(/\r/g, "\\r")
          .replace(/\n/g, "\\n")
          .replace(/\u2028/g, "\\u2028")
          .replace(/\u2029/g, "\\u2029")
          .replace(quotePattern, (matchedQuote) => `\\${matchedQuote}`);
      }

      function escapeHtmlText(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function escapeHtmlAttributeValue(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }

      function createOutcome(key, status, changed, previousValue, nextValue, extra) {
        return Object.assign({ key, status, changed, previousValue, nextValue }, extra || {});
      }

      function notRequestedOutcome(key) {
        return createOutcome(key, "not_requested", false, null, null);
      }

      function missingTargetOutcome(key, requestedValue, extra) {
        return createOutcome(key, "target_not_found", false, null, requestedValue, extra || {});
      }

      function summarizeOutcomeValue(key, value) {
        if (typeof value !== "string" || key !== "splashLogo") return value;
        if (value.length <= 96) return value;
        return `${value.slice(0, 72)}... [${value.length} chars]`;
      }

      function toReportOutcome(outcome) {
        if (!outcome) return outcome;
        return {
          ...outcome,
          previousValue: summarizeOutcomeValue(outcome.key, outcome.previousValue),
          nextValue: summarizeOutcomeValue(outcome.key, outcome.nextValue)
        };
      }

      function createCallbackEntry(outcome) {
        return {
          key: outcome.key,
          message: `${outcome.key} already exists`,
          value: summarizeOutcomeValue(outcome.key, outcome.previousValue),
          target: outcome.target || null
        };
      }

      function hasRequestedChanges(request) {
        return Boolean(
          request.androidUrl ||
          request.iosUrl ||
          request.splashName ||
          request.splashLogoDataUrl
        );
      }

      function rotateLeft(value, shift) {
        return (value << shift) | (value >>> (32 - shift));
      }

      function addUnsigned(x, y) {
        const x4 = x & 0x40000000;
        const y4 = y & 0x40000000;
        const x8 = x & 0x80000000;
        const y8 = y & 0x80000000;
        const result = (x & 0x3fffffff) + (y & 0x3fffffff);
        if (x4 & y4) return result ^ 0x80000000 ^ x8 ^ y8;
        if (x4 | y4) {
          if (result & 0x40000000) return result ^ 0xc0000000 ^ x8 ^ y8;
          return result ^ 0x40000000 ^ x8 ^ y8;
        }
        return result ^ x8 ^ y8;
      }

      function md5F(x, y, z) { return (x & y) | ((~x) & z); }
      function md5G(x, y, z) { return (x & z) | (y & (~z)); }
      function md5H(x, y, z) { return x ^ y ^ z; }
      function md5I(x, y, z) { return y ^ (x | (~z)); }

      function md5Transform(func, a, b, c, d, x, s, ac) {
        a = addUnsigned(a, addUnsigned(addUnsigned(func(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b);
      }

      function utf8Encode(value) {
        return unescape(encodeURIComponent(value));
      }

      function convertToWordArray(value) {
        const length = value.length;
        const wordCountTemp1 = length + 8;
        const wordCountTemp2 = (wordCountTemp1 - (wordCountTemp1 % 64)) / 64;
        const wordCount = (wordCountTemp2 + 1) * 16;
        const words = new Array(wordCount - 1);
        let bytePosition = 0;
        let byteCount = 0;

        while (byteCount < length) {
          const wordIndex = (byteCount - (byteCount % 4)) / 4;
          bytePosition = (byteCount % 4) * 8;
          words[wordIndex] = words[wordIndex] | (value.charCodeAt(byteCount) << bytePosition);
          byteCount += 1;
        }

        const wordIndex = (byteCount - (byteCount % 4)) / 4;
        bytePosition = (byteCount % 4) * 8;
        words[wordIndex] = words[wordIndex] | (0x80 << bytePosition);
        words[wordCount - 2] = length << 3;
        words[wordCount - 1] = length >>> 29;
        return words;
      }

      function wordToHex(value) {
        let result = "";
        for (let count = 0; count <= 3; count += 1) {
          const byte = (value >>> (count * 8)) & 255;
          const hex = `0${byte.toString(16)}`;
          result += hex.slice(-2);
        }
        return result;
      }

      function md5(value) {
        const x = convertToWordArray(utf8Encode(value));
        let a = 0x67452301;
        let b = 0xefcdab89;
        let c = 0x98badcfe;
        let d = 0x10325476;

        for (let k = 0; k < x.length; k += 16) {
          const aa = a;
          const bb = b;
          const cc = c;
          const dd = d;

          a = md5Transform(md5F, a, b, c, d, x[k + 0], 7, 0xd76aa478);
          d = md5Transform(md5F, d, a, b, c, x[k + 1], 12, 0xe8c7b756);
          c = md5Transform(md5F, c, d, a, b, x[k + 2], 17, 0x242070db);
          b = md5Transform(md5F, b, c, d, a, x[k + 3], 22, 0xc1bdceee);
          a = md5Transform(md5F, a, b, c, d, x[k + 4], 7, 0xf57c0faf);
          d = md5Transform(md5F, d, a, b, c, x[k + 5], 12, 0x4787c62a);
          c = md5Transform(md5F, c, d, a, b, x[k + 6], 17, 0xa8304613);
          b = md5Transform(md5F, b, c, d, a, x[k + 7], 22, 0xfd469501);
          a = md5Transform(md5F, a, b, c, d, x[k + 8], 7, 0x698098d8);
          d = md5Transform(md5F, d, a, b, c, x[k + 9], 12, 0x8b44f7af);
          c = md5Transform(md5F, c, d, a, b, x[k + 10], 17, 0xffff5bb1);
          b = md5Transform(md5F, b, c, d, a, x[k + 11], 22, 0x895cd7be);
          a = md5Transform(md5F, a, b, c, d, x[k + 12], 7, 0x6b901122);
          d = md5Transform(md5F, d, a, b, c, x[k + 13], 12, 0xfd987193);
          c = md5Transform(md5F, c, d, a, b, x[k + 14], 17, 0xa679438e);
          b = md5Transform(md5F, b, c, d, a, x[k + 15], 22, 0x49b40821);

          a = md5Transform(md5G, a, b, c, d, x[k + 1], 5, 0xf61e2562);
          d = md5Transform(md5G, d, a, b, c, x[k + 6], 9, 0xc040b340);
          c = md5Transform(md5G, c, d, a, b, x[k + 11], 14, 0x265e5a51);
          b = md5Transform(md5G, b, c, d, a, x[k + 0], 20, 0xe9b6c7aa);
          a = md5Transform(md5G, a, b, c, d, x[k + 5], 5, 0xd62f105d);
          d = md5Transform(md5G, d, a, b, c, x[k + 10], 9, 0x02441453);
          c = md5Transform(md5G, c, d, a, b, x[k + 15], 14, 0xd8a1e681);
          b = md5Transform(md5G, b, c, d, a, x[k + 4], 20, 0xe7d3fbc8);
          a = md5Transform(md5G, a, b, c, d, x[k + 9], 5, 0x21e1cde6);
          d = md5Transform(md5G, d, a, b, c, x[k + 14], 9, 0xc33707d6);
          c = md5Transform(md5G, c, d, a, b, x[k + 3], 14, 0xf4d50d87);
          b = md5Transform(md5G, b, c, d, a, x[k + 8], 20, 0x455a14ed);
          a = md5Transform(md5G, a, b, c, d, x[k + 13], 5, 0xa9e3e905);
          d = md5Transform(md5G, d, a, b, c, x[k + 2], 9, 0xfcefa3f8);
          c = md5Transform(md5G, c, d, a, b, x[k + 7], 14, 0x676f02d9);
          b = md5Transform(md5G, b, c, d, a, x[k + 12], 20, 0x8d2a4c8a);

          a = md5Transform(md5H, a, b, c, d, x[k + 5], 4, 0xfffa3942);
          d = md5Transform(md5H, d, a, b, c, x[k + 8], 11, 0x8771f681);
          c = md5Transform(md5H, c, d, a, b, x[k + 11], 16, 0x6d9d6122);
          b = md5Transform(md5H, b, c, d, a, x[k + 14], 23, 0xfde5380c);
          a = md5Transform(md5H, a, b, c, d, x[k + 1], 4, 0xa4beea44);
          d = md5Transform(md5H, d, a, b, c, x[k + 4], 11, 0x4bdecfa9);
          c = md5Transform(md5H, c, d, a, b, x[k + 7], 16, 0xf6bb4b60);
          b = md5Transform(md5H, b, c, d, a, x[k + 10], 23, 0xbebfbc70);
          a = md5Transform(md5H, a, b, c, d, x[k + 13], 4, 0x289b7ec6);
          d = md5Transform(md5H, d, a, b, c, x[k + 0], 11, 0xeaa127fa);
          c = md5Transform(md5H, c, d, a, b, x[k + 3], 16, 0xd4ef3085);
          b = md5Transform(md5H, b, c, d, a, x[k + 6], 23, 0x04881d05);
          a = md5Transform(md5H, a, b, c, d, x[k + 9], 4, 0xd9d4d039);
          d = md5Transform(md5H, d, a, b, c, x[k + 12], 11, 0xe6db99e5);
          c = md5Transform(md5H, c, d, a, b, x[k + 15], 16, 0x1fa27cf8);
          b = md5Transform(md5H, b, c, d, a, x[k + 2], 23, 0xc4ac5665);

          a = md5Transform(md5I, a, b, c, d, x[k + 0], 6, 0xf4292244);
          d = md5Transform(md5I, d, a, b, c, x[k + 7], 10, 0x432aff97);
          c = md5Transform(md5I, c, d, a, b, x[k + 14], 15, 0xab9423a7);
          b = md5Transform(md5I, b, c, d, a, x[k + 5], 21, 0xfc93a039);
          a = md5Transform(md5I, a, b, c, d, x[k + 12], 6, 0x655b59c3);
          d = md5Transform(md5I, d, a, b, c, x[k + 3], 10, 0x8f0ccc92);
          c = md5Transform(md5I, c, d, a, b, x[k + 10], 15, 0xffeff47d);
          b = md5Transform(md5I, b, c, d, a, x[k + 1], 21, 0x85845dd1);
          a = md5Transform(md5I, a, b, c, d, x[k + 8], 6, 0x6fa87e4f);
          d = md5Transform(md5I, d, a, b, c, x[k + 15], 10, 0xfe2ce6e0);
          c = md5Transform(md5I, c, d, a, b, x[k + 6], 15, 0xa3014314);
          b = md5Transform(md5I, b, c, d, a, x[k + 13], 21, 0x4e0811a1);
          a = md5Transform(md5I, a, b, c, d, x[k + 4], 6, 0xf7537e82);
          d = md5Transform(md5I, d, a, b, c, x[k + 11], 10, 0xbd3af235);
          c = md5Transform(md5I, c, d, a, b, x[k + 2], 15, 0x2ad7d2bb);
          b = md5Transform(md5I, b, c, d, a, x[k + 9], 21, 0xeb86d391);

          a = addUnsigned(a, aa);
          b = addUnsigned(b, bb);
          c = addUnsigned(c, cc);
          d = addUnsigned(d, dd);
        }

        return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
      }

      function toBase64(value) {
        const encoded = new TextEncoder().encode(value);
        let binary = "";
        for (let index = 0; index < encoded.length; index += 1) binary += String.fromCharCode(encoded[index]);
        return btoa(binary);
      }

      function applovinLinkHash(link) {
        return md5(toBase64(link) + md5(link));
      }

      function applovinIconHash(dataUrl) {
        return md5(dataUrl);
      }

      function detectNetwork(content) {
        const targetPlatformMatch = content.match(/targetPlatform\s*:\s*["']([^"']+)["']/i);
        if (targetPlatformMatch) return targetPlatformMatch[1].toLowerCase();
        if (/googlesyndication|ExitApi\.exit/i.test(content)) return "google";
        if (/mintegral|MW_INIT/i.test(content)) return "mintegral";
        if (/applovin|mraid\.open/i.test(content)) return "applovin";
        return "unknown";
      }

      function findMatchingBrace(content, openIndex) {
        let depth = 0;
        let quote = null;
        let escaped = false;
        let lineComment = false;
        let blockComment = false;

        for (let index = openIndex; index < content.length; index += 1) {
          const character = content[index];
          const nextCharacter = content[index + 1];

          if (lineComment) {
            if (character === "\n" || character === "\r") lineComment = false;
            continue;
          }
          if (blockComment) {
            if (character === "*" && nextCharacter === "/") {
              blockComment = false;
              index += 1;
            }
            continue;
          }
          if (quote) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === quote) quote = null;
            continue;
          }
          if (character === "/" && nextCharacter === "/") {
            lineComment = true;
            index += 1;
            continue;
          }
          if (character === "/" && nextCharacter === "*") {
            blockComment = true;
            index += 1;
            continue;
          }
          if (character === '"' || character === "'" || character === "`") {
            quote = character;
            continue;
          }
          if (character === "{") depth += 1;
          else if (character === "}") {
            depth -= 1;
            if (depth === 0) return index;
          }
        }
        return -1;
      }

      function getPackageConfigMatch(content) {
        const candidatePattern = /packageConfig\s*:\s*(Object\.assign\s*\(\s*)?\{/gi;
        let candidate = null;

        while ((candidate = candidatePattern.exec(content))) {
          const openIndex = candidate.index + candidate[0].lastIndexOf("{");
          const closeIndex = findMatchingBrace(content, openIndex);
          if (closeIndex < 0) continue;

          let suffixEnd = closeIndex + 1;
          if (candidate[1]) {
            const objectAssignSuffix = content.slice(closeIndex).match(
              /^\}\s*,\s*window\.LUNA_PLAYGROUND_PACKAGE_CONFIG\s*\|\|\s*\{\}\s*\)/i
            );
            if (!objectAssignSuffix) continue;
            suffixEnd = closeIndex + objectAssignSuffix[0].length;
          }

          return {
            fullMatch: content.slice(candidate.index, suffixEnd),
            prefix: content.slice(candidate.index, openIndex + 1),
            body: content.slice(openIndex + 1, closeIndex),
            suffix: content.slice(closeIndex, suffixEnd)
          };
        }
        return null;
      }

      function findProperty(body, key) {
        const regex = new RegExp(
          `((["'])${escapeRegExp(key)}\\2|${escapeRegExp(key)})\\s*:\\s*(?:"((?:\\\\[\\s\\S]|[^"\\\\])*)"|'((?:\\\\[\\s\\S]|[^'\\\\])*)')`,
          "i"
        );
        const match = body.match(regex);
        if (!match) return null;
        return {
          match: match[0],
          index: match.index,
          keyToken: match[1],
          valueQuote: match[3] !== undefined ? '"' : "'",
          value: match[3] !== undefined ? match[3] : match[4]
        };
      }

      function replacePropertyValue(body, key, nextValue) {
        const found = findProperty(body, key);
        if (!found) {
          return { body, changed: false, previousValue: null };
        }
        const safeValue = escapeQuotedValue(nextValue, found.valueQuote);
        const replacement = `${found.keyToken}:${found.valueQuote}${safeValue}${found.valueQuote}`;
        const nextBody = body.slice(0, found.index) + replacement + body.slice(found.index + found.match.length);
        return { body: nextBody, changed: nextBody !== body, previousValue: found.value };
      }

      function insertProperty(body, key, value) {
        const safeValue = escapeQuotedValue(value, '"');
        const property = `"${key}":"${safeValue}",`;
        const applicationNameRegex = /((["'])applicationName\2\s*:\s*(["'])[\s\S]*?\3\s*,?)/i;
        if (applicationNameRegex.test(body)) {
          return {
            body: body.replace(applicationNameRegex, (full) => (
              full.trimEnd().endsWith(",") ? `${full}${property}` : `${full},${property}`
            )),
            inserted: true
          };
        }
        return { body: `${property}${body}`, inserted: true };
      }

      function upsertStoreLink(body, key, requestedValue, mode) {
        if (!requestedValue) {
          return {
            body,
            outcome: notRequestedOutcome(key)
          };
        }

        const found = findProperty(body, key);
        const existingValue = found ? found.value : null;
        const hasExistingValue = typeof existingValue === "string" && existingValue.trim() !== "";

        if (mode === "add") {
          if (hasExistingValue) {
            return {
              body,
              outcome: createOutcome(key, "already_exists", false, existingValue, existingValue)
            };
          }
          if (found) {
            const replaced = replacePropertyValue(body, key, requestedValue);
            return {
              body: replaced.body,
              outcome: createOutcome(key, "added", replaced.changed, existingValue, requestedValue)
            };
          }
          const inserted = insertProperty(body, key, requestedValue);
          return {
            body: inserted.body,
            outcome: createOutcome(key, "added", true, null, requestedValue)
          };
        }

        if (found) {
          const replaced = replacePropertyValue(body, key, requestedValue);
          return {
            body: replaced.body,
            outcome: createOutcome(
              key,
              existingValue === requestedValue ? "already_same" : hasExistingValue ? "replaced" : "added",
              replaced.body !== body,
              existingValue,
              requestedValue
            )
          };
        }

        const inserted = insertProperty(body, key, requestedValue);
        return {
          body: inserted.body,
          outcome: createOutcome(key, "added", true, null, requestedValue)
        };
      }

      function createSplashWordmarkSvg(label) {
        const safeLabel = String(label || "").trim();
        const safeText = escapeHtmlText(safeLabel);
        const safeAttr = escapeHtmlAttributeValue(safeLabel);
        const width = Math.max(180, Math.ceil(safeLabel.length * 14 + 32));
        const height = 35.15625;
        const fontSize = 26;

        return [
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeAttr}">`,
          `<text x="50%" y="50%" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${safeText}</text>`,
          "</svg>"
        ].join("");
      }

      function replaceSplashNameContent(content, requestedValue, mode) {
        if (!requestedValue) {
          return { content, outcome: notRequestedOutcome("splashName") };
        }

        const wordmarkPattern = /(<([a-z0-9:-]+)\b[^>]*\bclass=(["'])[^"']*\bpreloader__luna__logo\b[^"']*\3[^>]*>)([\s\S]*?)(<\/\2>)/gi;
        const wordmarkSvg = createSplashWordmarkSvg(requestedValue);
        let matchedCount = 0;
        let changedCount = 0;
        let existingCount = 0;
        let firstPreviousValue = null;

        const nextContent = content.replace(wordmarkPattern, (fullMatch, prefix, tagName, quote, innerMarkup, suffix) => {
          matchedCount += 1;
          if (firstPreviousValue === null) firstPreviousValue = innerMarkup;

          const hasExistingValue = innerMarkup.trim() !== "";
          if (hasExistingValue) existingCount += 1;
          if (mode === "add" && hasExistingValue) return fullMatch;
          if (innerMarkup === wordmarkSvg) return fullMatch;

          changedCount += 1;
          return `${prefix}${wordmarkSvg}${suffix}`;
        });

        if (!matchedCount) {
          return {
            content,
            outcome: missingTargetOutcome("splashName", requestedValue, { target: "preloader_name_targets" })
          };
        }

        let status = "already_same";
        if (mode === "add") {
          if (!changedCount && existingCount) {
            status = "already_exists";
          } else if (changedCount) {
            status = "added";
          }
        } else if (changedCount) {
          status = existingCount ? "replaced" : "added";
        }

        return {
          content: nextContent,
          outcome: createOutcome("splashName", status, nextContent !== content, firstPreviousValue, requestedValue, {
            target: "preloader_name_targets",
            matchCount: matchedCount
          })
        };
      }

      function findSplashLogoTag(content) {
        const selectors = [
          { pattern: /<img\b[^>]*\bid=(["'])asset\/preloader\/icon\1[^>]*>/i, target: "#asset/preloader/icon" },
          { pattern: /<img\b[^>]*\bclass=(["'])[^"']*\bpreloader__icon\b[^"']*\1[^>]*>/i, target: ".preloader__icon" }
        ];

        let tagMatch = null;
        let target = null;
        for (const selector of selectors) {
          const match = content.match(selector.pattern);
          if (match) {
            tagMatch = match;
            target = selector.target;
            break;
          }
        }

        if (!tagMatch) return null;

        const originalTag = tagMatch[0];
        const srcMatch = originalTag.match(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i);
        return {
          tagMatch,
          target,
          originalTag,
          srcMatch,
          source: srcMatch ? srcMatch[2] : null
        };
      }

      function getSplashLogoSource(content) {
        return findSplashLogoTag(content)?.source || null;
      }

      function replaceSplashLogoSource(content, requestedValue, mode) {
        if (!requestedValue) {
          return { content, outcome: notRequestedOutcome("splashLogo") };
        }

        const logoTag = findSplashLogoTag(content);

        if (!logoTag) {
          return { content, outcome: missingTargetOutcome("splashLogo", requestedValue) };
        }

        const { tagMatch, target, originalTag, srcMatch } = logoTag;
        const previousValue = logoTag.source;
        const hasExistingValue = typeof previousValue === "string" && previousValue.trim() !== "";
        if (mode === "add" && hasExistingValue) {
          return {
            content,
            outcome: createOutcome("splashLogo", "already_exists", false, previousValue, previousValue, { target })
          };
        }

        const safeValue = escapeHtmlAttributeValue(requestedValue);
        let nextTag = originalTag;
        if (srcMatch) {
          nextTag = originalTag.replace(srcMatch[0], `src=${srcMatch[1]}${safeValue}${srcMatch[1]}`);
        } else {
          nextTag = originalTag.replace(/\/?>$/, (ending) => ` src="${safeValue}"${ending}`);
        }

        const nextContent = content.slice(0, tagMatch.index) + nextTag + content.slice(tagMatch.index + originalTag.length);
        return {
          content: nextContent,
          outcome: createOutcome(
            "splashLogo",
            !hasExistingValue ? "added" : previousValue === requestedValue ? "already_same" : "replaced",
            nextContent !== content,
            previousValue,
            requestedValue,
            { target }
          )
        };
      }

      function createApplovinHashTarget(key, value, outcome) {
        if (typeof value !== "string" || value.trim() === "") {
          return null;
        }

        const previousValue = outcome && typeof outcome.previousValue === "string" && outcome.previousValue.trim() !== ""
          ? outcome.previousValue
          : value;

        return {
          key,
          previousValue,
          nextValue: value
        };
      }

      function getApplovinHashForTarget(target) {
        if (!target || !target.nextValue) return null;
        return target.key === "splashLogo"
          ? applovinIconHash(target.nextValue)
          : applovinLinkHash(target.nextValue);
      }

      function getApplovinPreviousHashForTarget(target) {
        if (!target || typeof target.previousValue !== "string" || target.previousValue === "") return null;
        return target.key === "splashLogo"
          ? applovinIconHash(target.previousValue)
          : applovinLinkHash(target.previousValue);
      }

      function getQuotedHashCandidates(content) {
        const candidates = [];
        const pattern = /(["'])([0-9a-f]{32})\1/gi;
        let match = null;
        while ((match = pattern.exec(content))) {
          candidates.push({
            index: match.index,
            match: match[0],
            quote: match[1],
            value: match[2].toLowerCase()
          });
        }
        return candidates;
      }

      function hasQuotedHash(content, hash) {
        if (!hash) return false;
        return new RegExp(`(["'])${escapeRegExp(hash)}\\1`, "i").test(content);
      }

      function replaceQuotedHash(content, previousHash, nextHash) {
        if (!previousHash || !nextHash || previousHash.toLowerCase() === nextHash.toLowerCase()) return content;
        const pattern = new RegExp(`(["'])${escapeRegExp(previousHash)}\\1`, "gi");
        return content.replace(pattern, (fullMatch, quote) => `${quote}${nextHash}${quote}`);
      }

      function replaceReadableHashGuard(content, target, nextHash) {
        for (const candidate of getQuotedHashCandidates(content)) {
          const before = content.slice(Math.max(0, candidate.index - 800), candidate.index);
          const after = content.slice(candidate.index + candidate.match.length, candidate.index + candidate.match.length + 300);
          if (!/(?:!==|!=)\s*$/.test(before) || !/\breload\b/i.test(after)) continue;

          let matchesTarget = false;
          if (target.key === "splashLogo") {
            matchesTarget =
              /(?:\.preloader__icon|asset\/preloader\/icon)/i.test(before) &&
              /\.src[\s\S]{0,200}?(?:!==|!=)\s*$/i.test(before);
          } else {
            const keyMatches = before.match(new RegExp(escapeRegExp(target.key), "gi")) || [];
            matchesTarget = keyMatches.length >= 2 && /(?:md5|btoa)/i.test(before);
          }

          if (matchesTarget) {
            return (
              content.slice(0, candidate.index) +
              `${candidate.quote}${nextHash}${candidate.quote}` +
              content.slice(candidate.index + candidate.match.length)
            );
          }
        }
        return content;
      }

      function synchronizeApplovinHashes(content, targets) {
        const activeTargets = targets.filter((target) => target && target.nextValue);
        let nextContent = content;
        for (const target of activeTargets) {
          const newHash = getApplovinHashForTarget(target);
          const oldHash = getApplovinPreviousHashForTarget(target);
          nextContent = replaceQuotedHash(nextContent, oldHash, newHash);
        }
        for (const target of activeTargets) {
          const newHash = getApplovinHashForTarget(target);
          if (!hasQuotedHash(nextContent, newHash)) {
            nextContent = replaceReadableHashGuard(nextContent, target, newHash);
          }
        }

        const expectedHashes = [...new Set(activeTargets.map(getApplovinHashForTarget))];
        const unresolvedTargets = activeTargets.filter(
          (target) => !hasQuotedHash(nextContent, getApplovinHashForTarget(target))
        );
        const candidateHashes = [...new Set(getQuotedHashCandidates(nextContent).map((candidate) => candidate.value))];
        const unassignedHashes = candidateHashes.filter((hash) => !expectedHashes.includes(hash));

        if (
          unresolvedTargets.length === 1 &&
          unassignedHashes.length === 1 &&
          candidateHashes.length === expectedHashes.length
        ) {
          nextContent = replaceQuotedHash(
            nextContent,
            unassignedHashes[0],
            getApplovinHashForTarget(unresolvedTargets[0])
          );
        }
        return nextContent;
      }

      function createAggregateReport(inputName, mode, androidUrl, iosUrl, splashName, splashLogoDataUrl) {
        return {
          inputName,
          mode,
          requested: {
            androidUrl: androidUrl || null,
            iosUrl: iosUrl || null,
            splashName: splashName || null,
            splashLogoProvided: Boolean(splashLogoDataUrl)
          },
          changed: false,
          stats: { htmlVisited: 0, htmlChanged: 0, zipVisited: 0, zipChanged: 0 },
          callbacks: [],
          files: []
        };
      }

      function processHtmlContent(content, request, locationLabel) {
        const match = getPackageConfigMatch(content);
        const network = detectNetwork(content);
        const report = {
          type: "html",
          location: locationLabel,
          network,
          changed: false,
          callbacks: [],
          outcomes: { android: null, ios: null, applicationName: null, splashName: null, splashLogo: null },
          warnings: []
        };

        let nextContent = content;
        let currentPackageConfigBody = match ? match.body : null;
        let androidOutcome = request.androidUrl ? missingTargetOutcome("androidLink", request.androidUrl) : notRequestedOutcome("androidLink");
        let iosOutcome = request.iosUrl ? missingTargetOutcome("iosLink", request.iosUrl) : notRequestedOutcome("iosLink");
        let applicationNameOutcome = notRequestedOutcome("applicationName");

        if (match) {
          let nextBody = match.body;
          const androidUpdate = upsertStoreLink(nextBody, "androidLink", request.androidUrl, request.mode);
          nextBody = androidUpdate.body;
          const iosUpdate = upsertStoreLink(nextBody, "iosLink", request.iosUrl, request.mode);
          nextBody = iosUpdate.body;

          androidOutcome = androidUpdate.outcome;
          iosOutcome = iosUpdate.outcome;
          currentPackageConfigBody = nextBody;
          nextContent = content.replace(match.fullMatch, `${match.prefix}${nextBody}${match.suffix}`);
        } else if (request.androidUrl || request.iosUrl) {
          report.warnings.push("packageConfig_not_found");
        }

        const splashNameUpdate = replaceSplashNameContent(nextContent, request.splashName, request.mode);
        nextContent = splashNameUpdate.content;

        const splashLogoUpdate = replaceSplashLogoSource(nextContent, request.splashLogoDataUrl, request.mode);
        nextContent = splashLogoUpdate.content;

        for (const outcome of [androidOutcome, iosOutcome, applicationNameOutcome, splashNameUpdate.outcome, splashLogoUpdate.outcome]) {
          if (outcome.status === "already_exists") {
            report.callbacks.push(createCallbackEntry(outcome));
          }
        }

        if (network === "applovin") {
          const currentAndroidValue = currentPackageConfigBody ? findProperty(currentPackageConfigBody, "androidLink")?.value || null : null;
          const currentIosValue = currentPackageConfigBody ? findProperty(currentPackageConfigBody, "iosLink")?.value || null : null;
          const currentSplashLogoValue = getSplashLogoSource(nextContent);
          nextContent = synchronizeApplovinHashes(nextContent, [
            createApplovinHashTarget("androidLink", currentAndroidValue, androidOutcome),
            createApplovinHashTarget("iosLink", currentIosValue, iosOutcome),
            createApplovinHashTarget("splashLogo", currentSplashLogoValue, splashLogoUpdate.outcome)
          ]);
        }

        report.outcomes.android = toReportOutcome(androidOutcome);
        report.outcomes.ios = toReportOutcome(iosOutcome);
        report.outcomes.applicationName = toReportOutcome(applicationNameOutcome);
        report.outcomes.splashName = toReportOutcome(splashNameUpdate.outcome);
        report.outcomes.splashLogo = toReportOutcome(splashLogoUpdate.outcome);
        report.changed = nextContent !== content;
        return { content: nextContent, report };
      }

      async function processZipArrayBuffer(arrayBuffer, request, aggregate, locationLabel) {
        aggregate.stats.zipVisited += 1;
        const zip = await window.JSZip.loadAsync(arrayBuffer);
        let zipChanged = false;
        const fileNames = Object.keys(zip.files);

        for (const entryName of fileNames) {
          const entry = zip.files[entryName];
          if (entry.dir) continue;

          const childLabel = `${locationLabel}::${entryName}`;
          const extension = getExtension(entryName);

          if (extension === ".html" || extension === ".htm") {
            const originalContent = await entry.async("string");
            const processed = processHtmlContent(originalContent, request, childLabel);
            aggregate.stats.htmlVisited += 1;
            aggregate.files.push(processed.report);
            aggregate.callbacks.push(...processed.report.callbacks.map((callback) => ({ ...callback, location: childLabel })));

            if (processed.report.changed) {
              zip.file(entryName, processed.content);
              aggregate.stats.htmlChanged += 1;
              zipChanged = true;
            }
            continue;
          }

          if (extension === ".zip") {
            const nestedArrayBuffer = await entry.async("arraybuffer");
            const nestedProcessed = await processZipArrayBuffer(nestedArrayBuffer, request, aggregate, childLabel);
            if (nestedProcessed.changed) {
              zip.file(entryName, nestedProcessed.uint8array, { binary: true });
              zipChanged = true;
            }
          }
        }

        if (zipChanged) aggregate.stats.zipChanged += 1;

        return {
          changed: zipChanged,
          uint8array: zipChanged
            ? await zip.generateAsync({
              type: "uint8array",
              compression: "DEFLATE",
              compressionOptions: { level: 6 }
            })
            : new Uint8Array(arrayBuffer)
        };
      }

      // ---- Network rename (ported from RenameTool.html) ----
      function addPrefixIfNeeded(fileName, prefix) {
        if (!prefix) return fileName;
        if (fileName.toLowerCase().startsWith(`${prefix}_`.toLowerCase())) return fileName;
        return `${prefix}_${fileName}`;
      }

      function renameInnerBase(fileName, sourceBase, outputBase) {
        if (!sourceBase || !outputBase || sourceBase === outputBase) return fileName;
        return fileName.split(sourceBase).join(outputBase);
      }

      // Joins path segments, dropping empty ones (avoids "GoogleAds//file" when a file sits at an inner zip's root).
      function joinPath(...parts) {
        return parts.filter(Boolean).join("/");
      }

      async function applyNetworkRename(arrayBuffer, options) {
        const { innerRename, sourceBase, outputBase } = options;
        const loaded = await window.JSZip.loadAsync(arrayBuffer);
        const result = new window.JSZip();
        const nameFor = (fileName) => (innerRename ? renameInnerBase(fileName, sourceBase, outputBase) : fileName);

        for (const [relativePath, entry] of Object.entries(loaded.files)) {
          if (entry.dir) {
            result.folder(relativePath);
            continue;
          }

          const parts = relativePath.split("/");
          const fileName = parts.pop();
          const folderPath = parts.join("/");
          const parentFolder = parts.length ? parts[parts.length - 1] : "";
          const prefix = parentFolder ? NETWORK_RULES[parentFolder.toLowerCase()] : null;

          if (prefix === "GGA" && fileName.toLowerCase().endsWith(".zip")) {
            const inner = await window.JSZip.loadAsync(await entry.async("arraybuffer"));
            for (const [innerPath, innerEntry] of Object.entries(inner.files)) {
              if (innerEntry.dir) {
                result.folder(joinPath(folderPath, innerPath));
                continue;
              }
              const innerParts = innerPath.split("/");
              const innerName = innerParts.pop();
              const newInnerName = addPrefixIfNeeded(nameFor(innerName), prefix);
              const target = joinPath(folderPath, innerParts.join("/"), newInnerName);
              result.file(target, await innerEntry.async("arraybuffer"), { binary: true });
            }
            log(`Network rename: bung ${relativePath}`);
            continue;
          }

          const newName = addPrefixIfNeeded(nameFor(fileName), prefix);
          if (newName !== fileName) log(`Network rename: ${relativePath} -> ${newName}`);
          result.file(joinPath(folderPath, newName), await entry.async("arraybuffer"), { binary: true });
        }

        return result.generateAsync({
          type: "uint8array",
          compression: "DEFLATE",
          compressionOptions: { level: 6 }
        });
      }

      // ---- Store fetch (direct; host_permissions in manifest.json lift CORS) ----
      const IMAGE_HOSTS = [".googleusercontent.com", ".mzstatic.com"];

      function decodeHtml(text) {
        const box = document.createElement("textarea");
        box.innerHTML = text;
        return box.value;
      }

      async function fetchText(url) {
        const response = await fetch(url, { headers: { "Accept-Language": "en-US,en;q=0.9" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      }

      async function fetchPlay(pkg) {
        if (!/^[A-Za-z0-9_.]+$/.test(pkg || "")) throw new Error("invalid package id");
        const page = await fetchText(`https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=us`);
        let name = null;
        let icon = null;

        // 1) ld+json SoftwareApplication
        for (const match of page.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
          try {
            const data = JSON.parse(match[1]);
            if (data && data["@type"] === "SoftwareApplication") {
              name = data.name;
              icon = data.image;
              break;
            }
          } catch (error) { /* try next block */ }
        }

        // 2) itemprop fallbacks
        if (!name) name = (page.match(/itemprop="name"[^>]*>([^<]+)</) || [])[1] || null;
        if (!icon) icon = (page.match(/<img[^>]+alt="Icon image"[^>]+src="([^"]+)"/) || [])[1] || null;

        // 3) og fallbacks
        if (!name) {
          const og = (page.match(/property="og:title"\s+content="([^"]+)"/) || [])[1];
          name = og ? og.replace(/\s*-\s*Apps on Google Play\s*$/, "") : null;
        }
        if (!icon) icon = (page.match(/property="og:image"\s+content="([^"]+)"/) || [])[1] || null;

        if (!name || !icon) throw new Error("could not parse name/icon (app not found?)");
        return { name: decodeHtml(name).trim(), iconUrl: `${decodeHtml(icon).split("=")[0]}=s512` };
      }

      async function fetchAppStore(appId, country = "us") {
        if (!/^\d+$/.test(appId || "")) throw new Error("invalid app id");
        if (!/^[a-zA-Z]{2}$/.test(country || "")) country = "us";
        const response = await fetch(`https://itunes.apple.com/lookup?id=${appId}&country=${country}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const item = ((await response.json()).results || [])[0];
        if (!item) throw new Error("app not found");
        const icon = (item.artworkUrl512 || item.artworkUrl100 || "").replace(/\/\d+x\d+bb\.(jpg|png|webp)$/, "/512x512bb.$1");
        return { name: (item.trackName || "").trim(), iconUrl: icon };
      }

      async function fetchIconDataUrl(iconUrl) {
        let host = "";
        try { host = new URL(iconUrl).hostname; } catch (error) { /* invalid url */ }
        if (!iconUrl.startsWith("https://") || !IMAGE_HOSTS.some((suffix) => host.endsWith(suffix))) {
          throw new Error("icon host not allowed");
        }
        const response = await fetch(iconUrl);
        if (!response.ok) throw new Error(`icon HTTP ${response.status}`);
        return normalizeIcon(await response.blob());
      }

      // Google Play first, App Store as fallback. Returns { name, iconDataUrl, source, errors }.
      async function fetchStoreInfo(androidUrl, iosUrl) {
        const attempts = [];
        const playId = parsePlayId(androidUrl);
        const apple = parseAppStore(iosUrl);
        if (playId) attempts.push({ source: "Play", load: () => fetchPlay(playId) });
        if (apple) attempts.push({ source: "App Store", load: () => fetchAppStore(apple.id, apple.country) });

        const errors = [];
        if (!attempts.length) errors.push("Không có link hợp lệ");

        for (const attempt of attempts) {
          try {
            const info = await attempt.load();
            const iconDataUrl = await fetchIconDataUrl(info.iconUrl);
            return { name: info.name, iconDataUrl, source: attempt.source, errors };
          } catch (error) {
            errors.push(`${attempt.source}: ${error.message}`);
          }
        }
        return { name: null, iconDataUrl: null, source: null, errors };
      }

      // "Lấy lại từ link" on a variant card.
      async function fetchIntoRow(row) {
        const androidInput = row.querySelector("[data-field='androidUrl']");
        const iosInput = row.querySelector("[data-field='iosUrl']");
        androidInput.value = cleanPlayUrl(androidInput.value);
        iosInput.value = cleanAppStoreUrl(iosInput.value);
        renderRowChips(row);

        setRowBadge(row, "loading", "Đang lấy", "Đang lấy dữ liệu store…");
        try {
          const info = await fetchStoreInfo(androidInput.value, iosInput.value);
          if (info.source) {
            row._fetchedName = info.name;
            row.querySelector("[data-field='splashName']").value = info.name;
            setRowIcon(row, info.iconDataUrl, info.source);
            refreshRowPreview(row);
            const fallbackNote = info.errors.length ? ` (${info.errors.join("; ")})` : "";
            setRowBadge(row, "ok", info.source, `OK từ ${info.source}: ${info.name}${fallbackNote}`);
          } else {
            setRowBadge(row, "err", "Lỗi", info.errors.join("; ") || "Không lấy được dữ liệu");
          }
        } catch (error) {
          setRowBadge(row, "err", "Lỗi", `Lỗi: ${error.message}`);
        }
        updateGuide();
      }

      // ---- step 2: add-links popup (stage 1 = input list, stage 2 = check + confirm) ----
      function showStage(stage) {
        const isInput = stage === "input";
        elements.stageInput.classList.toggle("hidden", !isInput);
        elements.stageCheck.classList.toggle("hidden", isInput);
        elements.modalStep.textContent = isInput ? "Bước 1/2 · Nhập danh sách link" : "Bước 2/2 · Kiểm tra và xác nhận";
      }

      function openAddModal() {
        state.checkRun += 1;
        state.entries = [];
        const play = elements.quickPlay.value.trim();
        const ios = elements.quickIos.value.trim();
        elements.bulkText.value = play || ios ? `${play}\t${ios}`.trim() : "";
        elements.bulkHint.className = "hint warn hidden";
        showStage("input");
        elements.modal.showModal();
        elements.bulkText.focus();
      }

      function closeAddModal() {
        state.checkRun += 1;
        if (elements.modal.open) elements.modal.close();
      }

      // One line = one app. Each line may hold a Play link, an App Store link, or both.
      function parseBulkText(text) {
        const entries = [];
        for (const rawLine of String(text || "").split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          const tokens = line.split(/[\s,;|]+/).filter(Boolean);
          let play = "";
          let ios = "";
          for (const token of tokens) {
            const kind = classifyCell(token);
            if (kind === "ios" && !ios) ios = cleanAppStoreUrl(token);
            else if (kind === "play" && !play) play = cleanPlayUrl(token);
          }
          if (!play && !ios) {
            entries.push({ raw: line, invalid: true });
          } else {
            entries.push({ raw: line, invalid: false, androidUrl: play, iosUrl: ios });
          }
        }
        return entries.map((entry, index) => ({
          id: index + 1,
          name: "",
          iconDataUrl: null,
          source: null,
          error: "",
          note: "",
          status: entry.invalid ? "invalid" : "loading",
          androidUrl: "",
          iosUrl: "",
          ...entry
        }));
      }

      function buildCheckRow(entry, index) {
        const tr = document.createElement("tr");
        tr.dataset.id = String(entry.id);

        let nameCell;
        if (entry.status === "invalid") {
          nameCell = `<span class="err-text">Link không hợp lệ: ${escapeHtml(entry.raw)}</span>`;
        } else if (entry.status === "loading") {
          nameCell = '<span class="muted">Đang lấy dữ liệu…</span>';
        } else {
          nameCell = `<input type="text" class="name-input" data-role="name" aria-label="Tên app, dòng ${index + 1}" value="${escapeHtml(entry.name)}" placeholder="Nhập tên thủ công">`
            + (entry.status === "err" ? `<div class="err-text">${escapeHtml(entry.error)}</div>` : "");
        }

        let artCell;
        if (entry.iconDataUrl) artCell = `<img class="art" src="${entry.iconDataUrl}" alt="Icon của ${escapeHtml(entry.name || `dòng ${index + 1}`)}">`;
        else if (entry.status === "loading") artCell = '<span class="muted">…</span>';
        else artCell = '<span class="muted">Chưa có</span>';

        let playCell;
        let iosCell;
        let actionCell;
        if (entry.editing) {
          playCell = `<input type="text" class="edit-input" data-role="edit-play" aria-label="Link Google Play, dòng ${index + 1}" value="${escapeHtml(entry.androidUrl)}" placeholder="Link Google Play (ưu tiên)" spellcheck="false">`
            + (entry.editError ? `<div class="err-text">${escapeHtml(entry.editError)}</div>` : "");
          iosCell = `<input type="text" class="edit-input" data-role="edit-ios" aria-label="Link App Store, dòng ${index + 1}" value="${escapeHtml(entry.iosUrl)}" placeholder="Link App Store" spellcheck="false">`;
          actionCell = `<div class="row-actions"><button type="button" class="small primary" data-action="refresh-entry" aria-label="Lấy lại tên và icon, dòng ${index + 1}">Lấy lại</button><button type="button" class="small" data-action="cancel-edit">Huỷ</button></div>`;
        } else {
          playCell = entry.androidUrl ? linkChip("play", entry.androidUrl) : '<span class="dash">—</span>';
          iosCell = entry.iosUrl ? linkChip("ios", entry.iosUrl) : '<span class="dash">—</span>';
          actionCell = `<div class="row-actions"><button type="button" class="small" data-action="edit-entry" aria-label="Sửa hoặc thêm link, dòng ${index + 1}">Sửa</button><button type="button" class="small danger" data-action="remove-entry" aria-label="Xoá dòng ${index + 1}">Xoá</button></div>`;
        }

        tr.innerHTML = `
          <td class="n">${index + 1}</td>
          <td>${nameCell}</td>
          <td>${playCell}</td>
          <td>${iosCell}</td>
          <td>${artCell}</td>
          <td>${actionCell}</td>
        `;
        return tr;
      }

      function renderCheckTable() {
        elements.checkBody.innerHTML = "";
        state.entries.forEach((entry, index) => elements.checkBody.appendChild(buildCheckRow(entry, index)));
        updateCheckFooter();
      }

      function replaceCheckRow(entry) {
        const index = state.entries.indexOf(entry);
        if (index < 0) return;
        const current = elements.checkBody.querySelector(`tr[data-id="${entry.id}"]`);
        const next = buildCheckRow(entry, index);
        if (current) current.replaceWith(next);
        else elements.checkBody.appendChild(next);
      }

      function updateCheckFooter() {
        const total = state.entries.length;
        const loading = state.entries.filter((entry) => entry.status === "loading").length;
        const ok = state.entries.filter((entry) => entry.status === "ok").length;
        const err = state.entries.filter((entry) => entry.status === "err").length;
        const invalid = state.entries.filter((entry) => entry.status === "invalid").length;
        const editing = state.entries.filter((entry) => entry.editing).length;
        const usable = total - invalid;

        if (editing) elements.checkSummary.textContent = "Bấm “Lấy lại” hoặc “Huỷ” ở dòng đang sửa trước khi xác nhận.";
        else if (loading) elements.checkSummary.textContent = `Đang lấy dữ liệu: ${total - loading - invalid}/${usable}…`;
        else elements.checkSummary.textContent = `${total} dòng · ${ok} lấy được · ${err} lỗi${invalid ? ` · ${invalid} link không hợp lệ (sẽ bị bỏ qua)` : ""}`;
        elements.confirmBtn.disabled = loading > 0 || editing > 0 || usable === 0;
        elements.confirmBtn.textContent = usable ? `Xác nhận (${usable})` : "Xác nhận";
      }

      // Fetches name + icon for one entry (Google Play first, App Store fallback). A newer fetch on the same entry wins.
      async function fetchEntry(entry, run) {
        entry.token = (entry.token || 0) + 1;
        const token = entry.token;
        try {
          const info = await fetchStoreInfo(entry.androidUrl, entry.iosUrl);
          if (run !== state.checkRun || entry.token !== token) return;
          if (info.source) {
            entry.name = info.name;
            entry.iconDataUrl = info.iconDataUrl;
            entry.source = info.source;
            entry.note = info.errors.join("; ");
            entry.status = "ok";
          } else {
            entry.status = "err";
            entry.error = info.errors.join("; ") || "Không lấy được dữ liệu";
          }
        } catch (error) {
          if (run !== state.checkRun || entry.token !== token) return;
          entry.status = "err";
          entry.error = error.message;
        }
        if (!entry.editing) replaceCheckRow(entry);
        updateCheckFooter();
      }

      async function fetchEntries(run) {
        const queue = state.entries.filter((entry) => entry.status === "loading");
        let next = 0;
        const worker = async () => {
          while (next < queue.length) {
            const entry = queue[next];
            next += 1;
            if (run !== state.checkRun) return;
            await fetchEntry(entry, run);
          }
        };
        await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, worker));
      }

      function findEntryFromRow(tr) {
        return state.entries.find((item) => String(item.id) === tr.dataset.id);
      }

      function startEditEntry(entry) {
        entry.editing = true;
        entry.editError = "";
        // An unparseable line has no links yet: show its raw text in the Play field so it can be corrected.
        if (entry.status === "invalid" && !entry.androidUrl && !entry.iosUrl) entry.androidUrl = entry.raw;
        replaceCheckRow(entry);
        updateCheckFooter();
        const input = elements.checkBody.querySelector(`tr[data-id="${entry.id}"] [data-role='edit-play']`);
        if (input) input.focus();
      }

      function cancelEditEntry(entry) {
        entry.editing = false;
        entry.editError = "";
        if (entry.status === "invalid") {
          entry.androidUrl = "";
          entry.iosUrl = "";
        }
        replaceCheckRow(entry);
        updateCheckFooter();
      }

      // "Lấy lại": validate the edited links, then refresh name + icon (Google Play first).
      function refreshEntry(entry) {
        const tr = elements.checkBody.querySelector(`tr[data-id="${entry.id}"]`);
        if (!tr) return;
        const playRaw = tr.querySelector("[data-role='edit-play']").value.trim();
        const iosRaw = tr.querySelector("[data-role='edit-ios']").value.trim();
        const play = cleanPlayUrl(playRaw);
        const ios = cleanAppStoreUrl(iosRaw);

        let problem = "";
        if (play && !parsePlayId(play)) problem = "Link Google Play không hợp lệ.";
        else if (ios && !parseAppStore(ios)) problem = "Link App Store không hợp lệ (cần có id số, ví dụ .../id123456789).";
        else if (!play && !ios) problem = "Nhập ít nhất 1 link Google Play hoặc App Store.";

        entry.androidUrl = play;
        entry.iosUrl = ios;
        if (problem) {
          entry.editError = problem;
          replaceCheckRow(entry);
          updateCheckFooter();
          const input = elements.checkBody.querySelector(`tr[data-id="${entry.id}"] [data-role='edit-play']`);
          if (input) input.focus();
          return;
        }

        entry.editing = false;
        entry.editError = "";
        entry.status = "loading";
        entry.error = "";
        entry.iconDataUrl = null;
        entry.source = null;
        entry.note = "";
        replaceCheckRow(entry);
        updateCheckFooter();
        fetchEntry(entry, state.checkRun);
      }

      async function goToCheck() {
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
        const run = state.checkRun;
        showStage("check");
        renderCheckTable();
        elements.confirmBtn.focus();

        elements.checkNotice.className = "hint warn hidden";
        await fetchEntries(run);
      }

      function confirmEntries() {
        const usable = state.entries.filter((entry) => entry.status === "ok" || entry.status === "err");
        if (!usable.length) return;

        // Drop the untouched blank default card so it doesn't end up as an empty output.
        const existing = getRows();
        if (existing.length === 1 && isRowBlank(existing[0])) existing[0].remove();

        for (const entry of usable) {
          const row = addVariantRow({
            androidUrl: entry.androidUrl,
            iosUrl: entry.iosUrl,
            splashName: entry.name,
            splashLogoDataUrl: entry.iconDataUrl,
            iconSource: entry.source,
            fetchedName: entry.status === "ok" ? entry.name : null
          });
          if (entry.status === "ok") {
            setRowBadge(row, "ok", entry.source, `OK từ ${entry.source}: ${entry.name}${entry.note ? ` (${entry.note})` : ""}`);
          } else {
            setRowBadge(row, "err", "Lỗi", entry.error);
          }
        }

        const skipped = state.entries.length - usable.length;
        const failed = usable.filter((entry) => entry.status === "err").length;
        elements.quickPlay.value = "";
        elements.quickIos.value = "";
        closeAddModal();
        state.entries = [];

        const parts = [`Đã thêm ${usable.length} variant`];
        if (failed) parts.push(`${failed} variant chưa có icon (bấm “Chỉnh sửa” để bổ sung)`);
        if (skipped) parts.push(`bỏ qua ${skipped} link không hợp lệ`);
        showMsg(`${parts.join(", ")}.`, failed || skipped ? "warn" : "ok");
      }

      // ---- step 1: source files ----
      function applySources(files) {
        clearOutputState();
        state.sources = files.map((file) => ({ file, handle: null }));
        updateFileMeta();
        refreshAll();
      }

      function pickSupportedFiles(fileList) {
        return [...(fileList || [])].filter((file) => /\.(html?|zip)$/i.test(file.name));
      }

      function handleFallbackSelection(fileList) {
        const files = pickSupportedFiles(fileList);
        if (!files.length) {
          showMsg("Chỉ nhận file .zip / .html / .htm.", "err");
          return;
        }
        applySources(files);
      }

      async function handleOpenFile() {
        if (!("showOpenFilePicker" in window)) {
          elements.fileInput.click();
          return;
        }
        try {
          const handles = await window.showOpenFilePicker({
            multiple: true,
            types: [{
              description: "HTML hoặc ZIP",
              accept: {
                "text/html": [".html", ".htm"],
                "application/zip": [".zip"]
              }
            }]
          });
          const files = [];
          for (const handle of handles) files.push(await handle.getFile());
          applySources(files);
        } catch (error) {
          if (error && error.name !== "AbortError") showMsg(`Mở file thất bại: ${error.message}`, "err");
        }
      }

      async function loadInputSnapshot(file) {
        const extension = getExtension(file.name);
        if (extension === ".html" || extension === ".htm") {
          return { file, extension, data: await file.text() };
        }
        if (extension === ".zip") {
          return { file, extension, data: await file.arrayBuffer() };
        }
        throw new Error(`Unsupported file type: ${extension || "unknown"}`);
      }

      async function processInputSnapshot(snapshot, request) {
        const file = snapshot.file;
        const extension = snapshot.extension;
        const aggregate = createAggregateReport(
          file.name,
          request.mode,
          request.androidUrl,
          request.iosUrl,
          request.splashName,
          request.splashLogoDataUrl
        );
        let outputBlob = null;

        if (extension === ".html" || extension === ".htm") {
          const processed = processHtmlContent(snapshot.data, request, file.name);
          aggregate.stats.htmlVisited += 1;
          if (processed.report.changed) aggregate.stats.htmlChanged += 1;
          aggregate.files.push(processed.report);
          aggregate.callbacks.push(...processed.report.callbacks.map((callback) => ({ ...callback, location: file.name })));
          aggregate.changed = processed.report.changed;
          outputBlob = new Blob([processed.content], { type: "text/html;charset=utf-8" });
        } else if (extension === ".zip") {
          const processed = await processZipArrayBuffer(snapshot.data, request, aggregate, file.name);
          aggregate.changed = processed.changed;
          outputBlob = new Blob([processed.uint8array], { type: "application/zip" });
        } else {
          throw new Error(`Unsupported file type: ${extension || "unknown"}`);
        }

        return { report: aggregate, outputBlob };
      }

      async function processInputFile(file, request) {
        return processInputSnapshot(await loadInputSnapshot(file), request);
      }

      function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = () => reject(reader.error || new Error("Read file failed."));
          reader.readAsDataURL(file);
        });
      }

      function buildBatchReport(mode, variantCount, outputs, failures) {
        return {
          tool: "Ads Tool — Batch Variants + Store Fetch",
          generatedAt: new Date().toISOString(),
          mode,
          sourceCount: state.sources.length,
          variantCount,
          outputCount: outputs.length,
          failureCount: failures.length,
          outputs: outputs.map((output) => ({
            outputName: output.name,
            sourceName: output.sourceName,
            variantIndex: output.variantIndex + 1,
            report: output.report
          })),
          failures
        };
      }

      function getBatchBaseName() {
        if (state.sources.length === 1) return splitFileName(state.sources[0].file.name).base;
        return "playables";
      }

      async function createDownloadPackage(outputs, batchReport) {
        if (outputs.length === 1) {
          return { blob: outputs[0].blob, name: outputs[0].name, isBundle: false };
        }

        const bundle = new window.JSZip();
        for (const output of outputs) {
          bundle.file(output.name, await output.blob.arrayBuffer(), { binary: true });
          const reportBase = splitFileName(output.name).base;
          bundle.file(`_reports/${reportBase}.report.json`, JSON.stringify(output.report, null, 2));
        }
        bundle.file("_batch-report.json", JSON.stringify(batchReport, null, 2));

        const blob = await bundle.generateAsync({
          type: "blob",
          compression: "STORE"
        });
        return {
          blob,
          name: `${getBatchBaseName()}-batch-${outputs.length}-outputs.zip`,
          isBundle: true
        };
      }

      function setBusy(busy) {
        state.busy = busy;
        updateFileMeta();
        elements.addVariantBtn.disabled = busy;
        elements.openAddBtn.disabled = busy;
        setButtonsEnabled();
        updateGuide();
      }

      async function handleProcess() {
        if (!window.JSZip) {
          showMsg("JSZip chưa load được. Hãy mở lại tool.", "err");
          return;
        }
        if (!state.sources.length) {
          showMsg("Chưa chọn file nguồn (bước 1).", "err");
          return;
        }

        await Promise.all(getRows().map((row) => row._iconPending));

        let definitions;
        try {
          definitions = collectVariantDefinitions();
          validateVariantDefinitions(definitions);
        } catch (error) {
          showMsg(error.message, "err");
          return;
        }

        clearOutputState();
        resetLog();
        setBusy(true);

        const mode = normalizeMode(getSelectedMode());
        const failures = [];

        try {
          log(`Input files: ${state.sources.length}`);
          log(`Variants: ${definitions.length}`);
          log(`Total jobs: ${state.sources.length * definitions.length}`);
          log(`Mode: ${mode}`);

          const variants = await materializeVariantRequests(definitions, mode);
          const snapshots = [];
          for (const source of state.sources) {
            log(`Reading source: ${source.file.name}`);
            snapshots.push(await loadInputSnapshot(source.file));
          }

          const outputs = [];
          const usedNames = new Set();
          const totalJobs = snapshots.length * variants.length;
          let currentJob = 0;
          setProgress(0, totalJobs);

          for (let sourceIndex = 0; sourceIndex < snapshots.length; sourceIndex += 1) {
            const snapshot = snapshots[sourceIndex];
            for (const variant of variants) {
              currentJob += 1;
              setProgress(currentJob - 1, totalJobs);
              const requestedName = buildOutputName(snapshot.file.name, variant.outputName, variant.index, variant.request.splashName);
              const outputName = ensureUniqueOutputName(requestedName, usedNames);
              if (outputName !== requestedName) {
                log(`Output name trùng, đổi thành: ${outputName}`, "warn");
              }

              log(`[${currentJob}/${totalJobs}] ${snapshot.file.name} -> ${outputName}`);
              try {
                const result = await processInputSnapshot(snapshot, variant.request);
                result.report.store = variant.store;
                let outputBlob = result.outputBlob;
                if (elements.networkRenameCheckbox.checked && snapshot.extension === ".zip") {
                  const renamed = await applyNetworkRename(await outputBlob.arrayBuffer(), {
                    innerRename: elements.innerRenameCheckbox.checked,
                    sourceBase: splitFileName(snapshot.file.name).base,
                    outputBase: splitFileName(outputName).base
                  });
                  outputBlob = new Blob([renamed], { type: "application/zip" });
                }
                outputs.push({
                  name: outputName,
                  blob: outputBlob,
                  report: result.report,
                  sourceName: snapshot.file.name,
                  sourceIndex,
                  variantIndex: variant.index,
                  splashLogoFileName: variant.splashLogoFileName
                });
                log(`Done: ${outputName} | changed=${result.report.changed}`);
              } catch (error) {
                failures.push({
                  sourceName: snapshot.file.name,
                  outputName,
                  variantIndex: variant.index + 1,
                  message: error.message
                });
                log(`Failed: ${outputName} | ${error.message}`, "error");
              }

              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
          setProgress(totalJobs, totalJobs);
          elements.progressText.textContent = `Xong ${totalJobs} job`;

          if (!outputs.length) {
            throw new Error("Không tạo được output nào. Xem log để biết lỗi.");
          }

          state.outputs = outputs;
          renderOutputList();
          setStats(outputs, failures.length);

          const batchReport = buildBatchReport(mode, variants.length, outputs, failures);
          const downloadPackage = await createDownloadPackage(outputs, batchReport);
          state.batchReport = batchReport;
          state.outputBlob = downloadPackage.blob;
          state.outputName = downloadPackage.name;
          state.reportName = `${getBatchBaseName()}-batch-report.json`;
          state.reportBlob = new Blob(
            [JSON.stringify(batchReport, null, 2)],
            { type: "application/json;charset=utf-8" }
          );

          elements.downloadOutputBtn.disabled = false;
          elements.downloadReportBtn.disabled = false;
          elements.downloadOutputBtn.textContent = downloadPackage.isBundle
            ? `Tải tất cả (${outputs.length})`
            : "Tải output";

          log("");
          log(`Completed outputs: ${outputs.length}`);
          log(`Failed jobs: ${failures.length}`);
          log(`Download package: ${state.outputName}`);
          showMsg(
            `Hoàn tất: ${outputs.length} output${failures.length ? `, ${failures.length} lỗi (xem log)` : ""}.`,
            failures.length ? "warn" : "ok"
          );

          if (elements.autoDownloadCheckbox.checked) {
            downloadBlob(state.outputBlob, state.outputName);
            log("Auto-downloaded result package.");
          }
        } catch (error) {
          log(error.message, "error");
          showMsg(error.message, "err");
        } finally {
          setBusy(false);
        }
      }

      function addFromQuickField() {
        elements.openAddBtn.click();
      }

      // ---- wiring ----
      elements.dropZone.addEventListener("click", handleOpenFile);
      elements.dropZone.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleOpenFile();
        }
      });
      elements.dropZone.addEventListener("dragover", (event) => {
        event.preventDefault();
        elements.dropZone.classList.add("dragover");
      });
      elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("dragover"));
      elements.dropZone.addEventListener("drop", (event) => {
        event.preventDefault();
        elements.dropZone.classList.remove("dragover");
        handleFallbackSelection(event.dataTransfer.files);
      });
      elements.fileMeta.addEventListener("click", (event) => {
        const btn = event.target.closest("button");
        if (!btn) return;
        if (btn.dataset.clearAll) clearSources();
        else if (btn.dataset.removeIndex !== undefined) removeSource(Number(btn.dataset.removeIndex));
      });
      elements.fileInput.addEventListener("change", (event) => {
        handleFallbackSelection(event.target.files);
        event.target.value = "";
      });

      // step 2: two-part field + popup
      for (const [input, cleaner] of [[elements.quickPlay, cleanPlayUrl], [elements.quickIos, cleanAppStoreUrl]]) {
        input.addEventListener("blur", () => { input.value = cleaner(input.value); });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            addFromQuickField();
          }
        });
      }
      elements.openAddBtn.addEventListener("click", openAddModal);
      elements.closeModalBtn.addEventListener("click", closeAddModal);
      elements.cancelBtn.addEventListener("click", closeAddModal);
      elements.modal.addEventListener("cancel", () => { state.checkRun += 1; });
      elements.nextBtn.addEventListener("click", goToCheck);
      elements.backBtn.addEventListener("click", () => {
        state.checkRun += 1;
        showStage("input");
        elements.bulkText.focus();
      });
      elements.confirmBtn.addEventListener("click", confirmEntries);
      elements.checkBody.addEventListener("input", (event) => {
        const input = event.target.closest("[data-role='name']");
        if (!input) return;
        const entry = state.entries.find((item) => String(item.id) === input.closest("tr").dataset.id);
        if (entry) entry.name = input.value;
      });
      elements.checkBody.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        const tr = button.closest("tr");
        const entry = findEntryFromRow(tr);
        if (!entry) return;
        const action = button.dataset.action;
        if (action === "remove-entry") {
          state.entries = state.entries.filter((item) => item !== entry);
          renderCheckTable();
        } else if (action === "edit-entry") {
          startEditEntry(entry);
        } else if (action === "cancel-edit") {
          cancelEditEntry(entry);
        } else if (action === "refresh-entry") {
          refreshEntry(entry);
        }
      });
      elements.checkBody.addEventListener("keydown", (event) => {
        const input = event.target.closest("[data-role='edit-play'], [data-role='edit-ios']");
        if (!input) return;
        const entry = findEntryFromRow(input.closest("tr"));
        if (!entry) return;
        if (event.key === "Enter") {
          event.preventDefault();
          refreshEntry(entry);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelEditEntry(entry);
        }
      });

      elements.addVariantBtn.addEventListener("click", () => addVariantRow());
      elements.processBtn.addEventListener("click", handleProcess);
      elements.downloadOutputBtn.addEventListener("click", () => {
        if (state.outputBlob && state.outputName) downloadBlob(state.outputBlob, state.outputName);
      });
      elements.downloadReportBtn.addEventListener("click", () => {
        if (state.reportBlob && state.reportName) downloadBlob(state.reportBlob, state.reportName);
      });

      addVariantRow();
      updateFileMeta();
      refreshAll();
    })();
