import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";

const source = readFileSync(new URL("../local-markdown.html", import.meta.url), "utf8");
function extractFunction(name) {
  const match = new RegExp(`^      (?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(match, `Missing ${name}`);
  const end = source.indexOf("\n      }", match.index) + "\n      }".length;
  return source.slice(match.index, end);
}

const createRuntime = new Function("storedSession", "document", `
  const example = { id: "example", name: "Examples", builtin: true,
    sidebarMovable: true, sidebarDefaultFirst: true };
  const session = { files: [example], fileSort: { by: "manual", order: "asc" },
    sidebar: { sections: [], ungroupedFileIds: [example.id] } };
  let sessionNeedsSave = false, sessionRestored = false;
  let pickedHandle;
  const activeSaves = new Map(), editorReady = false;
  const window = { showSaveFilePicker() {} };
  const attachmentBlockStart = "<!-- LocalMarkdown attachments:v1";
  const fileSortToggle = document.querySelector("#LocalMarkdown-sort-toggle");
  const fileSortOptions = Array.from(document.querySelectorAll("[data-file-sort]"));
  function activeFile() { return session.files.find(file => file.id === session.activeId); }
  async function readStoredSession() { return storedSession; }
  function scheduleSessionSave() {}
  function scheduleAutoSave() {}
  function captureEditorValue() {}
  function cancelAutoSave() {}
  function updateStatus() {}
  async function pickMarkdownFile() { return pickedHandle; }
  async function waitForFileAttachments() { return true; }
  function serializeFile(file) { return file.text; }
  function renderFiles() { renderFileSort(); }
  function storedAttachments() { return []; }
  function replaceFileAttachments(file, attachments) { file.attachments = attachments; }
  function resetDocumentHistory() {}
  ${["normalizedFileSort", "compareSidebarFiles", "setFileSort", "selectFileSort", "renderFileSort", "sidebarFiles",
    "useManualFileOrder", "isStandaloneSidebarFile", "sectionForId",
    "removeFileFromSidebarLayout", "moveFileToSection", "normalizeSidebarLayout",
    "restoredAttachments", "handlePermission", "loadFileFromHandle", "refreshRestoredFile",
    "restoreSession", "sessionSnapshot", "normalizedFileTags", "markFileDirty", "parseStoredMarkdown",
    "syncSidebarFileAvailability", "saveFile", "saveActiveFile", "saveActiveFileAs", "writeText"].map(extractFunction).join("\n")}
  return { session, document, renderFiles, restoreSession, sessionSnapshot, setFileSort, selectFileSort, sidebarFiles,
    moveFileToSection, markFileDirty, loadFileFromHandle, saveActiveFile, saveActiveFileAs,
    chooseHandle(handle) { pickedHandle = handle; } };
`);

const fixture = () => ({
  version: 2, activeId: "a",
  fileOrder: ["example", "a", "b", "c", "d"],
  sidebar: { sections: [{ id: "work", name: "Work", collapsed: false, fileIds: ["a", "b", "c"] }],
    ungroupedFileIds: ["example", "d"] },
  files: [
    { id: "a", name: "Note 10.md", text: "common", createdAt: 200, editedAt: 600 },
    { id: "b", name: "note 2.md", text: "common", createdAt: 100, editedAt: 900 },
    { id: "c", name: "Alpha.excalidraw", text: "{}", createdAt: 300, editedAt: 400 },
    { id: "d", name: "Loose.md", text: "", createdAt: 50, editedAt: 50 }
  ]
});
const ids = files => files.map(file => file.id);
async function runtime(snapshot = fixture()) {
  const { document } = parseHTML(source);
  const app = createRuntime(snapshot, document);
  await app.restoreSession();
  app.renderFiles();
  return app;
}

for (const [by, ascending] of [
  ["created", ["b", "a", "c"]],
  ["edited", ["c", "a", "b"]],
  ["name", ["c", "b", "a"]]
]) {
  for (const order of ["asc", "desc"]) {
    test(`${by} ${order} sorts within a section without changing membership or manual order`, async () => {
      const app = await runtime();
      app.setFileSort(by, order);
      const section = app.session.sidebar.sections[0];
      assert.deepEqual(ids(app.sidebarFiles(section.fileIds)),
        order === "asc" ? ascending : [...ascending].reverse());
      assert.deepEqual(section.fileIds, ["a", "b", "c"]);
      assert.deepEqual(ids(app.sidebarFiles(app.session.sidebar.ungroupedFileIds)), ["example", "d"]);
    });
  }
}

test("sort preferences and dates survive a session snapshot and restore", async () => {
  const app = await runtime();
  app.setFileSort("edited", "desc");
  const snapshot = app.sessionSnapshot();
  const restored = await runtime(snapshot);
  assert.deepEqual(restored.session.fileSort, { by: "edited", order: "desc" });
  const selected = restored.document.querySelector('[data-file-sort="edited"]');
  assert.equal(selected.getAttribute("aria-label"), "Edited, descending");
  assert.equal(selected.querySelector(".LocalMarkdown-file-sort-direction").textContent, "↓");
  assert.deepEqual(restored.sessionSnapshot(), snapshot);
  assert.deepEqual(ids(restored.sidebarFiles(["a", "b", "c"])), ["b", "a", "c"]);
});

test("file tags survive saving, Save As, section moves, and session restore", async () => {
  const snapshot = fixture();
  snapshot.files[0].tags = ["red", "yellow", "green"];
  snapshot.files[2].tags = ["yellow", "green"];
  const app = await runtime(snapshot);
  const file = app.session.files.find(file => file.id === "a");
  app.chooseHandle(localHandle("Tagged.md"));
  await app.saveActiveFile();
  app.chooseHandle(localHandle("Renamed.md"));
  await app.saveActiveFileAs();
  app.moveFileToSection(file.id, null);
  const restored = await runtime(app.sessionSnapshot());
  const recovered = restored.session.files.find(file => file.id === "a");
  assert.equal(recovered.name, "Renamed.md");
  assert.deepEqual(recovered.tags, ["red", "yellow", "green"]);
  assert.equal(recovered.text, snapshot.files[0].text);
  assert.equal(recovered.editedAt, snapshot.files[0].editedAt);
  assert.ok(restored.session.sidebar.ungroupedFileIds.includes(file.id));
  assert.deepEqual(restored.session.files.find(file => file.id === "c").tags, ["yellow", "green"]);
});

test("restoring old or malformed tag metadata keeps only supported unique colors", async () => {
  const snapshot = fixture();
  snapshot.files[0].tags = ["green", "red", "red", "blue", null];
  snapshot.files[1].tags = "red";
  snapshot.files[2].tags = { red: true };
  const app = await runtime(snapshot);
  assert.deepEqual(app.sessionSnapshot().files.map(file => file.tags), [["red", "green"], [], [], []]);
});

test("the combined menu starts each new sort ascending and toggles repeated selections", async () => {
  const app = await runtime();
  for (const [by, order] of [
    ["created", "asc"], ["created", "desc"], ["created", "asc"],
    ["edited", "asc"], ["edited", "desc"],
    ["name", "asc"], ["name", "desc"], ["created", "asc"],
    ["manual", "asc"], ["manual", "asc"]
  ]) {
    app.selectFileSort(by);
    assert.deepEqual(app.session.fileSort, { by, order });
    const checked = app.document.querySelectorAll('[data-file-sort][aria-checked="true"]');
    assert.equal(checked.length, 1);
    assert.equal(checked[0].dataset.fileSort, by);
    assert.equal(checked[0].querySelector(".LocalMarkdown-file-sort-direction").textContent,
      by === "manual" ? "" : order === "asc" ? "↑" : "↓");
    for (const option of app.document.querySelectorAll('[data-file-sort][aria-checked="false"]')) {
      assert.equal(option.querySelector(".LocalMarkdown-file-sort-direction").textContent, "");
    }
    assert.equal(app.document.querySelector("#LocalMarkdown-sort-toggle").dataset.order,
      by === "manual" ? "manual" : order);
  }
});

test("legacy sessions retain their layout order when dates are unknown", async () => {
  const snapshot = fixture();
  snapshot.version = 1;
  delete snapshot.sidebar;
  snapshot.fileSort = { by: "unsupported", order: "invalid" };
  for (const file of snapshot.files) {
    delete file.createdAt;
    file.editedAt = "invalid";
  }
  const app = await runtime(snapshot);
  assert.deepEqual(app.session.fileSort, { by: "manual", order: "asc" });
  assert.deepEqual(ids(app.sidebarFiles(app.session.sidebar.ungroupedFileIds)), snapshot.fileOrder);
  for (const by of ["created", "edited"]) {
    for (const order of ["asc", "desc"]) {
      app.setFileSort(by, order);
      assert.deepEqual(ids(app.sidebarFiles(app.session.sidebar.ungroupedFileIds)),
        snapshot.fileOrder);
    }
  }
});

test("matching dates retain the layout order regardless of names and direction", async () => {
  const app = await runtime();
  for (const file of app.session.files.filter(file => !file.builtin)) {
    file.createdAt = 100;
    file.editedAt = 100;
  }
  for (const by of ["created", "edited"]) {
    app.setFileSort(by, "asc");
    assert.deepEqual(ids(app.sidebarFiles(["a", "b", "c"])), ["a", "b", "c"]);
    app.setFileSort(by, "desc");
    assert.deepEqual(ids(app.sidebarFiles(["a", "b", "c"])), ["a", "b", "c"]);
  }
});

function localHandle(name, text = "", lastModified = 5000) {
  return {
    name, queryPermission: async () => "granted",
    getFile: async () => ({ name, lastModified, text: async () => text }),
    createWritable: async () => ({
      write: async value => { text = value; },
      close: async () => {}
    })
  };
}

test("first save and Save As preserve date order and timestamps through reload", async () => {
  for (const date of [0, 100]) {
    for (const by of ["created", "edited"]) {
      for (const order of ["asc", "desc"]) {
        const snapshot = fixture();
        for (const file of snapshot.files) file.createdAt = file.editedAt = date;
        snapshot.files[0].name = "Untitled.md";
        snapshot.files[0].dirty = true;
        const app = await runtime(snapshot);
        app.setFileSort(by, order);
        const fileIds = app.session.sidebar.sections[0].fileIds;
        const before = ids(app.sidebarFiles(fileIds));
        const file = app.session.files.find(file => file.id === "a");
        app.chooseHandle(localHandle("Alpha.md"));
        await app.saveActiveFile();
        assert.equal(file.name, "Alpha.md");
        assert.equal(file.dirty, false);
        assert.deepEqual(ids(app.sidebarFiles(fileIds)), before);
        app.chooseHandle(localHandle("Zebra.md"));
        await app.saveActiveFileAs();
        assert.equal(file.name, "Zebra.md");
        assert.equal(file.createdAt, date);
        assert.equal(file.editedAt, date);
        assert.deepEqual(ids(app.sidebarFiles(fileIds)), before);
        const restored = await runtime(app.sessionSnapshot());
        assert.deepEqual(ids(restored.sidebarFiles(fileIds)), before);
        const recovered = restored.session.files.find(file => file.id === "a");
        assert.equal(recovered.createdAt, date);
        assert.equal(recovered.editedAt, date);
      }
    }
  }
});

test("renaming still changes position when sorting by name", async () => {
  const app = await runtime();
  const file = app.session.files.find(file => file.id === "a");
  app.setFileSort("name", "asc");
  file.name = "Zebra.md";
  assert.deepEqual(ids(app.sidebarFiles(["a", "b", "c"])), ["c", "b", "a"]);
  file.name = "Aardvark.md";
  assert.deepEqual(ids(app.sidebarFiles(["a", "b", "c"])), ["a", "c", "b"]);
});

test("unchanged disk content preserves edited time even if name or modification time changes", async () => {
  const snapshot = fixture();
  snapshot.fileSort = { by: "edited", order: "desc" };
  snapshot.files[0].handle = localHandle("Renamed.md", "common");
  const app = await runtime(snapshot);
  const file = app.session.files.find(file => file.id === "a");
  assert.equal(file.name, "Renamed.md");
  assert.equal(file.editedAt, 600);
  assert.equal(file.createdAt, 200);
  assert.deepEqual(ids(app.sidebarFiles(["a", "b", "c"])), ["b", "a", "c"]);
});

test("embedded attachment changes count as edits but reconstructed objects do not", async () => {
  for (const change of [{}, { data: "new image" }, { type: "image/svg+xml" }, { kind: "excalidraw" }]) {
    const app = await runtime();
    const file = app.session.files.find(file => file.id === "a");
    const attachment = { id: "image", type: "image/png", data: "original image", kind: null };
    file.text = "![image](lmd/image)";
    file.attachments = new Map([[attachment.id, attachment]]);
    const manifest = { version: 1, attachments: [{ ...attachment, ...change }] };
    const stored = file.text + "\n\n<!-- LocalMarkdown attachments:v1\n" + JSON.stringify(manifest) + "\n-->\n";
    file.handle = localHandle("Image.md", stored);
    await app.loadFileFromHandle(file);
    assert.equal(file.editedAt, Object.keys(change).length ? 5000 : 600);
    assert.equal(file.createdAt, 200);
  }
});

test("equal dates and equivalent names retain the layout order in both directions", async () => {
  const app = await runtime();
  for (const file of app.session.files.filter(file => !file.builtin)) {
    file.name = file.id === "a" ? "NOTE.md" : "note.md";
    file.createdAt = 100;
    file.editedAt = 100;
  }
  for (const by of ["created", "edited", "name"]) {
    for (const order of ["asc", "desc"]) {
      app.setFileSort(by, order);
      assert.deepEqual(ids(app.sidebarFiles(["c", "b", "a"])), ["c", "b", "a"]);
    }
  }
});

test("editing an already dirty file moves it to the latest edited position", async () => {
  const app = await runtime();
  app.setFileSort("edited", "desc");
  const file = app.session.files.find(file => file.id === "c");
  file.dirty = true;
  app.markFileDirty(file);
  assert.deepEqual(ids(app.sidebarFiles(["a", "b", "c"])), ["c", "b", "a"]);
  assert.equal(file.createdAt, 300);
});

test("disk refresh updates edited time while unsaved recovered edits keep their timestamp", async () => {
  const snapshot = fixture();
  const handle = {
    queryPermission: async () => "granted",
    getFile: async () => ({ name: "Updated.md", lastModified: 5000, text: async () => "disk" })
  };
  snapshot.files[0].handle = handle;
  snapshot.files[1].handle = handle;
  snapshot.files[1].dirty = true;
  const app = await runtime(snapshot);
  const clean = app.session.files.find(file => file.id === "a");
  const dirty = app.session.files.find(file => file.id === "b");
  assert.equal(clean.editedAt, 5000);
  assert.equal(clean.createdAt, 200);
  assert.equal(clean.text, "disk");
  assert.equal(dirty.editedAt, 900);
  assert.equal(dirty.text, "common");
});

test("a positional drag switches to manual starting from the displayed sort order", async () => {
  const app = await runtime();
  app.setFileSort("name", "asc");
  app.moveFileToSection("a", "work", "c", false);
  assert.equal(app.session.fileSort.by, "manual");
  assert.deepEqual(app.session.sidebar.sections[0].fileIds, ["a", "c", "b"]);
});

test("moving a file into a section retains the selected sort", async () => {
  const app = await runtime();
  app.setFileSort("created", "desc");
  app.moveFileToSection("d", "work");
  assert.deepEqual(app.session.fileSort, { by: "created", order: "desc" });
  assert.deepEqual(ids(app.sidebarFiles(app.session.sidebar.sections[0].fileIds)), ["c", "a", "b", "d"]);
  assert.deepEqual(app.session.sidebar.ungroupedFileIds, ["example"]);
});
