# Privacy Policy for Chrome Bookmark Checker

**Last updated:** September 15, 2026

This Privacy Policy describes how the **Chrome Bookmark Checker** browser extension ("we", "our", or "the extension") handles user data.

## 1. Data Collection & Processing
Chrome Bookmark Checker is designed with a strict **privacy-first** approach:
- **No Personal Data Collection:** The extension does not collect, record, transmit, or sell any personal information, browsing history, or user data.
- **Local Operation:** All bookmark scanning, URL normalization, and duplicate checks take place locally within your browser environment.
- **Network Requests:** To verify whether saved bookmarks are active or broken, the extension sends direct HTTP requests (e.g., `HEAD` / `GET`) from your local browser directly to the destination web servers specified in your bookmark URLs. No intermediate server or third-party proxy is used.
- **Local Storage:** The extension uses Chrome's local storage API (`chrome.storage`) solely to retain local user preferences and scan state on your machine. This data never leaves your device.

## 2. Permissions Justification
- `bookmarks`: Required strictly to read your saved bookmarks to identify broken links and duplicate URLs. The extension does not modify your bookmarks without your explicit action.
- `storage`: Required to store your settings and scan status locally within your browser.
- `<all_urls>`: Required to send link validation requests to arbitrary web destinations corresponding to your saved bookmarks.

## 3. Third-Party Sharing
We do not share, sell, rent, or trade your data with any third parties, advertisers, or analytics providers.

## 4. Single-Purpose Policy Compliance
Chrome Bookmark Checker serves a single dedicated purpose: to help users inspect, validate, and clean up their browser bookmarks. It does not perform unexpected background tasks, inject advertisements, or alter web content.

## 5. Contact
If you have questions or concerns regarding this Privacy Policy, please open an issue in the official GitHub repository.
