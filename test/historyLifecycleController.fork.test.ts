import { assert } from "chai";
import {
  createHistoryLifecycleController,
  type HistoryLifecycleControllerDeps,
} from "../src/modules/contextPanel/setupHandlers/controllers/historyLifecycleController";
import { createGlobalPortalItem } from "../src/modules/contextPanel/portalScope";
import {
  chatHistory,
  loadedConversationKeys,
} from "../src/modules/contextPanel/state";
import type { Message } from "../src/modules/contextPanel/types";
import {
  conversationRepository,
  type ConversationCatalogEntry,
} from "../src/core/conversations/repository";

const LIBRARY_ID = 7;
const SOURCE_CONVERSATION_KEY = 2_000_000_021;
const TARGET_CONVERSATION_KEY = 2_000_000_099;

class FakeClassList {
  private readonly tokens = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) this.tokens.add(token);
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) this.tokens.delete(token);
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }
}

class FakeStyle {
  display = "";
  height = "";
  maxHeight = "";

  private readonly properties = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.properties.get(name) || "";
  }
}

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  value = "";
  type = "";
  placeholder = "";
  disabled = false;
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  private readonly eventListeners = new Map<
    string,
    Array<(event: Event) => void>
  >();

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {}

  set innerHTML(value: string) {
    this.textContent = value;
    this.children.length = 0;
  }

  get innerHTML(): string {
    return this.textContent;
  }

  append(...nodes: Array<FakeElement | string>): void {
    for (const node of nodes) {
      if (typeof node === "string") {
        this.textContent += node;
      } else {
        this.appendChild(node);
      }
    }
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push((event: Event) => {
      if (typeof listener === "function") {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    });
    this.eventListeners.set(type, listeners);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.eventListeners.get(event.type) || []) {
      listener(event);
    }
    return !(event as { defaultPrevented?: boolean }).defaultPrevented;
  }

  querySelector(): FakeElement | null {
    return null;
  }

  closest(): FakeElement | null {
    return null;
  }

  focus(): void {
    // No layout in unit tests.
  }

  setSelectionRange(): void {
    // No text selection in unit tests.
  }
}

class FakeDocument {
  readonly defaultView = {
    innerHeight: 800,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    getComputedStyle: () => ({
      backgroundColor: "rgb(255, 255, 255)",
      getPropertyValue: () => "",
    }),
  };
  readonly documentElement: FakeElement;
  readonly body: FakeElement;

  constructor() {
    this.documentElement = new FakeElement(this, "html");
    this.body = new FakeElement(this, "body");
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }
}

function makeMessage(role: Message["role"], text: string, timestamp: number) {
  return { role, text, timestamp } satisfies Message;
}

function makeCatalogEntry(params: {
  conversationKey: number;
  kind?: "global" | "paper";
  title?: string;
  libraryID?: number;
  paperItemID?: number;
}): ConversationCatalogEntry {
  return {
    conversationID: `test:${params.conversationKey}`,
    conversationKey: params.conversationKey,
    system: "upstream",
    kind: params.kind || "global",
    libraryID: params.libraryID || LIBRARY_ID,
    paperItemID: params.paperItemID,
    createdAt: 1,
    lastActivityAt: 1,
    title: params.title || "Forked conversation",
    userTurnCount: 0,
  };
}

function createControllerHarness() {
  const doc = new FakeDocument();
  const body = new FakeElement(doc, "div") as unknown as HTMLElement;
  const panelRoot = new FakeElement(doc, "div") as unknown as HTMLElement;
  const inputBox = new FakeElement(
    doc,
    "textarea",
  ) as unknown as HTMLTextAreaElement;
  const status = new FakeElement(doc, "div") as unknown as HTMLElement;
  const historyUndo = new FakeElement(doc, "div") as unknown as HTMLElement;
  const historyUndoText = new FakeElement(
    doc,
    "span",
  ) as unknown as HTMLElement;
  const topToast = new FakeElement(doc, "div") as unknown as HTMLElement;
  let currentItem: Zotero.Item | null = createGlobalPortalItem(
    LIBRARY_ID,
    SOURCE_CONVERSATION_KEY,
  );

  const deps: HistoryLifecycleControllerDeps = {
    body,
    inputBox,
    panelRoot,
    status,
    historyBar: null,
    titleStatic: null,
    historyNewBtn: null,
    historyNewMenu: null,
    historyNewOpenBtn: null,
    historyNewPaperBtn: null,
    historyToggleBtn: null,
    historyMenu: null,
    historyRowMenu: null,
    historyRowRenameBtn: null,
    historyUndo,
    historyUndoText,
    historyUndoBtn: null,
    topToast,
    modeChipBtn: null,
    claudeSystemToggleBtn: null,
    getItem: () => currentItem,
    setItem: (item) => {
      currentItem = item;
    },
    getBasePaperItem: () => null,
    setBasePaperItem: () => undefined,
    getConversationSystem: () => "upstream",
    isClaudeConversationSystem: () => false,
    isCodexConversationSystem: () => false,
    isRuntimeConversationSystem: () => false,
    isNoteSession: () => false,
    isGlobalMode: () => true,
    isPaperMode: () => false,
    isWebChatMode: () => false,
    getCurrentLibraryID: () => LIBRARY_ID,
    resolveCurrentPaperBaseItem: () => null,
    getManualPaperContextsForItem: () => [],
    resolveAutoLoadedPaperContext: () => null,
    refreshAutoLoadedPaperContextForCurrentItem: () => undefined,
    persistDraftInputForCurrentConversation: () => undefined,
    restoreDraftInputForCurrentConversation: () => undefined,
    syncConversationIdentity: () => undefined,
    syncQueuedFollowUpRegistration: () => undefined,
    updateRuntimeModeButton: () => undefined,
    updateClaudeSystemToggle: () => undefined,
    refreshChatPreservingScroll: () => undefined,
    resetComposePreviewUI: () => undefined,
    updateModelButton: () => undefined,
    updateReasoningButton: () => undefined,
    updatePaperPreviewPreservingScroll: () => undefined,
    clearForcedSkill: () => undefined,
    closePaperPicker: () => undefined,
    closePromptMenu: () => undefined,
    closeResponseMenu: () => undefined,
    closeRetryModelMenu: () => undefined,
    closeExportMenu: () => undefined,
    closeHistoryRowMenu: () => undefined,
    closeHistoryNewMenu: () => undefined,
    closeHistoryMenu: () => undefined,
    isHistoryMenuOpen: () => false,
    isHistoryNewMenuOpen: () => false,
    runWithChatScrollGuard: (fn) => fn(),
    clearSelectedImageState: () => undefined,
    clearSelectedFileState: () => undefined,
    clearSelectedTextState: () => undefined,
    clearDraftInputState: () => undefined,
    clearTransientComposeStateForItem: () => undefined,
    scheduleAttachmentGc: () => undefined,
    notifyConversationHistoryChanged: () => undefined,
    renderWebChatHistoryMenu: async () => undefined,
    closeModelMenu: () => undefined,
    closeReasoningMenu: () => undefined,
    closeSlashMenu: () => undefined,
    getSelectedModelInfo: () => ({
      selectedEntryId: "",
      selectedEntry: null,
      currentModel: "",
    }),
    markNextWebChatSendAsNewChat: () => undefined,
    primeFreshWebChatPaperChipState: () => undefined,
    updateImagePreviewPreservingScroll: () => undefined,
    getPreferredTargetSystem: () => "upstream",
    switchConversationSystem: async () => undefined,
    setActiveEditSession: () => undefined,
    getCoreAgentRuntime: async () => ({}) as any,
    log: () => undefined,
  };

  return {
    controller: createHistoryLifecycleController(deps),
    item: currentItem,
    historyUndo: historyUndo as unknown as FakeElement,
    historyUndoText: historyUndoText as unknown as FakeElement,
    topToast: topToast as unknown as FakeElement,
    status: status as unknown as FakeElement,
  };
}

describe("historyLifecycleController fork behavior", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: Record<string, any>;
  };
  let originalZotero: Record<string, any> | undefined;
  let originalDeleteTurnMessages: typeof conversationRepository.deleteTurnMessages;
  let originalEnsureCatalogEntry: typeof conversationRepository.ensureCatalogEntry;
  let originalForkConversation: typeof conversationRepository.forkConversation;
  let originalLoadMessages: typeof conversationRepository.loadMessages;

  beforeEach(function () {
    originalZotero = globalScope.Zotero;
    originalDeleteTurnMessages = conversationRepository.deleteTurnMessages;
    originalEnsureCatalogEntry = conversationRepository.ensureCatalogEntry;
    originalForkConversation = conversationRepository.forkConversation;
    originalLoadMessages = conversationRepository.loadMessages;
    globalScope.Zotero = {
      ...(originalZotero || {}),
      locale: "zh-CN",
      Libraries: { userLibraryID: LIBRARY_ID },
      Items: { get: () => null },
      DB: {
        queryAsync: async () => [],
        executeTransaction: async (fn: () => Promise<unknown>) => await fn(),
      },
      debug: () => undefined,
    };
    chatHistory.delete(SOURCE_CONVERSATION_KEY);
    chatHistory.delete(TARGET_CONVERSATION_KEY);
    loadedConversationKeys.delete(SOURCE_CONVERSATION_KEY);
    loadedConversationKeys.delete(TARGET_CONVERSATION_KEY);
  });

  afterEach(function () {
    conversationRepository.deleteTurnMessages = originalDeleteTurnMessages;
    conversationRepository.ensureCatalogEntry = originalEnsureCatalogEntry;
    conversationRepository.forkConversation = originalForkConversation;
    conversationRepository.loadMessages = originalLoadMessages;
    chatHistory.delete(SOURCE_CONVERSATION_KEY);
    chatHistory.delete(TARGET_CONVERSATION_KEY);
    loadedConversationKeys.delete(SOURCE_CONVERSATION_KEY);
    loadedConversationKeys.delete(TARGET_CONVERSATION_KEY);
    globalScope.Zotero = originalZotero;
  });

  it("finalizes a pending deleted turn before forking through a later turn and shows the top toast", async function () {
    const events: string[] = [];
    const deleteCalls: Array<
      Parameters<typeof conversationRepository.deleteTurnMessages>[0]
    > = [];
    const forkCalls: Array<
      Parameters<typeof conversationRepository.forkConversation>[0]
    > = [];
    conversationRepository.deleteTurnMessages = async (params) => {
      events.push("deleteTurnMessages");
      deleteCalls.push(params);
    };
    conversationRepository.ensureCatalogEntry = async (params) =>
      makeCatalogEntry({
        conversationKey: params.conversationKey || TARGET_CONVERSATION_KEY,
        kind: params.kind,
        libraryID: params.libraryID,
        paperItemID: params.paperItemID,
      });
    conversationRepository.forkConversation = async (params) => {
      events.push("forkConversation");
      forkCalls.push(params);
      return {
        entry: makeCatalogEntry({
          conversationKey: TARGET_CONVERSATION_KEY,
          kind: params.kind,
          libraryID: params.libraryID,
          paperItemID: params.paperItemID,
        }),
        copiedMessageCount: 4,
      };
    };
    conversationRepository.loadMessages = async () => [];

    const { controller, item, historyUndo, historyUndoText, topToast, status } =
      createControllerHarness();
    chatHistory.set(SOURCE_CONVERSATION_KEY, [
      makeMessage("user", "First", 100),
      makeMessage("assistant", "First answer", 200),
      makeMessage("user", "Deleted", 300),
      makeMessage("assistant", "Deleted answer", 400),
      makeMessage("user", "Fork target", 500),
      makeMessage("assistant", "Fork target answer", 600),
    ]);
    loadedConversationKeys.add(SOURCE_CONVERSATION_KEY);

    await controller.queueTurnDeletion({
      conversationKey: SOURCE_CONVERSATION_KEY,
      userTimestamp: 300,
      assistantTimestamp: 400,
    });

    assert.isTrue(
      controller.hasPendingTurnDeletionForConversation(SOURCE_CONVERSATION_KEY),
    );
    assert.equal(historyUndo.style.display, "flex");
    assert.equal(
      historyUndoText.textContent,
      "\u5df2\u5220\u9664\u4e00\u8f6e\u5bf9\u8bdd",
    );
    assert.deepEqual(
      (chatHistory.get(SOURCE_CONVERSATION_KEY) || []).map(
        (message) => message.timestamp,
      ),
      [100, 200, 500, 600],
    );

    await controller.forkConversationFromTurn({
      item,
      conversationKey: SOURCE_CONVERSATION_KEY,
      userTimestamp: 500,
      assistantTimestamp: 600,
    });

    assert.deepEqual(events, ["deleteTurnMessages", "forkConversation"]);
    assert.deepEqual(deleteCalls, [
      {
        system: "upstream",
        conversationKey: SOURCE_CONVERSATION_KEY,
        userTimestamp: 300,
        assistantTimestamp: 400,
      },
    ]);
    assert.deepEqual(forkCalls, [
      {
        system: "upstream",
        kind: "global",
        libraryID: LIBRARY_ID,
        paperItemID: undefined,
        sourceConversationKey: SOURCE_CONVERSATION_KEY,
        throughAssistantTimestamp: 600,
      },
    ]);
    assert.isFalse(
      controller.hasPendingTurnDeletionForConversation(SOURCE_CONVERSATION_KEY),
    );
    assert.equal(topToast.style.display, "flex");
    assert.equal(topToast.getAttribute("aria-hidden"), "false");
    assert.isTrue(topToast.classList.contains("llm-top-toast-visible"));
    assert.equal(topToast.textContent, "\u5bf9\u8bdd\u5df2 fork");
    assert.equal(status.textContent, "\u5bf9\u8bdd\u5df2 fork");
  });

  it("does not finalize a later pending deletion before forking an earlier turn", async function () {
    const events: string[] = [];
    const deleteCalls: Array<
      Parameters<typeof conversationRepository.deleteTurnMessages>[0]
    > = [];
    conversationRepository.deleteTurnMessages = async (params) => {
      events.push("deleteTurnMessages");
      deleteCalls.push(params);
    };
    conversationRepository.ensureCatalogEntry = async (params) =>
      makeCatalogEntry({
        conversationKey: params.conversationKey || TARGET_CONVERSATION_KEY,
        kind: params.kind,
        libraryID: params.libraryID,
        paperItemID: params.paperItemID,
      });
    conversationRepository.forkConversation = async (params) => {
      events.push("forkConversation");
      return {
        entry: makeCatalogEntry({
          conversationKey: TARGET_CONVERSATION_KEY,
          kind: params.kind,
          libraryID: params.libraryID,
          paperItemID: params.paperItemID,
        }),
        copiedMessageCount: 2,
      };
    };
    conversationRepository.loadMessages = async () => [];

    const { controller, item } = createControllerHarness();
    chatHistory.set(SOURCE_CONVERSATION_KEY, [
      makeMessage("user", "Fork target", 100),
      makeMessage("assistant", "Fork target answer", 200),
      makeMessage("user", "Deleted later", 300),
      makeMessage("assistant", "Deleted later answer", 400),
    ]);
    loadedConversationKeys.add(SOURCE_CONVERSATION_KEY);

    await controller.queueTurnDeletion({
      conversationKey: SOURCE_CONVERSATION_KEY,
      userTimestamp: 300,
      assistantTimestamp: 400,
    });
    await controller.forkConversationFromTurn({
      item,
      conversationKey: SOURCE_CONVERSATION_KEY,
      userTimestamp: 100,
      assistantTimestamp: 200,
    });

    assert.deepEqual(events, ["forkConversation"]);
    assert.deepEqual(deleteCalls, []);
    assert.isTrue(
      controller.hasPendingTurnDeletionForConversation(SOURCE_CONVERSATION_KEY),
    );
  });
});
