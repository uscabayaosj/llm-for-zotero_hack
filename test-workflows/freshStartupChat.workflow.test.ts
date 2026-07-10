import { assert } from "chai";
import type {
  WorkflowTestApi,
  WorkflowTestFixture,
  WorkflowTestNoteFixture,
  WorkflowTestStandaloneNoteFixture,
} from "../src/modules/contextPanel/workflowTestTypes";

function getWorkflowTestApi(): WorkflowTestApi {
  const api = (Zotero as any).LLMForZotero?.api?.workflowTest;
  assert.isOk(api, "workflow test API should be installed");
  return api as WorkflowTestApi;
}

function diagnosticsMessage(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

describe("workflow: fresh startup chat", function () {
  this.timeout(45000);

  let api: WorkflowTestApi;
  const fixtures: Array<
    | WorkflowTestFixture
    | WorkflowTestNoteFixture
    | WorkflowTestStandaloneNoteFixture
  > = [];

  beforeEach(async function () {
    api = getWorkflowTestApi();
    await api.reset();
  });

  afterEach(async function () {
    await api.closeStandalone();
    while (fixtures.length) {
      const fixture = fixtures.pop();
      if (fixture) await api.cleanupFixture(fixture);
    }
    await api.reset();
  });

  it("opens an embedded paper panel on a blank draft instead of the old stored conversation", async function () {
    const fixture = await api.createPaperWithPdfFixture({
      title: "Workflow Fresh Startup Paper",
      pdfTitle: "Workflow Fresh Startup PDF",
    });
    fixtures.push(fixture);

    const oldPanel = await api.renderPanelForItem(fixture.parentItemId);
    const oldMarker = "workflow old paper startup marker";
    const oldDiagnostics = await api.seedPanelStoredUserMessage(
      oldPanel.panelId,
      oldMarker,
    );
    const oldKey = oldDiagnostics.conversationKey;
    assert.isOk(oldKey, diagnosticsMessage(oldDiagnostics));
    assert.include(
      oldDiagnostics.messageText || "",
      oldMarker,
      diagnosticsMessage(oldDiagnostics),
    );

    const startupPanel = await api.renderStartupPanelForItem(
      fixture.parentItemId,
    );
    const startupDiagnostics = await api.getDiagnostics(startupPanel.panelId);
    assert.equal(
      startupDiagnostics.conversationKind,
      "paper",
      diagnosticsMessage(startupDiagnostics),
    );
    assert.notEqual(
      startupDiagnostics.conversationKey,
      oldKey,
      diagnosticsMessage(startupDiagnostics),
    );
    assert.notInclude(
      startupDiagnostics.messageText || "",
      oldMarker,
      diagnosticsMessage(startupDiagnostics),
    );
  });

  it("opens an embedded standalone note on a blank library draft", async function () {
    const fixture = await api.createStandaloneNoteFixture({
      noteHtml: "<p>Workflow standalone startup note body.</p>",
    });
    fixtures.push(fixture);

    const oldPanel = await api.renderPanelForItem(fixture.noteItemId);
    const oldMarker = "workflow old standalone-note startup marker";
    const oldDiagnostics = await api.seedPanelStoredUserMessage(
      oldPanel.panelId,
      oldMarker,
    );
    const oldKey = oldDiagnostics.conversationKey;
    assert.isOk(oldKey, diagnosticsMessage(oldDiagnostics));

    const startupPanel = await api.renderStartupPanelForItem(
      fixture.noteItemId,
    );
    const startupDiagnostics = await api.getDiagnostics(startupPanel.panelId);
    assert.equal(
      startupDiagnostics.conversationKind,
      "global",
      diagnosticsMessage(startupDiagnostics),
    );
    assert.notEqual(
      startupDiagnostics.conversationKey,
      oldKey,
      diagnosticsMessage(startupDiagnostics),
    );
    assert.notInclude(
      startupDiagnostics.messageText || "",
      oldMarker,
      diagnosticsMessage(startupDiagnostics),
    );
  });

  it("preserves the active library conversation after navigating into a paper and back", async function () {
    const standaloneNote = await api.createStandaloneNoteFixture({
      noteHtml: "<p>Workflow library navigation note.</p>",
    });
    const paper = await api.createPaperWithPdfFixture({
      title: "Workflow Library Navigation Paper",
      pdfTitle: "Workflow Library Navigation PDF",
    });
    fixtures.push(standaloneNote, paper);

    const startupPanel = await api.renderStartupPanelForItem(
      standaloneNote.noteItemId,
    );
    const marker = "workflow active library conversation marker";
    const activeLibrary = await api.seedPanelStoredUserMessage(
      startupPanel.panelId,
      marker,
    );
    assert.equal(
      activeLibrary.conversationKind,
      "global",
      diagnosticsMessage(activeLibrary),
    );

    await api.renderStartupPanelForItem(paper.parentItemId);
    const returnedPanel = await api.renderStartupPanelForItem(
      standaloneNote.noteItemId,
    );
    const returnedLibrary = await api.getDiagnostics(returnedPanel.panelId);

    assert.equal(
      returnedLibrary.conversationKey,
      activeLibrary.conversationKey,
      diagnosticsMessage(returnedLibrary),
    );
    assert.include(
      returnedLibrary.messageText || "",
      marker,
      diagnosticsMessage(returnedLibrary),
    );
  });

  it("preserves the active paper conversation when opening a standalone window after startup", async function () {
    const paper = await api.createPaperWithPdfFixture({
      title: "Workflow Standalone Persistence Paper",
      pdfTitle: "Workflow Standalone Persistence PDF",
    });
    fixtures.push(paper);

    const startupPanel = await api.renderStartupPanelForItem(
      paper.parentItemId,
    );
    const marker = "workflow active paper standalone marker";
    const activePaper = await api.seedPanelStoredUserMessage(
      startupPanel.panelId,
      marker,
    );

    const standalone = await api.openStandaloneForItem(paper.parentItemId);

    assert.equal(
      standalone.conversationKey,
      activePaper.conversationKey,
      diagnosticsMessage(standalone),
    );
    assert.include(
      standalone.messageText || "",
      marker,
      diagnosticsMessage(standalone),
    );
  });

  it("labels standalone item-note windows as ordinary paper chat", async function () {
    const fixture = await api.createItemNoteFixture({
      title: "Workflow Standalone Item Note Parent",
      pdfTitle: "Workflow Standalone Item Note PDF",
      noteHtml: "<p>Workflow item note title</p><p>Body.</p>",
    });
    fixtures.push(fixture);

    const diagnostics = await api.openStandaloneForItem(fixture.noteItemId);
    assert.equal(
      diagnostics.activeTab,
      "paper",
      diagnosticsMessage(diagnostics),
    );
    assert.equal(diagnostics.paperTabText, "Paper chat");
    assert.equal(
      diagnostics.titleText,
      "Workflow Standalone Item Note Parent",
      diagnosticsMessage(diagnostics),
    );
  });

  it("labels standalone standalone-note windows as ordinary library chat", async function () {
    const fixture = await api.createStandaloneNoteFixture({
      noteHtml: "<p>Workflow standalone note title</p><p>Body.</p>",
    });
    fixtures.push(fixture);

    const diagnostics = await api.openStandaloneForItem(fixture.noteItemId);
    assert.equal(
      diagnostics.activeTab,
      "open",
      diagnosticsMessage(diagnostics),
    );
    assert.equal(diagnostics.openTabText, "Library chat");
    assert.equal(
      diagnostics.titleText,
      "Library chat",
      diagnosticsMessage(diagnostics),
    );
  });
});
