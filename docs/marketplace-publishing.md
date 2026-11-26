# Marketplace & Public Release Guide

This checklist covers everything required to publish **Relay (`v1.0.0`)** publicly on GitHub, npm, and each supported agent marketplace/gallery.

---

## 1. Pre-Flight Verification Checklist

Run all checks from a clean working tree before tagging:

```bash
# 1. Sync generated provider runtimes, logos, and root skills
npm run bundle:plugins
git diff --exit-code -- plugins skills

# 2. Run the automated test suite and cross-provider smoke test
npm test
npm run smoke

# 3. Verify npm tarball contents (ensure no bench/, project-progress/, or secrets)
npm pack --dry-run

# 4. Validate platform plugin & extension manifests
claude plugin validate --strict .claude-plugin/marketplace.json
claude plugin validate --profile directory --strict plugins/claude-code
agy plugin validate --strict plugins/gemini
gemini extensions validate .
gemini extensions validate plugins/gemini
```

Also verify OpenAI Codex local marketplace loading:
```bash
codex plugin marketplace add .
codex plugin list --available --marketplace relay
```

---

## 2. GitHub Repository Setup

1. **Make the repository public:**
   GitHub → **Settings → General → Danger Zone → Change repository visibility → Make public**.
2. **Set repository About metadata:**
   - **Description:** `Local-first task delegation bridge for Claude Code, OpenAI Codex, Gemini CLI, and Antigravity. Export bounded Task Capsules to ChatGPT and validate Result Capsules in isolated Git worktrees.`
   - **Website:** `https://github.com/AndriiLavrekha/relay`
   - **Topics** *(required for Gemini CLI Extensions Gallery auto-discovery!)*:
     `gemini-cli-extension`, `claude-code-plugin`, `codex-plugin`, `antigravity-plugin`, `chatgpt`, `ai-agents`, `developer-tools`, `nodejs`
3. **Create and push the `v1.0.0` release tag:**
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0: Relay public launch"
   git push origin main --follow-tags
   gh release create v1.0.0 --title "Relay v1.0.0" --notes-file docs/releases/v1.0.0.md
   ```

---

## 3. Platform Marketplace Submissions

### A. Claude Code (Official Directory + Self-Hosted Marketplace)
- **Self-hosted marketplace (immediate):** Once the repo is public and tagged `v1.0.0`, users can immediately install via:
  ```text
  /plugin marketplace add AndriiLavrekha/relay@v1.0.0
  /plugin install relay@relay
  ```
- **Official directory (`anthropics/claude-plugins-official`):**
  1. Ensure `claude plugin validate --profile directory --strict plugins/claude-code` passes with zero errors or warnings.
  2. Submit `plugins/claude-code` (or repository URL `https://github.com/AndriiLavrekha/relay` with subdirectory `plugins/claude-code`) through Anthropic's official Claude Code plugin intake process.

### B. OpenAI Codex / ChatGPT Universal Plugin Directory
- **Self-hosted marketplace (immediate):**
  ```bash
  codex plugin marketplace add AndriiLavrekha/relay --ref v1.0.0
  codex plugin add relay@relay
  ```
- **Official OpenAI Plugins Directory:**
  1. Package `plugins/codex` into a `.zip` archive (contains `.codex-plugin/plugin.json`, `assets/logo.svg`, `skills/`, `runtime/`, `README.md`).
  2. In the **OpenAI Developer / Plugins Dashboard**, upload the ZIP under your verified publisher profile.
  3. Confirm `interface.shortDescription` (`"Safe ChatGPT task delegation"`, 28 chars <= 30), `logo` / `composerIcon` (`./assets/logo.svg`), and `skills/` pass static validation, then submit for review.

### C. Gemini CLI Extensions Gallery
- **Automated discovery:** No manual PR or form is required. Once:
  1. `AndriiLavrekha/relay` is **public** on GitHub,
  2. the repository has the **`gemini-cli-extension`** GitHub topic, and
  3. `gemini-extension.json` is at the repository root (plus `commands/` and `skills/`),
  the Gemini CLI Extensions Gallery crawler indexes it automatically (typically within 24 hours).
- **Direct install:**
  ```bash
  gemini extensions install https://github.com/AndriiLavrekha/relay --ref v1.0.0
  ```

### D. Antigravity (`agy`)
- **Direct & workspace discovery:**
  - Opening the repo auto-discovers `plugins/gemini` via `.agents/plugins.json`.
  - Users install directly via:
    ```bash
    agy plugin install https://github.com/AndriiLavrekha/relay/tree/v1.0.0/plugins/gemini
    ```
  - `plugins/gemini/.gemini-plugin/plugin.json` includes `"logo": "assets/logo.svg"` so `agy plugin validate --strict plugins/gemini` passes cleanly without missing-icon warnings.

### E. npm Registry (`@andriilavrekha/relay`)
```bash
npm login
npm publish --access public
```
Then verify:
```bash
npx @andriilavrekha/relay version
```
