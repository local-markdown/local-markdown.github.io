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
  const fileSortToggle = document.querySelector("#LocalMarkdown-sort-toggle");
  const fileSortOptions = Array.from(document.querySelectorAll("[data-file-sort]"));
  function activeFile() { return session.files.find(file => file.id === session.activeId); }
  async function readStoredSession() { return storedSession; }
  function scheduleSessionSave() {}
  function scheduleAutoSave() {}
  function renderFiles() { renderFileSort(); }
  function storedAttachments() { return []; }
  function parseStoredMarkdown(text) { return { text, attachments: new Map() }; }
  function replaceFileAttachments(file, attachments) { file.attachments = attachments; }
  function resetDocumentHistory() {}
  ${["normalizedFileSort", "compareSidebarFiles", "setFileSort", "selectFileSort", "renderFileSort", "sidebarFiles",
    "useManualFileOrder", "isStandaloneSidebarFile", "sectionForId",
    "removeFileFromSidebarLayout", "moveFileToSection", "normalizeSidebarLayout",
    "restoredAttachments", "handlePermission", "loadFileFromHandle", "refreshRestoredFile",
    "restoreSession", "sessionSnapshot", "markFileDirty"].map(extractFunction).join("\n")}
  return { session, document, renderFiles, restoreSession, sessionSnapshot, setFileSort, selectFileSort, sidebarFiles,
    moveFileToSection, markFileDirty, loadFileFromHandle };
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

test("legacy sessions keep manual order but date sorts use names when dates are unknown", async () => {
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
        order === "asc" ? ["example", "c", "d", "b", "a"] : ["example", "a", "b", "d", "c"]);
    }
  }
});

test("matching dates sort names naturally in the selected direction", async () => {
  const app = await runtime();
  for (const file of app.session.files.filter(file => !file.builtin)) {
    file.createdAt = 100;
    file.editedAt = 100;
  }
  for (const by of ["created", "edited"]) {
    app.setFileSort(by, "asc");
    assert.deepEqual(ids(app.sidebarFiles(["a", "b", "c"])), ["c", "b", "a"]);
    app.setFileSort(by, "desc");
    assert.deepEqual(ids(app.sidebarFiles(["a", "b", "c"])), ["a", "b", "c"]);
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
