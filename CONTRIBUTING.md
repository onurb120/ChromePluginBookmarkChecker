# Contributing Guidelines

Thank you for your interest in contributing to **Chrome Bookmark Checker**! To maintain code quality and security, please review the following guidelines before submitting code.

---

## 1. Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/onurb120/ChromePluginBookmarkChecker.git
   cd ChromePluginBookmarkChecker
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Build the extension:**
   ```bash
   npm run build
   ```

---

## 2. Mandatory Quality & Security Checklist

Before committing code or opening a Pull Request, verify the following:

- [ ] **Dependency Security:** Run `npm audit` and ensure there are no High or Critical severity vulnerabilities.
- [ ] **No Secret Leaks:** Verify that no API keys, personal tokens, `.env` files, or credentials are accidentally committed.
- [ ] **Local Testing:** Test the extension unpacked in Google Chrome via `chrome://extensions` &rarr; *Load unpacked* &rarr; select the `dist/` directory.
- [ ] **Manifest V3 Compliance:** Do not introduce remote script loaders, `eval()`, or unapproved background permissions.
- [ ] **Privacy First:** Ensure all bookmark scanning logic remains 100% local. Do not send user URLs or data to external servers.

---

## 3. Pull Request Guidelines

1. Fork the repo and create a feature branch (`git checkout -b feature/my-feature`).
2. Keep PRs focused on a single change or fix.
3. Write clear, descriptive commit messages.
4. Ensure documentation (`README.md`, guides) is updated if your change affects user-facing features or workflows.
5. Open a Pull Request against the `main` branch.
