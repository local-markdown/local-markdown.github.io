import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../local-markdown.html", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = `      function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${name}() in local-markdown.html`);
  const next = source.indexOf("\n      function ", start + marker.length);
  assert.notEqual(next, -1, `Could not find the end of ${name}()`);
  return source.slice(start, next);
}

const createRuntime = new Function(`
  let currentFile = null;
  let codeMirrorView = null;
  let editorReady = true;
  let editorStateRestoreFrame = null;
  let nextFrameId = 1;
  const frames = new Map();

  function activeFile() { return currentFile; }
  function requestAnimationFrame(callback) {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  }
  function cancelAnimationFrame(id) { frames.delete(id); }

  ${extractFunction("editorSelectionSnapshot")}
  ${extractFunction("editorScrollSnapshot")}
  ${extractFunction("currentEditorRange")}
  ${extractFunction("restoreEditorRange")}
  ${extractFunction("restoreEditorSelection")}

  return {
    editorSelectionSnapshot,
    editorScrollSnapshot,
    currentEditorRange,
    restoreEditorRange,
    restoreEditorSelection,
    setCurrentFile(file) { currentFile = file; },
    setCodeMirrorView(view) { codeMirrorView = view; },
    setEditorReady(ready) { editorReady = ready; },
    flushFrames() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    },
    pendingFrameCount() { return frames.size; }
  };
`);

function fakeCodeMirrorView({ length = 12, anchor = 3, head = 8 } = {}) {
  const dispatches = [];
  let focusCount = 0;
  const scrollDOM = { scrollTop: 17, scrollLeft: 5 };
  const view = {
    state: { doc: { length }, selection: { main: { anchor, head } } },
    scrollDOM,
    dispatch(transaction) { dispatches.push(transaction); },
    focus() { focusCount += 1; }
  };
  return { view, dispatches, scrollDOM, focusCount: () => focusCount };
}

const createActivationRuntime = new Function("files", `
  const calls = [];
  const session = { activeId: files[0].id, files: [...files], lastOpenHandle: null };
  const editorStatesByFile = new WeakMap();
  let editorReady = true;
  let pendingEditorHistoryInput = null;
  let tableResizeSession = null;

  function activeFile() { return session.files.find(file => file.id === session.activeId); }
  function captureDocumentSnapshotEditorState(snapshot, file) {
    calls.push(["capture", file.id]);
    snapshot.selection = { anchor: file.cursor, head: file.cursor };
    snapshot.scroll = { top: file.scrollTop, left: file.scrollLeft };
  }
  function releaseAttachmentPreviews(id) { calls.push(["release", id]); }
  function finishTableResize() {}
  function hideTableResizeHandle() {}
  function hideImageResizer() {}
  function syncSidebarFileAvailability() {}
  function setEditorValue(file) { calls.push(["set", file.id]); }
  function documentHistoryFor(file) { calls.push(["history", file.id]); }
  function restoreEditorSelection(file, selection, scroll) {
    calls.push(["restore", file.id, selection, scroll]);
  }
  function renderFiles() {}
  function updateStatus() {}
  function scheduleAttachmentPreviews() {}
  function scheduleTableWidths() {}
  function scheduleSessionSave() {}
  function updateDocumentHistoryControls() {}

  ${extractFunction("activateFile")}

  return { activateFile, calls, session, savedState(file) {
    return editorStatesByFile.get(file);
  } };
`);

test("CodeMirror selection, range, and scroll snapshots have no legacy fields", () => {
  const runtime = createRuntime();
  const file = { id: "active" };
  const fake = fakeCodeMirrorView();
  runtime.setCurrentFile(file);
  runtime.setCodeMirrorView(fake.view);

  assert.deepEqual(runtime.editorSelectionSnapshot(file), { anchor: 3, head: 8 });
  assert.deepEqual(runtime.currentEditorRange(file), { anchor: 3, head: 8 });
  assert.deepEqual(runtime.editorScrollSnapshot(file), { top: 17, left: 5 });
  assert.equal(runtime.editorSelectionSnapshot({ id: "other" }), null);
  assert.equal(runtime.currentEditorRange({ id: "other" }), null);
  assert.equal(runtime.editorScrollSnapshot({ id: "other" }), null);
});

test("restoreEditorRange clamps positions, dispatches, scrolls, and focuses", () => {
  const runtime = createRuntime();
  const fake = fakeCodeMirrorView({ length: 10 });
  runtime.setCodeMirrorView(fake.view);

  runtime.restoreEditorRange({ anchor: -4, head: 25 });
  assert.deepEqual(fake.dispatches, [{
    selection: { anchor: 0, head: 10 },
    scrollIntoView: true
  }]);
  assert.equal(fake.focusCount(), 1);

  runtime.restoreEditorRange(null);
  assert.deepEqual(fake.dispatches[1], {
    selection: { anchor: 10, head: 10 },
    scrollIntoView: true
  });
  assert.equal(fake.focusCount(), 2);
});

test("restoreEditorSelection uses the latest frame and restores CM state", () => {
  const runtime = createRuntime();
  const file = { id: "active" };
  const fake = fakeCodeMirrorView({ length: 9 });
  runtime.setCurrentFile(file);
  runtime.setCodeMirrorView(fake.view);

  runtime.restoreEditorSelection(file, { anchor: 2, head: 4 }, { top: 20, left: 6 });
  runtime.restoreEditorSelection(file, { anchor: -3, head: 30 }, { top: 41, left: 7 });
  assert.equal(runtime.pendingFrameCount(), 1);
  runtime.flushFrames();

  assert.deepEqual(fake.dispatches, [{ selection: { anchor: 0, head: 9 } }]);
  assert.equal(fake.focusCount(), 1);
  assert.equal(fake.scrollDOM.scrollTop, 41);
  assert.equal(fake.scrollDOM.scrollLeft, 7);
});

test("activateFile captures the previous state and restores after target setup", () => {
  const first = {
    id: "first", cursor: 4, scrollTop: 31, scrollLeft: 2, attachments: new Map()
  };
  const second = {
    id: "second", cursor: 7, scrollTop: 55, scrollLeft: 3, attachments: new Map()
  };
  const runtime = createActivationRuntime([first, second]);

  runtime.activateFile(second);
  assert.deepEqual(runtime.savedState(first), {
    selection: { anchor: 4, head: 4 },
    scroll: { top: 31, left: 2 }
  });
  assert.equal(runtime.calls.some(([name]) => name === "restore"), false);

  runtime.calls.length = 0;
  runtime.activateFile(first);
  const setIndex = runtime.calls.findIndex(([name]) => name === "set");
  const historyIndex = runtime.calls.findIndex(([name]) => name === "history");
  const restoreIndex = runtime.calls.findIndex(([name]) => name === "restore");
  assert.ok(setIndex >= 0 && setIndex < historyIndex && historyIndex < restoreIndex);
  assert.deepEqual(runtime.calls[restoreIndex], [
    "restore",
    "first",
    { anchor: 4, head: 4 },
    { top: 31, left: 2 }
  ]);
});

test("the old editor compatibility tokens do not return", () => {
  for (const token of [
    "getCurrentMode",
    '"ir"',
    "insertEmptyBlock",
    "selectionNodePath",
    "nodeAtSelectionPath",
    "selectionOffsetLimit",
    "irScrollRestoreFrame"
  ]) {
    assert.equal(source.includes(token), false, `Found legacy token: ${token}`);
  }
  assert.doesNotMatch(source, /editor\??\.kind/);
});
