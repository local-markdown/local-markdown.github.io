import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../local-markdown.html', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`      async function ${name}(`);
  assert.notEqual(start, -1);
  const end = source.slice(start + 1).search(/\n      (?:async )?function /);
  return source.slice(start, start + 1 + end);
}

function runtime({ ready = true, fail = false } = {}) {
  const file = { name: '会议.notes.md', text: '# Latest edits', attachments: new Map(), dirty: true, handle: null };
  const downloads = [], statuses = [], timers = [], revoked = [];
  let captured = false;
  const document = {
    createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }),
    body: { append() {} }
  };
  const implementation = extract('downloadWordFile').replace(/import\("https:\/\/cdn\.jsdelivr\.net\/npm\/[^"\n]+"\)/g, 'loadModule()');
  const run = new Function('captureEditorValue', 'activeFile', 'isDrawingFile', 'updateStatus',
    'waitForFileAttachments', 'loadModule', 'createWordDocument', 'document', 'URL', 'setTimeout', 'console',
    `${implementation}; return downloadWordFile;`)(
    () => { captured = true; }, () => file, () => false, text => statuses.push(text),
    async () => ready, async () => ({ marked: {}, Packer: { toBlob: async () => new Blob(['docx']) } }),
    async snapshot => {
      assert.equal(captured, true);
      assert.notEqual(snapshot, file);
      assert.notEqual(snapshot.attachments, file.attachments);
      assert.equal(snapshot.text, '# Latest edits');
      if (fail) throw new Error('Conversion failed');
      return {};
    }, document, { createObjectURL: () => 'blob:word', revokeObjectURL: url => revoked.push(url) },
    (fn, delay) => timers.push({ fn, delay }), { error() {} }
  );
  return { run, file, downloads, statuses, timers, revoked };
}

test('Word download uses a DOCX filename and preserves Markdown save state', async () => {
  const r = runtime();
  assert.equal(await r.run(), true);
  assert.deepEqual(r.downloads, ['会议.notes.docx']);
  assert.equal(r.file.dirty, true);
  assert.equal(r.file.handle, null);
  assert.equal(r.timers[0].delay, 60000);
  r.timers[0].fn();
  assert.deepEqual(r.revoked, ['blob:word']);
});

for (const options of [{ ready: false }, { fail: true }]) {
  test(`Word export avoids partial downloads on ${options.fail ? 'conversion' : 'attachment'} failure`, async () => {
    const r = runtime(options);
    assert.equal(await r.run(), false);
    assert.equal(r.downloads.length, 0);
    assert.equal(r.file.dirty, true);
    assert.match(r.statuses.at(-1), /Couldn’t download Word/);
  });
}

test('unavailable images retain a readable label and report the omission', async () => {
  const warnings = new Set();
  const image = new Function('attachmentIdFromSource', 'fetch', 'AbortSignal',
    `${extract('wordImageRun')}; return wordImageRun;`)(() => null,
    async () => { throw new Error('CORS blocked'); }, { timeout() {} });
  const result = await image('https://example.com/image.png', 'Architecture',
    { attachments: new Map() }, { TextRun: class { constructor(text) { this.text = text; } } }, warnings);
  assert.equal(result.text, '[Image: Architecture]');
  assert.equal(warnings.size, 1);
});
