export type NoteEditingSelectionTrackingTimerHost = {
  setInterval(callback: () => void, delay: number): number;
  clearInterval(timerId: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timerId: number): void;
};

export type NoteEditingSelectionTrackingLifecycle = {
  trackSelectionDocument: (doc: Document) => void;
  dispose: () => void;
};

export function createNoteEditingSelectionTrackingLifecycle(params: {
  timerHost: NoteEditingSelectionTrackingTimerHost;
  refresh: () => void;
  onDispose?: () => void;
  debounceDelayMs?: number;
  intervalDelayMs?: number;
}): NoteEditingSelectionTrackingLifecycle {
  const debounceDelayMs = params.debounceDelayMs ?? 150;
  const intervalDelayMs = params.intervalDelayMs ?? 250;
  const trackedSelectionDocuments = new Set<Document>();
  let debounceTimer: number | null = null;
  let immediateTimer: number | null = null;
  let disposed = false;

  const refresh = () => {
    if (!disposed) params.refresh();
  };
  const debouncedRefresh: EventListener = () => {
    if (disposed) return;
    if (debounceTimer !== null) {
      params.timerHost.clearTimeout(debounceTimer);
    }
    debounceTimer = params.timerHost.setTimeout(() => {
      debounceTimer = null;
      refresh();
    }, debounceDelayMs);
  };
  const immediateRefresh: EventListener = () => {
    if (disposed) return;
    if (immediateTimer !== null) {
      params.timerHost.clearTimeout(immediateTimer);
    }
    immediateTimer = params.timerHost.setTimeout(() => {
      immediateTimer = null;
      refresh();
    }, 0);
  };
  const intervalId = params.timerHost.setInterval(refresh, intervalDelayMs);

  const trackSelectionDocument = (doc: Document) => {
    if (disposed || trackedSelectionDocuments.has(doc)) return;
    trackedSelectionDocuments.add(doc);
    doc.addEventListener("selectionchange", debouncedRefresh, true);
    doc.addEventListener("mouseup", immediateRefresh, true);
    doc.addEventListener("keyup", immediateRefresh, true);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    params.timerHost.clearInterval(intervalId);
    if (debounceTimer !== null) {
      params.timerHost.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (immediateTimer !== null) {
      params.timerHost.clearTimeout(immediateTimer);
      immediateTimer = null;
    }
    for (const doc of trackedSelectionDocuments) {
      doc.removeEventListener("selectionchange", debouncedRefresh, true);
      doc.removeEventListener("mouseup", immediateRefresh, true);
      doc.removeEventListener("keyup", immediateRefresh, true);
    }
    trackedSelectionDocuments.clear();
    params.onDispose?.();
  };

  return { trackSelectionDocument, dispose };
}
