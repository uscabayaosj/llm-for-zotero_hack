import { assert } from "chai";
import {
  READER_TEXT_SELECTION_POPUP_EVENT,
  registerReaderSelectionTrackingListener,
  unregisterReaderSelectionTrackingListener,
  type ReaderSelectionTrackingReader,
} from "../src/modules/contextPanel/readerSelectionTracking";

type Handler = () => void;

type ListenerRecord = {
  pluginID?: string;
  type: string;
  handler: Handler;
};

type FakeReader = ReaderSelectionTrackingReader<Handler> & {
  _registeredListeners: ListenerRecord[];
};

const PLUGIN_ID = "zotero-llm@github.com.yilewang";

function makeReader(): FakeReader {
  return {
    _registeredListeners: [],
    registerEventListener(type, handler, pluginID) {
      this._registeredListeners.push({ type, handler, pluginID });
    },
  };
}

function countSelectionListeners(reader: FakeReader): number {
  return reader._registeredListeners.filter(
    (listener) =>
      listener.pluginID === PLUGIN_ID &&
      listener.type === READER_TEXT_SELECTION_POPUP_EVENT,
  ).length;
}

describe("reader selection tracking registration", function () {
  it("re-registers when Zotero removed the listener but a stale marker remains", function () {
    const reader = makeReader();
    const staleHandler = () => undefined;
    const freshHandler = () => undefined;
    reader.__llmSelectionTracking = {
      pluginID: PLUGIN_ID,
      type: READER_TEXT_SELECTION_POPUP_EVENT,
      handler: staleHandler,
    };

    const registered = registerReaderSelectionTrackingListener(
      reader,
      PLUGIN_ID,
      freshHandler,
    );

    assert.isTrue(registered);
    assert.equal(countSelectionListeners(reader), 1);
    assert.strictEqual(reader._registeredListeners[0].handler, freshHandler);
    assert.strictEqual(reader.__llmSelectionTracking?.handler, freshHandler);
  });

  it("does not duplicate an already-live selection popup listener", function () {
    const reader = makeReader();
    const handler = () => undefined;

    assert.isTrue(
      registerReaderSelectionTrackingListener(reader, PLUGIN_ID, handler),
    );
    assert.isFalse(
      registerReaderSelectionTrackingListener(reader, PLUGIN_ID, handler),
    );

    assert.equal(countSelectionListeners(reader), 1);
  });

  it("clears the marker and listener records during plugin shutdown", function () {
    const reader = makeReader();
    const handler = () => undefined;

    registerReaderSelectionTrackingListener(reader, PLUGIN_ID, handler);
    unregisterReaderSelectionTrackingListener(reader, PLUGIN_ID);

    assert.equal(countSelectionListeners(reader), 0);
    assert.isUndefined(reader.__llmSelectionTracking);
  });
});
