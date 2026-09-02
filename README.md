<p align="center">
  <img src="logo.svg" alt="Local Markdown logo" width="88">
</p>

<h1 align="center">Local Markdown</h1>

<p align="center">A lightweight browser-based Markdown editor for local files.</p>

<p align="center">
  <a href="https://local-markdown.github.io/"><strong>Open Local Markdown</strong></a>
</p>

Open Local Markdown in desktop Chrome or Edge, choose a Markdown file, and start writing. You do not need to download an app or create an account. Local Markdown saves changes directly to files on your computer.

## Get started

1. Open the [online editor](https://local-markdown.github.io/) in desktop Chrome or Edge.
2. Select **+**, then choose **Open File** for an existing `.md` file or **New File** to create one.
3. Grant access to the file when your browser asks.
4. Hover over a new file, select **⋯**, then **Save…** once. After that, changes save automatically.

## Features

- One Obsidian-style Markdown view powered by CodeMirror 6
- Every Markdown newline is preserved through editing, undo, refresh, and live preview
- White, Solarized Light, and Solarized Dark color themes
- Multiple open files in a collapsible, responsive sidebar
- Persistent topic sections for grouping, collapsing, renaming, and reordering open files
- File context actions for saving, renaming, closing, and confirmed deletion
- Filename and content search across open files
- Open-file and unsaved edit recovery after refresh
- Screenshot and copied image pasting
- Proportional image resizing and left, centre, or right alignment
- Automatic Markdown links for pasted URLs, using webpage titles or document filenames
- Editable Excalidraw drawings embedded directly in Markdown files
- Directly editable visual table cells with multiline text, images, column widths, and row or column controls
- Live Mermaid diagrams from fenced `mermaid` code blocks
- Formatting toolbar, keyboard shortcuts, a docked syntax-tree outline, and export
- Access only to the files you choose

Pasted images are stored inside the Markdown file with Local Markdown's attachment format. Other editors can read the text but may not display those images. Use standard image URLs when compatibility matters.

Hover over an image to reveal its left, centre, and right alignment controls along the image's top edge and its resize handle in the bottom-right corner. Drag the handle to resize, or focus it and use the arrow keys in 10-pixel steps (hold Shift for 50-pixel steps). Image layout is stored as a standard HTML `<img>` element because Markdown image syntax does not include dimensions or alignment.

Click any table cell to edit it directly without switching to raw Markdown. Enter adds a line inside the cell, Tab moves to the next cell, and Tab from the last cell adds a new row. Use the table edges to add or remove rows and columns, drag a column boundary to resize it, paste images directly into cells, or hover the upper-left cell for Excel and CSV export.

Live Preview hides Markdown markers on inactive lines and reveals the original source on the line being edited. Headings, inline formatting, links, quotes, lists, horizontal rules, code blocks, tasks, images, and visual tables keep their rendered form without changing the Markdown stored in the file.

Click a rendered Mermaid diagram to edit its source. Hover over it and select the expand control to inspect the diagram full-screen; large diagrams remain scrollable.

Pasting a URL by itself creates a Markdown link. Local Markdown uses a copied link label when available, the filename for document and media URLs, supported sites' oEmbed titles, or a directly accessible HTML page title. If metadata is unavailable, it falls back to a readable name from the URL.

## Draw with Excalidraw

Create or open a Markdown file, then select **Draw with Excalidraw** in the formatting toolbar. Select **Insert** when the drawing is ready. Local Markdown embeds an SVG preview and its editable Excalidraw scene inside the Markdown file.

Double-click an embedded drawing to reopen it, then select **Update** to replace the preview without creating a second attachment.

Use Excalidraw's menu to **Open** a `.excalidraw` file, then select **Insert** to embed it in the current Markdown file. Choose **Save to…** from the same menu to export the current drawing as a `.excalidraw` file.

## Privacy and browser support

The editor is delivered by GitHub Pages, but your documents are not uploaded to GitHub or another server. Your browser grants access only to the files you choose. Local Markdown also keeps a browser-local copy so it can restore your session after a refresh.

The File System Access API works best in desktop Chrome or Chromium-based Edge. The browser may ask you to restore file access after a restart.

An internet connection is required to open the editor and load CodeMirror 6 from jsDelivr. Excalidraw is loaded from esm.sh only when you open the drawing tool.

## Run the standalone file

If you prefer, you can still download [`local-markdown.html`](https://github.com/local-markdown/local-markdown.github.io/raw/refs/heads/main/local-markdown.html) and open it directly in desktop Chrome or Edge.
