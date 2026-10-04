import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { diff } from "@codemirror/merge";

const source = readFileSync(new URL("../local-markdown.html", import.meta.url), "utf8");
function extractFunction(name) {
  const match = new RegExp(`^      (?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(match, `Missing ${name}`);
  const next = /^      (?:async )?function /gm;
  next.lastIndex = match.index + match[0].length;
  return source.slice(match.index, next.exec(source)?.index ?? source.length);
}

const createRuntime = new Function("EditorState", "StateEffect", "codeMirrorDiff", "text", "selection", `
  const file = { id: "test", name: "test.md", text, attachments: new Map() };
  const dispatches = [], history = [], revoked = [], previews = [];
  const scrollEffect = StateEffect.define({ map: (position, changes) => changes.mapPos(position) });
  let scrollAnchor = text.indexOf("Stable middle");
  let codeMirrorInputSuppression = 0, imageResizeSession = null;
  let pendingEditorHistoryInput = null, restoringDocumentHistory = false;
  const editorReady = true;
  const codeMirrorView = {
    state: EditorState.create({ doc: text, selection,
      extensions: EditorState.allowMultipleSelections.of(true) }),
    scrollSnapshot() { return scrollEffect.of(scrollAnchor); },
    dispatch(spec) {
      const transaction = this.state.update(spec);
      dispatches.push({ transaction, suppression: codeMirrorInputSuppression });
      this.state = transaction.state;
      const effect = transaction.effects.find(effect => effect.is(scrollEffect));
      if (effect) scrollAnchor = effect.value;
    }
  };
  function activeFile() { return file; }
  function isDrawingFile(file) { return file.name.endsWith(".excalidraw"); }
  function renderDrawingFilePreview(file) { previews.push(file.text); }
  function renderCodeMirrorOutline() {}
  function closeTableContextMenu() {}
  function hideImageResizer() {}
  function renderFiles() {}
  function updateStatus() {}
  function scheduleAttachmentPreviews() {}
  function scheduleTableWidths() {}
  function scheduleSessionSave() {}
  function captureEditorValue() {}
  function resetDocumentHistory() { history.length = 0; }
  function parseStoredMarkdown(text) { return { text, attachments: new Map() }; }
  function currentEditorMarkdown() { return codeMirrorView.state.doc.toString(); }
  function canonicalEditorText(value) { return value; }
  function markFileDirty(file) { file.dirty = true; }
  function documentSnapshot(file) { return { text: file.text }; }
  function recordDocumentMutation(file, before, options) { history.push({ before, options }); }
  function revokeAttachmentPreview(fileId, id) { revoked.push(id); }
  ${["applyEditorChanges", "updateEditorDocument", "applyImageUpdate",
    "applyTableStructureUpdate", "replaceFileAttachments", "applyDocumentSnapshot",
    "loadFileFromHandle", "saveActiveFile"]
    .map(extractFunction).join("\n")}
  return { file, codeMirrorView, dispatches, history, revoked, previews,
    applyEditorChanges, updateEditorDocument, applyImageUpdate, applyTableStructureUpdate,
    applyDocumentSnapshot, replaceFileAttachments, saveActiveFile,
    scrollAnchor: () => scrollAnchor,
    suppression: () => codeMirrorInputSuppression
  };
`);

const fixture = "Before 🦊\n\n<img src=\"photo.png\" width=\"160\">\n\n"
  + "Stable middle\n\n| A | B |\n| --- | --- |\n| One | Two |\n\nAfter 🌻\n";
const runtime = (selection = { anchor: fixture.length - 1 }) =>
  createRuntime(EditorState, StateEffect, diff, fixture, selection);

function changedRanges(transaction) {
  const ranges = [];
  transaction.changes.iterChanges((from, to, _fromB, _toB, insert) =>
    ranges.push({ from, to, insert: insert.toString() }));
  return ranges;
}

test("image resizing updates the image source without replacing surrounding text or collapsing selections", () => {
  const selection = EditorSelection.create([
    EditorSelection.range(8, 3),
    EditorSelection.range(fixture.length - 2, fixture.length - 6)
  ], 1);
  const app = runtime(selection);
  const updated = fixture.replace('width="160"', 'width="240"');
  assert.equal(app.applyImageUpdate(app.file, fixture, updated, "Resize image"), true);
  const { transaction, suppression } = app.dispatches[0];
  assert.equal(transaction.newDoc.toString(), updated);
  assert.equal(transaction.newSelection.eq(selection), true);
  assert.equal(app.scrollAnchor(), fixture.indexOf("Stable middle"));
  assert.ok(changedRanges(transaction).every(change =>
    change.from >= fixture.indexOf('<img') && change.to < fixture.indexOf("Stable middle")));
  assert.equal(suppression, 1);
  assert.equal(app.suppression(), 0);
  assert.equal(app.file.text, updated);
  assert.equal(app.file.dirty, true);
  assert.deepEqual(app.history, [{ before: { text: fixture }, options: { label: "resize image" } }]);
});

test("table structure changes map a selection after the table and preserve the earlier scroll anchor", () => {
  const app = runtime();
  const row = "| Three | Four |\n";
  const updated = fixture.replace("\n\nAfter", "\n" + row + "\nAfter");
  app.applyTableStructureUpdate(app.file, updated, "Row added");
  assert.equal(app.codeMirrorView.state.doc.toString(), updated);
  assert.equal(app.codeMirrorView.state.selection.main.head, fixture.length - 1 + row.length);
  assert.equal(app.scrollAnchor(), fixture.indexOf("Stable middle"));
  assert.ok(changedRanges(app.dispatches[0].transaction).every(change =>
    change.from >= fixture.indexOf("| A") && change.to < fixture.indexOf("After")));
  assert.equal(app.history.length, 1);
});

test("snapshot and reload updates retain unchanged content between distant edits", () => {
  const app = runtime({ anchor: fixture.length });
  const updated = fixture.replace("Before 🦊", "Before 🦊: revised")
    .replace("After 🌻", "After 🌻: revised");
  app.updateEditorDocument(app.file, updated);
  const ranges = changedRanges(app.dispatches[0].transaction);
  assert.equal(app.codeMirrorView.state.doc.toString(), updated);
  const middle = fixture.indexOf("Stable middle");
  assert.ok(ranges.length >= 2);
  assert.ok(ranges.every(change => change.to <= middle || change.from > middle + 13));
  assert.equal(app.scrollAnchor(), updated.indexOf("Stable middle"));
  assert.equal(app.codeMirrorView.state.selection.main.head, updated.length);
});

test("undo and redo snapshots restore text and selection without resetting the current scroll anchor", () => {
  const app = runtime();
  const attachment = { type: "image/png", data: "data" };
  app.file.attachments.set("photo", attachment);
  const updated = fixture.replace('width="160"', 'width="320"');
  const initial = { text: fixture, attachments: new Map(app.file.attachments),
    selection: { anchor: fixture.length - 1, head: fixture.length - 4 }, scroll: { top: 0 } };
  const resized = { ...initial, text: updated };
  app.applyDocumentSnapshot(app.file, resized);
  assert.equal(app.codeMirrorView.state.doc.toString(), updated);
  assert.deepEqual(app.codeMirrorView.state.selection.main.toJSON(), resized.selection);
  assert.equal(app.scrollAnchor(), fixture.indexOf("Stable middle"));
  app.applyDocumentSnapshot(app.file, initial);
  assert.equal(app.codeMirrorView.state.doc.toString(), fixture);
  assert.deepEqual(app.revoked, [], "unchanged image previews must survive undo/redo");
  assert.equal(app.history.length, 0, "restoring a snapshot must not create another history entry");
  assert.ok(app.dispatches.every(({ transaction }) => changedRanges(transaction)
    .every(change => change.from > 0 && change.to < fixture.length)));
});

test("attachment replacement invalidates only removed or changed image previews", () => {
  const app = runtime();
  const same = { data: "same" };
  app.file.attachments = new Map([["keep", same], ["change", { data: "old" }], ["remove", {}]]);
  const next = new Map([["keep", same], ["change", { data: "new" }]]);
  app.replaceFileAttachments(app.file, next);
  assert.deepEqual(app.revoked, ["change", "remove"]);
  assert.deepEqual(app.file.attachments, next);
  assert.notEqual(app.file.attachments, next);
});

test("reconnecting a clean file applies external edits incrementally", async () => {
  const app = runtime({ anchor: fixture.length });
  const updated = fixture.replace("Before 🦊", "New beginning 🦊").replace("After 🌻", "New ending 🌻");
  app.file.needsPermission = true;
  app.file.handle = {
    requestPermission: async () => "granted",
    getFile: async () => ({ name: "test.md", text: async () => updated })
  };
  await app.saveActiveFile();
  assert.equal(app.file.needsPermission, false);
  assert.equal(app.file.dirty, false);
  assert.equal(app.file.text, updated);
  assert.equal(app.codeMirrorView.state.doc.toString(), updated);
  assert.equal(app.codeMirrorView.state.selection.main.head, updated.length);
  assert.equal(app.scrollAnchor(), updated.indexOf("Stable middle"));
  assert.ok(changedRanges(app.dispatches[0].transaction).length >= 2);
});

test("unchanged and CRLF-equivalent snapshots need no editor transaction", () => {
  const app = runtime();
  app.updateEditorDocument(app.file, fixture);
  app.updateEditorDocument(app.file, fixture.replaceAll("\n", "\r\n"));
  assert.equal(app.dispatches.length, 0);
  app.updateEditorDocument(app.file, "", { anchor: 90, head: -1 });
  assert.equal(app.codeMirrorView.state.doc.length, 0);
  assert.deepEqual(app.codeMirrorView.state.selection.main.toJSON(), { anchor: 0, head: 0 });
});

test("drawing snapshots update the preview without putting drawing JSON into the Markdown editor", () => {
  const app = runtime();
  app.file.name = "test.excalidraw";
  app.file.text = '{"elements":[]}';
  app.updateEditorDocument(app.file);
  assert.equal(app.dispatches.length, 0);
  assert.deepEqual(app.previews, [app.file.text]);
});

test("a failed dispatch always releases input suppression", () => {
  const app = runtime();
  app.codeMirrorView.dispatch = () => { throw new Error("failed dispatch"); };
  assert.throws(() => app.updateEditorDocument(app.file, fixture + "more"), /failed dispatch/);
  assert.equal(app.suppression(), 0);
});

test("full-document loading is confined to startup and file activation", () => {
  assert.equal([...source.matchAll(/\bloadEditorDocument\(/g)].length, 3);
  assert.match(extractFunction("activateFile"), /loadEditorDocument\(file\)/);
  assert.doesNotMatch(source, /\bsetEditorValue\(|editor\.setValue\(/);
});
