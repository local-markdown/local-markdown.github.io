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

function fakeDoc(value) {
  const text = String(value);
  const values = text.split("\n");
  const records = [];
  let from = 0;
  for (let index = 0; index < values.length; index += 1) {
    const line = values[index];
    records.push({ number: index + 1, from, to: from + line.length, text: line });
    from += line.length + (index < values.length - 1 ? 1 : 0);
  }
  return {
    length: text.length,
    lines: records.length,
    line(number) { return records[number - 1]; },
    lineAt(position) {
      return records.find(record => position <= record.to) || records.at(-1);
    },
    sliceString(from, to) { return text.slice(from, to); },
    toString() { return text; }
  };
}

const createIndentRuntime = new Function(`
  let codeMirrorView = null;
  const dispatches = [];
  function dispatchCodeMirrorChange(changes, selection) {
    dispatches.push({ changes, selection });
    return true;
  }
  ${extractFunction("codeMirrorSelection")}
  ${extractFunction("codeMirrorLineTransformPosition")}
  ${extractFunction("transformCodeMirrorLines")}
  ${extractFunction("removeCodeMirrorIndentationUnit")}
  ${extractFunction("outdentCodeMirrorLines")}
  return {
    removeCodeMirrorIndentationUnit,
    indent() {
      return transformCodeMirrorLines(line => \`    \${line}\`, {
        preserveSelection: true
      });
    },
    outdentCodeMirrorLines,
    setView(view) { codeMirrorView = view; dispatches.length = 0; },
    dispatches
  };
`);

const createTaskRuntime = new Function(`
  let codeMirrorTaskDragSession = null;
  let codeMirrorView = null;
  const dispatches = [];
  const statuses = [];
  function clearCodeMirrorTaskDropTarget() {}
  function dispatchCodeMirrorChange(changes, selection) {
    dispatches.push({ changes, selection });
    return true;
  }
  function updateStatus(message) { statuses.push(message); }
  ${extractFunction("markdownIndentWidth")}
  ${extractFunction("markdownTaskLineMatch")}
  ${extractFunction("markdownListIndentWidth")}
  ${extractFunction("codeMirrorDocumentLines")}
  ${extractFunction("codeMirrorTaskSubtree")}
  ${extractFunction("codeMirrorListParentIndex")}
  ${extractFunction("codeMirrorListDepth")}
  ${extractFunction("codeMirrorTasksAreSiblings")}
  ${extractFunction("codeMirrorTaskSiblingTargetFroms")}
  ${extractFunction("finishCodeMirrorTaskDrag")}
  return {
    markdownIndentWidth,
    codeMirrorTaskSubtree,
    codeMirrorListDepth,
    codeMirrorTasksAreSiblings,
    codeMirrorTaskSiblingTargetFroms,
    finishCodeMirrorTaskDrag,
    setDrag(view, session) {
      codeMirrorView = view;
      codeMirrorTaskDragSession = session;
      dispatches.length = 0;
      statuses.length = 0;
    },
    dispatches,
    statuses
  };
`);

test("task indentation changes exactly one four-space level", () => {
  const runtime = createIndentRuntime();
  assert.deepEqual([
    "        - [ ] eight spaces",
    "    - [ ] four spaces",
    "  - [ ] two spaces",
    "\t- [ ] tab",
    "  \t- [ ] spaces then tab",
    "- [ ] root"
  ].map(runtime.removeCodeMirrorIndentationUnit), [
    "    - [ ] eight spaces",
    "- [ ] four spaces",
    "- [ ] two spaces",
    "- [ ] tab",
    "- [ ] spaces then tab",
    "- [ ] root"
  ]);
  assert.match(source, /case "indent": transformCodeMirrorLines\(line => ` {4}\$\{line\}`, \{\s+preserveSelection: true\s+\}\);/);
  assert.match(extractFunction("outdentCodeMirrorLines"), /preserveSelection: true/);
});

function selection(anchor, head = anchor) {
  return { anchor, head, from: Math.min(anchor, head), to: Math.max(anchor, head) };
}

function indentationView(value, anchor, head = anchor) {
  return { state: { doc: fakeDoc(value), selection: { main: selection(anchor, head) } } };
}

test("indent and outdent preserve a single cursor instead of jumping to line end", () => {
  const runtime = createIndentRuntime();
  runtime.setView(indentationView("Task", 2));
  runtime.indent();
  assert.deepEqual(runtime.dispatches[0], {
    changes: { from: 0, to: 4, insert: "    Task" },
    selection: { anchor: 6, head: 6 }
  });

  runtime.setView(indentationView("    Task", 6));
  runtime.outdentCodeMirrorLines();
  assert.deepEqual(runtime.dispatches[0], {
    changes: { from: 0, to: 8, insert: "Task" },
    selection: { anchor: 2, head: 2 }
  });
});

test("indent preserves forward and reverse multiline selection direction", () => {
  const runtime = createIndentRuntime();
  const value = "One\nTwo\nThree";
  runtime.setView(indentationView(value, 1, 7));
  runtime.indent();
  assert.equal(runtime.dispatches[0].changes.insert, "    One\n    Two");
  assert.deepEqual(runtime.dispatches[0].selection, { anchor: 5, head: 15 });

  runtime.setView(indentationView(value, 7, 1));
  runtime.indent();
  assert.deepEqual(runtime.dispatches[0].selection, { anchor: 15, head: 5 });
  assert.ok(runtime.dispatches[0].selection.anchor > runtime.dispatches[0].selection.head);
});

test("mixed-whitespace outdent maps forward and reverse multiline selections", () => {
  const runtime = createIndentRuntime();
  const value = "  \tOne\n        Two\nLast";
  const secondStart = value.indexOf("        Two");
  const forwardAnchor = 3;
  const forwardHead = secondStart + 8;
  runtime.setView(indentationView(value, forwardAnchor, forwardHead));
  runtime.outdentCodeMirrorLines();
  assert.equal(runtime.dispatches[0].changes.insert, "One\n    Two");
  assert.deepEqual(runtime.dispatches[0].selection, { anchor: 0, head: 8 });

  runtime.setView(indentationView(value, forwardHead, forwardAnchor));
  runtime.outdentCodeMirrorLines();
  assert.deepEqual(runtime.dispatches[0].selection, { anchor: 8, head: 0 });
});

test("other line toolbar transforms keep their established line-end selection", () => {
  const transformSource = extractFunction("transformCodeMirrorLines");
  assert.match(transformSource, /preserveSelection \? \{/);
  assert.match(transformSource, /: \{ anchor: lineEnd \}/);
  for (const functionName of [
    "toggleCodeMirrorLinePrefix",
    "cycleCodeMirrorHeading",
    "setCodeMirrorHeadingLevel",
    "adjustCodeMirrorHeading",
    "toggleCodeMirrorTask"
  ]) {
    assert.doesNotMatch(extractFunction(functionName), /preserveSelection/);
  }
});

test("task hierarchy exposes only siblings and a parent drag moves its subtree", () => {
  const runtime = createTaskRuntime();
  const lines = [
    "- [ ] Parent",
    "    - [ ] Child",
    "        - [ ] Grandchild",
    "- [ ] Sibling",
    "    - [ ] Sibling child",
    "- [ ] Last"
  ];
  const doc = fakeDoc(lines.join("\n"));

  assert.deepEqual(runtime.codeMirrorTaskSubtree(lines, 0), { from: 0, to: 3 });
  assert.equal(runtime.codeMirrorListDepth(lines, 2), 2);
  assert.equal(runtime.codeMirrorTasksAreSiblings(lines, 0, 3), true);
  assert.equal(runtime.codeMirrorTasksAreSiblings(lines, 0, 1), false);
  assert.deepEqual(
    [...runtime.codeMirrorTaskSiblingTargetFroms(doc, lines, 0)],
    [doc.line(4).from, doc.line(6).from]
  );

  runtime.setDrag({ state: { doc } }, {
    pointerId: 7,
    sourceFrom: doc.line(1).from,
    sourceIndex: 0,
    source: { from: 0, to: 3 },
    targetFrom: doc.line(4).from,
    dropAfter: true,
    dragging: true
  });
  runtime.finishCodeMirrorTaskDrag({ pointerId: 7 });
  assert.equal(runtime.dispatches.length, 1);
  assert.equal(runtime.dispatches[0].changes.insert, [
    "- [ ] Sibling",
    "    - [ ] Sibling child",
    "- [ ] Parent",
    "    - [ ] Child",
    "        - [ ] Grandchild",
    "- [ ] Last"
  ].join("\n"));

  runtime.setDrag({ state: { doc } }, {
    pointerId: 8,
    sourceFrom: doc.line(1).from,
    sourceIndex: 0,
    source: { from: 0, to: 3 },
    targetFrom: doc.line(2).from,
    dropAfter: true,
    dragging: true
  });
  runtime.finishCodeMirrorTaskDrag({ pointerId: 8 });
  assert.equal(runtime.dispatches.length, 0, "a parent cannot be dropped inside its descendants");
});

const createSidebarRuntime = new Function(`
  let session = null;
  let renderCount = 0;
  let saveCount = 0;
  function renderFiles() { renderCount += 1; }
  function scheduleSessionSave() { saveCount += 1; }
  ${extractFunction("isStandaloneSidebarFile")}
  ${extractFunction("sectionForId")}
  ${extractFunction("removeFileFromSidebarLayout")}
  ${extractFunction("normalizeSidebarLayout")}
  ${extractFunction("moveSectionRelative")}
  ${extractFunction("moveFileToSection")}
  return {
    setSession(value) { session = value; renderCount = 0; saveCount = 0; },
    normalizeSidebarLayout,
    moveSectionRelative,
    moveFileToSection,
    state() { return { session, renderCount, saveCount }; }
  };
`);

test("sidebar normalization keeps each eligible file in exactly one hierarchy location", () => {
  const runtime = createSidebarRuntime();
  const session = {
    files: [
      { id: "example", builtin: true, sidebarMovable: true, sidebarDefaultFirst: true },
      { id: "a" }, { id: "b" }, { id: "c" },
      { id: "builtin", builtin: true }, { id: "welcome", welcome: true }
    ],
    sidebar: {
      sections: [
        { id: "one", name: " One ", collapsed: 0, fileIds: ["a", "a", "missing"] },
        { id: "two", name: "Two", collapsed: true, fileIds: ["b", "a"] },
        { id: "two", name: "Duplicate", fileIds: ["c"] }
      ],
      ungroupedFileIds: ["b", "builtin"]
    }
  };
  runtime.setSession(session);
  assert.equal(runtime.normalizeSidebarLayout(), true);
  assert.deepEqual(session.sidebar, {
    sections: [
      { id: "one", name: "One", collapsed: false, fileIds: ["a"] },
      { id: "two", name: "Two", collapsed: true, fileIds: ["b"] }
    ],
    ungroupedFileIds: ["example", "c"]
  });

  runtime.moveFileToSection("example", "one", "a", false);
  assert.deepEqual(session.sidebar.sections[0].fileIds, ["example", "a"]);
  assert.deepEqual(session.sidebar.ungroupedFileIds, ["c"]);
  runtime.moveFileToSection("c", "one", "a", false);
  assert.deepEqual(session.sidebar.sections[0].fileIds, ["example", "c", "a"]);
  assert.deepEqual(session.sidebar.ungroupedFileIds, []);
  runtime.moveSectionRelative("two", "one", false);
  assert.deepEqual(session.sidebar.sections.map(section => section.id), ["two", "one"]);
  assert.deepEqual(runtime.state(), { session, renderCount: 3, saveCount: 3 });
});

test("Examples is draggable but keeps builtin deletion protections", () => {
  const appendSource = extractFunction("appendOpenFileButton");
  assert.match(appendSource,
    /const movable = isStandaloneSidebarFile\(file\);[\s\S]*if \(movable\)[\s\S]*enableFileReordering/);
  assert.match(appendSource, /if \(!file\.builtin\) attachFileContextMenu/);
  assert.match(extractFunction("closeFile"), /file\.builtin/);
  assert.match(extractFunction("removeSessionFile"), /!file \|\| file\.builtin/);
  assert.match(extractFunction("deleteFileTarget"), /!name \|\| file\.builtin/);
  assert.match(source,
    /sidebarMovable: true, sidebarDefaultFirst: true/);
});

test("sidebar and task drag affordances keep the source visible and show one drop line", () => {
  assert.match(source, /\.LocalMarkdown-sidebar-drag-handle\s*\{[\s\S]*?opacity: 0; pointer-events: none;/);
  assert.match(source, /\.LocalMarkdown-file-row:hover > \.LocalMarkdown-file-drag-handle[\s\S]*?opacity: 1; pointer-events: auto;/);
  assert.match(source, /\.LocalMarkdown-file-row:has\(\.LocalMarkdown-file\.LocalMarkdown-dragging\)[\s\S]*?> \.LocalMarkdown-file-drag-handle/);
  assert.match(source, /\.LocalMarkdown-file\.LocalMarkdown-dragging \{ opacity: \.52; \}/);
  assert.match(source, /\.LocalMarkdown-sidebar-drop-before::after,[\s\S]*?height: 2px; background: var\(--lm-accent\)/);
  assert.match(extractFunction("markSidebarDropTarget"), /clearSidebarDropTargets\(\);/);

  assert.match(source, /\.LocalMarkdown-cm-task-drag-handle\s*\{[\s\S]*?opacity: 0; pointer-events: none;/);
  assert.match(source, /\.cm-line:hover \.LocalMarkdown-cm-task-drag-handle,[\s\S]*?opacity: 1; pointer-events: auto;/);
  assert.match(source, /\.LocalMarkdown-cm-task-drag-source \.LocalMarkdown-cm-task-drag-handle/);
  assert.match(extractFunction("markCodeMirrorTaskDragSource"), /session\.source\.from \+ 1[\s\S]*?session\.source\.to/);
});

test("rendered sidebar and toolbar omit unused compatibility datasets", () => {
  assert.doesNotMatch(extractFunction("renderTopicSection"), /dataset\.sectionId/);
  assert.doesNotMatch(extractFunction("createCodeMirrorToolbar"), /dataset\.type/);
  assert.doesNotMatch(source, /LocalMarkdown-view-current|Editor view: Markdown/);
});

test("Examples omits the obsolete clickable-image example", () => {
  assert.doesNotMatch(source,
    /Clickable external image|Selecting the image opens the linked page|Clickable random image/);
});

const createOutlineRuntime = new Function(`
  let codeMirrorView = null;
  let codeMirrorMarkdownParser = null;
  ${extractFunction("outlineHeadingLabel")}
  ${extractFunction("codeMirrorOutlineHeadings")}
  return {
    headings(value, nodes) {
      codeMirrorView = { state: { doc: { toString() { return value; } } } };
      codeMirrorMarkdownParser = {
        parse() { return { iterate({ enter }) { for (const node of nodes) enter(node); } }; }
      };
      return codeMirrorOutlineHeadings();
    },
    outlineHeadingLabel
  };
`);

test("outline extracts ATX and Setext headings and cleans inline Markdown", () => {
  const runtime = createOutlineRuntime();
  const value = "# **Alpha** [link](https://example.com)\nBody\nBeta `code`\n===\n";
  const betaFrom = value.indexOf("Beta");
  assert.deepEqual(runtime.headings(value, [
    { name: "ATXHeading1", from: 0, to: value.indexOf("\n") },
    { name: "Paragraph", from: 1, to: 4 },
    { name: "SetextHeading1", from: betaFrom, to: value.length - 1 }
  ]), [
    { from: 0, level: 1, label: "Alpha link" },
    { from: betaFrom, level: 1, label: "Beta code" }
  ]);
  assert.equal(runtime.outlineHeadingLabel("### ![Logo](logo.png) Title ###", 3), "Logo Title");
});

test("outline stays docked, persists open state, and shares editor heading colours", () => {
  const outlineRule = source.match(/\.LocalMarkdown-cm-outline\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(outlineRule, /height: 100%; flex:/);
  assert.match(outlineRule, /border-left: 1px solid var\(--lm-border\)/);
  assert.doesNotMatch(outlineRule, /position:|box-shadow:/);
  assert.match(extractFunction("toggleCodeMirrorOutline"), /localStorage\.setItem\(outlineStorageKey, open \? "open" : "closed"\)/);
  assert.match(extractFunction("initializeCodeMirror"), /localStorage\.getItem\(outlineStorageKey\) === "open"/);
  assert.doesNotMatch(source, /\.LocalMarkdown-cm-outline button\s*\{/);
  assert.match(source, /\.LocalMarkdown-cm-outline-content button\s*\{/);
  assert.match(extractFunction("renderCodeMirrorOutline"),
    /close\.innerHTML = `<svg[\s\S]*?header\.append\(title, close\)/);
  for (let level = 1; level <= 6; level += 1) {
    assert.match(source, new RegExp(
      `\\.LocalMarkdown-cm-line-heading-${level} \\{ color: var\\(--lm-heading-${level}\\)`));
    assert.match(source, new RegExp(
      `\\[data-heading-level="${level}"\\] \\{ color: var\\(--lm-heading-${level}\\)`));
  }
});

const createImageRuntime = new Function(`
  const document = {
    createElement() {
      return {
        set innerHTML(value) {
          this.value = String(value)
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        }
      };
    }
  };
  function attachmentIdForImage() { return null; }
  function attachmentPath(id) { return "lmd/" + id; }
  ${extractFunction("escapeHtmlAttribute")}
  ${extractFunction("imageAlignmentStyle")}
  ${extractFunction("imageHtml")}
  ${extractFunction("decodedHtmlAttribute")}
  ${extractFunction("htmlAttribute")}
  ${extractFunction("imageMarkupCandidates")}
  ${extractFunction("imageSourceReference")}
  ${extractFunction("imageMarkupCandidate")}
  ${extractFunction("replaceMarkdownImageCandidate")}
  ${extractFunction("setHtmlImageWidth")}
  ${extractFunction("setHtmlImageAlignment")}
  ${extractFunction("genericImageResize")}
  ${extractFunction("genericImageAlignment")}
  return {
    imageHtml,
    setHtmlImageWidth,
    setHtmlImageAlignment,
    genericImageResize,
    genericImageAlignment
  };
`);

function fakeImage(markup, attributes = {}) {
  return {
    dataset: { markdownStart: "0", markdownEnd: String(markup.length) },
    getAttribute(name) { return attributes[name] ?? null; },
    closest() { return null; }
  };
}

test("generic image resize and alignment preserve source metadata", () => {
  const runtime = createImageRuntime();
  const markdown = '![A & B](image.png "Caption")';
  const image = fakeImage(markdown, { src: "image.png", alt: "A & B", title: "Caption" });
  assert.equal(
    runtime.genericImageResize(image, markdown, 320, { attachments: new Map() }),
    '<img src="image.png" alt="A &amp; B" title="Caption" width="320">'
  );
  assert.equal(
    runtime.genericImageAlignment(image, markdown, "center", { attachments: new Map() }),
    '<img src="image.png" alt="A &amp; B" title="Caption" style="display: block; margin-left: auto; margin-right: auto;">'
  );

  const html = '<img class="hero" src="image.png" width="200" height="100" style="color: red; display: block; margin-left: auto; margin-right: 0;">';
  assert.equal(
    runtime.setHtmlImageWidth(html, 480),
    '<img class="hero" src="image.png" style="color: red; display: block; margin-left: auto; margin-right: 0;" width="480">'
  );
  assert.match(runtime.setHtmlImageAlignment(html, "left"), /color: red; display: block; margin-left: 0; margin-right: auto;/);
});

test("table images delegate to the same image controls and table-cell paste path", () => {
  assert.match(extractFunction("appendTableCellContent"), /configureCodeMirrorTableImage\(image\);/);
  assert.match(extractFunction("configureCodeMirrorTableImage"), /showImageResizer\(image, true\)/);
  assert.match(source, /if \(tableCell\) void pasteEmbeddedImagesIntoTableCell\(images, tableCell\);/);
  assert.match(extractFunction("editableImageFromNode"), /element\?\.closest\?\.\("img"\)/);
});

const createDrawingRuntime = new Function(`
  let drawingSession = null;
  let documentHistoryRecordingDepth = 0;
  let pendingEditorValueResolve = null;
  let activeInsertFile = null;
  const records = [];
  const statuses = [];
  const inserted = [];
  const exportOptions = [];
  const session = { files: [] };
  const drawingSaveButton = { disabled: false };
  const drawingStatus = { textContent: "" };
  const drawingDialog = { open: true, close() { this.open = false; }, showModal() { this.open = true; } };
  const editor = { focus() { records.push(["focus"]); } };
  class XMLSerializer { serializeToString() { return "<svg/>"; } }
  function readBlobPayload() { return Promise.resolve({ type: "image/svg+xml", data: "svg-data", blob: {} }); }
  function createAttachmentId() { return "drawing-1"; }
  function documentSnapshot(file) { return { text: file.text }; }
  function revokeAttachmentPreview(fileId, id) { records.push(["revoke", fileId, id]); }
  function restoreEditorRange(range) { records.push(["restore-range", range]); }
  function waitForEditorHistoryValue(file) {
    activeInsertFile = file;
    return new Promise(resolve => { pendingEditorValueResolve = resolve; });
  }
  function attachmentPath(id) { return "lmd/" + id; }
  function insertCodeMirrorBlock(markdown) {
    inserted.push(markdown);
    activeInsertFile.text += "\\n\\n" + markdown;
    pendingEditorValueResolve(activeInsertFile.text);
    return true;
  }
  function closeDrawingDialog() { drawingSession = null; }
  function markFileDirty(file) { file.dirty = true; records.push(["dirty", file.id]); }
  function renderFiles() { records.push(["render"]); }
  function scheduleAttachmentPreviews() { records.push(["preview"]); }
  function recordDocumentMutation(file, before, details) {
    records.push(["history", file.id, before.text, details.label]);
  }
  function updateStatus(message) { statuses.push(message); }
  ${extractFunction("commitDrawing")}
  return {
    async run({ file, attachmentId = null }) {
      records.length = 0;
      statuses.length = 0;
      inserted.length = 0;
      exportOptions.length = 0;
      session.files = [file];
      drawingSaveButton.disabled = false;
      drawingDialog.open = true;
      const modules = {
        async exportToSvg(options) { exportOptions.push(options); return {}; }
      };
      drawingSession = {
        modules,
        file,
        editorRange: { anchor: 2, head: 2 },
        attachmentId,
        elements: [{ id: "visible", isDeleted: false }],
        appState: { viewBackgroundColor: "#fff" },
        files: {}
      };
      await commitDrawing();
      return { records: [...records], statuses: [...statuses], inserted: [...inserted], exportOptions: [...exportOptions] };
    }
  };
`);

test("Excalidraw insert and update share one attachment/history lifecycle", async () => {
  const runtime = createDrawingRuntime();
  const insertedFile = { id: "new", text: "# Note", dirty: false, attachments: new Map() };
  const insertion = await runtime.run({ file: insertedFile });
  assert.equal(insertedFile.attachments.get("drawing-1").kind, "excalidraw");
  assert.equal(insertion.inserted[0], "![Excalidraw drawing](lmd/drawing-1)");
  assert.ok(insertion.records.some(record => record.at(-1) === "drawing insertion"));
  assert.equal(insertion.statuses.at(-1), "Drawing embedded in Markdown");
  assert.equal(insertion.exportOptions[0].appState.exportEmbedScene, true);

  const existing = {
    id: "existing-file",
    text: "![Drawing](lmd/existing)",
    dirty: false,
    attachments: new Map([["existing", { id: "existing", kind: "excalidraw", data: "old" }]])
  };
  const update = await runtime.run({ file: existing, attachmentId: "existing" });
  assert.equal(existing.attachments.get("existing").data, "svg-data");
  assert.deepEqual(update.inserted, []);
  assert.ok(update.records.some(record => record.at(-1) === "drawing update"));
  assert.equal(update.statuses.at(-1), "Drawing updated");
});
