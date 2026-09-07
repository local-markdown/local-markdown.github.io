import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../local-markdown.html", import.meta.url), "utf8");
function extractFunction(name) {
  const start = source.indexOf(`      async function ${name}(`);
  assert.notEqual(start, -1);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n      (?:async )?function /);
  assert.notEqual(end, -1);
  return source.slice(start, start + 1 + end);
}

function runtime({ prepare = async () => true, clickError = false, picker = false } = {}) {
  const file = { text: "# Notes\n\n你好", name: "Notes.md", dirty: true, handle: null };
  const downloads = [];
  const statuses = [];
  const timers = [];
  const revoked = [];
  let blob;
  let removed = false;
  const api = new Function("window", "document", "URL", "Blob", "setTimeout",
    "waitForFileAttachments", "serializeFile", "suggestedFileName", "updateStatus",
    "scheduleSessionSave", "captureEditorValue", "activeFile", "pickMarkdownFile", `
      ${extractFunction("downloadMarkdownFile")}
      ${extractFunction("saveActiveFile")}
      ${extractFunction("saveActiveFileAs")}
      return { downloadMarkdownFile, saveActiveFile, saveActiveFileAs };
    `)(picker ? { showSaveFilePicker() {} } : {}, {
      createElement: () => ({
        click() {
          if (clickError) throw new Error("Download blocked");
          downloads.push({ name: this.download, url: this.href, blob });
        },
        remove() { removed = true; }
      }),
      body: { append() {} }
    }, {
      createObjectURL(value) { blob = value; return "blob:test"; },
      revokeObjectURL(url) { revoked.push(url); }
    }, Blob, (fn, delay) => timers.push({ fn, delay }), prepare,
    f => `${f.text}\n<!-- embedded attachment -->`, f => f.name,
    status => statuses.push(status), () => {}, () => {}, () => file, async () => null);
  return { ...api, file, downloads, statuses, timers, revoked, removed: () => removed };
}

for (const action of ["saveActiveFile", "saveActiveFileAs"]) {
  test(`${action} downloads serialized Markdown when the picker is unavailable`, async () => {
    const r = runtime();
    await r[action]();
    assert.equal(r.downloads.length, 1);
    assert.equal(r.downloads[0].name, "Notes.md");
    assert.equal(await r.downloads[0].blob.text(), "# Notes\n\n你好\n<!-- embedded attachment -->");
    assert.equal(r.file.handle, null);
    assert.equal(r.file.dirty, true);
    assert.equal(r.removed(), true);
    assert.deepEqual(r.revoked, []);
    assert.equal(r.timers[0].delay, 60000);
    r.timers[0].fn();
    assert.deepEqual(r.revoked, ["blob:test"]);
  });

  test(`${action} preserves desktop picker cancellation without downloading`, async () => {
    const r = runtime({ picker: true });
    await r[action]();
    assert.equal(r.downloads.length, 0);
    assert.equal(r.file.dirty, true);
  });
}

test("download waits for pending attachments", async () => {
  let ready;
  const r = runtime({ prepare: () => new Promise(resolve => { ready = resolve; }) });
  const saving = r.saveActiveFile();
  assert.equal(r.downloads.length, 0);
  ready(true);
  await saving;
  assert.equal(r.downloads.length, 1);
});

test("failed attachment preparation prevents an incomplete download", async () => {
  const r = runtime({ prepare: async () => false });
  assert.equal(await r.downloadMarkdownFile(r.file), false);
  assert.equal(r.downloads.length, 0);
  assert.equal(r.file.dirty, true);
  assert.match(r.statuses.at(-1), /prepare/);
});

test("download errors preserve edits and clean up temporary resources", async () => {
  const r = runtime({ clickError: true });
  assert.equal(await r.downloadMarkdownFile(r.file), false);
  assert.equal(r.file.dirty, true);
  assert.equal(r.removed(), true);
  assert.equal(r.timers.length, 1);
  assert.match(r.statuses.at(-1), /Try saving again/);
});
