import { assert } from "chai";
import { strToU8, zipSync } from "fflate";

import {
  extractDocxPlainText,
  extractEpubPlainText,
  extractTextAttachmentContent,
  resolveTextAttachmentSourceModeFromMetadata,
} from "../src/modules/contextPanel/textAttachmentExtraction";

function buildTestEpub(): Uint8Array {
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      [
        '<?xml version="1.0"?>',
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>',
        "</container>",
      ].join(""),
    ),
    "OEBPS/content.opf": strToU8(
      [
        '<?xml version="1.0"?>',
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">',
        "<manifest>",
        '<item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>',
        '<item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>',
        '<item id="css" href="style.css" media-type="text/css"/>',
        "</manifest>",
        '<spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>',
        "</package>",
      ].join(""),
    ),
    "OEBPS/chapter1.xhtml": strToU8(
      "<html><body><h1>Chapter One</h1><p>Working memory retains task-relevant items.</p></body></html>",
    ),
    "OEBPS/chapter2.xhtml": strToU8(
      "<html><body><h1>Chapter Two</h1><p>Attention gates encoding &amp; retrieval.</p></body></html>",
    ),
    "OEBPS/style.css": strToU8("p { margin: 0; }"),
  });
}

describe("text attachment extraction", function () {
  it("extracts plain paragraph and table text from DOCX bytes", function () {
    const docxBytes = zipSync({
      "word/document.xml": strToU8(
        [
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
          "<w:body>",
          "<w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p>",
          "<w:p><w:r><w:t>Second</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>line</w:t></w:r></w:p>",
          "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
          "</w:body>",
          "</w:document>",
        ].join(""),
      ),
    });

    assert.equal(
      extractDocxPlainText(docxBytes),
      "Hello & welcome\nSecond\tline\nCell A",
    );
  });

  it("strips HTML attachments to readable text", function () {
    const bytes = new TextEncoder().encode(
      "<html><body><h1>Title</h1><p>Alpha &amp; beta</p></body></html>",
    );

    assert.equal(
      extractTextAttachmentContent(bytes, "html"),
      "Title\n Alpha & beta",
    );
  });

  it("detects EPUB attachments by MIME type and extension", function () {
    assert.equal(
      resolveTextAttachmentSourceModeFromMetadata({
        contentType: "application/epub+zip",
        filename: "book.bin",
      }),
      "epub",
    );
    assert.equal(
      resolveTextAttachmentSourceModeFromMetadata({
        contentType: "application/octet-stream",
        filename: "Memory and Attention.EPUB",
      }),
      "epub",
    );
    assert.isNull(
      resolveTextAttachmentSourceModeFromMetadata({
        contentType: "application/zip",
        filename: "archive.zip",
      }),
    );
  });

  it("extracts EPUB text in spine order", function () {
    const text = extractEpubPlainText(buildTestEpub());
    const chapterOneIndex = text.indexOf(
      "Working memory retains task-relevant items.",
    );
    const chapterTwoIndex = text.indexOf(
      "Attention gates encoding & retrieval.",
    );
    assert.isAbove(chapterOneIndex, -1);
    assert.isAbove(chapterTwoIndex, chapterOneIndex);
    assert.include(text, "Chapter One");
    assert.notInclude(text, "margin");
    assert.equal(text, extractTextAttachmentContent(buildTestEpub(), "epub"));
  });

  it("falls back to archive-order XHTML when the EPUB package is malformed", function () {
    const bytes = zipSync({
      mimetype: strToU8("application/epub+zip"),
      "OEBPS/a-first.xhtml": strToU8(
        "<html><body><p>First part</p></body></html>",
      ),
      "OEBPS/b-second.xhtml": strToU8(
        "<html><body><p>Second part</p></body></html>",
      ),
    });
    const text = extractEpubPlainText(bytes);
    assert.include(text, "First part");
    assert.include(text, "Second part");
  });

  it("returns empty text for non-zip EPUB bytes", function () {
    assert.equal(
      extractEpubPlainText(new TextEncoder().encode("not a zip archive")),
      "",
    );
  });
});
