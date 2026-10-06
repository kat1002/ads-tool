// GitHub repo is not renamed yet (old name redirects); change here when it is.
const REPO = "kat1002/ads-tool";
const UPDATE_KEY = "playableBatchUpdateCheck";
const ALARM = "playableBatchUpdateAlarm";
const ASSET_NAME = "playable-batch-extension.zip";

function openTool() {
  chrome.tabs.create({ url: chrome.runtime.getURL("playable-batch.html") });
}

async function reopenIfFlagged() {
  // adsToolReopenAfterUpdate: flag name written by versions before the rename to Playable Batch.
  const stored = await chrome.storage.local.get(["playableBatchReopenAfterUpdate", "adsToolReopenAfterUpdate"]);
  const v = stored.playableBatchReopenAfterUpdate || stored.adsToolReopenAfterUpdate;
  if (!v) return;
  await chrome.storage.local.remove(["playableBatchReopenAfterUpdate", "adsToolReopenAfterUpdate"]);
  openTool();
}

function cmp(a, b) {
  const parse = (v) => String(v || "").trim().replace(/^v/i, "").split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

async function checkUpdate() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    if (!res.ok) return;
    const data = await res.json();
    const asset = (data.assets || []).find((item) => item.name === ASSET_NAME);
    const latest = {
      version: String(data.tag_name || "").replace(/^v/i, ""),
      htmlUrl: data.html_url,
      assetUrl: asset?.browser_download_url || data.html_url,
      body: (data.body || "").slice(0, 1500)
    };
    await chrome.storage.local.set({ [UPDATE_KEY]: { checkedAt: Date.now(), latest } });
    const isNew = cmp(latest.version, chrome.runtime.getManifest().version) > 0;
    await chrome.action.setBadgeText({ text: isNew ? "NEW" : "" });
  } catch (e) {
    // best-effort
  }
}

function setup() {
  chrome.alarms.create(ALARM, { periodInMinutes: 360 });
}

chrome.action.onClicked.addListener(openTool);

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) checkUpdate();
});

chrome.runtime.onInstalled.addListener(async (d) => {
  setup();
  chrome.action.setBadgeText({ text: "" });
  checkUpdate();
  if (d.reason === "update") await reopenIfFlagged();
});

chrome.runtime.onStartup.addListener(() => {
  setup();
  checkUpdate();
  reopenIfFlagged();
});

reopenIfFlagged();
