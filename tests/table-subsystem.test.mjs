import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../local-markdown.html", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = new RegExp(`^( +)(?:async )?function ${name}\\(`, "m");
  const match = marker.exec(source);
  assert.ok(match, `Missing ${name}() in local-markdown.html`);
  const nextFunction = new RegExp(`^${match[1]}(?:async )?function `, "gm");
  nextFunction.lastIndex = match.index + match[0].length;
  const next = nextFunction.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

function extractClass(name, nextFunctionName) {
  const marker = `        class ${name} `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${name} in local-markdown.html`);
  const end = source.indexOf(`\n\n        function ${nextFunctionName}(`, start);
  assert.notEqual(end, -1, `Could not find the end of ${name}`);
  return source.slice(start, end);
}

const tableRuntime = new Function(`
  const minimumTableColumnWidth = 48;
  const tableWidthsCommentName = "local-markdown:table-widths";
  ${extractFunction("markdownLineRecords")}
  ${extractFunction("characterIsEscaped")}
  ${extractFunction("markdownTableCells")}
  ${extractFunction("normalizedTableWidths")}
  ${extractFunction("normalizedTableWidth")}
  ${extractFunction("resizedTableColumnLayout")}
  ${extractFunction("tableLayoutAfterColumnAction")}
  ${extractFunction("parseTableWidthsComment")}
  ${extractFunction("markdownTableBlocks")}
  ${extractFunction("markdownTableRenderBlocks")}
  ${extractFunction("formattedTableWidth")}
  ${extractFunction("replaceTableWidthsMetadata")}
  ${extractFunction("codeMirrorTableDelimiter")}
  ${extractFunction("serializeCodeMirrorTableRow")}
  ${extractFunction("tableTextNodeMarkdown")}
  return {
    markdownTableCells,
    normalizedTableWidths,
    resizedTableColumnLayout,
    tableLayoutAfterColumnAction,
    parseTableWidthsComment,
    markdownTableBlocks,
    markdownTableRenderBlocks,
    replaceTableWidthsMetadata,
    codeMirrorTableDelimiter,
    serializeCodeMirrorTableRow,
    tableTextNodeMarkdown
  };
`)();

test("table cells preserve escaped pipes and ignore pipes inside code spans", () => {
  assert.deepEqual(
    tableRuntime.markdownTableCells("| left \\| literal | `code|span` |"),
    ["left \\| literal", "`code|span`"]
  );
  assert.deepEqual(
    tableRuntime.markdownTableCells("alpha | ``code ` and | pipe`` | omega"),
    ["alpha", "``code ` and | pipe``", "omega"]
  );
  assert.equal(tableRuntime.markdownTableCells("plain text"), null);
  assert.equal(tableRuntime.markdownTableCells("    | indented | code |"), null);
});

test("table parser skips fenced examples and preserves CRLF metadata/layout", () => {
  const markdown = [
    "```md",
    "| ignored | table |",
    "| --- | --- |",
    "```",
    "",
    "<!-- local-markdown:table-widths=25,75;table-width=82.5 -->",
    "| Name | Value |",
    "| :--- | ---: |",
    "| one | two |",
    "| `a|b` | escaped \\| pipe |",
    "after"
  ].join("\r\n");

  const blocks = tableRuntime.markdownTableBlocks(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].newline, "\r\n");
  assert.deepEqual(blocks[0].widths, [25, 75]);
  assert.equal(blocks[0].tableWidth, 82.5);
  assert.notEqual(blocks[0].metadataStart, null);

  const renderBlocks = tableRuntime.markdownTableRenderBlocks(markdown);
  assert.equal(renderBlocks.length, 1);
  assert.deepEqual(renderBlocks[0].alignments, ["left", "right"]);
  assert.deepEqual(renderBlocks[0].rows, [
    ["Name", "Value"],
    ["one", "two"],
    ["`a|b`", "escaped \\| pipe"]
  ]);
  assert.equal(markdown.slice(renderBlocks[0].end, renderBlocks[0].end + 2), "\r\n");
});

test("width normalization and resize layouts preserve physical column sizes", () => {
  assert.deepEqual(tableRuntime.normalizedTableWidths([1, 1, 2], 3), [25, 25, 50]);
  assert.equal(tableRuntime.normalizedTableWidths([1, 0], 2), null);
  assert.equal(tableRuntime.normalizedTableWidths([1, 2], 3), null);

  const resized = tableRuntime.resizedTableColumnLayout(
    [100, 100], 0, -80, 200, 400);
  assert.deepEqual(resized, {
    widths: [32.43, 67.57],
    tableWidth: 37,
    appliedDelta: -52
  });

  assert.deepEqual(
    tableRuntime.tableLayoutAfterColumnAction([40, 60], 80, "column-left", 1, 20),
    { widths: [32, 20, 48], tableWidth: 100 }
  );
  assert.deepEqual(
    tableRuntime.tableLayoutAfterColumnAction([40, 60], 80, "delete-column", 0, 20),
    { widths: [100], tableWidth: 48 }
  );
  assert.equal(
    tableRuntime.tableLayoutAfterColumnAction([40, 60], 80, "row-below", 0, 20),
    null
  );
});

test("editor width changes keep rendered table and column widths on a fixed pixel basis", () => {
  const widthRuntime = new Function(`
    let fixedTableWidthBasis = null;
    ${extractFunction("normalizedTableWidth")}
    ${extractFunction("tableWidthBasisPixels")}
    ${extractFunction("setTableRenderedWidth")}
    return {
      setTableRenderedWidth,
      setBasis(value) { fixedTableWidthBasis = value; }
    };
  `)();
  const properties = new Map();
  const table = {
    style: {
      setProperty(name, value) { properties.set(name, value); }
    }
  };

  assert.equal(widthRuntime.setTableRenderedWidth(table, 82.5), true);
  assert.equal(properties.get("--lm-table-width"), "82.5%");

  widthRuntime.setBasis(760);
  assert.equal(widthRuntime.setTableRenderedWidth(table, 82.5), true);
  assert.equal(properties.get("--lm-table-width"), "627px");

  const editorWidthSource = extractFunction("setEditorWidth");
  assert.match(editorWidthSource,
    /editorReady && fixedTableWidthBasis === null/);
  assert.match(editorWidthSource,
    /codeMirrorView\?\.contentDOM\.getBoundingClientRect\(\)\.width/);
  assert.match(editorWidthSource, /lockTableWidthBasis\(/);
  assert.match(source,
    /\.LocalMarkdown-cm-table-widget \{\s+width: var\(--lm-table-width-basis, 100%\);/);
  assert.match(extractFunction("applyCodeMirrorTableLayout"),
    /applyTableWidths\(table, block\.widths, block\.tableWidth\)/);
});

test("editor width slider maximum follows the full available editing area", () => {
  const calls = [];
  const boundsRuntime = new Function("calls", `
    let editorReady = true;
    let preferredEditorWidth = 760;
    let editorWidthTracksMaximum = false;
    const defaultEditorWidth = 760;
    const editorWidthSideMargin = 24;
    const editorWidthInput = { min: "480", max: "1600" };
    const codeMirrorView = { scrollDOM: { clientWidth: 1040 } };
    function setEditorWidth(value, options) { calls.push({ value, options }); }
    ${extractFunction("refreshEditorWidthBounds")}
    return {
      refreshEditorWidthBounds,
      input: editorWidthInput,
      view: codeMirrorView,
      setTracking(value) { editorWidthTracksMaximum = value; }
    };
  `)(calls);

  assert.equal(boundsRuntime.refreshEditorWidthBounds(), true);
  assert.equal(boundsRuntime.input.max, "992");
  assert.equal(calls.at(-1).value, 760);

  boundsRuntime.setTracking(true);
  boundsRuntime.view.scrollDOM.clientWidth = 1280;
  assert.equal(boundsRuntime.refreshEditorWidthBounds(), true);
  assert.equal(boundsRuntime.input.max, "1232");
  assert.equal(calls.at(-1).value, 1232);
  assert.deepEqual(calls.at(-1).options, {
    persist: false,
    lockTables: false,
    remember: false
  });

  assert.match(extractFunction("toggleCodeMirrorOutline"),
    /requestAnimationFrame\(\(\) => \{\s+refreshEditorWidthBounds\(\);/);
  assert.match(source,
    /id="LocalMarkdown-editor-width" type="range" min="480" max="1600" step="1"/);
});

test("width metadata inserts and replaces without changing table newlines", () => {
  const plain = "| A | B |\r\n| --- | --- |\r\n| 1 | 2 |";
  const plainBlock = tableRuntime.markdownTableBlocks(plain)[0];
  assert.equal(
    tableRuntime.replaceTableWidthsMetadata(plain, plainBlock, [1, 3], 75),
    "<!-- local-markdown:table-widths=25,75;table-width=75 -->\r\n" + plain
  );

  const stored = "<!-- local-markdown:table-widths=50,50 -->\n"
    + "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const storedBlock = tableRuntime.markdownTableBlocks(stored)[0];
  assert.equal(
    tableRuntime.replaceTableWidthsMetadata(stored, storedBlock, [2, 1], 100),
    "<!-- local-markdown:table-widths=66.67,33.33 -->\n"
      + "| A | B |\n| --- | --- |\n| 1 | 2 |"
  );
});

test("table row and multiline-cell serialization is stable", () => {
  assert.deepEqual(
    tableRuntime.codeMirrorTableDelimiter(["left", "center", "right"]),
    ["---", ":---:", "---:"]
  );
  assert.equal(
    tableRuntime.serializeCodeMirrorTableRow(["A", "B"], "  "),
    "  | A | B |"
  );
  assert.equal(
    tableRuntime.tableTextNodeMarkdown("one|two\nthree\\|four\u200b"),
    "one\\|two<br>three\\|four"
  );
});

test("Enter adds a zero-width caret anchor after a trailing BR", () => {
  const inserted = [];
  const anchor = {};
  const selection = {
    anchorNode: anchor,
    rangeCount: 1,
    removeAllRanges() {},
    addRange() {},
    getRangeAt() {
      return {
        deleteContents() {},
        insertNode(fragment) { inserted.push(...fragment.nodes); },
        setStartAfter(node) { this.after = node; },
        collapse() {}
      };
    }
  };
  const document = {
    createDocumentFragment() {
      return { nodes: [], append(node) { this.nodes.push(node); } };
    },
    createElement(name) {
      return { nodeName: name.toUpperCase() };
    },
    createTextNode(value) {
      return { nodeName: "#text", nodeValue: value };
    }
  };
  const insertText = new Function("document", "getSelection", `
    ${extractFunction("insertCodeMirrorTableCellText")}
    return insertCodeMirrorTableCellText;
  `)(document, () => selection);

  assert.equal(insertText({ contains: node => node === anchor }, "\n"), true);
  assert.deepEqual(inserted.map(node => [node.nodeName, node.nodeValue]), [
    ["BR", undefined],
    ["#text", "\u200b"]
  ]);
});

test("sequential trailing spaces stay in the cell until a stable commit", () => {
  const selection = {
    isCollapsed: true,
    rangeCount: 1,
    focusNode: {},
    focusOffset: 4,
    trailingText: ""
  };
  const document = {
    createRange() {
      return {
        selectNodeContents() {},
        setStart() {},
        toString() { return selection.trailingText; }
      };
    }
  };
  const shouldDefer = new Function("document", "getSelection", `
    function tableCellMarkdown(cell) { return cell.markdown; }
    ${extractFunction("shouldDeferCodeMirrorTableCommit")}
    return shouldDeferCodeMirrorTableCommit;
  `)(document, () => selection);
  const cell = {
    markdown: "Line one ",
    contains(node) { return node === selection.focusNode; }
  };

  assert.equal(shouldDefer({ inputType: "insertText", data: " " }, cell), true);
  cell.markdown = "Line one t";
  assert.equal(shouldDefer({ inputType: "insertText", data: "t" }, cell), false);
  cell.markdown = "Line  one ";
  selection.trailingText = "one ";
  assert.equal(shouldDefer({ inputType: "insertText", data: " " }, cell), false);
  selection.trailingText = "";
  assert.equal(shouldDefer({ inputType: "insertFromPaste", data: " " }, cell), false);
});

test("capture flushes the active table cell before reading CodeMirror", () => {
  const captureSource = extractFunction("captureEditorValue");
  assert.ok(
    captureSource.indexOf("flushActiveCodeMirrorTableCell();")
      < captureSource.indexOf("currentEditorMarkdown()")
  );
  const runtime = new Function(`
    const calls = [];
    const file = { id: "file", text: "before", builtin: false };
    let editorReady = true;
    let currentValue = "before";
    let pendingEditorHistoryInput = { fileId: file.id };
    function flushActiveCodeMirrorTableCell() {
      calls.push("flush");
      currentValue = "after";
      file.text = currentValue;
      return true;
    }
    function activeFile() { return file; }
    function currentEditorMarkdown() { calls.push("read"); return currentValue; }
    function canonicalEditorText(value) { return value; }
    function synchronizeDocumentHistoryPresent() { calls.push("synchronize-history"); }
    function editorHistoryDetails() { return {}; }
    function documentSnapshot() { return {}; }
    function markFileDirty() { calls.push("dirty"); }
    function recordDocumentMutation() { calls.push("record-history"); }
    ${captureSource}
    return { captureEditorValue, calls, file,
      pending() { return pendingEditorHistoryInput; } };
  `)();

  runtime.captureEditorValue();
  assert.deepEqual(runtime.calls, ["flush", "read"]);
  assert.equal(runtime.file.text, "after");
  assert.equal(runtime.pending(), null);
});

test("save, undo, and table structure paths inherit the capture flush", () => {
  for (const functionName of [
    "saveActiveFile",
    "saveActiveFileAs",
    "undoDocumentChange",
    "redoDocumentChange",
    "updateCodeMirrorTableStructure",
    "updateTableHeaderRow",
    "startTableResize"
  ]) {
    assert.match(
      extractFunction(functionName),
      /captureEditorValue\(\);/,
      `${functionName}() bypasses the table-cell flush boundary`
    );
  }
  const livePreview = extractFunction("createCodeMirrorLivePreview");
  assert.match(
    livePreview,
    /flushActiveCodeMirrorTableCell = \(\) => \{[\s\S]*commitCodeMirrorTableEdit\(codeMirrorView, table\)/
  );
});

const tableWidgetSource = extractClass("TableWidget", "inlinePreviewDecorations");
const TableWidget = new Function(`
  class WidgetType {}
  ${tableWidgetSource}
  return TableWidget;
`)();

test("TableWidget equality includes alignment-only changes", () => {
  const block = {
    start: 12,
    tableIndex: 1,
    renderStart: 10,
    end: 50,
    rows: [["A", "B"]],
    alignments: ["left", "right"],
    widths: [50, 50],
    tableWidth: 100
  };
  const same = new TableWidget(structuredClone(block));
  const changed = new TableWidget({
    ...structuredClone(block), alignments: ["right", "left"]
  });
  const movedStart = new TableWidget({ ...structuredClone(block), start: 13 });
  const movedIndex = new TableWidget({ ...structuredClone(block), tableIndex: 2 });
  assert.equal(new TableWidget(block).eq(same), true);
  assert.equal(new TableWidget(block).eq(changed), false);
  assert.equal(new TableWidget(block).eq(movedStart), false);
  assert.equal(new TableWidget(block).eq(movedIndex), false);
});

test("direct table editing and focus-preserving updateDOM remain authoritative", () => {
  const configureCell = extractFunction("configureCodeMirrorTableCell");
  assert.match(configureCell,
    /cell\.contentEditable = "true";/);
  assert.doesNotMatch(
    configureCell,
    /function configureCodeMirrorTableCell\(cell, value,/
  );
  assert.doesNotMatch(
    tableWidgetSource,
    /configureCodeMirrorTableCell\(cell, value,/
  );
  assert.match(tableWidgetSource, /table\.addEventListener\("input"/);
  assert.match(
    tableWidgetSource,
    /if \(cell && shouldDeferCodeMirrorTableCommit\(event, cell\)\) return;\s+if \(cell && !commitCodeMirrorTableEdit\(view, table\)\)/
  );
  assert.match(
    tableWidgetSource,
    /table\.addEventListener\("focusout", event => \{\s+const cell = event\.target\.closest\?\.\("td, th"\);\s+if \(cell && !commitCodeMirrorTableEdit\(view, table\)\)/
  );
  assert.match(tableWidgetSource, /commitCodeMirrorTableEdit\(view, table\)/);
  assert.match(tableWidgetSource, /table\.addEventListener\("paste"/);
  assert.match(tableWidgetSource, /insertCodeMirrorTableCellText\(cell, text\)/);
  assert.match(tableWidgetSource, /const currentValue = tableCellMarkdown\(cell\);/);
  assert.match(
    tableWidgetSource,
    /if \(currentValue !== value\) \{\s+cell\.replaceChildren\(\);\s+appendTableCellContent\(cell, value\);\s+\}/
  );
  assert.match(tableWidgetSource, /ignoreEvent\(\) \{ return true; \}/);

  const keydown = extractFunction("handleCodeMirrorTableKeydown");
  assert.match(keydown, /insertCodeMirrorTableCellText\(cell, "\\n"\)/);
  assert.match(keydown, /focusCodeMirrorTableCell\(cells\[nextIndex\]\)/);
  assert.match(keydown, /updateCodeMirrorTableStructure\("row-below", cell\)/);
  assert.match(keydown, /focusCodeMirrorTableCell\(tableCellAt\(nextTable, rowIndex, 0\), false\)/);
});

test("table image pointer events use the single delegated image path", () => {
  assert.doesNotMatch(tableWidgetSource, /addEventListener\("pointerup"/);
  assert.doesNotMatch(tableWidgetSource, /addEventListener\("dblclick"/);
  assert.doesNotMatch(extractFunction("configureCodeMirrorTableImage"),
    /image\.addEventListener\("click"/);
  assert.match(source,
    /editorElement\.addEventListener\("click", event => \{\s+const image = editableImageFromNode/);
  assert.match(source,
    /editorElement\.addEventListener\("dblclick", event => \{\s+const attachment = excalidrawAttachmentFromEvent/);
});

test("unused table widget state attributes stay removed", () => {
  for (const token of [
    "markdownValue",
    "markdownTableEnd",
    "markdownRow",
    "markdownColumn",
    "activeRow",
    "activeColumn",
    "dataset.edge"
  ]) assert.equal(source.includes(token), false, `Found unused table state: ${token}`);
});

test("table export has no Vditor-only line-break class fallback", () => {
  const exportSource = extractFunction("tableCellExportText");
  assert.match(exportSource, /querySelectorAll\("br"\)/);
  assert.doesNotMatch(source, /LocalMarkdown-table-line-break/);
});
