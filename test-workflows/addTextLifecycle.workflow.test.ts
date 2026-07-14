import { assert } from "chai";
import type {
  WorkflowTestApi,
  WorkflowTestFixture,
} from "../src/modules/contextPanel/workflowTestTypes";

function getWorkflowTestApi(): WorkflowTestApi {
  const api = (Zotero as any).LLMForZotero?.api?.workflowTest;
  assert.isOk(api, "workflow test API should be installed");
  return api as WorkflowTestApi;
}

describe("workflow: Add Text lifecycle", function () {
  this.timeout(45000);

  let api: WorkflowTestApi;
  let fixture: WorkflowTestFixture | null = null;

  beforeEach(async function () {
    api = getWorkflowTestApi();
    await api.reset();
  });

  afterEach(async function () {
    if (fixture) {
      await api.cleanupFixture(fixture);
      fixture = null;
    }
    await api.reset();
  });

  it("repairs a listener lost after plugin startup", async function () {
    const diagnostics = await api.exerciseReaderSelectionTrackingRecovery();

    assert.equal(diagnostics.before, 1, JSON.stringify(diagnostics));
    assert.equal(diagnostics.afterDrop, 0, JSON.stringify(diagnostics));
    assert.equal(diagnostics.afterHealthCheck, 1, JSON.stringify(diagnostics));
    assert.isTrue(diagnostics.markerPresent, JSON.stringify(diagnostics));
    assert.isTrue(diagnostics.markerLive, JSON.stringify(diagnostics));
    assert.isBelow(diagnostics.elapsedMs, 2000, JSON.stringify(diagnostics));
  });

  it("preserves a non-first-page PDF highlight through the final model request", async function () {
    const filler = (label: string, count: number) =>
      Array.from(
        { length: count },
        (_, index) =>
          `${label} evidence sentence ${index + 1} describes stable local context for retrieval.`,
      ).join(" ");
    const selectedText = "HIGHLIGHT_PAGE_TWO_ANCHOR_RESULT";
    const precedingMarker = "PRECEDING_LOCKED_CHUNK_MARKER";
    const followingMarker = "FOLLOWING_LOCKED_CHUNK_MARKER";
    fixture = await api.createPaperWithPdfFixture({
      title: "Workflow Highlight-Aware Retrieval",
      pdfTitle: "Workflow Highlight-Aware Retrieval PDF",
      pages: [
        `${filler("page one", 38)} ${precedingMarker}`,
        `${filler("page two before", 20)} ${selectedText} ${filler(
          "page two after",
          20,
        )}`,
        `${followingMarker} ${filler("page three", 38)}`,
      ],
    });
    const panel = await api.renderPanelForItem(fixture.parentItemId);

    const diagnostics = await api.exerciseHighlightAwareContextRetrieval({
      panelId: panel.panelId,
      attachmentItemId: fixture.pdfAttachmentId,
      pageIndex: 1,
      selectedText,
      question: "Explain the highlighted result.",
    });
    const diagnosticMessage = JSON.stringify({
      readerItemId: diagnostics.readerItemId,
      addTextButtonLabel: diagnostics.addTextButtonLabel,
      selectedContext: diagnostics.selectedContext,
      resolvedAnchor: {
        contextItemId: diagnostics.resolvedAnchor.contextItemId,
        pageIndex: diagnostics.resolvedAnchor.pageIndex,
        pageLabel: diagnostics.resolvedAnchor.pageLabel,
        resolution: diagnostics.resolvedAnchor.resolution,
        primaryChunkIndex: diagnostics.resolvedAnchor.primaryChunkIndex,
        preferredChunkIndexes: diagnostics.resolvedAnchor.preferredChunkIndexes,
        injectedChars: diagnostics.resolvedAnchor.injectedChars,
      },
      finalPrompt: diagnostics.lastFinalRequest.prompt,
      finalStrategy: diagnostics.lastFinalRequest.strategy,
      finalContextHasSelectedText:
        diagnostics.lastFinalRequest.combinedContext.includes(selectedText),
      finalContextHasPrecedingMarker:
        diagnostics.lastFinalRequest.combinedContext.includes(precedingMarker),
      finalContextHasFollowingMarker:
        diagnostics.lastFinalRequest.combinedContext.includes(followingMarker),
    });

    assert.equal(
      diagnostics.readerItemId,
      fixture.pdfAttachmentId,
      diagnosticMessage,
    );
    assert.equal(diagnostics.addTextButtonLabel, "Add Text", diagnosticMessage);
    assert.equal(
      diagnostics.selectedContext.contextItemId,
      fixture.pdfAttachmentId,
      diagnosticMessage,
    );
    assert.equal(diagnostics.selectedContext.pageIndex, 1, diagnosticMessage);
    assert.equal(diagnostics.selectedContext.pageLabel, "2", diagnosticMessage);
    assert.equal(
      diagnostics.resolvedAnchor.resolution,
      "chunks",
      diagnosticMessage,
    );
    assert.lengthOf(
      diagnostics.resolvedAnchor.preferredChunkIndexes,
      3,
      diagnosticMessage,
    );
    assert.include(
      diagnostics.resolvedAnchor.contextText,
      selectedText,
      diagnosticMessage,
    );
    assert.include(
      diagnostics.resolvedAnchor.contextText,
      precedingMarker,
      diagnosticMessage,
    );
    assert.include(
      diagnostics.resolvedAnchor.contextText,
      "[following local context]",
      diagnosticMessage,
    );
    assert.include(
      diagnostics.lastFinalRequest.prompt,
      `attachment_id=${fixture.pdfAttachmentId}`,
      diagnosticMessage,
    );
    assert.include(
      diagnostics.lastFinalRequest.prompt,
      "page_label=2",
      diagnosticMessage,
    );
    assert.include(
      diagnostics.lastFinalRequest.prompt,
      "page_index=1",
      diagnosticMessage,
    );
    assert.include(
      diagnostics.lastFinalRequest.prompt,
      "location_resolution=chunks",
      diagnosticMessage,
    );
    assert.include(
      diagnostics.lastFinalRequest.combinedContext,
      selectedText,
      diagnosticMessage,
    );
    assert.include(
      diagnostics.lastFinalRequest.combinedContext,
      precedingMarker,
      diagnosticMessage,
    );
    assert.include(
      diagnostics.lastFinalRequest.combinedContext,
      followingMarker,
      diagnosticMessage,
    );
  });
});
