export const READER_TEXT_SELECTION_POPUP_EVENT =
  "renderTextSelectionPopup" as const;

export type ReaderSelectionTrackingRecord<THandler> = {
  pluginID: string;
  type: typeof READER_TEXT_SELECTION_POPUP_EVENT;
  handler: THandler;
};

export type ReaderSelectionListenerRecord<THandler = unknown> = {
  pluginID?: string;
  type?: string;
  handler?: THandler | unknown;
};

export type ReaderSelectionTrackingReader<THandler> = {
  __llmSelectionTracking?: ReaderSelectionTrackingRecord<THandler>;
  _registeredListeners?: ReaderSelectionListenerRecord<THandler>[];
  registerEventListener: (
    type: typeof READER_TEXT_SELECTION_POPUP_EVENT,
    handler: THandler,
    pluginID?: string,
  ) => void;
};

function getReaderListenerRecords<THandler>(
  readerAPI: ReaderSelectionTrackingReader<THandler>,
): ReaderSelectionListenerRecord<THandler>[] | null {
  return Array.isArray(readerAPI._registeredListeners)
    ? readerAPI._registeredListeners
    : null;
}

function isPluginSelectionListener<THandler>(
  listener: ReaderSelectionListenerRecord<THandler>,
  pluginID: string,
): boolean {
  return (
    listener.pluginID === pluginID &&
    listener.type === READER_TEXT_SELECTION_POPUP_EVENT
  );
}

export function hasReaderSelectionTrackingListener<THandler>(
  readerAPI: ReaderSelectionTrackingReader<THandler>,
  tracking: ReaderSelectionTrackingRecord<THandler>,
): boolean | null {
  const listeners = getReaderListenerRecords(readerAPI);
  if (!listeners) return null;
  return listeners.some(
    (listener) =>
      isPluginSelectionListener(listener, tracking.pluginID) &&
      listener.handler === tracking.handler,
  );
}

export function removeReaderSelectionTrackingListeners<THandler>(
  readerAPI: ReaderSelectionTrackingReader<THandler>,
  pluginID: string,
): boolean {
  const listeners = getReaderListenerRecords(readerAPI);
  if (!listeners) return false;
  const nextListeners = listeners.filter(
    (listener) => !isPluginSelectionListener(listener, pluginID),
  );
  if (nextListeners.length === listeners.length) return false;
  readerAPI._registeredListeners = nextListeners;
  return true;
}

export function registerReaderSelectionTrackingListener<THandler>(
  readerAPI: ReaderSelectionTrackingReader<THandler>,
  pluginID: string,
  handler: THandler,
): boolean {
  const existingTracking = readerAPI.__llmSelectionTracking;
  if (
    existingTracking?.pluginID === pluginID &&
    existingTracking.type === READER_TEXT_SELECTION_POPUP_EVENT
  ) {
    const existingListenerPresent = hasReaderSelectionTrackingListener(
      readerAPI,
      existingTracking,
    );
    if (
      existingListenerPresent === true ||
      (existingListenerPresent === null && existingTracking.handler === handler)
    ) {
      return false;
    }
  }

  removeReaderSelectionTrackingListeners(readerAPI, pluginID);
  readerAPI.registerEventListener(
    READER_TEXT_SELECTION_POPUP_EVENT,
    handler,
    pluginID,
  );
  readerAPI.__llmSelectionTracking = {
    pluginID,
    type: READER_TEXT_SELECTION_POPUP_EVENT,
    handler,
  };
  return true;
}

export function unregisterReaderSelectionTrackingListener<THandler>(
  readerAPI: ReaderSelectionTrackingReader<THandler>,
  pluginID: string,
): boolean {
  const removedListeners = removeReaderSelectionTrackingListeners(
    readerAPI,
    pluginID,
  );
  const hadMarker =
    readerAPI.__llmSelectionTracking?.pluginID === pluginID &&
    readerAPI.__llmSelectionTracking.type === READER_TEXT_SELECTION_POPUP_EVENT;
  if (hadMarker) {
    delete readerAPI.__llmSelectionTracking;
  }
  return removedListeners || hadMarker;
}
