import { assert } from "chai";
import type { WorkflowTestApi } from "../src/modules/contextPanel/workflowTestTypes";

function getWorkflowTestApi(): WorkflowTestApi {
  const api = (Zotero as any).LLMForZotero?.api?.workflowTest;
  assert.isOk(api, "workflow test API should be installed");
  return api as WorkflowTestApi;
}

describe("workflow: Add Text lifecycle", function () {
  this.timeout(10000);

  it("repairs a listener lost after plugin startup", async function () {
    const diagnostics =
      await getWorkflowTestApi().exerciseReaderSelectionTrackingRecovery();

    assert.equal(diagnostics.before, 1, JSON.stringify(diagnostics));
    assert.equal(diagnostics.afterDrop, 0, JSON.stringify(diagnostics));
    assert.equal(diagnostics.afterHealthCheck, 1, JSON.stringify(diagnostics));
    assert.isTrue(diagnostics.markerPresent, JSON.stringify(diagnostics));
    assert.isTrue(diagnostics.markerLive, JSON.stringify(diagnostics));
    assert.isBelow(diagnostics.elapsedMs, 2000, JSON.stringify(diagnostics));
  });
});
