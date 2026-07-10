import { assert } from "chai";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const cssPath = resolve("addon/content/zoteroPane.css");
const wordWrapIconPath = resolve("addon/content/icons/action-word-wrap.svg");
const sourceCodeIconPath = resolve(
  "addon/content/icons/action-source-code.svg",
);

describe("code-block toolbar SVG icons", function () {
  it("ships the approved turnover-arrow and source-code SVG assets", function () {
    assert.isTrue(existsSync(wordWrapIconPath));
    assert.isTrue(existsSync(sourceCodeIconPath));

    const wordWrapIcon = readFileSync(wordWrapIconPath, "utf8");
    const sourceCodeIcon = readFileSync(sourceCodeIconPath, "utf8");

    assert.include(wordWrapIcon, 'd="M4 7h11.5a4.5 4.5 0 0 1 0 9H8"');
    assert.include(wordWrapIcon, 'd="m11 13-3 3 3 3"');
    assert.equal(wordWrapIcon.match(/<path\b/g)?.length, 2);

    assert.include(sourceCodeIcon, 'd="m8.5 7-5 5 5 5"');
    assert.include(sourceCodeIcon, 'd="m15.5 7 5 5-5 5"');
    assert.include(sourceCodeIcon, 'd="m13.25 4.75-2.5 14.5"');
    assert.equal(sourceCodeIcon.match(/<path\b/g)?.length, 3);
  });

  it("renders both SVGs as compact stateful toolbar masks", function () {
    const css = readFileSync(cssPath, "utf8");
    const controlsRule = css.match(
      /\.llm-rendered-markdown \.llm-codeblock-source-toggle,\n\.llm-rendered-markdown \.llm-codeblock-wrap-toggle \{([\s\S]*?)\n\}/,
    )?.[1];

    assert.isString(controlsRule);
    assert.include(controlsRule, "width: 24px;");
    assert.include(controlsRule, "min-width: 24px;");
    assert.include(controlsRule, "height: 24px;");
    assert.include(controlsRule, "padding: 0;");
    assert.include(css, 'mask-image: url("icons/action-word-wrap.svg")');
    assert.include(
      css,
      '-webkit-mask-image: url("icons/action-word-wrap.svg")',
    );
    assert.include(css, 'mask-image: url("icons/action-source-code.svg")');
    assert.include(
      css,
      '-webkit-mask-image: url("icons/action-source-code.svg")',
    );
    assert.include(css, '.llm-codeblock-source-toggle[aria-expanded="true"]');
    assert.include(css, '.llm-codeblock-wrap-toggle[aria-pressed="true"]');
  });
});
