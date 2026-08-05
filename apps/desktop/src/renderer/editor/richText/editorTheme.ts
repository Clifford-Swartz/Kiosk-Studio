import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { TEXT_LINE_HEIGHT } from "@kiosk/engine";

/**
 * Lexical's default `ParagraphNode`/`ListItemNode`/`ListNode` DOM is a bare
 * `<p>`/`<li>`/`<ul>`/`<ol>` with no class unless `initialConfig.theme`
 * assigns one — so without this, they carry the browser's UA-stylesheet
 * default margins (`<ul>`/`<ol>` also add ~1em top/bottom margin plus ~40px
 * padding on top of each `<li>`'s own margin) and default line-height, which
 * pushes edited content down/out of the text box relative to the read-only
 * renderer (`ElementRenderer.tsx`'s `TextElement`), which uses plain
 * unmargined divs at `TEXT_LINE_HEIGHT` and a custom flex-row marker instead
 * of native list padding.
 *
 * Blank paragraphs get an extra `data-blank` compression rule — the read-only
 * renderer halves their line-height (used as a manual-spacing convention),
 * so ParagraphSpacingPlugin in RichTextEditor.tsx tags them the same way
 * live, or spacer lines look much taller while editing than once deselected.
 * They also get `width: 100%`: the ContentEditable root is a non-stretch flex
 * column, so each `<p>` sizes to its own content's min-content width by
 * default — for a paragraph with no text at all that's ~0, unlike read-only's
 * paragraph divs (plain blocks, always `width: 100%`). Without it, blank
 * lines are an unclickable sliver you can't place the caret in.
 *
 * A blank paragraph's real DOM content is an empty Lexical text node — no
 * glyph, so no inline box for the line box to size from. `line-height: 0.5`
 * can only compress a line box that exists; against zero content, browsers
 * fall back to a full-height strut regardless of the CSS value (and
 * `min-height` is a floor, so it can't undo that — it only helps when the
 * box is too *small*, not too big). Read-only avoids this by rendering an
 * actual space character for blank paragraphs, giving the browser real
 * inline content to size against. The `::before` rule below is the CSS
 * equivalent — generated content, so it never touches Lexical's persisted
 * text — giving the empty line a genuine (small) inline box that
 * `line-height: 0.5` can legitimately shrink.
 */
const PARAGRAPH_CLASS = "kiosk-rte-paragraph";
const LISTITEM_CLASS = "kiosk-rte-listitem";
const LIST_CLASS = "kiosk-rte-list";
const STYLE_TAG_ID = "kiosk-rte-theme-style";

if (typeof document !== "undefined" && !document.getElementById(STYLE_TAG_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = `
    .${PARAGRAPH_CLASS}, .${LISTITEM_CLASS} { margin: 0; width: 100%; line-height: ${TEXT_LINE_HEIGHT}; }
    .${PARAGRAPH_CLASS}[data-blank="true"] { line-height: 0.5; }
    .${PARAGRAPH_CLASS}[data-blank="true"]::before { content: "\\00a0"; }
    .${LIST_CLASS} { margin: 0; padding-left: 28px; }
  `;
  document.head.appendChild(style);
}

export const RTE_THEME: InitialConfigType["theme"] = {
  paragraph: PARAGRAPH_CLASS,
  list: { listitem: LISTITEM_CLASS, ul: LIST_CLASS, ol: LIST_CLASS },
};
