import { assert } from "chai";
import {
  buildAssistantDisplayMarkdownForRender,
  finalizeAssistantMessageQuoteCitationsForTests,
  waitForAssistantQuoteValidationForTests,
} from "../src/modules/contextPanel/chat";
import {
  buildQuoteCitation,
  replaceQuoteCitationPlaceholdersForMarkdown,
} from "../src/modules/contextPanel/quoteCitations";
import { clearPageTextCache } from "../src/modules/contextPanel/livePdfSelectionLocator";
import {
  chatHistory,
  pdfTextCache,
  pdfTextLoadingTasks,
} from "../src/modules/contextPanel/state";
import type {
  Message,
  PaperContextRef,
} from "../src/modules/contextPanel/types";

function installPdfSource(
  contextItemId: number,
  sourceText: string,
): { getCallCount: () => number; restore: () => void } {
  const originalZotero = globalThis.Zotero;
  const originalZtoolkit = globalThis.ztoolkit;
  let calls = 0;
  const attachment = {
    id: contextItemId,
    parentID: undefined,
    attachmentContentType: "application/pdf",
    isAttachment: () => true,
    isNote: () => false,
    getField: (field: string) =>
      field === "title" ? "Representational drift paper" : "",
    getFilename: () => "representational-drift.pdf",
  } as unknown as Zotero.Item;
  (globalThis as typeof globalThis & { Zotero: typeof Zotero }).Zotero = {
    Items: {
      get: (id: number) => (id === contextItemId ? attachment : null),
    },
    PDFWorker: {
      getFullText: async () => {
        calls += 1;
        return {
          text: sourceText,
          pageChars: [sourceText.length],
        };
      },
    },
  } as typeof Zotero;
  (globalThis as typeof globalThis & { ztoolkit: typeof ztoolkit }).ztoolkit = {
    log: () => undefined,
  } as typeof ztoolkit;
  return {
    getCallCount: () => calls,
    restore: () => {
      (globalThis as typeof globalThis & { Zotero: typeof Zotero }).Zotero =
        originalZotero;
      (
        globalThis as typeof globalThis & { ztoolkit: typeof ztoolkit }
      ).ztoolkit = originalZtoolkit;
    },
  };
}

describe("minimal source-match quote gate workflow", function () {
  const conversationKey = 9011;
  const contextItemId = 811;
  let restoreSource = () => undefined;
  const paper: PaperContextRef = {
    itemId: 810,
    contextItemId,
    title: "Representational drift paper",
    firstCreator: "Eppler et al.",
    year: "2026",
    contentSourceMode: "text",
  };

  afterEach(function () {
    restoreSource();
    restoreSource = () => undefined;
    chatHistory.delete(conversationKey);
    pdfTextCache.clear();
    pdfTextLoadingTasks.clear();
    clearPageTextCache();
  });

  it("keeps a registered Eppler anchor trusted without source I/O", async function () {
    const source = installPdfSource(contextItemId, "Unneeded PDF text.");
    restoreSource = source.restore;
    const citation = buildQuoteCitation({
      quoteText:
        "For each NC bin, neuron pairs were grouped into K bins based on their SC at day t. For each SC bin k, we computed the mean across pairwise NC Yi",
      displayQuoteText:
        "For each NC bin, neuron pairs were grouped into K bins based on their SC at day t. For each SC bin k, we computed the mean across **pairwise NC Yᵢ**...",
      citationLabel: "(Eppler et al., 2026)",
      sourceMatchText:
        "For each NC bin, neuron pairs were grouped into K bins based on their SC at day t. For each SC bin k, we computed the mean across pairwise NC Yi",
      sourceMatchKind: "normalized-span",
      sourceMatchSource: "pdf-page-text",
      contextItemId,
      itemId: paper.itemId,
      pageHintLabel: "10",
    });
    assert.isDefined(citation);
    const userMessage: Message = {
      role: "user",
      text: "Explain the method.",
      timestamp: 1,
      paperContexts: [paper],
    };
    const assistantMessage: Message = {
      role: "assistant",
      text: `[[quote:${citation!.id}]]`,
      quoteCitations: [citation!],
      timestamp: 2,
    };
    chatHistory.set(conversationKey, [userMessage, assistantMessage]);

    finalizeAssistantMessageQuoteCitationsForTests(assistantMessage, {
      pairedUserMessage: userMessage,
      conversationKey,
    });
    await waitForAssistantQuoteValidationForTests(conversationKey);

    assert.equal(source.getCallCount(), 0);
    assert.equal(assistantMessage.text, `[[quote:${citation!.id}]]`);
    assert.deepEqual(assistantMessage.quoteCitations, [citation!]);
    assert.isUndefined(assistantMessage.quoteDisplayOverride);
    assert.include(
      buildAssistantDisplayMarkdownForRender(assistantMessage),
      "[[quote-occurrence:",
    );
  });

  it("defers without I/O, then overlays a unique source match", async function () {
    const quote =
      "Noise correlation changed more favorably for neuron pairs with high signal correlation.";
    const source = installPdfSource(
      contextItemId,
      `Results. ${quote} The next result follows.`,
    );
    restoreSource = source.restore;
    const userMessage: Message = {
      role: "user",
      text: "Explain the result.",
      timestamp: 1,
      paperContexts: [paper],
    };
    const assistantMessage: Message = {
      role: "assistant",
      text: `> ${quote}`,
      timestamp: 2,
    };
    chatHistory.set(conversationKey, [userMessage, assistantMessage]);

    finalizeAssistantMessageQuoteCitationsForTests(assistantMessage, {
      pairedUserMessage: userMessage,
      conversationKey,
    });

    assert.equal(source.getCallCount(), 0);
    assert.equal(assistantMessage.text, `> ${quote}`);
    assert.isUndefined(assistantMessage.quoteDisplayOverride);

    await waitForAssistantQuoteValidationForTests(conversationKey);

    assert.isAbove(source.getCallCount(), 0);
    assert.equal(assistantMessage.text, `> ${quote}`);
    assert.isUndefined(assistantMessage.quoteCitations);
    assert.match(
      assistantMessage.quoteDisplayOverride?.markdown || "",
      /\[\[quote:Q_[a-z0-9]+\]\]/,
    );
    assert.equal(
      assistantMessage.quoteDisplayOverride?.quoteCitations?.[0]?.citationLabel,
      "(Eppler et al., 2026)",
    );
  });

  it("treats a unique partial match as an ordinary source quote", async function () {
    const sourceSentence =
      "Noise correlation changed more favorably for neuron pairs with high signal correlation.";
    const quote = `${sourceSentence} This explanatory sentence was added by the model.`;
    const source = installPdfSource(contextItemId, sourceSentence);
    restoreSource = source.restore;
    const userMessage: Message = {
      role: "user",
      text: "Explain the result.",
      timestamp: 1,
      paperContexts: [paper],
    };
    const assistantMessage: Message = {
      role: "assistant",
      text: `> ${quote}`,
      timestamp: 2,
    };
    chatHistory.set(conversationKey, [userMessage, assistantMessage]);

    finalizeAssistantMessageQuoteCitationsForTests(assistantMessage, {
      pairedUserMessage: userMessage,
      conversationKey,
    });
    await waitForAssistantQuoteValidationForTests(conversationKey);

    const displayCitation =
      assistantMessage.quoteDisplayOverride?.quoteCitations?.[0];
    assert.equal(displayCitation?.citationLabel, "(Eppler et al., 2026)");
    assert.equal(displayCitation?.displayQuoteText, quote);
    assert.notInclude(
      replaceQuoteCitationPlaceholdersForMarkdown(
        assistantMessage.quoteDisplayOverride?.markdown || "",
        displayCitation ? [displayCitation] : [],
      ),
      "Related source",
    );
    assert.equal(assistantMessage.text, `> ${quote}`);
  });

  it("overlays Not a source quote only after a complete zero match", async function () {
    const quote =
      "Among neuron pairs, does noise correlation change more favorably for high signal correlation?";
    const raw = `> ${quote}\n>\n> (Eppler et al., 2026, page 3)`;
    const source = installPdfSource(
      contextItemId,
      "The complete paper text discusses a different experimental result.",
    );
    restoreSource = source.restore;
    const userMessage: Message = {
      role: "user",
      text: "Explain the result.",
      timestamp: 1,
      paperContexts: [paper],
    };
    const assistantMessage: Message = {
      role: "assistant",
      text: raw,
      timestamp: 2,
    };
    chatHistory.set(conversationKey, [userMessage, assistantMessage]);

    finalizeAssistantMessageQuoteCitationsForTests(assistantMessage, {
      pairedUserMessage: userMessage,
      conversationKey,
    });
    assert.isUndefined(assistantMessage.quoteDisplayOverride);

    await waitForAssistantQuoteValidationForTests(conversationKey);

    assert.equal(assistantMessage.text, raw);
    assert.isUndefined(assistantMessage.quoteCitations);
    assert.equal(
      assistantMessage.quoteDisplayOverride?.markdown,
      `> ${quote}\n>\n> Not a source quote`,
    );
    assert.include(
      buildAssistantDisplayMarkdownForRender(assistantMessage),
      "[[quote-occurrence:",
    );
  });

  it("preserves historical raw content during fast and background review", async function () {
    const quote =
      "A historical model interpretation currently appears as a sourced quotation.";
    const raw = `> ${quote}\n>\n> (Eppler et al., 2026, page 3)`;
    const staleCitation = buildQuoteCitation({
      quoteText: quote,
      citationLabel: "(Eppler et al., 2026)",
      sourceMatchKind: "progressive",
      sourceMatchSource: "context-text",
      contextItemId,
      itemId: paper.itemId,
      pageHintLabel: "3",
    });
    assert.isDefined(staleCitation);
    const source = installPdfSource(
      contextItemId,
      "The complete paper contains unrelated source wording.",
    );
    restoreSource = source.restore;
    const userMessage: Message = {
      role: "user",
      text: "Explain the result.",
      timestamp: 1,
      paperContexts: [paper],
    };
    const assistantMessage: Message = {
      role: "assistant",
      text: raw,
      quoteCitations: [staleCitation!],
      timestamp: 2,
    };
    chatHistory.set(conversationKey, [userMessage, assistantMessage]);

    finalizeAssistantMessageQuoteCitationsForTests(assistantMessage, {
      pairedUserMessage: userMessage,
      conversationKey,
    });
    assert.equal(assistantMessage.text, raw);
    assert.isUndefined(assistantMessage.quoteDisplayOverride);

    await waitForAssistantQuoteValidationForTests(conversationKey);

    assert.equal(assistantMessage.text, raw);
    assert.deepEqual(assistantMessage.quoteCitations, [staleCitation!]);
    assert.include(
      assistantMessage.quoteDisplayOverride?.markdown || "",
      "Not a source quote",
    );
  });

  it("leaves unresolved and open-ended source scopes unchanged", async function () {
    const quote =
      "A genuine quotation may belong to a source that is not yet available.";
    const source = installPdfSource(
      contextItemId,
      "The resolved paper contains unrelated wording.",
    );
    restoreSource = source.restore;
    const cases: Message[] = [
      {
        role: "user",
        text: "Compare these papers.",
        timestamp: 1,
        paperContexts: [
          paper,
          { ...paper, itemId: 0, contextItemId: 0, title: "Unresolved paper" },
        ],
      },
      {
        role: "user",
        text: "Compare this collection.",
        timestamp: 3,
        paperContexts: [paper],
        selectedCollectionContexts: [
          { collectionId: 17, libraryID: 1, name: "Drift" },
        ],
      },
    ];

    for (const [index, userMessage] of cases.entries()) {
      const assistantMessage: Message = {
        role: "assistant",
        text: `> ${quote}\n>\n> (Eppler et al., 2026)`,
        timestamp: index + 10,
      };
      chatHistory.set(conversationKey, [userMessage, assistantMessage]);
      finalizeAssistantMessageQuoteCitationsForTests(assistantMessage, {
        pairedUserMessage: userMessage,
        conversationKey,
      });
      await waitForAssistantQuoteValidationForTests(conversationKey);
      assert.isUndefined(assistantMessage.quoteDisplayOverride);
      assert.include(assistantMessage.text, "(Eppler et al., 2026)");
    }
  });
});
