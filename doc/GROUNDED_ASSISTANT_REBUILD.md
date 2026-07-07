# Grounded Research Assistant Rebuild

This fork is being rebuilt around one goal: a **reliable AI research
assistant for examining library items (PDFs and EPUBs) in Zotero** that
grounds every claim in the actual source text, cites it accurately, and can
show you exactly where an answer came from.

This document records what Phase 1 changed and what the following phases
are, mapped to the findings of the independent security audit
(`MIMO_AUDIT_REPORT`, 2026-07-07).

## How grounding works

The plugin already ships a citation-verification pipeline; the rebuild
keeps and extends it:

1. **Evidence-first prompting** — paper text reaches the model as chunks
   tagged with section labels and page hints
   (`libraryChatEvidencePolicy.ts`, `libraryRetrieveEvidencePack.ts`).
   Body sections (methods, results, discussion) are preferred over
   abstracts and front matter when selecting quotable evidence.
2. **Quote verification** — quoted text in an answer becomes a citation
   anchor (`[[quote:ID]]`) only when the quote is actually found in the
   source text (`quoteCitations.ts`, `quoteTextSearch.ts`). Unverifiable
   quotes are visibly downgraded instead of being presented as sourced.
3. **Click-to-highlight** — clicking a citation opens the attachment in
   Zotero's reader and scrolls to the exact passage:
   - **PDFs**: page navigation plus pdf.js FindController paragraph jump
     (`livePdfSelectionLocator.ts`), with verified page labels cached and
     written back into the citation chip.
   - **EPUBs** (new in Phase 1): the reader opens the EPUB and locates the
     passage by DOM text search with progressively shorter queries
     (`epubQuoteLocator.ts`).

## Phase 1 (this change set)

### EPUB support (grounding feature)

EPUB attachments were previously unsupported: not readable as context, and
citation clicks refused to open them. Now:

- `application/epub+zip` / `.epub` attachments are recognized as text
  attachments (`contextAttachmentSupport.ts`).
- EPUB text is extracted locally — no network — by unzipping the archive
  and walking the OPF spine in reading order
  (`textAttachmentExtraction.ts`), so chapters reach the model in the same
  order a reader sees them. Malformed packages fall back to archive-order
  XHTML extraction.
- The agent's `read_attachment` tool and the context panel both accept
  EPUBs; they participate in the same quote-citation verification as other
  text attachments and get an `EPUB` badge in the UI.
- Citation clicks on EPUB-backed sources open Zotero's EPUB reader and
  jump to the cited passage (`epubQuoteLocator.ts`,
  `assistantCitationLinks.ts`). If the exact passage cannot be located,
  the reader's find bar is primed with the quote so near-matches are one
  keypress away, and the status line says so honestly.

### Security hardening (audit Priority 1)

A grounded assistant is only trustworthy if a prompt-injected paper cannot
hijack it. Phase 1 closes the audit's critical gaps:

| Audit ID | Fix                                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-01     | `run_command` now requires explicit user confirmation for **every** command (the regex-based "destructive command" heuristic remains only to describe _why_ in the confirmation card). Execution is also refused at the tool level unless approval was applied, even if a caller bypasses the registry flow. |
| C-02     | `zotero_script` now requires confirmation in **both** read and write mode, with a script preview card. Read-mode scripts run in the privileged Gecko runtime and could previously exfiltrate data with zero user interaction. Unapproved execution is refused at the tool level.                             |
| C-03     | All WebChat relay endpoints on Zotero's HTTP server now require a per-installation bearer token (`relayAuth.ts`). The token is generated with `crypto.getRandomValues`, stored in prefs, surfaced in the WebChat preferences UI, and compared in constant time. Unauthenticated requests get `401`.          |
| H-03     | The MCP server's token generator no longer falls back to `Math.random()`; it throws if a CSPRNG is unavailable. The relay token generator was written the same way.                                                                                                                                          |

## Phase 2 (next)

Audit items that should land next, in order of leverage:

1. **C-04** — path allowlisting for `file_io` (restrict to the Zotero data
   directory and the configured notes directory; confirmation for reads
   outside them).
2. **H-05** — block private IP ranges (127.0.0.0/8, 10.0.0.0/8,
   169.254.0.0/16, 192.168.0.0/16) for user-configured `apiBase` URLs.
3. **H-04** — parameterize/validate all SQL construction in
   `conversationMessageSql.ts`.
4. **H-01 / H-02** — OS keychain storage for API keys and Codex tokens; at
   minimum `0600` permissions on `~/.codex/auth.json` and a plaintext
   warning in preferences.
5. **M-01** — warn when Zotero's HTTP server is bound to a non-loopback
   address.

## Phase 3 (structural)

- Split `llmClient.ts` (4.2k lines) into auth / transport / streaming
  parser modules (audit Q-01, Arch-1).
- Pin CI workflow actions to commit SHAs (Arch-2).
- Rate-limit relay endpoints (M-04) and add CSP to XHTML pages (Arch-4).
- EPUB grounding refinements: CFI-based deep links so EPUB citations can
  restore an exact reading position, and chapter labels in citation chips
  (the EPUB analogue of PDF page labels).
