import type { InitialConfigType } from "@lexical/react/LexicalComposer";

/**
 * Lexical's default `ParagraphNode`/`ListItemNode` DOM is a bare `<p>`/`<li>`
 * with no class unless `initialConfig.theme` assigns one — so without this,
 * they carry the browser's UA-stylesheet default margins (~1em), which pushes
 * edited content down/out of the text box relative to the read-only renderer
 * (`ElementRenderer.tsx`'s `TextElement`), which uses plain unmargined divs.
 */
const PARAGRAPH_CLASS = "kiosk-rte-paragraph";
const LISTITEM_CLASS = "kiosk-rte-listitem";
const STYLE_TAG_ID = "kiosk-rte-theme-style";

if (typeof document !== "undefined" && !document.getElementById(STYLE_TAG_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = `.${PARAGRAPH_CLASS}, .${LISTITEM_CLASS} { margin: 0; }`;
  document.head.appendChild(style);
}

export const RTE_THEME: InitialConfigType["theme"] = {
  paragraph: PARAGRAPH_CLASS,
  list: { listitem: LISTITEM_CLASS },
};
