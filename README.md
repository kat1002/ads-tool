# Ads Tool (Chrome / Edge extension)

Batch tool for ads playables: fetches app name + icon from Google Play / App Store, renames and exports a ZIP.
Works on Windows, macOS and Linux in any Chromium browser (Chrome, Edge, Brave). No Python, no exe.

**Trang tải về / Download page: https://github.com/kat1002/ads-tool/releases/latest**

| File | Dùng cho |
|---|---|
| `ads-tool-extension.zip` | Windows, Mac, Linux (Chrome / Edge / Brave). Làm theo hướng dẫn bên dưới. |
| `AdsTool.exe` | Chỉ Windows, bấm đúp là chạy (cần Microsoft Edge). Nếu Windows cảnh báo: **More info** → **Run anyway**. |

## Cài đặt extension

**Bước 1.** Vào trang tải về ở trên, tải `ads-tool-extension.zip`, rồi **giải nén** ra một thư mục cố định (ví dụ `Documents\AdsTool`). Không xoá thư mục này sau khi cài.

**Bước 2.** Mở trình duyệt, gõ `chrome://extensions` (Edge: `edge://extensions`) vào thanh địa chỉ, rồi bật **Developer mode** (Chế độ dành cho nhà phát triển).

![Bật Developer mode](docs/1-developer-mode.png)

**Bước 3.** Bấm **Load unpacked** (Tải tiện ích đã giải nén), chọn thư mục vừa giải nén ở bước 1 (thư mục có file `manifest.json`).

![Nút Load unpacked](docs/2-load-unpacked.png)

**Bước 4.** Extension **Ads Tool** xuất hiện trong danh sách và đang bật.

![Đã cài xong](docs/3-installed.png)

**Bước 5.** Bấm biểu tượng puzzle (Extensions) trên thanh công cụ, bấm ghim (pin) cạnh **Ads Tool** để luôn thấy biểu tượng.

## Sử dụng

Bấm biểu tượng **Ads Tool** trên thanh công cụ, tool mở trong một tab mới.

![Giao diện Ads Tool](docs/4-tool.png)

- **Ghi chú link:** widget nổi ở góc dưới bên phải, lưu link kèm ghi chú (tuỳ chọn) trên máy bằng `chrome.storage.local`, chia theo danh mục (tab) như từng game hoặc thể loại. Hỗ trợ mở, copy, xoá, đổi tên/xoá danh mục, xuất và nhập file `.txt` để chuyển sang máy khác.

## Cập nhật

Phiên bản hiện tại hiển thị ở đầu trang Ads Tool. Khi có bản release mới trên GitHub, một banner cập nhật sẽ xuất hiện.

- **Cập nhật:** tự tải bản mới và ghi đè các file. Lần đầu bạn chọn thư mục đang cài Ads Tool (thư mục chứa `manifest.json`); trình duyệt có thể hỏi cấp quyền lại mỗi phiên làm việc.
- **Tải thủ công:** cách dự phòng. Tải zip mới, giải nén đè lên thư mục cũ, mở `chrome://extensions` (Edge: `edge://extensions`) rồi bấm **Reload** ở Ads Tool.
- Nếu trình duyệt từ chối thư mục đã chọn (thư mục hệ thống, ví dụ nằm trong `AppData`), hãy chuyển extension sang chỗ khác như `Documents\AdsTool`, rồi Load unpacked lại từ thư mục đó.
- Lần nâng cấp đầu tiên lên 1.0.3 phải làm thủ công, vì bản này thêm quyền mới.

## Lỗi thường gặp

- **Không thấy nút Load unpacked:** chưa bật Developer mode (bước 2).
- **Chọn thư mục báo lỗi manifest:** bạn đang chọn nhầm thư mục. Phải chọn thư mục chứa trực tiếp file `manifest.json`, không phải file zip và không phải thư mục cha.
- **Extension biến mất sau khi khởi động lại trình duyệt:** thư mục đã bị xoá hoặc di chuyển. Đặt lại thư mục ở chỗ cố định rồi Load unpacked lại.
- **Máy công ty chặn cài extension:** liên hệ IT hoặc dùng `AdsTool.exe` (Windows).

## Development

- Edit the files here, then click reload on `chrome://extensions`.
- `ads-tool.js` is the app; `ads-tool.html` is markup + CSS; `jszip.min.js` is JSZip 3.10.1.
- Store fetch (`fetchPlay`, `fetchAppStore`) runs straight from the extension page. `host_permissions` in `manifest.json` lift CORS for the store and image hosts.
- Release: bump `version` in `manifest.json`, then `git tag vX.Y.Z && git push --tags`. The workflow attaches `ads-tool-extension.zip` to a GitHub Release. Upload `AdsTool.exe` (built from the `exe` branch) with `gh release upload`.
