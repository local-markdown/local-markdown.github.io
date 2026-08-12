# Evidence

## 1. Innovative

- Local Markdown combines local File System Access, browser-session restoration, a multi-file/folder sidebar, three editing views, and embedded Excalidraw in a browser-only editor. The core interactions remain familiar editor patterns rather than a novel interaction model (`local-markdown.html:624-692`, `1066-1179`, `3693-3847`).

## 2. Useful

- New, Search, Open, Save, Close, view switching, file selection, and the editor are directly available (`local-markdown.html:624-692`, `1673-1694`).
- The editor canvas occupies about 74.6% of the audited 1280×720 viewport; primary content is the largest region (screenshot: canvas `x=220-1279`, `y=71-719`).
- The first-use Open menu exposes Open File and Open Folder immediately (`local-markdown.html:674-685`; browser DOM snapshot).
- Keyboard gaps remain: file reordering uses drag handlers only, and table/image resize affordances use `tabindex="-1"` with pointer interactions (`local-markdown.html:2288-2307`, `5066-5075`, `728`, `741-744`, `5100-5116`).

## 3. Aesthetic

- The rendered white theme uses nine core colors and a compact authored spacing system concentrated at 2–10px (`local-markdown.html:36-49`, `115-170`, `240-337`).
- Observed type sizes are 10, 12, 13, 13.3333, 13.6, 15, 16, and 20px; fractional values are from Vditor/browser styles (`local-markdown.html:89`, `105`, `126`, `142`, `257`, `265`, `274`).
- The 40px app bar and 31px editor bar align cleanly, but the faint token fails AA for enabled view labels: `#aaa` on `#fff` is 2.32:1. The Search placeholder is 2.23:1 on `#fafafa` (`local-markdown.html:42`, `142-144`, `263-267`).

## 4. Understandable

- Semantic structure includes a labeled aside, search, navigation, main, status, menus, and editor-view group (`local-markdown.html:611-689`).
- Plain primary verbs—Open, Save, Close—are visible (`local-markdown.html:674-689`).
- The 25-command formatting toolbar is icon-first and depends on tooltips/accessibility names (`local-markdown.html:5268-5282`; screenshot toolbar `x=350-980`, `y=40-70`).
- Several visible labels do not precisely describe behavior: Markdown selects instant-rendering mode; Open Folder appends a workspace; Upload image or file ignores non-images; Documents also contains folders (`local-markdown.html:634`, `668-684`, `1660-1662`, `2383-2405`, `4008-4010`, `4827-4837`, `5276`, `5299-5302`).
- Dirty files use an unexplained bullet and the status “Not saved” does not specify “to disk” (`local-markdown.html:1637`, `1682-1684`).
- Focus reaches the editor only after 42 earlier tab stops, and there is no skip link (`local-markdown.html:609-694`, `5268-5282`; browser focus-order measurement).

## 5. Unobtrusive

- No modal, badge, notification, or overlay is visible initially. Content remains the figure, with a 220px sidebar and two compact chrome rows totaling 71px (`local-markdown.html:96-116`, `240-270`, `402-407`; 1280×720 screenshot).
- The persistent 25-command formatting row is visually dense even though its monochrome styling is quiet (`local-markdown.html:5268-5282`).

## 6. Honest

- No marketing superlatives, pricing claims, fake scarcity, confirmshaming, or other dark patterns were found. Destructive dialogs plainly state permanent deletion and unsaved-data loss (`local-markdown.html:1012-1019`, `4741-4786`, `5165-5169`).
- The autosave copy says “about 700 milliseconds,” matching the configured 700ms delay (`local-markdown.html:852`, `1070`, `4336-4353`).
- Minor label/behavior mismatches remain: Upload image or file only handles images; Open Folder adds a folder; Not saved means not saved to disk; browser-requirement messages infer browser identity from missing APIs (`local-markdown.html:682-684`, `1637`, `4008-4010`, `4283-4285`, `4423-4426`, `4789-4792`, `4827-4837`, `5276`, `5299-5302`).
- The restoration claim is unconditional while persistence failure is console-only (`local-markdown.html:1070`, `1377-1383`, `1545-1551`).

## 7. Long-lasting

- The interface uses system typography, neutral monochrome tokens, compact menus, familiar sidebar/editor geometry, and Solarized variants; no gradient, glass, oversized-display-type, or ornamental trend marker dominates (`local-markdown.html:34-90`, `96-116`, `240-337`).

## 8. Thorough

- Empty, loading, error, success, focus, and disabled states all exist (`local-markdown.html:93-94`, `148-150`, `288-289`, `314-315`, `665`, `668-670`, `1627-1637`, `1803-1830`, `2126-2133`, `3699-3790`, `4041-4050`, `4339-4347`, `4449-4463`).
- Detail gaps: two faint text tokens fail AA, no skip link exists, file reorder and resize flows are pointer-only, and adjacent Vditor targets are 23×30px (`local-markdown.html:406`, `609-694`, `2288-2307`, `5066-5075`, `5100-5116`).

## 9. Environmentally friendly

- The primary view makes 11 logical requests: the document plus six scripts, three stylesheets, and one external example image; Excalidraw is lazy-loaded only when invoked (`local-markdown.html:16-29`, `760`, `3648-3690`; browser page-asset inventory).
- Initial executable JavaScript is about 1,161,245 transfer-equivalent bytes: 191,099 inline bytes in the local HTML plus 970,146 gzip bytes across the six observed Vditor resources. Decoded JavaScript is about 5,599,555 bytes. Exact pinned CDN downloads supplied the external byte counts.
- Warm-cache localhost readiness was observed within 55ms after navigation, when all three view controls were enabled, `.vditor-content` existed, and the toolbar no longer said “Loading editor…” (`local-markdown.html:5321-5331`). This is not a cold-network TTI measurement.
- No idle animation is present; three short transitions exist for sidebar/file movement, and `prefers-reduced-motion` disables the shell transitions (`local-markdown.html:100`, `108-112`, `166`, `601-605`).
- Dark mode is user-selectable rather than inferred from `prefers-color-scheme`; Solarized Dark sets `color-scheme: dark` (`local-markdown.html:68-83`, `893-915`).

## 10. As little design as possible

- Current measurements found 43 visible interactive elements: 9 sidebar, 8 app toolbar, and 26 editor elements. Twenty-five are formatting-toolbar commands (`local-markdown.html:608-692`, `1673-1694`, `5268-5282`; live DOM measurement).
- The visible DOM has one repeated affordance pattern: two Hide sidebar controls in the responsive component tree, though only one is visible on desktop (`local-markdown.html:618-624`, `640-645`, `1036-1057`, `4852-4854`).
- The toolbar includes advanced commands such as emoji, drawing, outline, export, and insertion controls on the default surface (`local-markdown.html:5268-5282`).

## Structural measurements

- Maximum rendered nesting depth under `.LocalMarkdown-app`: 8 edges / 9 node levels, reaching an image inside the Vditor preview (`local-markdown.html:609-692`, `5261-5305`; live DOM traversal).
- Dead props/unused imports: 0. This is a vanilla single-file app; all dynamically imported Excalidraw bindings are consumed (`local-markdown.html:3648-3690`, `3728-3812`).

## Accessibility summary

- Four landmarks: complementary sidebar, search, Documents navigation, and main (`local-markdown.html:611`, `626`, `634`, `637`).
- Current focus order has 43 stops; the editor is last. All major shell actions are keyboard reachable except file reordering and table/image resizing (`local-markdown.html:609-692`, `2288-2307`, `5066-5075`, `5100-5116`, `5268-5282`).

## Known gaps

- Rendered visual/contrast measurements cover the desktop white theme; Solarized themes were source-inspected but not fully visually exercised.
- Empty/loading/error/success states were source-verified rather than all being deliberately triggered.
- Native file/folder pickers and destructive flows were not invoked.
- Third-party Excalidraw UI and transient dependency popovers were out of scope.
- Performance byte counts use observed assets and direct gzip requests. The readiness figure is only a warm-cache localhost upper bound; cold-network TTI was unavailable.
