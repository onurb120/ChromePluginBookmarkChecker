# Chrome Plugin Bookmark Checker

A Google Chrome Extension (Manifest V3) for checking, managing, and cleaning up bookmarks. It scans your browser bookmarks to detect broken links, 404 errors, redirects, and duplicate entries.

## Features

- **Bookmark Link Validation**: Scans all saved bookmarks and verifies HTTP status codes.
- **Duplicate Detection**: Identifies identical or normalized URLs saved multiple times.
- **Dead Link Filtering**: Easily filter and view bookmarks returning 404, 50x, or connection errors.
- **Batch Cleanup**: Safely remove or update dead bookmarks directly from the extension popup.

## Installation (Developer Mode)

1. Clone this repository or download the source code.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** and select the folder containing this repository (`ChromePluginBookmarkChecker`).
5. Click the extension icon in the toolbar to launch the Bookmark Checker popup.

## Permissions

- `bookmarks`: Required to read, update, and organize Chrome browser bookmarks.
- `storage`: Required to save scan progress and extension settings locally.
- `activeTab`: Optional interaction for inspecting current open tabs against bookmarks.

## License

MIT License.
