# Chrome Web Store listing: Playable Batch

## Single purpose

Playable Batch helps ad-playable creators process playable ad ZIP/HTML files in batch: it reads an app's name and icon from the store link you paste, renames the playable, replaces the store links, splash name and logo inside it, and exports the result as new files.

## Permission justifications

**storage**
Saves the user's notes (link notes, categories) and tool settings locally in `chrome.storage.local` so they persist between sessions. Nothing is synced or sent anywhere.

**https://play.google.com/\***
Fetches the public page of an app from a store link the user pasted, to read the app name and icon. Only requested when the user adds or refreshes a link.

**https://itunes.apple.com/\***
Calls the public lookup endpoint for an app ID taken from a store link the user pasted, to read the app name and icon.

**https://\*.googleusercontent.com/\***
Downloads the app icon image whose URL appears on the store page, so it can be embedded in the exported playable.

**https://\*.mzstatic.com/\***
Downloads the app icon image whose URL is returned by the lookup endpoint, so it can be embedded in the exported playable.

No remote code is loaded or executed. All scripts are bundled in the package.

## Privacy policy (draft)

Playable Batch does not collect, store, transmit or sell any personal data to the developer. The developer operates no server and receives no analytics, telemetry or usage data.

- Store links that you paste are used only to request the public app page or lookup data from the store that owns the link (Google Play or Apple App Store), and to download the app icon from that store's image host. These requests go directly from your browser to those stores and are subject to their own privacy policies.
- Playable files you load are processed locally in your browser. They are never uploaded.
- Your notes and settings are saved only in `chrome.storage.local` on your device. You can remove them by clearing the extension's data or uninstalling the extension.
- The extension uses no cookies for tracking, no third-party SDKs and no advertising identifiers.

Contact: nguyenphuc10022004@gmail.com

## Chrome Web Store review checklist

- [ ] `python build-store.py` run on the latest `main` changes merged into `store`; version in `store-build/manifest.json` matches the release you intend to publish (bump in `manifest.json` on main first).
- [ ] Zip contains only: manifest.json (at root), background.js, playable-batch.html, playable-batch.js, jszip.min.js, icons/.
- [ ] Permissions are only `storage` plus the four host permissions; no `alarms`, `nativeMessaging`, GitHub hosts.
- [ ] No network calls other than Google Play, Apple lookup and their image hosts; no remote code. Note: bundled `jszip.min.js` contains a `new Function` in its setImmediate fallback (library code, not reachable with the way it is used); mention in reviewer notes if asked.
- [ ] Load `store-build/` unpacked in Chrome and test: click the icon opens the tool, add Play and App Store links fetch name/icon, notes save and reload, process and download a sample playable.
- [ ] Description and screenshots do not use store brand names as endorsements; "store links" wording only.
- [ ] Single purpose statement, permission justifications and privacy policy filled in the developer dashboard; privacy policy hosted at a public URL and linked.
- [ ] Data usage disclosures: no data collected; certify the three limited-use statements.
- [ ] Screenshots (1280x800 or 640x400), small promo tile (440x280), 128x128 icon provided.
- [ ] Test instructions for reviewers: a sample playable ZIP and a sample Play/App Store link.
