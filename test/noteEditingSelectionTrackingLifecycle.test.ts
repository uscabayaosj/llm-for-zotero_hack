import { assert } from "chai";
import { createNoteEditingSelectionTrackingLifecycle } from "../src/modules/contextPanel/noteEditing/selectionTrackingLifecycle";

type SelectionEventName = "selectionchange" | "mouseup" | "keyup";

class TrackingDocument {
  private readonly listeners = new Map<
    SelectionEventName,
    Set<EventListenerOrEventListenerObject>
  >();

  addEventListener(
    type: SelectionEventName,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: SelectionEventName,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: SelectionEventName): void {
    const event = { type } as Event;
    for (const listener of this.listeners.get(type) || []) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }

  listenerCount(type: SelectionEventName): number {
    return this.listeners.get(type)?.size || 0;
  }
}

describe("note editing selection tracking lifecycle", function () {
  it("disposes timers, document listeners, and its marker exactly once", function () {
    let nextTimerId = 1;
    const intervalCallbacks = new Map<number, () => void>();
    const timeoutCallbacks = new Map<number, () => void>();
    const clearedIntervals: number[] = [];
    const clearedTimeouts: number[] = [];
    const timerHost = {
      setInterval(callback: () => void): number {
        const timerId = nextTimerId++;
        intervalCallbacks.set(timerId, callback);
        return timerId;
      },
      clearInterval(timerId: number): void {
        clearedIntervals.push(timerId);
        intervalCallbacks.delete(timerId);
      },
      setTimeout(callback: () => void): number {
        const timerId = nextTimerId++;
        timeoutCallbacks.set(timerId, callback);
        return timerId;
      },
      clearTimeout(timerId: number): void {
        clearedTimeouts.push(timerId);
        timeoutCallbacks.delete(timerId);
      },
    };
    let refreshCount = 0;
    let markerCleanupCount = 0;
    const lifecycle = createNoteEditingSelectionTrackingLifecycle({
      timerHost,
      refresh: () => {
        refreshCount += 1;
      },
      onDispose: () => {
        markerCleanupCount += 1;
      },
    });
    const firstDocument = new TrackingDocument();
    const secondDocument = new TrackingDocument();

    lifecycle.trackSelectionDocument(firstDocument as unknown as Document);
    lifecycle.trackSelectionDocument(secondDocument as unknown as Document);
    firstDocument.dispatch("selectionchange");
    firstDocument.dispatch("mouseup");

    lifecycle.dispose();
    lifecycle.dispose();

    assert.deepEqual(clearedIntervals, [1]);
    assert.sameMembers(clearedTimeouts, [2, 3]);
    assert.equal(intervalCallbacks.size, 0);
    assert.equal(timeoutCallbacks.size, 0);
    assert.equal(markerCleanupCount, 1);
    assert.equal(refreshCount, 0);
    for (const doc of [firstDocument, secondDocument]) {
      assert.equal(doc.listenerCount("selectionchange"), 0);
      assert.equal(doc.listenerCount("mouseup"), 0);
      assert.equal(doc.listenerCount("keyup"), 0);
    }

    const lateDocument = new TrackingDocument();
    lifecycle.trackSelectionDocument(lateDocument as unknown as Document);
    lateDocument.dispatch("selectionchange");
    assert.equal(lateDocument.listenerCount("selectionchange"), 0);
    assert.equal(timeoutCallbacks.size, 0);
  });
});
