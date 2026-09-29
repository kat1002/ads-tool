# Ads Tool (Chrome / Edge extension)

Batch tool for ads playables: fetches app name + icon from Google Play / App Store, renames and exports a ZIP.
Works on Windows, macOS and Linux in any Chromium browser (Chrome, Edge, Brave). No Python, no exe.

## Cài đặt

1. Tải `ads-tool-extension.zip` từ trang **Releases** rồi giải nén ra một thư mục (đừng xoá thư mục này sau khi cài).
2. Mở `chrome://extensions` (Edge: `edge://extensions`).
3. Bật **Developer mode** (góc trên bên phải).
4. Bấm **Load unpacked** và chọn thư mục vừa giải nén.
5. Bấm biểu tượng puzzle trên thanh công cụ, ghim **Ads Tool**.

Dùng: bấm biểu tượng **Ads Tool**, tool sẽ mở trong một tab mới.

Cập nhật: tải zip mới, giải nén đè lên thư mục cũ, rồi bấm nút reload của extension ở trang extensions.

## Development

- Edit the files here, then click reload on `chrome://extensions`.
- `ads-tool.js` is the app; `ads-tool.html` is markup + CSS; `jszip.min.js` is JSZip 3.10.1.
- Store fetch (`fetchPlay`, `fetchAppStore`) runs straight from the extension page. `host_permissions` in `manifest.json` lift CORS for the store and image hosts.
- Release: bump `version` in `manifest.json`, then `git tag vX.Y.Z && git push --tags`. The workflow attaches `ads-tool-extension.zip` to a GitHub Release.
