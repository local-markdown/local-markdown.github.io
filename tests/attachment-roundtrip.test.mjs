import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../local-markdown.html", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = `      function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${name}() in local-markdown.html`);
  const next = source.indexOf("\n      function ", start + marker.length);
  assert.notEqual(next, -1, `Could not find the end of ${name}()`);
  return source.slice(start, next);
}

function extractAttachmentConstants() {
  const start = source.indexOf("      const attachmentBlockStart");
  const end = source.indexOf("      const pastedImageMaxDimension", start);
  assert.notEqual(start, -1, "Missing attachment constants");
  assert.notEqual(end, -1, "Could not find the end of the attachment constants");
  return source.slice(start, end);
}

const createRuntime = new Function(`
  ${extractAttachmentConstants()}
  const attachmentPreviewUrls = new Map();
  const attachmentPreviewReferences = new Map();
  ${extractFunction("parseStoredMarkdown")}
  ${extractFunction("referencedAttachmentIds")}
  ${extractFunction("revokeAttachmentPreview")}
  ${extractFunction("pruneUnusedAttachments")}
  ${extractFunction("serializeFile")}
  return { parseStoredMarkdown, serializeFile };
`);

const { parseStoredMarkdown, serializeFile } = createRuntime();

function attachment(id, options = {}) {
  return {
    id,
    type: options.type || "image/png",
    data: options.data || "data:image/png;base64,AA==",
    kind: options.kind || null,
    blob: null,
    pending: null,
    error: false
  };
}

function markdownFile(text, items = []) {
  return {
    id: "test-file",
    text,
    attachments: new Map(items.map(item => [item.id, item]))
  };
}

test("plain Markdown remains byte-for-byte unchanged", () => {
  const cases = [
    "",
    "first\n\nsecond",
    "first\r\n\r\nsecond\r\n"
  ];
  for (let trailingNewlines = 0; trailingNewlines <= 6; trailingNewlines += 1) {
    cases.push(`text${"\n".repeat(trailingNewlines)}`);
  }

  for (const text of cases) {
    const stored = serializeFile(markdownFile(text));
    assert.equal(stored, text);
    assert.equal(parseStoredMarkdown(stored).text, text);
  }
});

test("attachment manifests preserve zero through six trailing newlines", () => {
  for (let trailingNewlines = 0; trailingNewlines <= 6; trailingNewlines += 1) {
    const image = attachment("image-1");
    const text = `first\n\n![image](lmd/image-1)\n\nsecond${"\n".repeat(trailingNewlines)}`;
    const stored = serializeFile(markdownFile(text, [image]));

    assert.ok(stored.startsWith(`${text}\n\n<!-- LocalMarkdown attachments:v1\n`));
    const parsed = parseStoredMarkdown(stored);
    assert.equal(parsed.text, text);
    assert.equal(parsed.warning, null);
    assert.deepEqual(parsed.attachments.get("image-1"), image);
  }
});

test("the app LF delimiter preserves a CRLF Markdown body exactly", () => {
  const image = attachment("crlf-image");
  const text = "first\r\n\r\n![image](lmd/crlf-image)\r\n\r\n";
  const stored = serializeFile(markdownFile(text, [image]));
  const parsed = parseStoredMarkdown(stored);

  assert.ok(stored.startsWith(`${text}\n\n<!-- LocalMarkdown attachments:v1\n`));
  assert.equal(parsed.text, text);
  assert.deepEqual(parsed.attachments.get("crlf-image"), image);
});

test("the app LF delimiter preserves a trailing lone carriage return", () => {
  const image = attachment("lone-cr");
  const text = "![image](lmd/lone-cr)\r";
  const stored = serializeFile(markdownFile(text, [image]));
  const parsed = parseStoredMarkdown(stored);

  assert.ok(stored.startsWith(`${text}\n\n<!-- LocalMarkdown attachments:v1\n`));
  assert.equal(parsed.text, text);
  assert.deepEqual(parsed.attachments.get("lone-cr"), image);
});

test("a fully CRLF-normalized manifest preserves CRLF trailing newlines", () => {
  const image = attachment("crlf-manifest");
  const manifest = JSON.stringify({ version: 1, attachments: [image] });
  const text = "first\r\n\r\n![image](lmd/crlf-manifest)\r\n";
  const stored = `${text}\r\n\r\n<!-- LocalMarkdown attachments:v1\r\n${manifest}\r\n-->\r\n`;
  const parsed = parseStoredMarkdown(stored);

  assert.equal(parsed.text, text);
  assert.deepEqual(parsed.attachments.get("crlf-manifest"), image);
});

test("an earlier literal attachment sentinel remains Markdown", () => {
  const image = attachment("final-image");
  const text = [
    "before",
    "",
    "<!-- LocalMarkdown attachments:v1",
    "this is literal Markdown, not JSON",
    "-->",
    "",
    "after",
    "![image](lmd/final-image)"
  ].join("\n");
  const parsed = parseStoredMarkdown(serializeFile(markdownFile(text, [image])));

  assert.equal(parsed.text, text);
  assert.deepEqual(parsed.attachments.get("final-image"), image);
});

test("sentinel text inside manifest JSON does not hide the block start", () => {
  const image = attachment("sentinel-data", {
    type: "image/svg+xml",
    data: "data:image/svg+xml,<!-- LocalMarkdown attachments:v1"
  });
  const manifest = JSON.stringify({ version: 1, attachments: [image] });
  const text = "![image](lmd/sentinel-data)";
  const stored = `${text}\n\n<!-- LocalMarkdown attachments:v1\n${manifest}\n-->\n`;
  const parsed = parseStoredMarkdown(stored);

  assert.equal(parsed.text, text);
  assert.equal(parsed.warning, null);
  assert.deepEqual(parsed.attachments.get("sentinel-data"), image);
});

test("legacy trimmed manifests and attachment paths remain readable", () => {
  const manifest = JSON.stringify({
    version: 1,
    attachments: [{
      id: "legacy-image",
      type: "image/png",
      data: "data:image/png;base64,AA=="
    }]
  });
  const text = "legacy body\n\n![legacy](local-markdown-attachment/legacy-image)";
  const stored = `${text}\n\n<!-- LocalMarkdown attachments:v1\n${manifest}\n-->\n`;
  const parsed = parseStoredMarkdown(stored);

  assert.equal(parsed.text, text);
  assert.equal(parsed.attachments.get("legacy-image")?.kind, null);

  const reserialized = serializeFile(markdownFile(text, [attachment("legacy-image")]));
  assert.equal(parseStoredMarkdown(reserialized).text, text);
  assert.ok(reserialized.includes('"id":"legacy-image"'));
});

test("manifest at the start remains supported", () => {
  const manifest = JSON.stringify({ version: 1, attachments: [] });
  const stored = `<!-- LocalMarkdown attachments:v1\n${manifest}\n-->\n`;
  const parsed = parseStoredMarkdown(stored);

  assert.equal(parsed.text, "");
  assert.equal(parsed.attachments.size, 0);
});

test("malformed and unsupported manifests leave stored Markdown untouched", () => {
  const storedValues = [
    "body\n\n<!-- LocalMarkdown attachments:v1\n{not JSON}\n-->\n",
    "body\n\n<!-- LocalMarkdown attachments:v1\n"
      + '{"version":2,"attachments":[]}\n-->\n'
  ];

  for (const stored of storedValues) {
    const parsed = parseStoredMarkdown(stored);
    assert.equal(parsed.text, stored);
    assert.equal(parsed.attachments.size, 0);
    assert.equal(parsed.warning, "Attachment data could not be read");
  }
});

test("regular attachments and Excalidraw kind round-trip", () => {
  const image = attachment("image-2");
  const drawing = attachment("drawing-1", {
    type: "image/svg+xml",
    data: "data:image/svg+xml;base64,PHN2Zy8+",
    kind: "excalidraw"
  });
  const text = "![image](lmd/image-2)\n\n![drawing](lmd/drawing-1)";
  const parsed = parseStoredMarkdown(serializeFile(markdownFile(text, [image, drawing])));

  assert.equal(parsed.text, text);
  assert.equal(parsed.attachments.get("image-2")?.kind, null);
  assert.equal(parsed.attachments.get("drawing-1")?.kind, "excalidraw");
  assert.equal(parsed.attachments.get("drawing-1")?.type, "image/svg+xml");
  assert.equal(parsed.attachments.get("drawing-1")?.data, drawing.data);
});
