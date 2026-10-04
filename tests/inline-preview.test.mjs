import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parser, Strikethrough } from "@lezer/markdown";
import { parseHTML } from "linkedom";

const source = readFileSync(new URL("../local-markdown.html", import.meta.url), "utf8");
function extractFunction(name) {
  const match = new RegExp(`^( +)(?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(match, `Missing ${name}`);
  const next = new RegExp(`^${match[1]}(?:async )?function `, "gm");
  next.lastIndex = match.index + match[0].length;
  return source.slice(match.index, next.exec(source)?.index ?? source.length);
}

function runtime() {
  const { document, Node } = parseHTML("<html><body></body></html>");
  let activeElement = null;
  Object.defineProperty(document, "activeElement", { get: () => activeElement });
  const Decoration = Object.fromEntries(["mark", "replace"].map(type => [type,
    options => ({ range: (from, to) => ({ type, options, from, to }) })]));
  const functions = ["decodedHtmlAttribute", "htmlAttribute", "markdownInlineNodes",
    "appendTableCellText", "appendTableInlineNodes", "appendTableCellContent",
    "tableTextNodeMarkdown", "tableCellNodeMarkdown", "tableCellMarkdown",
    "revealTableCellMarkdown", "inlinePreviewDecorations"];
  const api = new Function("document", "Node", "codeMirrorMarkdownParser", "Decoration", `
    function attachmentIdFromSource() { return null; }
    function configureCodeMirrorTableImage() {}
    function tableImageMarkdown(image) { return image.dataset.markdownImage; }
    function getSelection() { return null; }
    class ImageWidget {
      constructor(from, to, source, alt, title, width, alignment) {
        Object.assign(this, { from, to, source, alt, title, width, alignment });
      }
    }
    ${functions.map(extractFunction).join("\n")}
    return { markdownInlineNodes, appendTableCellContent, tableCellMarkdown,
      revealTableCellMarkdown, inlinePreviewDecorations };
  `)(document, Node, parser.configure([Strikethrough]), Decoration);
  return {
    ...api,
    table(value, focused = false) {
      const cell = document.createElement("td");
      document.body.append(cell);
      activeElement = focused ? cell : null;
      api.appendTableCellContent(cell, value);
      return cell;
    },
    preview(value) {
      const decorations = [];
      api.inlinePreviewDecorations({ text: value, from: 0 }, decorations);
      const replacements = decorations.filter(item => item.type === "replace")
        .sort((a, b) => a.from - b.from);
      let visible = "", cursor = 0;
      for (const item of replacements) {
        assert.ok(item.from >= cursor, "replacement ranges must not overlap");
        visible += value.slice(cursor, item.from);
        if (item.options.widget) visible += "[image]";
        cursor = item.to;
      }
      return { decorations, visible: visible + value.slice(cursor) };
    }
  };
}

for (const [markdown, visible, selectors] of [
  ["**bold with *italic inside***", "bold with italic inside", ["strong", "strong em"]],
  ["***both***", "both", ["em", "em strong"]],
  ["__bold__ and _italic_", "bold and italic", ["strong", "em"]],
  ["~~**removed**~~", "removed", ["s", "s strong"]],
  ["``a ` and **literal**``", "a ` and **literal**", ["code"]],
  ["[**label**](https://example.com/a(b) \"title\")", "label", [".LocalMarkdown-cm-format-link strong"]],
  ["[One short *paragraph*]", "[One short paragraph]", ["em"]],
  ["[*italic*][reference]", "[italic][reference]", ["em"]],
  ["before<https://example.com>after", "beforehttps://example.comafter", [".LocalMarkdown-cm-format-link"]]
]) {
  test(`inline preview and table formatting agree: ${markdown}`, () => {
    const r = runtime();
    const cell = r.table(markdown);
    assert.equal(cell.textContent, visible);
    assert.equal(r.preview(markdown).visible, visible);
    for (const selector of selectors) assert.ok(cell.querySelector(selector), selector);
    assert.equal(r.tableCellMarkdown(cell), markdown, "rendering preserves saved delimiters");
    r.revealTableCellMarkdown(cell);
    assert.equal(cell.textContent, markdown, "focusing reveals the original source");
    assert.equal(r.tableCellMarkdown(cell), markdown);
  });
}

test("escaped and intraword markers stay literal in both surfaces", () => {
  const r = runtime();
  for (const value of [String.raw`\*literal\*`, String.raw`\*\*literal\*\*`, "word_with_underscores", "** unmatched", "a * spaced * b"]) {
    const cell = r.table(value);
    assert.equal(cell.textContent, value);
    assert.equal(cell.querySelector("strong, em, code, s"), null);
    assert.equal(r.preview(value).visible, value);
    assert.equal(r.tableCellMarkdown(cell), value);
  }
});

test("inline code protects image, HTML, and link syntax even in focused cells", () => {
  const r = runtime();
  const value = '`![image](x.png) <img src="x"> <br> [link](url) **bold**`';
  const cell = r.table(value);
  assert.equal(cell.querySelector("img, br, strong, .LocalMarkdown-cm-format-link"), null);
  assert.equal(r.preview(value).visible, value.slice(1, -1));
  assert.equal(r.preview(value).decorations.filter(x => x.options.widget).length, 0);
  const focused = r.table(value, true);
  assert.equal(focused.textContent, value);
  assert.equal(focused.querySelector("img, br, strong, code"), null);
  assert.equal(r.tableCellMarkdown(focused), value);
});

test("image destinations use parser boundaries and images remain visible during cell editing", () => {
  const r = runtime();
  const value = String.raw`**photo** ![sample](images/a\(b\).png "A title")`;
  for (const focused of [false, true]) {
    const cell = r.table(value, focused);
    assert.equal(cell.querySelector("img").getAttribute("src"), "images/a(b).png");
    assert.equal(cell.querySelector("img").title, "A title");
    assert.equal(r.tableCellMarkdown(cell), value);
    assert.equal(Boolean(cell.querySelector("strong")), !focused);
  }
  const image = r.preview(value).decorations.find(x => x.options.widget).options.widget;
  assert.equal(image.source, "images/a(b).png");
  assert.equal(image.title, "A title");
});

test("HTML image attributes have the same layout in both surfaces", () => {
  const r = runtime();
  const value = '<img src="lmd/test" alt="sample" width="80" style="display:block;margin-left:auto;margin-right:0">';
  const img = r.table(value).querySelector("img");
  const widget = r.preview(value).decorations[0].options.widget;
  assert.equal(widget.source, img.getAttribute("src"));
  assert.equal(widget.alt, img.alt);
  assert.equal(widget.width, 80);
  assert.equal(img.style.width, "80px");
  assert.equal(widget.alignment, "right");
  assert.equal(img.dataset.imageAlign, "right");
});

test("table line breaks and original link syntax survive rendering and marker reveal", () => {
  const r = runtime();
  const value = '**bold**<br />[label](url)';
  const cell = r.table(value);
  assert.equal(cell.querySelectorAll("br").length, 1);
  assert.equal(r.tableCellMarkdown(cell), value);
  r.revealTableCellMarkdown(cell);
  assert.equal(r.tableCellMarkdown(cell), value);
  const focused = r.table(value, true);
  assert.equal(focused.querySelectorAll("br").length, 1);
  assert.equal(focused.querySelector("strong, .LocalMarkdown-cm-format-link"), null);
  assert.equal(r.tableCellMarkdown(focused), value);
});
