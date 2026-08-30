import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../local-markdown.html", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = new RegExp(`^      (?:async )?function ${name}\\(`, "m");
  const match = marker.exec(source);
  assert.ok(match, `Missing ${name}() in local-markdown.html`);
  const nextFunction = /^      (?:async )?function /gm;
  nextFunction.lastIndex = match.index + match[0].length;
  const next = nextFunction.exec(source);
  return source.slice(match.index, next?.index ?? source.length);
}

function assertOrder(functionName, tokens) {
  const functionSource = extractFunction(functionName);
  let cursor = -1;
  for (const token of tokens) {
    const index = functionSource.indexOf(token, cursor + 1);
    assert.notEqual(index, -1, `${functionName}() is missing ${token}`);
    assert.ok(index > cursor, `${functionName}() moved ${token} out of order`);
    cursor = index;
  }
}

const markFileDirtySource = extractFunction("markFileDirty");
const createRuntime = new Function(`
  const calls = [];
  function scheduleAutoSave(file) { calls.push(["auto-save", file]); }
  function scheduleSessionSave() { calls.push(["session-save"]); }
  ${markFileDirtySource}
  return { calls, markFileDirty };
`);

test("markFileDirty has only the shared dirty and save-scheduling effects", () => {
  const runtime = createRuntime();
  const file = { dirty: false };

  runtime.markFileDirty(file);

  assert.equal(file.dirty, true);
  assert.deepEqual(runtime.calls, [
    ["auto-save", file],
    ["session-save"]
  ]);
  assert.doesNotMatch(markFileDirtySource, /renderFiles|recordDocumentMutation|documentSnapshot/);
});

test("markFileDirty is the only dirty=true assignment", () => {
  const dirtyAssignments = [...source.matchAll(/\b[\w.]+\.dirty\s*=\s*true;/g)];
  assert.equal(dirtyAssignments.length, 1);
  assert.equal(dirtyAssignments[0][0], "file.dirty = true;");
  assert.ok(
    dirtyAssignments[0].index >= source.indexOf(markFileDirtySource)
      && dirtyAssignments[0].index < source.indexOf(markFileDirtySource)
        + markFileDirtySource.length,
    "dirty=true escaped markFileDirty()"
  );
  assert.match(
    markFileDirtySource,
    /file\.dirty = true;\n\s+scheduleAutoSave\(file\);\n\s+scheduleSessionSave\(\);/
  );
});

test("existing builtin guards remain in guarded mutation callers", () => {
  for (const functionName of [
    "synchronizeDocumentHistoryPresent",
    "applyDocumentSnapshot",
    "captureEditorValue",
    "applyTableStructureUpdate",
    "applyTableWidthTextUpdate",
    "applyImageUpdate",
    "handleCodeMirrorInput"
  ]) {
    assert.match(
      extractFunction(functionName),
      /if \(!file\.builtin\) \{\s+markFileDirty\(file\);\s+\}/,
      `${functionName}() lost its builtin guard`
    );
  }

  assert.doesNotMatch(
    extractFunction("processPastedAttachment"),
    /if \(!file\.builtin\) \{\s+markFileDirty\(file\);\s+\}/
  );
});

test("history snapshots and recording stay ordered in their mutation callers", () => {
  assertOrder("synchronizeDocumentHistoryPresent", [
    "const history = documentHistoryFor(file);",
    "markFileDirty(file);",
    "history.present = documentSnapshot(file);"
  ]);
  assertOrder("applyDocumentSnapshot", [
    "restoringDocumentHistory = true;",
    "markFileDirty(file);",
    "restoringDocumentHistory = false;"
  ]);
  assertOrder("captureEditorValue", [
    "const before = documentSnapshot(file, { captureSelection: false });",
    "markFileDirty(file);",
    "recordDocumentMutation(file, before, details);"
  ]);
  assertOrder("applyTableStructureUpdate", [
    "const before = documentSnapshot(file);",
    "markFileDirty(file);",
    "recordDocumentMutation(file, before, { label: message.toLocaleLowerCase() });"
  ]);
  assertOrder("applyTableWidthTextUpdate", [
    "const before = documentSnapshot(file);",
    "markFileDirty(file);",
    "recordDocumentMutation(file, before, {"
  ]);
  assertOrder("applyImageUpdate", [
    "const before = documentSnapshot(file);",
    "markFileDirty(file);",
    "recordDocumentMutation(file, before, { label: message.toLocaleLowerCase() });"
  ]);
  assertOrder("handleCodeMirrorInput", [
    "const before = documentSnapshot(file, { captureSelection: false });",
    "markFileDirty(file);",
    "if (transactionInput) {",
    "else recordDocumentMutation(file, before, editorHistoryDetails(file));"
  ]);
  assertOrder("commitDrawing", [
    "closeDrawingDialog({ focusEditor: false });",
    "markFileDirty(current.file);",
    "renderFiles();",
    "scheduleAttachmentPreviews();",
    "recordDocumentMutation(current.file, before, {"
  ]);
  assertOrder("pasteEmbeddedImages", [
    "file.text = await editorValuePromise;",
    "markFileDirty(file);",
    "renderFiles();",
    "scheduleAttachmentPreviews();",
    "recordDocumentMutation(file, before, {"
  ]);
  assertOrder("pasteEmbeddedImagesIntoTableCell", [
    "markFileDirty(file);",
    "renderFiles();",
    "scheduleAttachmentPreviews();",
    "recordDocumentMutation(file, before, {"
  ]);
});

test("unload delegates to comprehensive owned-resource cleanup", () => {
  const cleanupAndListener = extractFunction("disposeRuntimeResources");
  const cleanupEnd = cleanupAndListener.indexOf("\n      }\n");
  assert.notEqual(cleanupEnd, -1, "Could not find the end of disposeRuntimeResources()");
  const cleanup = cleanupAndListener.slice(0, cleanupEnd + "\n      }".length);
  assert.match(source, /addEventListener\("unload", disposeRuntimeResources\);/);
  assert.doesNotMatch(source, /addEventListener\("unload",\s*\(\)\s*=>/);
  assertOrder("disposeRuntimeResources", [
    "attachmentPreviewObserver?.disconnect();",
    "cancelAnimationFrame(codeMirrorLineDecorationFrame);",
    "cancelAnimationFrame(editorStateRestoreFrame);",
    "cancelAnimationFrame(tableWidthRefreshFrame);",
    "cancelAnimationFrame(tableResizeSession.frameId);",
    "clearTimeout(imagePreviewTimer);",
    "clearTimeout(attachmentPreviewTimer);",
    "clearTimeout(sessionSaveTimer);",
    "clearTimeout(editorHistorySynchronizationTimer);",
    "for (const timer of autoSaveTimers.values()) clearTimeout(timer);",
    "autoSaveTimers.clear();",
    "for (const request of imageWorkerRequests.values()) clearTimeout(request.timer);",
    "imageWorkerRequests.clear();",
    "for (const waiter of editorHistoryValueWaiters.values()) clearTimeout(waiter.timeout);",
    "editorHistoryValueWaiters.clear();",
    "sidebarDragPreview?.remove();",
    "releaseAttachmentPreviews();",
    "imageWorker?.terminate();",
    "if (imageWorkerUrl) URL.revokeObjectURL(imageWorkerUrl);",
    "drawingRoot?.unmount();",
    "flushActiveCodeMirrorTableCell = () => false;",
    "codeMirrorView?.destroy();"
  ]);
  for (const reset of [
    "attachmentPreviewObserver = null;",
    "codeMirrorLineDecorationFrame = null;",
    "editorStateRestoreFrame = null;",
    "tableWidthRefreshFrame = null;",
    "tableResizeSession = null;",
    "imagePreviewTimer = null;",
    "attachmentPreviewTimer = null;",
    "sessionSaveTimer = null;",
    "editorHistorySynchronizationTimer = null;",
    "editorHistorySynchronization = null;",
    "sidebarDragPreview = null;",
    "imageWorker = null;",
    "imageWorkerUrl = null;",
    "drawingRoot = null;",
    "drawingSession = null;",
    "flushActiveCodeMirrorTableCell = () => false;",
    "codeMirrorView = null;",
    "editor = null;",
    "editorReady = false;"
  ]) assert.match(cleanup, new RegExp(reset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(cleanup, /sessionDatabasePromise|\.close\(/);
});

test("owned-resource cleanup cancels active work and resets references", () => {
  const cleanupAndListener = extractFunction("disposeRuntimeResources");
  const cleanupEnd = cleanupAndListener.indexOf("\n      }\n");
  const cleanup = cleanupAndListener.slice(0, cleanupEnd + "\n      }".length);
  const createCleanupRuntime = new Function(`
    const calls = [];
    function cancelAnimationFrame(value) { calls.push(["cancel-frame", value]); }
    function clearTimeout(value) { calls.push(["clear-timeout", value]); }
    function releaseAttachmentPreviews() { calls.push(["release-previews"]); }
    const URL = { revokeObjectURL(value) { calls.push(["revoke-url", value]); } };
    let attachmentPreviewObserver = { disconnect() { calls.push(["disconnect-observer"]); } };
    let codeMirrorLineDecorationFrame = 11;
    let editorStateRestoreFrame = 12;
    let tableWidthRefreshFrame = 13;
    let tableResizeSession = { frameId: 14 };
    let imagePreviewTimer = 21;
    let attachmentPreviewTimer = 22;
    let sessionSaveTimer = 27;
    let editorHistorySynchronizationTimer = 23;
    let editorHistorySynchronization = {};
    const autoSaveTimers = new Map([["file", 24]]);
    const imageWorkerRequests = new Map([[1, { timer: 25 }]]);
    const editorHistoryValueWaiters = new Map([["file", { timeout: 26 }]]);
    let sidebarDragPreview = { remove() { calls.push(["remove-drag-preview"]); } };
    let imageWorker = { terminate() { calls.push(["terminate-worker"]); } };
    let imageWorkerUrl = "blob:worker";
    let drawingRoot = { unmount() { calls.push(["unmount-drawing"]); } };
    let drawingSession = {};
    let flushActiveCodeMirrorTableCell = () => true;
    let codeMirrorView = { destroy() { calls.push(["destroy-editor"]); } };
    let editor = {};
    let editorReady = true;
    ${cleanup}
    return {
      calls,
      disposeRuntimeResources,
      state() {
        return {
          attachmentPreviewObserver,
          codeMirrorLineDecorationFrame,
          editorStateRestoreFrame,
          tableWidthRefreshFrame,
          tableResizeSession,
          imagePreviewTimer,
          attachmentPreviewTimer,
          sessionSaveTimer,
          editorHistorySynchronizationTimer,
          editorHistorySynchronization,
          autoSaveTimerCount: autoSaveTimers.size,
          imageWorkerRequestCount: imageWorkerRequests.size,
          editorHistoryWaiterCount: editorHistoryValueWaiters.size,
          sidebarDragPreview,
          imageWorker,
          imageWorkerUrl,
          drawingRoot,
          drawingSession,
          tableCellFlushDisabled: flushActiveCodeMirrorTableCell() === false,
          codeMirrorView,
          editor,
          editorReady
        };
      }
    };
  `);
  const runtime = createCleanupRuntime();

  runtime.disposeRuntimeResources();

  assert.deepEqual(runtime.state(), {
    attachmentPreviewObserver: null,
    codeMirrorLineDecorationFrame: null,
    editorStateRestoreFrame: null,
    tableWidthRefreshFrame: null,
    tableResizeSession: null,
    imagePreviewTimer: null,
    attachmentPreviewTimer: null,
    sessionSaveTimer: null,
    editorHistorySynchronizationTimer: null,
    editorHistorySynchronization: null,
    autoSaveTimerCount: 0,
    imageWorkerRequestCount: 0,
    editorHistoryWaiterCount: 0,
    sidebarDragPreview: null,
    imageWorker: null,
    imageWorkerUrl: null,
    drawingRoot: null,
    drawingSession: null,
    tableCellFlushDisabled: true,
    codeMirrorView: null,
    editor: null,
    editorReady: false
  });
  for (const expected of [
    ["cancel-frame", 11], ["cancel-frame", 12], ["cancel-frame", 13],
    ["cancel-frame", 14], ["clear-timeout", 21], ["clear-timeout", 22],
    ["clear-timeout", 27],
    ["clear-timeout", 23], ["clear-timeout", 24], ["clear-timeout", 25],
    ["clear-timeout", 26], ["disconnect-observer"], ["remove-drag-preview"],
    ["release-previews"], ["terminate-worker"], ["revoke-url", "blob:worker"],
    ["unmount-drawing"], ["destroy-editor"]
  ]) assert.ok(runtime.calls.some(call => JSON.stringify(call) === JSON.stringify(expected)));
});
