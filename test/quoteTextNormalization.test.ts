import { assert } from "chai";
import {
  buildQuoteTextIndex,
  findCanonicalQuoteSourceSpan,
  findQuoteSourceSpansAllowingLayoutArtifacts,
  normalizeQuoteTextCanonical,
  stripLikelyLayoutNumberArtifacts,
} from "../src/modules/contextPanel/quoteTextNormalization";

describe("quoteTextNormalization", function () {
  it("normalizes MinerU math and PDF punctuation without content-word repairs", function () {
    assert.equal(
      normalizeQuoteTextCanonical(
        "crossvalidated goodnessof $\\textstyle \\mathbf { R } ^ { 2 }$ (cvR²)",
      ),
      "crossvalidated goodnessof r2 cvr2",
    );
  });

  it("normalizes Unicode hyphens, soft hyphens, curly quotes, and line-break hyphenation", function () {
    assert.equal(
      normalizeQuoteTextCanonical(
        "“Al\u00ad-\nthough” cross\u2011validated R ^ { 2 }",
      ),
      "although cross validated r2",
    );
  });

  it("removes standalone soft hyphens without splitting words", function () {
    assert.equal(
      normalizeQuoteTextCanonical("Al\u00adthough cross\u00advalidated"),
      "although crossvalidated",
    );
  });

  it("maps canonical full-span matches back to original source text", function () {
    const source =
      "But we found that the model\u2019s goodness-of-fit, measured by crossvalidated $\\textstyle \\mathbf { R } ^ { 2 }$ (cvR2 ), dropped sharply.";
    const index = buildQuoteTextIndex(source);
    const span = findCanonicalQuoteSourceSpan(
      index,
      "the model's goodness-of-fit, measured by crossvalidated R² (cvR2 ), dropped",
    );

    assert.isNotNull(span);
    assert.include(span?.text, "the model\u2019s goodness-of-fit");
    assert.include(span?.text, "$\\textstyle \\mathbf { R } ^ { 2 }$");
    assert.include(span?.text, "dropped");
  });

  it("preserves adjacent source punctuation when mapping canonical spans", function () {
    const source = "The model\u2019s accuracy dropped sharply!";
    const span = findCanonicalQuoteSourceSpan(
      buildQuoteTextIndex(source),
      "The model's accuracy dropped sharply.",
    );

    assert.equal(span?.text, "The model\u2019s accuracy dropped sharply!");
  });

  it("recovers a complete source sentence when the displayed quote omitted a trailing figure locator", function () {
    const source = [
      "151 Neurons undergoing a preference change showed a stereotyped transition in net E/I drive.",
      "152 The net drive associated with the newly preferred pattern became dominant afterward (Fig. 3B).",
    ].join("\n");
    const query =
      "Neurons undergoing a preference change showed a stereotyped transition in net E/I drive. The net drive associated with the newly preferred pattern became dominant afterward.";
    const spans = findQuoteSourceSpansAllowingLayoutArtifacts(
      buildQuoteTextIndex(source),
      query,
    );

    assert.lengthOf(spans, 1);
    assert.include(spans[0].text, "\n152 ");
    assert.match(spans[0].text, /\(Fig\. 3B\)\.$/);
  });

  it("fails closed when terminal punctuation does not correspond to a complete source boundary", function () {
    const source =
      "The newly preferred pattern became dominant afterward during the following trials.";
    const query = "The newly preferred pattern became dominant afterward.";
    const spans = findQuoteSourceSpansAllowingLayoutArtifacts(
      buildQuoteTextIndex(source),
      query,
    );

    assert.isEmpty(spans);
  });

  it("removes line-bound manuscript numbers without removing semantic numbers", function () {
    const source =
      "The transition began in 2024.\n152 The new pattern became dominant afterward (Fig. 3B).";
    const stripped = stripLikelyLayoutNumberArtifacts(source);

    assert.include(stripped, "in 2024");
    assert.notMatch(stripped, /\n152\b/);
    assert.include(stripped, "(Fig. 3B).");
  });

  it("aligns a complete quote through line numbers, EOL hyphenation, soft hyphens, and ligatures", function () {
    const source = [
      "The net drive asso-",
      "153 ciated with the previously preferred pattern declined.",
      "154 Concurrently, the e\u00adxcitatory coe\uFB03cient increased.",
    ].join("\n");
    const query =
      "The net drive associated with the previously preferred pattern declined. Concurrently, the excitatory coefficient increased.";
    const spans = findQuoteSourceSpansAllowingLayoutArtifacts(
      buildQuoteTextIndex(source),
      query,
    );

    assert.lengthOf(spans, 1);
    assert.include(spans[0].text, "\n153 ");
    assert.include(spans[0].text, "\n154 ");
    assert.include(spans[0].text, "coe\uFB03cient");
  });

  it("aligns through PDF.js line numbers concatenated directly to text", function () {
    const source = [
      "Neurons undergoing a preference change showed a stereotyped transition in net E/I drive.",
      "151The net drive associated with the previously preferred pattern was dominant before the change.",
      "152Concurrently, the newly preferred pattern began rising before the change and became dominant afterward.",
    ].join("\n");
    const query =
      "Neurons undergoing a preference change showed a stereotyped transition in net E/I drive. The net drive associated with the previously preferred pattern was dominant before the change. Concurrently, the newly preferred pattern began rising before the change and became dominant afterward.";
    const spans = findQuoteSourceSpansAllowingLayoutArtifacts(
      buildQuoteTextIndex(source),
      query,
    );

    assert.lengthOf(spans, 1);
    assert.include(spans[0].text, "\n151The net drive");
    assert.include(spans[0].text, "\n152Concurrently");
  });

  it("aligns when retrieval and live PDF.js place the same line numbers on opposite sides of EOL", function () {
    const source = [
      "Neurons undergoing a preference change showed a stereotyped transition in net E/I drive.151",
      "The net drive associated with the newly preferred pattern became dominant afterward (Fig. 3B).",
    ].join("\n");
    const query = [
      "Neurons undergoing a preference change showed a stereotyped transition in net E/I drive.",
      "152 The net drive associated with the newly preferred pattern became dominant afterward (Fig. 3B).",
    ].join("\n");
    const spans = findQuoteSourceSpansAllowingLayoutArtifacts(
      buildQuoteTextIndex(source),
      query,
    );

    assert.lengthOf(spans, 1);
    assert.include(spans[0].text, ".151\nThe net drive");
    assert.match(spans[0].text, /\(Fig\. 3B\)\.$/);
  });

  it("aligns CJK source text while ignoring an injected page number", function () {
    const source =
      "表征漂移在长期记录中保持连续。\n6\n但群体结构仍然可以被稳定解码。";
    const query =
      "表征漂移在长期记录中保持连续。但群体结构仍然可以被稳定解码。";
    const spans = findQuoteSourceSpansAllowingLayoutArtifacts(
      buildQuoteTextIndex(source),
      query,
    );

    assert.lengthOf(spans, 1);
    assert.include(spans[0].text, "\n6\n");
  });
});
