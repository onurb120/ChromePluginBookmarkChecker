# Chrome Plugin Bookmark Checker

A Google Chrome Extension (Manifest V3) for checking, managing, and cleaning up bookmarks. It scans your browser bookmarks to detect broken links, 404 errors, redirects, and duplicate entries.

## Features

- **Bookmark Link Validation**: Scans all saved bookmarks and verifies HTTP status codes.
- **Duplicate Detection**: Identifies identical or normalized URLs saved multiple times.
- **Dead Link Filtering**: Easily filter and view bookmarks returning 404, 50x, or connection errors.
- **Batch Cleanup**: Safely remove or update dead bookmarks directly from the extension popup.

## Installation

### Option 1: Building from Source (Developer Mode)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/onurb120/ChromePluginBookmarkChecker.git
   cd ChromePluginBookmarkChecker
   ```

2. **Install dependencies and build:**
   ```bash
   npm install
   npm run build
   ```
   *(For active development with hot reloading, run `npm run dev` instead).*

3. **Load into Chrome:**
   1. Open Google Chrome and navigate to `chrome://extensions`.
   2. Enable **Developer mode** using the toggle switch in the top-right corner.
   3. Click **Load unpacked** and select the **`dist`** directory inside the repository (`ChromePluginBookmarkChecker/dist`).
   4. Click the extension icon in the toolbar to launch Bookmark Checker.

### Option 2: Pre-built Release Package

1. Download the latest extension ZIP (`dist/chrome-bookmark-checker.zip`) from the repository or releases.
2. Extract the ZIP archive to a folder on your computer.
3. Open Google Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode** using the toggle switch in the top-right corner.
5. Click **Load unpacked** and select the extracted folder containing `manifest.json`.

## Packaging & Distribution

1. Run the automated packaging script in PowerShell:
   ```powershell
   .\package_extension.ps1
   ```
2. The deployment-ready archive will be generated at `dist/chrome-bookmark-checker.zip`.
3. Upload the generated zip archive to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
4. Review [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for Google store submission requirements.

## Permissions

- `bookmarks`: Required to read, update, and organize Chrome browser bookmarks.
- `storage`: Required to save scan progress and extension settings locally.
- `<all_urls>`: Required to send link verification requests to arbitrary bookmarked URLs.

## License

MIT License.
