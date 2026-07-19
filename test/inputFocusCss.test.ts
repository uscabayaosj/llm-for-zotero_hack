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

function extractCssRules(css: string, selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(
    css.matchAll(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, "g")),
    (match) => match[0],
  );
}

describe("composer input focus CSS", function () {
  it("keeps the shared input borderless while typing", function () {
    const css = readPanelCss();
    const inputRules = extractCssRules(css, ".llm-input");
    const focusRule = extractCssRule(css, ".llm-input:focus");

    assert.include(inputRules.join("\n"), "border: none;");
    assert.include(inputRules.join("\n"), "appearance: none;");
    assert.include(focusRule, "outline: none;");
    assert.include(focusRule, "box-shadow: none;");
    assert.notInclude(focusRule, "border-color");
  });

  it("keeps the inline editor borderless with matched bottom corners", function () {
    const css = readPanelCss();
    const editWrapperRule = extractCssRule(css, ".llm-inline-edit-wrapper");
    const editInputSectionRule = extractCssRule(
      css,
      ".llm-inline-edit-wrapper > .llm-input-section",
    );

    assert.include(editWrapperRule, "--llm-inline-edit-border-radius: 10px;");
    assert.include(editWrapperRule, "border: none;");
    assert.include(
      editWrapperRule,
      "border-radius: var(--llm-inline-edit-border-radius);",
    );
    assert.notInclude(editWrapperRule, "var(--color-accent)");
    assert.match(
      editInputSectionRule,
      /border-radius:\s*0 0 var\(--llm-inline-edit-border-radius\)\s+var\(--llm-inline-edit-border-radius\);/,
    );
  });
});
