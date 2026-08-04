import React, { useEffect, useMemo, useRef } from "react";
import { $getRoot, $selectAll } from "lexical";
import { ListNode, ListItemNode } from "@lexical/list";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import type { Element, RichTextDoc } from "@kiosk/engine";
import { richTextToPlainString, plainTextToRichTextDoc } from "@kiosk/engine";
import { textEditorOverlayGeometry } from "./overlayStyle.js";
import { lexicalStateToRichTextDoc, richTextDocToLexicalNodes } from "./lexicalAdapter.js";
import { FormattingToolbar } from "./FormattingToolbar.js";
import { RTE_THEME } from "./editorTheme.js";

/**
 * In-canvas rich-text editing surface for `type: "text"` elements. Mounted in
 * place of Canvas.tsx's plain InlineTextEditor (which remains for `button`).
 * Commits `content` + a derived plain-string `text` mirror on every change —
 * same "store is source of truth" contract InlineTextEditor uses.
 */
export function RichTextEditor({
  element,
  scale,
  seekPoint,
  onCommit,
  pauseCapture,
  resumeCapture,
}: {
  element: Element;
  scale: number;
  /** Viewport point of the double-click that opened editing — the caret is
   * seeked there instead of selecting everything on entry. */
  seekPoint?: { x: number; y: number } | null;
  onCommit: (patch: { content: RichTextDoc; text: string }) => void;
  pauseCapture: () => void;
  resumeCapture: () => void;
}) {
  // A whole edit+format session (however many keystrokes/toolbar clicks) is
  // one undo entry — same pattern as MaskOverlay.
  useEffect(() => {
    pauseCapture();
    return () => resumeCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Latest content, updated on every Lexical change but only pushed to the
  // store once, on commit — updateElementProps is a no-op while editingId is
  // set (isModalEditingActive), so per-keystroke writes would be silently
  // dropped. Same convention MaskOverlay uses: commit once, on exit.
  const latestRef = useRef<{ content: RichTextDoc; text: string } | null>(null);
  const commit = () => {
    if (latestRef.current) onCommit(latestRef.current);
  };

  const initialContent = useMemo<RichTextDoc>(() => {
    const c = element.props.content as RichTextDoc | undefined;
    if (c && c.version === 1 && Array.isArray(c.paragraphs)) return c;
    return plainTextToRichTextDoc(typeof element.props.text === "string" ? element.props.text : "");
    // Read once — Lexical's initialConfig.editorState only runs on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.id]);

  const initialConfig: InitialConfigType = useMemo(
    () => ({
      namespace: `richtext-${element.id}`,
      nodes: [ListNode, ListItemNode],
      theme: RTE_THEME,
      onError: (error: Error) => console.error("[RichTextEditor]", error),
      editorState: () => {
        const root = $getRoot();
        for (const node of richTextDocToLexicalNodes(initialContent)) root.append(node);
      },
    }),
    [element.id, initialContent],
  );

  // Same alignment mapping as ElementRenderer.tsx's TextElement. Set on the
  // editable root (not baked into each paragraph) so it's only a fallback:
  // text-align is CSS-inherited, so a paragraph with its own explicit format
  // (from FormattingToolbar) still overrides this, exactly like the
  // read-only renderer's `p.align ?? align` fallback.
  const align = str(element.props.align, "left") as "left" | "center" | "right";
  const justify = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <AutoFocusSeek seekPoint={seekPoint} />
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            style={{
              ...textEditorOverlayGeometry(element, scale),
              display: "flex",
              flexDirection: "column",
              alignItems: justify,
              textAlign: align,
              color: str(element.props.color, "#ffffff"),
              fontFamily: str(element.props.fontFamily, "system-ui, sans-serif"),
              fontSize: num(element.props.fontSize, 32),
              whiteSpace: "pre-wrap",
              overflow: "hidden",
            }}
            // Stop these from bubbling to the canvas background (which would
            // close editing) so you can click/drag within the text to place
            // the caret or select a range — mirrors InlineTextEditor.
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
            onKeyDown={(e: React.KeyboardEvent) => {
              // Escape exits editing; Enter (unlike the plain InlineTextEditor)
              // inserts a new paragraph — handled by RichTextPlugin's default
              // command wiring, so we don't intercept it here.
              if (e.key === "Escape") {
                e.preventDefault();
                commit();
              }
            }}
          />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ListPlugin />
      <OnChangePlugin
        onChange={(editorState) => {
          const content = lexicalStateToRichTextDoc(editorState);
          latestRef.current = { content, text: richTextToPlainString(content) };
        }}
      />
      <BlurToExit onDone={commit} />
      <FormattingToolbar />
    </LexicalComposer>
  );
}

/** Focuses the editor and seeks the caret to `seekPoint` (the viewport
 * position of the double-click that opened editing) once the click's
 * trailing pointer events have settled — mirrors InlineTextEditor's
 * deferral. Falls back to select-all if there's no seek point, or it
 * resolves outside the editor (e.g. a click on padding). */
function AutoFocusSeek({ seekPoint }: { seekPoint?: { x: number; y: number } | null }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const t = window.setTimeout(() => {
      editor.focus(() => {
        const root = editor.getRootElement();
        const range = seekPoint ? caretRangeFromPoint(seekPoint.x, seekPoint.y) : null;
        if (root && range && root.contains(range.startContainer)) {
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        } else {
          editor.update(() => $selectAll());
        }
      });
    }, 0);
    return () => window.clearTimeout(t);
  }, [editor, seekPoint]);
  return null;
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  return doc.caretRangeFromPoint ? doc.caretRangeFromPoint(x, y) : null;
}

/** Commits + exits on blur, ignoring the spurious blur right after mount. */
function BlurToExit({ onDone }: { onDone: () => void }) {
  const [editor] = useLexicalComposerContext();
  const ready = useRef(false);
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const t = window.setTimeout(() => {
      ready.current = true;
    }, 50);
    const handleBlur = (e: FocusEvent) => {
      if (!ready.current) return;
      // Ignore blur caused by focus moving to the formatting toolbar (a
      // document.body portal, so it's outside this contentEditable root).
      const next = e.relatedTarget as Node | null;
      if (next && root.closest("body")?.contains(next) && isToolbarNode(next)) return;
      onDone();
    };
    root.addEventListener("blur", handleBlur);
    return () => {
      window.clearTimeout(t);
      root.removeEventListener("blur", handleBlur);
    };
  }, [editor, onDone]);
  return null;
}

function isToolbarNode(node: Node): boolean {
  return node instanceof HTMLElement && node.closest("[data-formatting-toolbar]") !== null;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}
