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
  type ListNode,
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

/**
 * Recursively walks a (possibly nested) `ListNode`, pushing one paragraph per
 * `ListItemNode` that carries its own text. A sub-bullet in Lexical isn't a
 * flat item with a level number — it's a `ListItemNode` whose child is
 * itself a nested `ListNode` (holding the real sub-bullet items), so a
 * "parent" item can have both its own text AND a nested list of children.
 * `level` is threaded through as the recursion depth rather than read from
 * `item.getIndent()` (which walks the same ancestor chain, but only once we
 * know we're inside a list at all).
 */
function walkList(listNode: ListNode, level: number, paragraphs: RichTextParagraph[]): void {
  const kind = listNode.getListType() === "number" ? "number" : "bullet";
  for (const item of listNode.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const children = item.getChildren();
    const textChildren = children.filter($isTextNode);
    if (textChildren.length > 0) {
      paragraphs.push({ spans: textNodesToSpans(textChildren), list: { kind, level } });
    }
    for (const nested of children) {
      if ($isListNode(nested)) walkList(nested, level + 1, paragraphs);
    }
  }
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
        const indent = node.getIndent();
        if (indent > 0) paragraph.indent = indent;
        paragraphs.push(paragraph);
      } else if ($isListNode(node)) {
        walkList(node, 0, paragraphs);
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

type ListStackFrame = { level: number; listNode: ListNode; lastItem: ListItemNode | null };

/**
 * Consumes a contiguous run of `list`-tagged paragraphs starting at `start`,
 * building properly *nested* `ListNode`/`ListItemNode` structure — nesting
 * depth is what encodes `level` in Lexical, the same shape `walkList` above
 * reads back. This intentionally never calls `item.setIndent()`: that method
 * delegates to `$handleIndent`, which is a no-op unless the item already has
 * a list parent in place, so building the nesting directly (rather than
 * flat-appending then trying to indent after the fact) is what makes the
 * round trip actually preserve sub-bullets.
 */
function appendListRun(paragraphs: RichTextParagraph[], start: number, nodes: LexicalNode[]): number {
  const first = paragraphs[start].list!;
  const root = $createListNode(first.kind === "number" ? "number" : "bullet");
  nodes.push(root);
  const stack: ListStackFrame[] = [{ level: first.level, listNode: root, lastItem: null }];

  let i = start;
  while (i < paragraphs.length && paragraphs[i].list) {
    const cur = paragraphs[i].list!;
    while (stack.length > 1 && cur.level < stack[stack.length - 1].level) stack.pop();
    let top = stack[stack.length - 1];

    if (cur.level > top.level && top.lastItem) {
      const childList = $createListNode(cur.kind === "number" ? "number" : "bullet");
      top.lastItem.append(childList);
      top = { level: cur.level, listNode: childList, lastItem: null };
      stack.push(top);
    } else if (cur.level === top.level && cur.kind !== top.listNode.getListType()) {
      // Kind changed at the same depth (e.g. a numbered sub-list under a
      // bullet item) — start a fresh sibling list at this level.
      const parentItem = stack.length > 1 ? stack[stack.length - 2].lastItem : null;
      const siblingList = $createListNode(cur.kind === "number" ? "number" : "bullet");
      if (parentItem) parentItem.append(siblingList);
      else nodes.push(siblingList);
      top = { level: cur.level, listNode: siblingList, lastItem: null };
      stack[stack.length - 1] = top;
    }

    const item = $createListItemNode();
    appendSpans(item, paragraphs[i].spans);
    top.listNode.append(item);
    top.lastItem = item;
    i += 1;
  }
  return i;
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
      i = appendListRun(doc.paragraphs, i, nodes);
    } else {
      const paragraph = $createParagraphNode();
      if (p.align) paragraph.setFormat(p.align);
      if (p.fontSize !== undefined) paragraph.setStyle(`font-size: ${p.fontSize}px;`);
      if (p.indent) paragraph.setIndent(p.indent);
      appendSpans(paragraph, p.spans);
      nodes.push(paragraph);
      i += 1;
    }
  }
  return nodes;
}
