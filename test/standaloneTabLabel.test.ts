import { assert } from "chai";
import { resolveStandalonePaperTabLabel } from "../src/modules/contextPanel/standaloneTabLabel";

describe("standaloneTabLabel", function () {
  it("labels the paper tab as Paper chat by default", function () {
    assert.equal(resolveStandalonePaperTabLabel(), "Paper chat");
  });

  it("overrides the paper slot label with Web chat while webchat is active", function () {
    assert.equal(
      resolveStandalonePaperTabLabel({ isWebChat: true }),
      "Web chat",
    );
  });
});
