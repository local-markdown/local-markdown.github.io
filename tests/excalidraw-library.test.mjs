import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../local-markdown.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const match = new RegExp(`^      (?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, `Missing ${name}`);
  const next = /^      (?:async )?function /gm;
  next.lastIndex = match.index + match[0].length;
  return source.slice(match.index, next.exec(source)?.index ?? source.length);
}

function libraryRuntime(saved = null) {
  const bundled = [{ id: 'bundled' }];
  const storage = new Map(saved === null ? [] : [['library', JSON.stringify({ libraryItems: saved })]]);
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };
  const modules = {
    loadLibraryFromBlob: async blob => JSON.parse(await blob.text()).libraryItems,
    serializeLibraryAsJSON: libraryItems => JSON.stringify({ libraryItems })
  };
  const createAdapter = new Function('localStorage', 'document', 'Blob', `
    const drawingLibraryStorageKey = 'library';
    ${extractFunction('createDrawingLibraryAdapter')}
    return createDrawingLibraryAdapter;
  `)(localStorage, { querySelector: () => ({ textContent: JSON.stringify({ libraryItems: bundled }) }) }, Blob);
  return { createAdapter: () => createAdapter(modules), storage, bundled };
}

test('an untouched library starts with the bundled collection', async () => {
  const runtime = libraryRuntime();
  assert.deepEqual((await runtime.createAdapter().load()).libraryItems, runtime.bundled);
});

test('removing imported items and resetting stay removed after reopening', async () => {
  const runtime = libraryRuntime([{ id: 'first' }, { id: 'second' }]);
  const adapter = runtime.createAdapter();
  adapter.save({ libraryItems: [{ id: 'second' }] });
  assert.deepEqual((await runtime.createAdapter().load()).libraryItems, [{ id: 'second' }]);
  adapter.save({ libraryItems: [] });
  assert.deepEqual((await runtime.createAdapter().load()).libraryItems, []);
});

test('native library reconciliation reads the latest stored items', async () => {
  const runtime = libraryRuntime();
  const adapter = runtime.createAdapter();
  await adapter.load();
  runtime.storage.set('library', JSON.stringify({ libraryItems: [{ id: 'another-tab' }] }));
  assert.deepEqual((await adapter.load()).libraryItems, [{ id: 'another-tab' }]);
});

test('drawing window allows body portals while keeping the document inert', () => {
  const app = { inert: false };
  const dialog = { open: false, show() { this.open = true; }, close() { this.open = false; } };
  const setOpen = new Function('appElement', 'drawingDialog', `
    ${extractFunction('setDrawingDialogOpen')}
    return setDrawingDialogOpen;
  `)(app, dialog);
  setOpen(true);
  assert.equal(dialog.open, true);
  assert.equal(app.inert, true);
  setOpen(false);
  assert.equal(dialog.open, false);
  assert.equal(app.inert, false);
});

test('catalogue returns reopen drawing tools only for library imports', () => {
  const calls = [];
  const run = new Function('hash', 'file', 'drawingSession', 'calls', `
    const editorReady = true, window = { location: { hash } };
    function activeFile() { return file; }
    function createNewFile(section, kind) { calls.push(kind); }
    function openDrawingDialog() { calls.push('open'); }
    ${extractFunction('openDrawingLibraryImport')}
    openDrawingLibraryImport();
  `);
  run('#heading', {}, null, calls);
  run('#addLibrary=https%3A%2F%2Flibraries.excalidraw.com%2Ftest', {}, {}, calls);
  assert.deepEqual(calls, []);
  run('#addLibrary=https%3A%2F%2Flibraries.excalidraw.com%2Ftest', {}, null, calls);
  run('#addLibrary=https%3A%2F%2Flibraries.excalidraw.com%2Ftest', { builtin: true }, null, calls);
  assert.deepEqual(calls, ['open', 'excalidraw']);
});
