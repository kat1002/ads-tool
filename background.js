chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("ads-tool.html") });
});

chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason !== "update") return;
  const { adsToolReopenAfterUpdate: v } = await chrome.storage.local.get("adsToolReopenAfterUpdate");
  if (!v) return;
  await chrome.storage.local.remove("adsToolReopenAfterUpdate");
  chrome.tabs.create({ url: chrome.runtime.getURL("ads-tool.html") });
});
