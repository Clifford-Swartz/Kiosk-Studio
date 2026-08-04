# ADR 0014: Rich Text Model for Text Elements

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Design team, engine team

## Context

Text elements had one box-level style (`props.text` + flat `fontWeight`/`fontStyle`/`textDecoration`/`color`/`align`), plus a line-granular escape hatch (`props.runs`, one style per line) used only by PPTX import to approximate mixed bold/non-bold bullets. Neither supports what users expect from a text editor: bold/italic/underline/color on part of a line, bullet/numbered lists, or an in-canvas WYSIWYG editing surface. The Properties Panel exposed box-level Style/Align toggles that only ever applied to the whole element, and editing text meant typing into an uncontrolled `contentEditable` div with no formatting affordances at all.

## Decision

Introduce `RichTextDoc` (`packages/engine/src/model/richText.ts`) as the canonical per-character text model, stored in `props.content`:

```typescript
interface RichTextSpan { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; }
interface RichTextParagraph { spans: RichTextSpan[]; align?: "left"|"center"|"right"; fontSize?: number; list?: { kind: "bullet"|"number"; level: number }; }
interface RichTextDoc { version: 1; paragraphs: RichTextParagraph[]; }
```

Pure data, no editor or rendering dependency — both `packages/engine` (read-only render) and `apps/desktop` (Lexical-based editing) consume it directly.

**Schema migration (v3 → v4):** every `text` element gets `props.content`, built from `props.runs` if present (one paragraph per legacy run) else from `props.text` (one paragraph per newline). `props.runs` is dropped once migrated — `ElementRenderer` only ever reads `props.content`. `props.text` is kept as a plain-string mirror (used for search/fallback and, where the element is bound, kept live by bindings — see below), always regenerated from `content` on commit rather than treated as a separate source of truth.

**In-canvas editing:** `RichTextEditor.tsx` mounts Lexical (via `lexicalAdapter.ts`'s `RichTextDoc ↔ Lexical node tree` conversion) in place of the plain `InlineTextEditor` for `type: "text"` (buttons keep the plain editor — single-style label, no rich formatting). A `FormattingToolbar` appears on selection for bold/italic/underline/color/list toggles, portalled to `document.body` so it isn't clipped by the canvas viewport.

**Rendering:** `ElementRenderer`'s `TextElement` maps `RichTextDoc.paragraphs` directly — blank paragraphs render as spacer lines, list paragraphs get a bullet (`•`) or number (`N.`) marker plus `paddingLeft: level * 28px` indent, and each paragraph's spans render as `<span>`s with per-span bold/italic/underline/color falling back to the element's base style (`props.color`/`fontWeight`/etc., which remain the element's default/fallback style — this is what the Properties Panel's Size/Font/Color controls still edit).

**Binding interaction:** `ElementResolver.resolveBindings()` can only ever write a plain string into `props.text`/`props.label` (that's the coercion rule already in place for those two prop keys) — it never touches `props.content`, so a binding update would otherwise be silently shadowed by stale rich content. `ElementRenderer` computes `boundToText` (true when any of the element's bindings target `text`/`label`) and, when true, renders `plainTextToRichTextDoc(props.text)` instead of `props.content` — the live bound value always wins over whatever rich content happened to be there before the binding was attached.

**PPTX import:** `packages/pptx`'s `shapeLines()` no longer bakes a bullet glyph into paragraph text (the old `bulletPrefix()` returned a literal `"• "`/`"  ◦ "` string prefix). It now returns structured `PptxLine.list: { kind: "bullet"|"number", level }` (`kind` from whether the paragraph's `pPr` has `a:buAutoNum` vs. the default bullet; suppressed entirely by `a:buNone`). `pptxImport.ts` builds a `RichTextDoc` directly — one paragraph per `PptxLine`, one span per paragraph carrying that line's resolved style, `list` passed straight through — and writes it into `props.content`, retiring the `props.runs` output path.

**Properties Panel:** the text case dropped its free-text `<textarea>`, Style toggles (Bold/Italic/Underline), and Align buttons — all superseded by in-canvas per-character formatting and the `FormattingToolbar`. It keeps the data `BindControl`, and Size/Font/Color as the element's base/fallback style.

## Consequences

- A latent, unrelated bug surfaced while wiring this up and was fixed as a prerequisite: `isModalEditingActive()` (`editingId !== null`) blocks `updateElementProps` for the *entire* duration of text/button editing — since `editingId` is set for exactly that span, no per-keystroke commit could ever land in the store. Both `RichTextEditor` and `InlineTextEditor` now follow the same convention `MaskOverlay.tsx` already established: clear modal state first (`exitTextEditing()`), *then* commit once, on exit — not per keystroke.
- `props.text` is now purely derived (`richTextToPlainString(content)`), regenerated on every commit. Nothing should treat it as independently authored for a `text` element outside the binding-fallback case above.
- List rendering fidelity is per-paragraph, not per-run — a paragraph can be a bullet or not, at one level, but a single line can't mix list levels. This matches Lexical's own list model and PowerPoint's paragraph-level `pPr`.

## Alternatives Considered

### Keep `props.runs`, add formatting fields per run (rejected)

Extending the line-granular shape to carry bold/italic/underline/color per run would have kept PPTX import simpler, but caps formatting granularity at "whole line" — no bold-part-of-a-word — which was the core gap this ADR exists to close. `RichTextSpan[]` per paragraph (rather than per line) is what makes character-level formatting possible at all.

## Related

- ADR 0013: Visibility/Interactivity Consolidation — establishes the "clear modal state before committing" pattern this ADR's editor commit-timing fix reuses (`MaskOverlay.tsx`'s precedent).
