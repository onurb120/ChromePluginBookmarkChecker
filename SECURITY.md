# Security Policy

## Supported Versions

We release security updates and bug fixes for the latest version of **Chrome Bookmark Checker**:

| Version | Supported          |
| :------ | :----------------- |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## Reporting a Vulnerability

We take the security of our users and software very seriously. If you discover a security vulnerability or security bug, please follow these reporting guidelines:

### 1. Private Vulnerability Disclosure (Preferred)
Please **do not open a public GitHub issue** for undisclosed vulnerabilities. Instead:
- Go to the [Security Advisories](https://github.com/onurb120/ChromePluginBookmarkChecker/security/advisories) tab of this repository.
- Click **Report a vulnerability** to privately submit details to the maintainers.

### 2. What to Include
To help us triage and resolve the issue quickly, please include:
- A clear description of the vulnerability.
- Steps to reproduce or a Proof of Concept (PoC).
- Potential impact and affected components.

We will acknowledge receipt within 48 hours and provide an estimated timeline for a fix.

---

## Dependency & Supply Chain Security Standards

To protect against supply chain attacks:
1. **Automated Daily Audits:** Automated GitHub Dependabot scans run daily (`.github/dependabot.yml`) to detect known CVEs in third-party packages.
2. **Audit Verification:** All dependency additions and updates must pass `npm audit` with zero high or critical vulnerabilities prior to release.
3. **Reproducible Builds:** The `package-lock.json` file is strictly committed and enforced via `npm ci` during builds to avoid compromised upstream package drift.

---

## Extension Platform Security (Manifest V3)

- **Zero Remote Code:** In strict adherence to Manifest V3 guidelines, no `eval()`, `new Function()`, or externally hosted scripts are executed.
- **Local-Only Processing:** All bookmark validation logic is performed locally within the browser. No URLs or browsing history are ever transmitted to remote analytical or third-party servers.
