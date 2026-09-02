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

const createRuntime = new Function(`
  ${extractFunction("markdownLineRecords")}
  ${extractFunction("markdownMermaidRenderBlocks")}
  return { markdownMermaidRenderBlocks };
`);

test("Mermaid fences are parsed into renderable source ranges", () => {
  const { markdownMermaidRenderBlocks } = createRuntime();
  const markdown = [
    "Before",
    "```mermaid",
    "flowchart LR",
    "  A --> B",
    "```",
    "After"
  ].join("\n");

  const [block] = markdownMermaidRenderBlocks(markdown);

  assert.equal(block.from, markdown.indexOf("```mermaid"));
  assert.equal(block.to, markdown.indexOf("```\nAfter") + 3);
  assert.equal(block.bodyFrom, markdown.indexOf("flowchart LR"));
  assert.equal(block.source, "flowchart LR\n  A --> B\n");
});

test("Mermaid language matching is case-insensitive and supports tilde fences", () => {
  const { markdownMermaidRenderBlocks } = createRuntime();
  const markdown = "~~~~ Mermaid title\r\ngraph TD\r\nA-->B\r\n~~~~\r\n";

  const [block] = markdownMermaidRenderBlocks(markdown);

  assert.equal(block.source, "graph TD\r\nA-->B\r\n");
  assert.equal(block.to, markdown.lastIndexOf("~~~~") + 4);
});

test("non-Mermaid and unclosed fences stay as ordinary code", () => {
  const { markdownMermaidRenderBlocks } = createRuntime();
  const markdown = [
    "```js",
    "const example = '```mermaid';",
    "```",
    "```mermaid",
    "graph TD",
    "A-->B"
  ].join("\n");

  assert.deepEqual(markdownMermaidRenderBlocks(markdown), []);
});

test("live preview lazy-loads Mermaid with strict rendering", () => {
  assert.match(source, /mermaid@11\.12\.0\/\+esm/);
  assert.match(extractFunction("loadMermaid"), /securityLevel: "strict"/);
  assert.match(extractFunction("createCodeMirrorLivePreview"),
    /class MermaidWidget extends WidgetType/);
  assert.match(extractFunction("createCodeMirrorLivePreview"),
    /return \[inlinePreview, tablePreview, mermaidPreview\];/);
});

test("rendered Mermaid diagrams expose a separate full-screen preview control", () => {
  const livePreview = extractFunction("createCodeMirrorLivePreview");

  assert.match(source, /<dialog class="LocalMarkdown-mermaid-preview"/);
  assert.match(livePreview, /aria-label", "Enlarge Mermaid diagram"/);
  assert.match(livePreview,
    /expand\.addEventListener\("mousedown", event => event\.stopPropagation\(\)\)/);
  assert.match(livePreview, /if \(diagram\) openMermaidPreview\(diagram\)/);
  assert.match(livePreview,
    /event\.target\.closest\?\.\("\.LocalMarkdown-cm-mermaid-expand"\)/);
  assert.match(livePreview, /wrapper\.addEventListener\("mousedown", edit\)/);
  assert.match(extractFunction("openMermaidPreview"),
    /mermaidPreviewContent\.replaceChildren\(diagram\)/);
  assert.match(extractFunction("closeMermaidPreview"),
    /mermaidPreviewOrigin\.prepend\(diagram\)/);
  assert.match(source,
    /event\.key === "Escape" && mermaidPreviewDialog\.open[\s\S]*closeMermaidPreview\(\)/);
});
