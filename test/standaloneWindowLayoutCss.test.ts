import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert } from "chai";

const here = dirname(fileURLToPath(import.meta.url));

function readPanelCss(): string {
  return readFileSync(resolve(here, "../addon/content/zoteroPane.css"), "utf8");
}

function extractCssRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`));
  return match?.[0] || "";
}

describe("standalone window layout CSS", function () {
  it("lets the standalone chat panel widen beyond the default window width", function () {
    const rule = extractCssRule(
      readPanelCss(),
      '[data-standalone="true"].llm-panel',
    );

    assert.isNotEmpty(rule);
    assert.include(rule, "--llm-standalone-chat-max-width");
    assert.include(
      rule,
      "width: min(100%, var(--llm-standalone-chat-max-width))",
    );
    assert.include(
      rule,
      "max-width: min(100%, var(--llm-standalone-chat-max-width))",
    );
    assert.notInclude(rule, "max-width: 820px");
  });
});
