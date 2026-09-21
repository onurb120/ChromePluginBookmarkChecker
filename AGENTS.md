# AI Agent Guidelines & Development Rules

These instructions apply to any AI pair programmer or autonomous coding agent working within this repository.

## 1. Supply Chain & Dependency Security Rules
- **Mandatory Audit on Package Changes:** Whenever you install, update, or modify dependencies in `package.json`, you MUST proactively run `npm audit`.
- **Zero High/Critical Vulnerabilities:** Do not leave unresolved High or Critical CVEs. Run `npm audit fix` or upgrade offending packages before concluding the task.
- **Lockfile Integrity:** Always ensure `package-lock.json` stays in sync with `package.json`.

## 2. Secrets & Privacy Protection
- **No Secret Leaks:** Never write, generate, or commit API keys, personal access tokens, passwords, or credentials into source files or documentation.
- **Privacy First:** Maintain the extension's zero-telemetry architecture. All bookmark checks and operations must execute strictly in the local browser context; never introduce external telemetry, analytics, or third-party server calls.

## 3. Chrome Manifest V3 Standards
- Adhere strictly to Chrome Extension Manifest V3 rules.
- Never use `eval()`, `new Function()`, or inject remote external scripts.
- Keep manifest permissions to the bare minimum required for functionality.

## 4. Packaging & Artifacts
- The production distribution ZIP must be built using `scripts/package_extension.ps1` (or `npm run package`) to ensure `manifest.json` is at the archive root and no development artifacts (`node_modules/`, `docs/`, `src/`, `.git/`) are bundled.
