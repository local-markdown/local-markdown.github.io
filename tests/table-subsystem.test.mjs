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
  ${extractFunction("tableWidthsMetadataChange")}
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
    tableWidthsMetadataChange,
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
  const prefix = "Before table\r\n\r\n";
  const plain = prefix + "| A | B |\r\n| --- | --- |\r\n| 1 | 2 |";
  const plainBlock = tableRuntime.markdownTableBlocks(plain)[0];
  assert.deepEqual(
    tableRuntime.tableWidthsMetadataChange(plainBlock, [1, 3], 75),
    {
      from: prefix.length,
      to: prefix.length,
      insert: "<!-- local-markdown:table-widths=25,75;table-width=75 -->\r\n"
    }
  );

  const metadata = "<!-- local-markdown:table-widths=50,50 -->\n";
  const stored = prefix + metadata + "\n| A | B |\n| --- | --- |\n| 1 | 2 |";
  const storedBlock = tableRuntime.markdownTableBlocks(stored)[0];
  assert.deepEqual(
    tableRuntime.tableWidthsMetadataChange(storedBlock, [2, 1], 100),
    {
      from: prefix.length,
      to: prefix.length + metadata.length,
      insert: "<!-- local-markdown:table-widths=66.67,33.33 -->\n"
    }
  );
  assert.equal(tableRuntime.tableWidthsMetadataChange(storedBlock, [1]), null);
});

test("resize saves only metadata, preserves CodeMirror scroll and selection, and records one undo step", () => {
  const createRuntime = new Function("value", `
    let codeMirrorInputSuppression = 0;
    const file = { text: value, dirty: false };
    const history = [];
    const dispatches = [];
    const scrollEffect = {};
    let mappedChanges;
    const codeMirrorView = {
      state: { changes(change) { return change; } },
      scrollSnapshot() {
        return { map(changes) { mappedChanges = changes; return scrollEffect; } };
      },
      dispatch(transaction) {
        dispatches.push({ transaction, suppression: codeMirrorInputSuppression });
      }
    };
    function documentSnapshot(file) { return { text: file.text }; }
    function markFileDirty(file) { file.dirty = true; }
    function renderFiles() {}
    function updateStatus() {}
    function scheduleAttachmentPreviews() {}
    function scheduleTableWidths() {}
    function renderCodeMirrorOutline() {}
    function recordDocumentMutation(file, before, options) { history.push({ before, options }); }
    ${extractFunction("applyEditorChanges")}
    ${extractFunction("applyTableWidthTextUpdate")}
    return {
      file, history, dispatches, scrollEffect, applyTableWidthTextUpdate,
      mappedChanges: () => mappedChanges,
      suppression: () => codeMirrorInputSuppression
    };
  `);
  const original = "Before table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter table";
  const runtime = createRuntime(original);
  for (const widths of [[25, 75], [40, 60]]) {
    const value = runtime.file.text;
    const table = tableRuntime.markdownTableBlocks(value)[0];
    const change = tableRuntime.tableWidthsMetadataChange(table, widths);
    const previousCount = runtime.history.length;
    assert.equal(runtime.applyTableWidthTextUpdate(runtime.file, value, change, "Resized"), true);
    const { transaction, suppression } = runtime.dispatches.at(-1);
    assert.deepEqual(Object.keys(transaction).sort(), ["changes", "effects"]);
    assert.deepEqual(transaction.changes, change);
    assert.equal(transaction.effects, runtime.scrollEffect);
    assert.equal(runtime.mappedChanges(), transaction.changes);
    assert.equal(suppression, 1, "programmatic resize must not record another input edit");
    assert.equal(runtime.suppression(), 0);
    assert.equal(runtime.file.dirty, true);
    assert.equal(runtime.file.text,
      value.slice(0, change.from) + change.insert + value.slice(change.to));
    assert.equal(runtime.file.text.replace(/<!-- local-markdown:table-widths[^\n]+\n/, ""), original);
    assert.equal(runtime.history.length, previousCount + 1);
    assert.deepEqual(runtime.history.at(-1), {
      before: { text: value }, options: { label: "table resize", mergeWithPrevious: false }
    });
  }
  const unchanged = tableRuntime.tableWidthsMetadataChange(
    tableRuntime.markdownTableBlocks(runtime.file.text)[0], [40, 60]);
  assert.equal(runtime.applyTableWidthTextUpdate(runtime.file, runtime.file.text, unchanged, "Resized"), false);
  assert.equal(runtime.history.length, 2);
  assert.equal(runtime.dispatches.length, 2);
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
  ${extractFunction("isDrawingFile")}
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

test("table updates preserve cell nodes when deletion exposes padding, but apply changed content", () => {
  const document = { activeElement: null };
  const RuntimeWidget = new Function("document", `
    class WidgetType {}
    function tableCellMarkdown(cell) { return cell.text; }
    function configureCodeMirrorTableCell() {}
    function appendTableCellContent(cell, value) { cell.text = value; }
    function applyCodeMirrorTableLayout() {}
    ${tableWidgetSource}
    return TableWidget;
  `)(document);

  for (const text of ["Cell this is a ", "Cell this is a\u00a0", " Cell", "\tCell\t", " "]) {
    let replacements = 0;
    const cell = {
      text,
      replaceChildren() { replacements++; },
      querySelectorAll() { return []; }
    };
    document.activeElement = cell;
    const wrapper = { querySelector: () => ({ rows: [{ cells: [cell] }] }) };
    const rows = [tableRuntime.markdownTableCells(
      tableRuntime.serializeCodeMirrorTableRow([text]))];
    const widget = new RuntimeWidget({ rows, alignments: ["left"] });
    assert.equal(widget.updateDOM(wrapper), true);
    assert.equal(replacements, 0, `Rebuilt cell containing ${JSON.stringify(text)}`);
    assert.equal(cell.text, text);

    // Undo and external edits must still replace genuinely different content.
    const undoWidget = new RuntimeWidget({ rows: [["Restored text"]], alignments: ["left"] });
    assert.equal(undoWidget.updateDOM(wrapper), true);
    assert.equal(replacements, 1);
    assert.equal(cell.text, "Restored text");
  }
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
    /table\.addEventListener\("focusout", event => \{[\s\S]*?queueMicrotask\(\(\) => \{\s+if \(cell\?\.isConnected && !commitCodeMirrorTableEdit\(view, table\)\)/
  );
  assert.match(tableWidgetSource, /commitCodeMirrorTableEdit\(view, table\)/);
  assert.match(tableWidgetSource, /table\.addEventListener\("paste"/);
  assert.match(tableWidgetSource, /insertCodeMirrorTableCellText\(cell, text\)/);
  assert.match(tableWidgetSource, /const currentValue = tableCellMarkdown\(cell\);/);
  assert.match(
    tableWidgetSource,
    /if \(currentValue\.trim\(\) !== value\) \{\s+cell\.replaceChildren\(\);\s+appendTableCellContent\(cell, value\);\s+\}/
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

test("inline formatting uses the table DOM selection instead of the source cursor", () => {
  const cell = {
    contains: node => node === anchor,
    dispatchEvent(event) { events.push(event.type); }
  };
  const anchor = {};
  const events = [];
  const selectedText = { textContent: "beta" };
  const content = {
    nodes: [selectedText],
    hasChildNodes() { return this.nodes.length > 0; },
    append(node) { this.nodes.push(node); }
  };
  let inserted;
  const range = {
    toString: () => "beta",
    extractContents: () => content,
    insertNode(fragment) { inserted = fragment.nodes; },
    setStartAfter(node) { this.start = node; },
    setEndBefore(node) { this.end = node; }
  };
  const selection = {
    anchorNode: anchor,
    focusNode: anchor,
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges() {},
    addRange(value) { assert.equal(value, range); }
  };
  const document = {
    createTextNode: textContent => ({ textContent }),
    createDocumentFragment: () => ({
      nodes: [],
      append(...nodes) { this.nodes.push(...nodes); }
    })
  };
  let sourceReads = 0;
  const wrap = new Function("document", "getSelection", "tableCellFromNode",
    "markEditorHistoryPending", "codeMirrorSelection", `
    function revealTableCellMarkdown() {}
    ${extractFunction("wrapCodeMirrorTableSelection")}
    ${extractFunction("wrapCodeMirrorSelection")}
    return wrapCodeMirrorSelection;
  `)(document, () => selection, node => node === anchor ? cell : null,
    () => events.push("history"), () => { sourceReads += 1; return null; });

  for (const marker of ["**", "*", "~~", "`"]) {
    assert.equal(wrap(marker, marker, "placeholder"), true);
    assert.equal(inserted[0].textContent, marker);
    assert.equal(inserted[1].nodes[0], selectedText);
    assert.equal(inserted[2].textContent, marker);
    assert.equal(range.start, inserted[0]);
    assert.equal(range.end, inserted[2]);
  }
  assert.equal(sourceReads, 0);
  assert.deepEqual(events, Array(4).fill(["history", "input"]).flat());

  range.toString = () => "**beta**";
  range.cloneContents = () => ({ querySelector: () => null });
  range.deleteContents = () => {};
  range.insertNode = node => { inserted = node; };
  range.selectNodeContents = node => { range.selected = node; };
  assert.equal(wrap("**"), true);
  assert.equal(inserted.textContent, "beta");
  assert.equal(range.selected, inserted);

  // A cross-cell selection must not modify the stale document cursor either.
  selection.focusNode = {};
  events.length = 0;
  assert.equal(wrap("**"), true);
  assert.equal(sourceReads, 0);
  assert.deepEqual(events, []);

  // Normal editor selections continue through the existing source-based path.
  selection.anchorNode = {};
  assert.equal(wrap("**"), false);
  assert.equal(sourceReads, 1);
});

test("table toolbar commands never use the unrelated source cursor", () => {
  const calls = [];
  const cell = {};
  const run = new Function("cell", "calls", `
    const codeMirrorView = {};
    const document = { activeElement: cell };
    function getSelection() { return { anchorNode: cell }; }
    function tableCellFromNode(node) { return node === cell ? cell : null; }
    function toggleCodeMirrorEmojiMenu() {}
    function updateStatus(message) { calls.push(["status", message]); }
    function wrapCodeMirrorSelection(...args) { calls.push(args); }
    function wrapCodeMirrorTableSelection(...args) { calls.push(args); return true; }
    ${extractFunction("runCodeMirrorToolbarCommand")}
    return runCodeMirrorToolbarCommand;
  `)(cell, calls);
  for (const command of ["emoji", "headings", "list", "ordered-list", "check",
    "outdent", "indent", "quote", "line", "code", "insert-before",
    "insert-after", "upload", "table", "draw"]) {
    calls.length = 0;
    run(command);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "status", command);
  }
  for (const [command, marker] of [["bold", "**"], ["italic", "*"],
    ["strike", "~~"], ["inline-code", "`"], ["link", "["]]) {
    calls.length = 0;
    run(command);
    assert.equal(calls[0][0], marker, command);
  }
});

test("styled table cells serialize formatting without losing original delimiters", () => {
  const serialize = new Function("Node", `
    ${extractFunction("tableTextNodeMarkdown")}
    ${extractFunction("tableCellNodeMarkdown")}
    return tableCellNodeMarkdown;
  `)({ TEXT_NODE: 3, ELEMENT_NODE: 1 });
  const text = nodeValue => ({ nodeType: 3, nodeValue });
  const element = (tagName, childNodes, dataset = {}) => ({
    nodeType: 1, tagName, childNodes, dataset
  });
  assert.equal(serialize(element("STRONG", [text("ddd")])), "**ddd**");
  assert.equal(serialize(element("EM", [text("italic")], {
    markdownOpen: "_", markdownClose: "_"
  })), "_italic_");
  assert.equal(serialize(element("S", [text("removed")])), "~~removed~~");
  assert.equal(serialize(element("STRIKE", [text("removed")])), "~~removed~~");
  assert.equal(serialize(element("B", [text(" bold ")])), " **bold** ");
  assert.equal(serialize(element("I", [text(" new")])), " *new*");
  assert.equal(serialize(element("I", [text(" ")])), " ");
  assert.equal(serialize(element("STRONG", [text("one"), element("BR", []),
    element("EM", [text("two|three")])])), "**one<br>*two\\|three***");
  assert.equal(serialize(element("CODE", [text("a`b")], {
    markdownOpen: "``", markdownClose: "``"
  })), "``a`b``");
});

test("revealing nested cell formatting preserves text nodes and selection boundaries", () => {
  const text = nodeValue => ({ nodeType: 3, nodeValue, childNodes: [] });
  const element = (childNodes, dataset = {}) => {
    const node = { nodeType: 1, childNodes, dataset,
      get lastChild() { return this.childNodes.at(-1); },
      contains(target) {
        return target === this || this.childNodes.some(child =>
          child === target || child.contains?.(target));
      },
      replaceWith(...nodes) {
        const parent = this.parentNode;
        parent.childNodes.splice(parent.childNodes.indexOf(this), 1, ...nodes);
        for (const child of nodes) child.parentNode = parent;
      }
    };
    for (const child of childNodes) child.parentNode = node;
    return node;
  };
  for (const selectWholeCell of [false, true]) {
    const word = text("word");
    const italic = element([word], { markdownOpen: "_", markdownClose: "_" });
    const bold = element([italic], { markdownOpen: "**", markdownClose: "**" });
    const image = element([]);
    const cell = element([bold, image]);
    cell.querySelectorAll = () => [bold, italic];
    const selection = {
      anchorNode: selectWholeCell ? cell : word,
      anchorOffset: selectWholeCell ? 0 : 3,
      focusNode: selectWholeCell ? cell : word,
      focusOffset: selectWholeCell ? 2 : 1,
      setBaseAndExtent(...points) { this.restored = points; }
    };
    const reveal = new Function("document", "Node", "getSelection", `
      ${extractFunction("revealTableCellMarkdown")}
      return revealTableCellMarkdown;
    `)({ createTextNode: text }, { TEXT_NODE: 3 }, () => selection);
    reveal(cell);
    assert.equal(cell.childNodes.map(node => node.nodeValue || "").join(""), "**_word_**");
    assert.equal(cell.childNodes[2], word);
    assert.equal(cell.lastChild, image);
    assert.deepEqual(selection.restored, selectWholeCell
      ? [cell, 0, cell, 6] : [word, 3, word, 1]);
  }
});
