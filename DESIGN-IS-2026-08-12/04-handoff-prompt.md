```text
/make-plan Redesign the Local Markdown desktop editor shell. Current design failed audit at 18/30 with critical gaps in principles #4 understandable, #9 environmentally friendly, and #10 as little design as possible.

Verdict paragraph (quoted from 03-verdict.md):
> REDESIGN — At 18/30, the editor's calm visual foundation is worth preserving, but the default interaction hierarchy should be reworked around the primary open-edit-save task rather than incrementally polishing a 43-control surface.

Why redesign and not refine: The total is below the 20-point refine threshold, and the surface's control hierarchy—not just its styling—causes the main failures.

Preserve from current design:
- Neutral theme tokens, system typography, and Solarized variants (`local-markdown.html:34-90`).
- Direct New, Search, Open, Save, Close, and three-view access around a large content canvas (`local-markdown.html:624-692`).

Discard:
- The 25-command always-visible formatting strip. Evidence: `local-markdown.html:5268-5282`. Caused failure on principle #10.
- The current label hierarchy where Markdown, Open Folder, Upload image or file, Documents, Not saved, and the dirty bullet do not precisely describe behavior. Evidence: `local-markdown.html:634,668-684,1637,1682-1684,4008-4010,4827-4837,5276,5299-5302`. Caused failure on principle #4.

Top 3–5 moves from the audit (verbatim):
1. Principle #10 — As little design as possible: Replace the 25-command always-visible formatting strip with a compact core set plus a keyboard-accessible overflow or contextual toolbar. Evidence: `01-evidence.md#10-as-little-design-as-possible`.
2. Principle #4 — Understandable: Rename modes and actions to match actual behavior—especially Markdown, Open Folder, Upload image or file, Documents, Not saved, and the dirty bullet. Evidence: `01-evidence.md#4-understandable`.
3. Principle #8 — Thorough: Meet WCAG AA for every enabled cue, add a skip path to the editor, provide keyboard alternatives for reorder/resize, and enlarge undersized targets. Evidence: `01-evidence.md#8-thorough`.
4. Principle #9 — Environmentally friendly: Cut initial editor JavaScript below 500KB compressed by deferring non-core highlighting/icon/language capabilities until invoked. Evidence: `01-evidence.md#9-environmentally-friendly`.
5. Principle #2 — Useful: Make the editor the earliest practical keyboard destination and preserve direct access to New, Search, Open, Save, Close, and view switching. Evidence: `01-evidence.md#2-useful`.

Redesign principles in priority order:
1. Principle #10 — As little design as possible — the default surface exposes only actions needed for open-edit-save; advanced formatting remains discoverable and keyboard accessible.
2. Principle #4 — Understandable — every visible label predicts its behavior without a tooltip and every state cue says what is saved where.
3. Principle #2 — Useful — opening, editing, saving, searching, and switching files remain one-step actions with equivalent keyboard paths.

Deliverables for the plan:
- New information architecture, not derived from the current toolbar layout
- New primary flow, low-fi and labeled, compared side-by-side to current
- States checklist: empty, loading, error, success, focus, disabled
- Migration path for current users and keyboard shortcuts
- Cutover criteria for retiring the old shell

Anti-patterns to guard against:
- Porting the old structure under new styling
- Keeping both designs behind a flag indefinitely
- Redesigning to follow a trend rather than the principles above
- Removing the preserved theme tokens or direct primary actions
```
