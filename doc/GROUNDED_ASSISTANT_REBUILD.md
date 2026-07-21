# Grounded Research Assistant Rebuild

This fork is being rebuilt around one goal: a **reliable AI research
assistant for examining library items (PDFs and EPUBs) in Zotero** that
grounds every claim in the actual source text, cites it accurately, and can
show you exactly where an answer came from.

This document records the EPUB grounding work and how it fits into the
existing citation-verification pipeline.

## How grounding works

The plugin already ships a citation-verification pipeline; EPUB support
extends it rather than replacing it:

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
   - **EPUBs**: the reader opens the EPUB and locates the passage by DOM
     text search with progressively shorter queries
     (`epubQuoteLocator.ts`).

## EPUB support

EPUB attachments were previously unsupported: not readable as context, and
citation clicks refused to open them. Now:

- `application/epub+zip` / `.epub` attachments are recognized as text
  attachments (`contextAttachmentSupport.ts`,
  `textAttachmentExtraction.ts`).
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

## Roadmap

- CFI-based deep links so EPUB citations can restore an exact reading
  position, and chapter labels in citation chips (the EPUB analogue of PDF
  page labels).
- Multi-candidate disambiguation when a quote matches more than one open
  EPUB, mirroring the existing PDF behavior.

## Note on agent tool confirmation

Confirmation-gating for privileged agent tools (`run_command`,
`zotero_script`, and related MCP write tools) is handled independently in
`src/agent/mcp/server.ts` (see `MCP_TOOLS_WITH_OWN_CONFIRMATION_POLICY` and
related machinery) and is out of scope for this document.
