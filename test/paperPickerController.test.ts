import { assert } from "chai";
import { describe, it } from "mocha";
import {
  createPaperPickerController,
  positionPaperPickerForAnchor,
} from "../src/modules/contextPanel/setupHandlers/controllers/paperPickerController";
import { MAX_SELECTED_PAPER_CONTEXTS } from "../src/modules/contextPanel/constants";
import { invalidatePaperSearchCache } from "../src/modules/contextPanel/paperSearch";
import {
  paperContextModeOverrides,
  selectedPaperContextCache,
  selectedPaperPreviewExpandedCache,
} from "../src/modules/contextPanel/state";
import type { PaperContextRef } from "../src/modules/contextPanel/types";

function makeRegularItem(index: number): Zotero.Item {
  const itemId = 1_000 + index;
  const attachmentId = 2_000 + index;
  return {
    id: itemId,
    key: `ITEM-${itemId}`,
    libraryID: 1,
    dateAdded: "2026-01-01T00:00:00Z",
    dateModified: "2026-01-01T00:00:00Z",
    firstCreator: "Tester",
    isAttachment: () => false,
    isRegularItem: () => true,
    getAttachments: () => [attachmentId],
    getCollections: () => [],
    getCreators: () => [],
    getNotes: () => [],
    getField: (field: string) => {
      switch (field) {
        case "title":
          return `Picker Paper ${index}`;
        case "firstCreator":
          return "Tester";
        case "year":
          return "2026";
        default:
          return "";
      }
    },
  } as unknown as Zotero.Item;
}

function makeAttachment(index: number): Zotero.Item {
  return {
    id: 2_000 + index,
    key: `ATTACH-${2_000 + index}`,
    libraryID: 1,
    dateAdded: "2026-01-01T00:00:00Z",
    dateModified: "2026-01-01T00:00:00Z",
    parentID: 1_000 + index,
    attachmentContentType: "application/pdf",
    isAttachment: () => true,
    isRegularItem: () => false,
    getAttachments: () => [],
    getCollections: () => [],
    getCreators: () => [],
    getField: (field: string) =>
      field === "title" ? `Picker Paper ${index} PDF` : "",
  } as unknown as Zotero.Item;
}

class FakeClassList {
  private tokens = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) this.tokens.add(token);
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) this.tokens.delete(token);
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }

  toggle(token: string, force?: boolean): boolean {
    const shouldAdd = force === undefined ? !this.tokens.has(token) : force;
    if (shouldAdd) this.tokens.add(token);
    else this.tokens.delete(token);
    return shouldAdd;
  }
}

class FakeStyle {
  display = "";
  private properties = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.properties.get(name) || "";
  }

  removeProperty(name: string): string {
    const previous = this.getPropertyValue(name);
    this.properties.delete(name);
    return previous;
  }
}

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  tabIndex = 0;
  scrollTop = 0;
  scrollHeight = 0;
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  private rect: DOMRect = makeRect();

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

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(): void {
    // The selector toggle test drives the controller method directly.
  }

  scrollIntoView(): void {
    // No layout in unit tests.
  }

  setBoundingClientRect(rect: Partial<DOMRect>): void {
    this.rect = makeRect(rect);
  }

  getBoundingClientRect(): DOMRect {
    return this.rect;
  }
}

class FakeDocument {
  defaultView = {
    innerHeight: 800,
    setTimeout: (handler: TimerHandler, timeout?: number) =>
      setTimeout(handler, timeout),
    clearTimeout: (handle?: number) => clearTimeout(handle),
  };
  documentElement = { clientHeight: 800 };

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }
}

function makeRect(rect: Partial<DOMRect> = {}): DOMRect {
  const left = rect.left ?? rect.x ?? 0;
  const top = rect.top ?? rect.y ?? 0;
  const width =
    rect.width ?? (rect.right !== undefined ? rect.right - left : 0);
  const height =
    rect.height ?? (rect.bottom !== undefined ? rect.bottom - top : 0);
  const right = rect.right ?? left + width;
  const bottom = rect.bottom ?? top + height;
  return {
    x: rect.x ?? left,
    y: rect.y ?? top,
    top,
    right,
    bottom,
    left,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeFakeInput(value: string): HTMLTextAreaElement {
  return {
    value,
    selectionStart: value.length,
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start;
      (this as { selectionEnd?: number }).selectionEnd = end;
    },
    focus: () => undefined,
  } as unknown as HTMLTextAreaElement;
}

function waitForPickerSearch(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 160));
}

describe("paper picker placement", function () {
  function makePlacementFixture(viewportHeight: number) {
    const fakeDocument = new FakeDocument();
    fakeDocument.defaultView.innerHeight = viewportHeight;
    fakeDocument.documentElement.clientHeight = viewportHeight;
    const body = fakeDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    const panelRoot = fakeDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    const inputSection = fakeDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    const paperPicker = fakeDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    inputSection.appendChild(paperPicker);
    panelRoot.setBoundingClientRect({
      top: 0,
      bottom: viewportHeight,
      height: viewportHeight,
    });
    return { body, panelRoot, inputSection, paperPicker };
  }

  it("prefers opening above the full input section when room exists", function () {
    const { body, panelRoot, inputSection, paperPicker } =
      makePlacementFixture(800);
    inputSection.setBoundingClientRect({ top: 500, bottom: 660, height: 160 });

    positionPaperPickerForAnchor({
      body: body as unknown as Element,
      panelRoot: panelRoot as unknown as HTMLElement,
      paperPicker: paperPicker as unknown as HTMLDivElement,
      anchor: inputSection as unknown as HTMLElement,
    });

    assert.isFalse(paperPicker.classList.contains("llm-paper-picker-below"));
    assert.equal(
      paperPicker.style.getPropertyValue("--llm-paper-picker-max-height"),
      "280px",
    );
  });

  it("keeps the picker above and scrollable when above space is constrained", function () {
    const { body, panelRoot, inputSection, paperPicker } =
      makePlacementFixture(600);
    inputSection.setBoundingClientRect({ top: 180, bottom: 340, height: 160 });

    positionPaperPickerForAnchor({
      body: body as unknown as Element,
      panelRoot: panelRoot as unknown as HTMLElement,
      paperPicker: paperPicker as unknown as HTMLDivElement,
      anchor: inputSection as unknown as HTMLElement,
    });

    assert.isFalse(paperPicker.classList.contains("llm-paper-picker-below"));
    assert.equal(
      paperPicker.style.getPropertyValue("--llm-paper-picker-max-height"),
      "160px",
    );
  });

  it("falls back below only when above space is not useful", function () {
    const { body, panelRoot, inputSection, paperPicker } =
      makePlacementFixture(600);
    inputSection.setBoundingClientRect({ top: 80, bottom: 300, height: 220 });

    positionPaperPickerForAnchor({
      body: body as unknown as Element,
      panelRoot: panelRoot as unknown as HTMLElement,
      paperPicker: paperPicker as unknown as HTMLDivElement,
      anchor: inputSection as unknown as HTMLElement,
    });

    assert.isTrue(paperPicker.classList.contains("llm-paper-picker-below"));
    assert.equal(
      paperPicker.style.getPropertyValue("--llm-paper-picker-max-height"),
      "240px",
    );
  });
});

describe("paper picker controller", function () {
  it("allows 30 manually selected paper contexts and rejects the 31st", function () {
    const originalZotero = (
      globalThis as typeof globalThis & { Zotero?: unknown }
    ).Zotero;
    const itemId = 42;
    const items = Array.from(
      { length: MAX_SELECTED_PAPER_CONTEXTS + 1 },
      (_, index) => makeRegularItem(index + 1),
    );
    const attachments = new Map<number, Zotero.Item>();
    for (let index = 1; index <= MAX_SELECTED_PAPER_CONTEXTS + 1; index += 1) {
      attachments.set(2_000 + index, makeAttachment(index));
    }
    const statuses: Array<{ message: string; level: string }> = [];

    (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero = {
      Items: {
        get(id: number) {
          return attachments.get(id) || null;
        },
      },
    };
    selectedPaperContextCache.delete(itemId);
    selectedPaperPreviewExpandedCache.delete(itemId);

    try {
      const controller = createPaperPickerController({
        body: {} as Element,
        panelRoot: {} as HTMLElement,
        inputBox: {} as HTMLTextAreaElement,
        paperPicker: null,
        paperPickerList: null,
        getItem: () => ({ id: itemId }) as Zotero.Item,
        getCurrentLibraryID: () => 1,
        isWebChatMode: () => false,
        resolveAutoLoadedPaperContext: () => null,
        getManualPaperContextsForItem: () =>
          selectedPaperContextCache.get(itemId) || [],
        isPaperContextMineru: () => false,
        getTextContextConversationKey: () => null,
        persistDraftInputForCurrentConversation: () => undefined,
        updatePaperPreviewPreservingScroll: () => undefined,
        updateSelectedTextPreviewPreservingScroll: () => undefined,
        setStatusMessage: (message, level) => statuses.push({ message, level }),
        log: () => undefined,
      });

      controller.addZoteroItemsAsPaperContext(
        items.slice(0, MAX_SELECTED_PAPER_CONTEXTS),
      );
      assert.lengthOf(
        selectedPaperContextCache.get(itemId) as PaperContextRef[],
        MAX_SELECTED_PAPER_CONTEXTS,
      );

      controller.addZoteroItemsAsPaperContext([
        items[MAX_SELECTED_PAPER_CONTEXTS],
      ]);
      assert.lengthOf(
        selectedPaperContextCache.get(itemId) as PaperContextRef[],
        MAX_SELECTED_PAPER_CONTEXTS,
      );
      assert.deepInclude(statuses, {
        message: `Paper Context up to ${MAX_SELECTED_PAPER_CONTEXTS}`,
        level: "error",
      });
    } finally {
      selectedPaperContextCache.delete(itemId);
      selectedPaperPreviewExpandedCache.delete(itemId);
      (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero =
        originalZotero;
    }
  });

  it("toggles a selected paper row off when selected again", async function () {
    const originalZotero = (
      globalThis as typeof globalThis & { Zotero?: unknown }
    ).Zotero;
    const originalToolkit = (
      globalThis as typeof globalThis & { ztoolkit?: any }
    ).ztoolkit;
    const itemId = 43;
    const paper = makeRegularItem(1);
    const attachment = makeAttachment(1);
    const items = new Map<number, Zotero.Item>([
      [paper.id, paper],
      [attachment.id, attachment],
    ]);
    const statuses: Array<{ message: string; level: string }> = [];
    const fakeDocument = new FakeDocument();
    const paperPicker = fakeDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as unknown as HTMLDivElement;
    const paperPickerList = fakeDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as unknown as HTMLDivElement;
    const body = fakeDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as unknown as Element;
    const inputBox = makeFakeInput("@Picker");

    (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero = {
      Items: {
        getAll: async () => [paper],
        get: (id: number) => items.get(id) || null,
      },
      Collections: {
        getByLibrary: () => [],
      },
      Libraries: {
        getName: () => "My Library",
      },
    };
    (globalThis as typeof globalThis & { ztoolkit?: unknown }).ztoolkit = {
      log: () => undefined,
    };
    invalidatePaperSearchCache(1);
    selectedPaperContextCache.delete(itemId);
    selectedPaperPreviewExpandedCache.delete(itemId);
    paperContextModeOverrides.delete(`${itemId}:${paper.id}:${attachment.id}`);

    try {
      const controller = createPaperPickerController({
        body,
        panelRoot: body as HTMLElement,
        inputBox,
        paperPicker,
        paperPickerList,
        getItem: () => ({ id: itemId }) as Zotero.Item,
        getCurrentLibraryID: () => 1,
        isWebChatMode: () => false,
        resolveAutoLoadedPaperContext: () => null,
        getManualPaperContextsForItem: () =>
          selectedPaperContextCache.get(itemId) || [],
        isPaperContextMineru: () => false,
        getTextContextConversationKey: () => null,
        persistDraftInputForCurrentConversation: () => undefined,
        updatePaperPreviewPreservingScroll: () => undefined,
        updateSelectedTextPreviewPreservingScroll: () => undefined,
        setStatusMessage: (message, level) => statuses.push({ message, level }),
        log: () => undefined,
      });

      controller.schedulePaperPickerSearch();
      await waitForPickerSearch();

      controller.selectActiveRow();
      assert.lengthOf(
        selectedPaperContextCache.get(itemId) as PaperContextRef[],
        1,
      );

      controller.selectActiveRow();
      assert.isUndefined(selectedPaperContextCache.get(itemId));
      assert.deepInclude(statuses, {
        message: "Paper context removed (0)",
        level: "ready",
      });
    } finally {
      selectedPaperContextCache.delete(itemId);
      selectedPaperPreviewExpandedCache.delete(itemId);
      paperContextModeOverrides.delete(
        `${itemId}:${paper.id}:${attachment.id}`,
      );
      invalidatePaperSearchCache(1);
      (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero =
        originalZotero;
      (globalThis as typeof globalThis & { ztoolkit?: unknown }).ztoolkit =
        originalToolkit;
    }
  });
});
