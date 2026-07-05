import { assert } from "chai";
import { getClaudeRuntimeModelEntries } from "../src/claudeCode/runtime";

describe("Claude Code runtime model entries", function () {
  it("does not expose manual input mode overrides", function () {
    const entries = getClaudeRuntimeModelEntries();

    assert.isAbove(entries.length, 0);
    for (const entry of entries) {
      assert.equal(entry.providerLabel, "Claude Code");
      assert.isUndefined(entry.advanced.inputMode);
    }
  });
});
