import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $isParagraphNode,
  $isTextNode,
  type EditorState,
  type ElementFormatType,
  type LexicalNode,
  type ParagraphNode,
} from "lexical";
import {
  $createListNode,
  $createListItemNode,
  $isListNode,
  $isListItemNode,
  type ListItemNode,
} from "@lexical/list";
import type { RichTextDoc, RichTextParagraph, RichTextSpan } from "@kiosk/engine";

/**
 * Pure mapping between Lexical's node tree and the engine's serializable
 * `RichTextDoc`. Only this file (and RichTextEditor.tsx/FormattingToolbar.tsx)
 * import Lexical — the engine package and read-only rendering never do.
 */

const ALIGN_VALUES = new Set(["left", "center", "right"]);

function parseStyleColor(style: string): string | undefined {
  const m = /color:\s*([^;]+)/i.exec(style);
  return m ? m[1].trim() : undefined;
}

function parseStyleFontSize(style: string): number | undefined {
  const m = /font-size:\s*([\d.]+)px/i.exec(style);
  return m ? Number(m[1]) : undefined;
}

function elementFormatToAlign(format: ElementFormatType): "left" | "center" | "right" | undefined {
  if (format === "start") return "left";
  if (format === "end") return "right";
  return ALIGN_VALUES.has(format) ? (format as "left" | "center" | "right") : undefined;
}

function textNodesToSpans(children: LexicalNode[]): RichTextSpan[] {
  const spans: RichTextSpan[] = [];
  for (const child of children) {
    if (!$isTextNode(child)) continue;
    const span: RichTextSpan = { text: child.getTextContent() };
    if (child.hasFormat("bold")) span.bold = true;
    if (child.hasFormat("italic")) span.italic = true;
    if (child.hasFormat("underline")) span.underline = true;
    const color = parseStyleColor(child.getStyle());
    if (color) span.color = color;
    spans.push(span);
  }
  return spans;
}

function listItemToParagraph(item: ListItemNode, kind: "bullet" | "number"): RichTextParagraph {
  return {
    spans: textNodesToSpans(item.getChildren()),
    list: { kind, level: item.getIndent() },
  };
}

/** Reads the current editor state into a plain `RichTextDoc`. */
export function lexicalStateToRichTextDoc(editorState: EditorState): RichTextDoc {
  const paragraphs: RichTextParagraph[] = [];
  editorState.read(() => {
    for (const node of $getRoot().getChildren()) {
      if ($isParagraphNode(node)) {
        const paragraph: RichTextParagraph = { spans: textNodesToSpans(node.getChildren()) };
        const align = elementFormatToAlign(node.getFormatType());
        if (align) paragraph.align = align;
        const fontSize = parseStyleFontSize(node.getStyle());
        if (fontSize !== undefined) paragraph.fontSize = fontSize;
        paragraphs.push(paragraph);
      } else if ($isListNode(node)) {
        const kind = node.getListType() === "number" ? "number" : "bullet";
        for (const item of node.getChildren()) {
          if ($isListItemNode(item)) paragraphs.push(listItemToParagraph(item, kind));
        }
      }
    }
  });
  return { version: 1, paragraphs };
}

function appendSpans(parent: ParagraphNode | ListItemNode, spans: RichTextSpan[]): void {
  if (spans.length === 0) {
    parent.append($createTextNode(""));
    return;
  }
  for (const span of spans) {
    const textNode = $createTextNode(span.text);
    if (span.bold) textNode.toggleFormat("bold");
    if (span.italic) textNode.toggleFormat("italic");
    if (span.underline) textNode.toggleFormat("underline");
    if (span.color) textNode.setStyle(`color: ${span.color};`);
    parent.append(textNode);
  }
}

/**
 * Builds Lexical nodes from a `RichTextDoc`. Must run inside an
 * `editor.update()` callback (uses Lexical's `$`-prefixed node factories).
 */
export function richTextDocToLexicalNodes(doc: RichTextDoc): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  let i = 0;
  while (i < doc.paragraphs.length) {
    const p = doc.paragraphs[i];
    if (p.list) {
      const kind = p.list.kind;
      const listNode = $createListNode(kind === "number" ? "number" : "bullet");
      while (i < doc.paragraphs.length && doc.paragraphs[i].list?.kind === kind) {
        const cur = doc.paragraphs[i];
        const item = $createListItemNode();
        if (cur.list) item.setIndent(cur.list.level);
        appendSpans(item, cur.spans);
        listNode.append(item);
        i += 1;
      }
      nodes.push(listNode);
    } else {
      const paragraph = $createParagraphNode();
      if (p.align) paragraph.setFormat(p.align);
      if (p.fontSize !== undefined) paragraph.setStyle(`font-size: ${p.fontSize}px;`);
      appendSpans(paragraph, p.spans);
      nodes.push(paragraph);
      i += 1;
    }
  }
  return nodes;
}
