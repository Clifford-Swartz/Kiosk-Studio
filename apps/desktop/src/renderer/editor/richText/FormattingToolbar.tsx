import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type ElementFormatType,
  type LexicalEditor,
} from "lexical";
import { $isListNode, $isListItemNode, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from "@lexical/list";
import { $findMatchingParent } from "@lexical/utils";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

export interface ActiveFormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  list: "bullet" | "number" | null;
  align: "left" | "center" | "right";
}

const DEFAULT_STATE: ActiveFormatState = { bold: false, italic: false, underline: false, list: null, align: "left" };

/**
 * Tracks the active bold/italic/underline/list/align state at the current
 * selection, plus its bounding rect (viewport-relative) while non-collapsed.
 * Shared by the floating FormattingToolbar (canvas) and the static
 * RichTextValueEditor toolbar (property panels) — only the former cares
 * about `rect` (it uses it both to position itself and to decide whether to
 * show at all).
 */
export function useSelectionFormatState(editor: LexicalEditor): { state: ActiveFormatState; rect: DOMRect | null } {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [state, setState] = useState<ActiveFormatState>(DEFAULT_STATE);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          setRect(null);
          return false;
        }

        if (selection.isCollapsed()) {
          setRect(null);
        } else {
          const domSelection = window.getSelection();
          setRect(domSelection && domSelection.rangeCount > 0 ? domSelection.getRangeAt(0).getBoundingClientRect() : null);
        }

        const listItem = $findMatchingParent(selection.anchor.getNode(), $isListItemNode);
        const listNode = listItem ? listItem.getParent() : null;
        const align = $findMatchingParent(selection.anchor.getNode(), (n) => "getFormatType" in n) as
          | { getFormatType(): ElementFormatType }
          | null;
        const alignType = align?.getFormatType();

        setState({
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          underline: selection.hasFormat("underline"),
          list: listNode && $isListNode(listNode) ? (listNode.getListType() === "number" ? "number" : "bullet") : null,
          align: alignType === "center" || alignType === "right" ? alignType : "left",
        });
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return { state, rect };
}

/**
 * Selection-driven formatting toolbar. Rendered as a `document.body` portal
 * positioned at the current text selection's bounding rect (viewport-relative
 * already — no stage-transform math, since it's outside the canvas' scaled
 * stage). Shows only while the selection is non-collapsed; hides on
 * collapse/blur.
 */
export function FormattingToolbar() {
  const [editor] = useLexicalComposerContext();
  const { state, rect } = useSelectionFormatState(editor);

  if (!rect) return null;

  return createPortal(
    <div
      data-formatting-toolbar
      // Buttons take focus via mousedown, which would blur the editor before
      // the click's command dispatches — keep focus (and the selection) put.
      onMouseDown={(e) => e.preventDefault()}
      // Rendered via a document.body portal: React still bubbles synthetic
      // events through the *component* tree, so an unguarded pointerdown here
      // would reach Canvas.tsx's canvas-background handler and exit editing
      // before the button's onClick ever fires.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: rect.left + rect.width / 2,
        top: rect.top - 44,
        transform: "translateX(-50%)",
        display: "flex",
        gap: 2,
        padding: 4,
        borderRadius: 8,
        background: "#161b22",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        border: "1px solid #2a3441",
        zIndex: 100000,
      }}
    >
      <FormattingButtons editor={editor} state={state} />
    </div>,
    document.body,
  );
}

/**
 * The bold/italic/underline/list/align button row — shared by the floating
 * FormattingToolbar (canvas) and the static RichTextValueEditor toolbar
 * (property panels).
 */
export function FormattingButtons({ editor, state }: { editor: LexicalEditor; state: ActiveFormatState }) {
  return (
    <>
      <ToolButton active={state.bold} label="B" title="Bold (Ctrl+B)" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")} />
      <ToolButton active={state.italic} label="I" title="Italic (Ctrl+I)" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")} />
      <ToolButton active={state.underline} label="U" title="Underline (Ctrl+U)" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")} />
      <Divider />
      <ToolButton
        active={state.list === "bullet"}
        label="•"
        title="Bullet list"
        onClick={() => editor.dispatchCommand(state.list === "bullet" ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND, undefined)}
      />
      <ToolButton
        active={state.list === "number"}
        label="1."
        title="Numbered list"
        onClick={() => editor.dispatchCommand(state.list === "number" ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined)}
      />
      <Divider />
      <ToolButton active={state.align === "left"} label="⟸" title="Align left" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left")} />
      <ToolButton active={state.align === "center"} label="⟺" title="Align center" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center")} />
      <ToolButton active={state.align === "right"} label="⟹" title="Align right" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right")} />
    </>
  );
}

function ToolButton({ active, label, title, onClick }: { active: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        minWidth: 26,
        height: 26,
        padding: "0 4px",
        border: "none",
        borderRadius: 4,
        background: active ? "#38bdf8" : "transparent",
        color: active ? "#0b1017" : "#e2e8f0",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, background: "#2a3441", margin: "2px 2px" }} />;
}
