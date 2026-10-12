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

const createRuntime = new Function("document", "files", `
  const session = { files };
  const filesElement = document.querySelector("#LocalMarkdown-files");
  const fileContextItems = Array.from(document.querySelectorAll(
    "#LocalMarkdown-file-context-menu .LocalMarkdown-file-context-item"));
  let fileContextTarget = null, saves = 0;
  function scheduleSessionSave() { saves += 1; }
  ${["normalizedFileTags", "renderFileTagDots", "appendFileTags", "updateFileTagMenu",
    "setFileTags", "fileContextActionAvailable", "runFileContextAction"].map(extractFunction).join("\n")}
  return {
    action: runFileContextAction,
    open(file) { fileContextTarget = { file }; updateFileTagMenu(file); },
    append(file) { appendFileTags(filesElement, file); },
    saves() { return saves; }
  };
`);

test("tag toggles update only the target file, retain other colors, and leave Markdown save state alone", async () => {
  const { document } = parseHTML(source);
  const file = { id: "note", name: "Note.md", text: "# Note\n", dirty: false, editedAt: 123 };
  const other = { id: "drawing", name: "Sketch.excalidraw", tags: ["yellow"] };
  const app = createRuntime(document, [file, other]);
  app.append(file);
  app.append(other);
  app.open(file);
  const dots = document.querySelector('[data-file-id="note"]');
  const otherDots = document.querySelector('[data-file-id="drawing"]');
  const selected = () => Array.from(document.querySelectorAll('[data-file-tag][aria-checked="true"]'),
    item => item.dataset.fileTag);
  const colors = () => Array.from(dots.children, dot => dot.dataset.tag);
  const clear = document.querySelector('[data-action="clear-tags"]');
  assert.equal(dots.hidden, true);
  assert.equal(clear.disabled, true);

  for (const color of ["green", "red", "yellow"]) {
    await app.action("toggle-tag", { file }, color);
  }
  assert.deepEqual(colors(), ["red", "yellow", "green"]);
  assert.deepEqual(selected(), colors());
  assert.equal(dots.hidden, false);
  assert.equal(dots.getAttribute("aria-label"), "Tags: Red, Yellow, Green");
  assert.equal(clear.disabled, false);
  await app.action("toggle-tag", { file }, "red");
  assert.deepEqual(file.tags, ["yellow", "green"]);
  assert.deepEqual(colors(), selected());
  assert.equal(otherDots.getAttribute("aria-label"), "Tags: Yellow");
  assert.deepEqual(other.tags, ["yellow"]);

  await app.action("clear-tags", { file });
  assert.deepEqual(file, { id: "note", name: "Note.md", text: "# Note\n",
    dirty: false, editedAt: 123, tags: [] });
  assert.deepEqual(selected(), []);
  assert.equal(dots.hidden, true);
  assert.equal(dots.childElementCount, 0);
  assert.equal(clear.disabled, true);
  assert.equal(app.saves(), 5);
});
