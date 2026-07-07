import { assert } from "chai";
import { describe, it } from "mocha";

import { buildEpubQuoteSearchQueries } from "../src/modules/contextPanel/epubQuoteLocator";

describe("epub quote locator", function () {
  it("puts the exact quote first and adds progressively shorter fallbacks", function () {
    const quote =
      "Working memory retains task-relevant items over short delays, and attention gates both encoding and retrieval of those items.";
    const queries = buildEpubQuoteSearchQueries([quote]);
    assert.equal(queries[0], quote);
    assert.include(
      queries,
      "Working memory retains task-relevant items over short delays, and attention gates both",
    );
    assert.include(
      queries,
      "Working memory retains task-relevant items over short delays,",
    );
    assert.isTrue(queries.every((query) => query.length >= 16));
  });

  it("splits ellipsis quotes into separately searchable segments", function () {
    const queries = buildEpubQuoteSearchQueries([
      "Working memory retains task-relevant items ... attention gates encoding and retrieval processes.",
    ]);
    assert.include(queries, "Working memory retains task-relevant items");
    assert.include(
      queries,
      "attention gates encoding and retrieval processes.",
    );
  });

  it("normalizes whitespace and smart quotes and deduplicates", function () {
    const queries = buildEpubQuoteSearchQueries([
      "The  “gating   model”  explains  selective   encoding here.",
      'The "gating model" explains selective encoding here.',
    ]);
    assert.equal(
      queries.filter(
        (query) =>
          query === 'The "gating model" explains selective encoding here.',
      ).length,
      1,
    );
  });

  it("drops quotes that are too short to search safely", function () {
    assert.deepEqual(buildEpubQuoteSearchQueries(["p. 42", ""]), []);
  });
});
