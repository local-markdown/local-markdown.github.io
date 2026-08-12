# Verdict: REDESIGN

**REDESIGN — At 18/30, the editor's calm visual foundation is worth preserving, but the default interaction hierarchy should be reworked around the primary open-edit-save task rather than incrementally polishing a 43-control surface.**

Highest-leverage moves:

1. **Principle #10 — As little design as possible:** Replace the 25-command always-visible formatting strip with a compact core set plus a keyboard-accessible overflow or contextual toolbar. Evidence: `01-evidence.md#10-as-little-design-as-possible`.
2. **Principle #4 — Understandable:** Rename modes and actions to match actual behavior—especially Markdown, Open Folder, Upload image or file, Documents, Not saved, and the dirty bullet. Evidence: `01-evidence.md#4-understandable`.
3. **Principle #8 — Thorough:** Meet WCAG AA for every enabled cue, add a skip path to the editor, provide keyboard alternatives for reorder/resize, and enlarge undersized targets. Evidence: `01-evidence.md#8-thorough`.
4. **Principle #9 — Environmentally friendly:** Cut initial editor JavaScript below 500KB compressed by deferring non-core highlighting/icon/language capabilities until invoked. Evidence: `01-evidence.md#9-environmentally-friendly`.
5. **Principle #2 — Useful:** Make the editor the earliest practical keyboard destination and preserve direct access to New, Search, Open, Save, Close, and view switching. Evidence: `01-evidence.md#2-useful`.
