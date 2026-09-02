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
