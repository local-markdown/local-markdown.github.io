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

test("the Excalidraw menu supports scene import and export", () => {
  const openDrawingDialog = extractFunction("openDrawingDialog");

  assert.match(openDrawingDialog, /loadScene:\s*true/);
  assert.match(openDrawingDialog, /saveToActiveFile:\s*true/);
  assert.match(openDrawingDialog, /export:\s*false/);
  assert.match(openDrawingDialog, /saveAsImage:\s*false/);
});

test("new drawings explain how imported scenes enter Markdown", () => {
  assert.match(
    extractFunction("openDrawingDialog"),
    /Draw or open a \.excalidraw file, then select Insert/
  );
});

const drawingHelpers = new Function(`
  const session = { files: [{ name: 'Untitled.excalidraw' }, { name: 'Untitled.md' }] };
  ${extractFunction('isDrawingFile')}
  ${extractFunction('drawingFileText')}
  ${extractFunction('nextUntitledName')}
  ${extractFunction('suggestedFileName')}
  return { isDrawingFile, drawingFileText, nextUntitledName, suggestedFileName };
`)();

test('standalone drawings use collision-free names and keep their extension on save', () => {
  assert.equal(drawingHelpers.nextUntitledName(), 'Untitled-2.md');
  assert.equal(drawingHelpers.nextUntitledName('excalidraw'), 'Untitled-2.excalidraw');
  assert.equal(drawingHelpers.suggestedFileName({ name: 'Design.excalidraw' }), 'Design.excalidraw');
});

test('standalone scene JSON preserves elements and image data without transient UI state', () => {
  const elements = [{ id: 'shape', type: 'rectangle', isDeleted: false }];
  const files = { image: { id: 'image', dataURL: 'data:image/png;base64,AAAA' } };
  const scene = JSON.parse(drawingHelpers.drawingFileText(elements, {
    viewBackgroundColor: '#abcdef', gridSize: 20, collaborators: new Map(), selectedElementIds: { shape: true }
  }, files));
  assert.equal(scene.type, 'excalidraw');
  assert.equal(scene.version, 2);
  assert.deepEqual(scene.elements, elements);
  assert.deepEqual(scene.files, files);
  assert.deepEqual(scene.appState, { viewBackgroundColor: '#abcdef', gridSize: 20 });
  assert.deepEqual(JSON.parse(drawingHelpers.drawingFileText()).elements, []);
});

test('capturing the hidden Markdown editor never overwrites a standalone scene', () => {
  const file = { name: 'Design.excalidraw', text: drawingHelpers.drawingFileText() };
  const capture = new Function('file', `
    const editorReady = true;
    function activeFile() { return file; }
    function flushActiveCodeMirrorTableCell() { throw new Error('Must not touch Markdown'); }
    ${extractFunction('isDrawingFile')}
    ${extractFunction('captureEditorValue')}
    return captureEditorValue;
  `)(file);
  const before = file.text;
  capture();
  assert.equal(file.text, before);
});

test('standalone drawing changes persist, including deleting the last shape', async () => {
  const file = { name: 'Design.excalidraw', text: drawingHelpers.drawingFileText(), attachments: new Map() };
  const open = new Function('file', 'Blob', `
    let drawingSession = null, drawingRoot = null, props = null;
    const editorReady = true;
    const drawingSaveButton = {}, drawingCancelButton = {}, drawingStatus = {}, drawingLoading = {};
    const drawingDialog = { showModal() {} }, drawingCanvas = {};
    const document = { documentElement: { dataset: {} } };
    function captureEditorValue() {}
    function activeFile() { return file; }
    function currentEditorRange() { return {}; }
    function markFileDirty() { file.dirty = true; }
    function scheduleSessionSave() {}
    function renderFiles() {}
    async function loadExcalidrawModules() {
      return {
        loadFromBlob: async blob => JSON.parse(await blob.text()),
        React: { createElement(type, options) { props = options; } },
        createRoot: () => ({ render() {} }), Excalidraw: {}
      };
    }
    ${extractFunction('isDrawingFile')}
    ${extractFunction('drawingFileText')}
    ${extractFunction('openDrawingDialog')}
    return async () => { await openDrawingDialog(); return { props, drawingSaveButton }; };
  `)(file, Blob);
  const { props, drawingSaveButton } = await open();
  assert.equal(drawingSaveButton.disabled, false);
  assert.equal(drawingSaveButton.textContent, 'Done');
  props.onChange([{ id: 'shape', type: 'rectangle' }], {}, {});
  assert.equal(JSON.parse(file.text).elements.length, 1);
  assert.equal(file.dirty, true);
  props.onChange([], {}, {});
  assert.deepEqual(JSON.parse(file.text).elements, []);
  assert.equal(drawingSaveButton.disabled, false);
});

function previewRuntime(loadModules) {
  const preview = {
    children: [], textContent: '',
    replaceChildren(...children) { this.children = children; this.textContent = ''; }
  };
  const revoked = [];
  const render = new Function('preview', 'loadExcalidrawModules', 'revoked', 'Blob', `
    let drawingPreviewToken = null, drawingPreviewUrl = null;
    const document = {
      querySelector() { return preview; },
      createElement() { return { addEventListener() {} }; }
    };
    const URL = { createObjectURL() { return 'blob:preview'; }, revokeObjectURL(url) { revoked.push(url); } };
    class XMLSerializer { serializeToString() { return '<svg/>'; } }
    ${extractFunction('isDrawingFile')}
    ${extractFunction('renderDrawingFilePreview')}
    return renderDrawingFilePreview;
  `)(preview, loadModules, revoked, Blob);
  return { render, preview, revoked };
}

test('inline previews show drawings, release their URLs, and explain empty scenes', async () => {
  const runtime = previewRuntime(async () => ({ exportToSvg: async () => ({}) }));
  await runtime.render({ name: 'Design.excalidraw', text: drawingHelpers.drawingFileText([{ id: 'shape' }]) });
  assert.equal(runtime.preview.children[0].src, 'blob:preview');
  assert.equal(runtime.preview.children[0].alt, 'Preview of Design.excalidraw');
  await runtime.render({ name: 'Empty.excalidraw', text: drawingHelpers.drawingFileText() });
  assert.deepEqual(runtime.revoked, ['blob:preview']);
  assert.match(runtime.preview.textContent, /drawing is empty/);
});

test('a pending drawing preview cannot replace the newly selected file', async () => {
  let finishExport;
  const runtime = previewRuntime(async () => ({
    exportToSvg: () => new Promise(resolve => { finishExport = resolve; })
  }));
  const pending = runtime.render({ name: 'Design.excalidraw', text: drawingHelpers.drawingFileText([{ id: 'shape' }]) });
  await Promise.resolve();
  await runtime.render({ name: 'Notes.md', text: '# Notes' });
  finishExport({});
  await pending;
  assert.deepEqual(runtime.preview.children, []);
  assert.equal(runtime.preview.textContent, '');
});
