# Google Chrome Web Store Publishing Procedure

This guide outlines the complete step-by-step procedure to publish the **Chrome Bookmark Checker** extension to the official Google Chrome Web Store.

---

## 1. Prerequisites

1. **Google Account with 2FA Enabled**:
   Google requires 2-Step Verification on any Google Account used for the developer dashboard.
2. **Chrome Web Store Developer Account**:
   - Navigate to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   - Pay the **one-time $5 USD registration fee**.
   - Complete your developer profile (Developer name, contact email address).

---

## 2. Generate the ZIP Package

Google requires a clean ZIP file where `manifest.json` is at the root of the archive (no subfolder enclosing it).

Run the automated packaging script from PowerShell:

```powershell
.\package_extension.ps1
```

This creates:
```text
dist/chrome-bookmark-checker.zip
```

The script automatically verifies and packages only the required runtime files:
- `manifest.json`
- `background.js`
- `popup.html`
- `popup.css`
- `popup.js`
- `icons/` (`icon16.png`, `icon48.png`, `icon128.png`)

---

## 3. Upload to Developer Dashboard

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Click **+ Add new item** (top-right).
3. Drag and drop `dist/chrome-bookmark-checker.zip` or click **Browse files** to upload it.
4. Once uploaded, the dashboard will direct you to your item configuration tabs.

---

## 4. Store Listing Configuration

### Item Details
- **Title**: `Chrome Bookmark Checker`
- **Summary** *(132 characters max)*:
  ```text
  Scan, validate, and clean up your Chrome bookmarks for broken links, 404 errors, and duplicate URLs.
  ```
- **Description** *(Detailed markdown/plain text)*:
  ```text
  Chrome Bookmark Checker is a fast, privacy-focused extension that helps you clean up and maintain your browser bookmarks.

  KEY FEATURES:
  • Broken Link Detection: Scans your saved bookmarks and checks HTTP response codes to flag dead links (404, 500, network timeouts).
  • Duplicate Detection: Automatically identifies identical and normalized URLs saved multiple times.
  • Category Filters: Switch views easily between All Bookmarks, Broken Links, and Duplicates.
  • Privacy First: All bookmark checking happens locally in your browser. No personal data or browsing history is tracked, stored remotely, or sold.

  HOW TO USE:
  1. Click the Bookmark Checker icon in your extension toolbar.
  2. Click "Start Scanning" to inspect your bookmarks.
  3. Filter by Broken or Duplicate bookmarks to inspect and manage your collection.
  ```
- **Category**: `Productivity` (or `Search Tools`)
- **Language**: English

### Graphic Assets
- **Store Icon**: Upload `icons/icon128.png` (128x128 PNG).
- **Screenshots**: Upload at least one screenshot of the extension popup (1280x800 or 640x400 PNG/JPEG).
  > **Tip**: You can take a screenshot by loading the unpacked extension in Chrome, opening the popup, and capturing a clean screenshot using Chrome DevTools or Windows Snipping Tool (`Win + Shift + S`).

---

## 5. Privacy Practices (Crucial for Fast Approval)

Google reviewers inspect this section carefully to prevent rejection.

### Single Purpose Description
When asked for your extension's single purpose, paste:
> *"This extension has a single purpose: to scan the user's saved browser bookmarks, verify whether the bookmarked URLs are alive or broken (e.g. 404/network errors), and detect duplicate bookmarks for cleanup."*

### Permission Justifications
Google asks why each sensitive permission is declared:

| Permission | Justification to Enter |
| :--- | :--- |
| **`bookmarks`** | `Required strictly to access the user's bookmark tree to inspect URL targets for link validation and to identify duplicate bookmark entries.` |
| **`storage`** | `Required to store local user preferences and scan state locally in the user's browser.` |
| **`<all_urls>`** (Host permissions) | `Required to send HTTP HEAD and GET verification requests to arbitrary web servers corresponding to the user's bookmarked URLs to determine if links are active or broken. No user data is transmitted.` |

### Data Usage Declarations
- **Data collection**: Select **"No, I am not collecting or using user data"**.
- **Data Usage Certifications**: Check all three certification boxes:
  1. [x] *I certify that I do not sell user data to third parties.*
  2. [x] *I certify that I do not use or transfer user data for purposes unrelated to the item's single purpose.*
  3. [x] *I certify that I do not use or transfer user data to determine creditworthiness or for lending purposes.*

### Privacy Policy URL
- Host the included `PRIVACY_POLICY.md` file (e.g., using GitHub Pages or a public repository link: `https://github.com/<your-username>/ChromePluginBookmarkChecker/blob/main/PRIVACY_POLICY.md`).
- Enter the public URL into the **Privacy Policy URL** field in the dashboard.

---

## 6. Distribution & Visibility

- **Visibility**:
  - Choose **Public** to make it available to everyone on the Chrome Web Store.
  - Or choose **Unlisted** if you first want to test it with a direct URL before making it searchable.
- **Regions**: All regions (default).
- **Pricing**: Free.

---

## 7. Submit for Review

1. Click **Submit for review** in the top-right corner of the developer dashboard.
2. If prompted about review duration, acknowledge the prompt.
3. **Review Timeline**:
   - Extensions with `<all_urls>` undergo manual human review by Google's Trust & Safety team.
   - Normal review time is typically **1 to 3 business days** (rarely up to 7 days during peak periods).
   - You will receive an email notification from Google when the extension is approved and published.
