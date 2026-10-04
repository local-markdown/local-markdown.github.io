import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";

const source = readFileSync(new URL("../local-markdown.html", import.meta.url), "utf8");

function extractFunction(name) {
  const match = new RegExp(`^      (?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(match, `Missing ${name}()`);
  const next = /^      (?:async )?function /gm;
  next.lastIndex = match.index + match[0].length;
  return source.slice(match.index, next.exec(source)?.index ?? source.length);
}

function runtime() {
  const { document, Node } = parseHTML(source);
  const editorElement = document.querySelector("#LocalMarkdown-editor");
  editorElement.innerHTML = '<div class="cm-editor"><span class="LocalMarkdown-cm-table-block"><table class="LocalMarkdown-cm-table-widget" data-markdown-table-index="0"><tr><th>H</th><th>I</th></tr><tr><td>A</td><td>B</td></tr></table></span></div>';
  const table = editorElement.querySelector("table");
  // Linkedom provides DOM selection but not table layout collections/geometry.
  Object.defineProperty(table, "rows", { get: () => [...table.querySelectorAll("tr")] });
  table.rows.forEach((row, rowIndex) => {
    Object.defineProperty(row, "rowIndex", { value: rowIndex });
    Object.defineProperty(row, "cells", { get: () => [...row.children] });
    row.cells.forEach((cell, cellIndex) => {
      Object.defineProperty(cell, "cellIndex", { value: cellIndex });
    });
  });
  const tableContextMenu = document.querySelector("#LocalMarkdown-table-context-menu");
  tableContextMenu.getBoundingClientRect = () => ({ width: 216, height: 280 });
  const tableContextItems = [...tableContextMenu.querySelectorAll("button")];
  const tableMenuContext = document.querySelector("#LocalMarkdown-table-menu-context");
  const calls = [];
  const frames = [];
  const file = {};
  let selectionNode = null;
  const context = {
    document, Node, editorElement, tableContextMenu, tableContextItems, tableMenuContext,
    innerWidth: 375, innerHeight: 300,
    getSelection: () => ({ anchorNode: selectionNode }),
    closeFileContextMenu() {}, closeSectionContextMenu() {},
    setNewMenuOpen() {}, setThemeMenuOpen() {}, hideTableResizeHandle() {},
    tableColumnCount: table => table.rows[0].cells.length,
    activeFile: () => file,
    updateCodeMirrorTableStructure: (action, cell) => { calls.push({ action, cell }); return true; },
    copyTableForExcel: table => { calls.push({ export: "copy", table }); },
    updateStatus: message => calls.push({ message }),
    requestAnimationFrame: callback => frames.push(callback),
    editor: { focus: () => calls.push({ editorFocus: true }) }
  };
  const functions = new Function(...Object.keys(context), `
    let tableContextCell = null;
    ${extractFunction("tableCellFromNode")}
    ${extractFunction("openTableContextMenu")}
    ${extractFunction("closeTableContextMenu")}
    ${extractFunction("createTableTouchActions")}
    ${extractFunction("runTableAction")}
    return { openTableContextMenu, closeTableContextMenu, createTableTouchActions, runTableAction,
      target() { return tableContextCell; } };
  `)(...Object.values(context));
  return { ...functions, table, tableContextMenu, tableMenuContext, calls, frames,
    select(cell) { selectionNode = cell; },
    action: name => tableContextMenu.querySelector('[data-table-action="' + name + '"]') };
}

test("context menu targets the clicked cell and protects the last row and column", () => {
  const r = runtime();
  r.select(r.table.rows[0].cells[0]);
  const clicked = r.table.rows[1].cells[1];
  r.openTableContextMenu(clicked, { clientX: 20, clientY: 80 });
  assert.equal(r.target(), clicked);
  assert.equal(r.tableMenuContext.textContent, "Row 2, column 2");
  assert.equal(r.action("delete-row").disabled, false);
  assert.equal(r.action("delete-column").disabled, false);
  r.table.rows[1].remove();
  r.table.rows[0].cells[1].remove();
  r.openTableContextMenu(r.table.rows[0].cells[0], { clientX: 20, clientY: 80 });
  assert.equal(r.action("delete-row").disabled, true);
  assert.equal(r.action("delete-column").disabled, true);
  assert.equal(r.action("row-above").disabled, false);
  assert.equal(r.action("column-right").disabled, false);
});

test("context menu clamps pointer coordinates to the viewport", () => {
  const r = runtime();
  const cell = r.table.rows[1].cells[1];
  r.openTableContextMenu(cell, { clientX: 370, clientY: 295 });
  assert.equal(r.tableContextMenu.style.left, "153px");
  assert.equal(r.tableContextMenu.style.top, "14px");
  r.openTableContextMenu(cell, { clientX: 0, clientY: 0 });
  assert.equal(r.tableContextMenu.style.left, "6px");
  assert.equal(r.tableContextMenu.style.top, "6px");
});

test("dismissal restores focus and clears the menu target", () => {
  const r = runtime();
  const cell = r.table.rows[1].cells[1];
  let focused = false;
  cell.focus = () => { focused = true; };
  r.openTableContextMenu(cell, { clientX: 20, clientY: 80 });
  r.closeTableContextMenu({ restoreFocus: true });
  assert.equal(r.tableContextMenu.hidden, true);
  assert.equal(r.target(), null);
  assert.equal(focused, true);
});

test("actions restore focus after deletion and ignore detached targets", async () => {
  const r = runtime();
  const selected = r.table.rows[1].cells[1];
  let focused = false;
  r.table.rows[1].cells[0].focus = () => { focused = true; };
  await r.runTableAction("delete-column", selected);
  assert.deepEqual(r.calls, [{ action: "delete-column", cell: selected }]);
  for (const row of r.table.rows) row.cells[1].remove();
  r.frames[0]();
  assert.equal(focused, true);
  r.calls.length = 0;
  await r.runTableAction("delete-row", selected);
  assert.deepEqual(r.calls, []);
  r.openTableContextMenu(selected, { clientX: 20, clientY: 80 });
  assert.equal(r.tableContextMenu.hidden, true);
});

test("touch fallback uses the selected cell in its table, otherwise its first cell", () => {
  const r = runtime();
  const button = r.createTableTouchActions(r.table);
  button.getBoundingClientRect = () => ({ left: 20, bottom: 60 });
  r.table.parentElement.prepend(button);
  r.select(r.table.rows[1].cells[1]);
  button.click();
  assert.equal(r.target(), r.table.rows[1].cells[1]);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  r.closeTableContextMenu();
  assert.equal(button.getAttribute("aria-expanded"), "false");
  r.select(null);
  button.click();
  assert.equal(r.target(), r.table.rows[0].cells[0]);
});

test("Excel copy uses the context menu's table", async () => {
  const r = runtime();
  const cell = r.table.rows[1].cells[1];
  await r.runTableAction("copy", cell);
  assert.deepEqual(r.calls, [
    { export: "copy", table: r.table }
  ]);
});
