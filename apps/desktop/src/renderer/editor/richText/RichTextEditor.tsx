import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { $getRoot, $isParagraphNode, $selectAll } from "lexical";
import { ListNode, ListItemNode } from "@lexical/list";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
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
  const baseFontSize = num(element.props.fontSize, 32);

  // Mirrors ElementRenderer.tsx's TextElement autofit, including its
  // structural split: a fixed-size, overflow-hidden OUTER box (positioning +
  // clipping, never measured) around an unconstrained INNER element (no
  // explicit height, no overflow — free to grow to its natural content
  // size) that IS measured. Collapsing both roles onto the ContentEditable
  // itself (fixed height + overflow:hidden + being the scrollHeight target,
  // all on one node) was the earlier bug: `fitRef` mirrors `fit` so the
  // OnChangePlugin callback below (a stable closure created once, not
  // re-created per render) always reads the latest value instead of a stale
  // one.
  const rootRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const fitRef = useRef(1);
  fitRef.current = fit;

  useLayoutEffect(() => {
    setFit(1);
  }, [element.width, element.height, baseFontSize, element.id]);

  // Only ever shrinks `fit` — same as TextElement's own adjustment effect,
  // which relies on ITS reset effect re-running on every `props.content`
  // change to claw the size back up. Ours can't depend on `props.content`
  // (that only updates on commit, not per keystroke), so `resetAndCheckFit`
  // below does the reset explicitly on every edit instead.
  const checkFit = () => {
    const el = rootRef.current;
    if (!el || element.height <= 0) return;
    const content = el.scrollHeight;
    const budget = element.height * 0.98; // small bottom margin so descenders survive
    const current = fitRef.current;
    if (content > budget && current > 0.4) {
      const next = Math.max(0.4, current * (budget / content));
      if (next < current - 0.005) setFit(next);
    }
  };
  useLayoutEffect(checkFit);

  // Called from the OnChangePlugin below on every keystroke. If a previous
  // edit already shrank the font, re-derive from full size instead of
  // shrinking further from wherever `fit` currently sits — otherwise
  // deleting a line (or even just continuing to type) can only ever ratchet
  // `fit` down, never back up, eventually pinning it at the 0.4 floor.
  // Setting fit back to 1 here just schedules the render; `checkFit` (which
  // reruns after every render via the layout effect above) does the actual
  // re-measure once that full-size render has committed.
  const resetAndCheckFit = () => {
    if (fitRef.current !== 1) setFit(1);
    else checkFit();
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <AutoFocusSeek seekPoint={seekPoint} />
      <div
        style={{
          ...textEditorOverlayGeometry(element, scale),
          display: "flex",
          flexDirection: "column",
          alignItems: justify,
          justifyContent: "flex-start",
          textAlign: align,
          overflow: "hidden",
        }}
        // Stop these from bubbling to the canvas background (which would
        // close editing) so you can click/drag anywhere in the box (not just
        // where the text currently is) to place the caret — mirrors
        // InlineTextEditor.
        onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
      >
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              ref={rootRef}
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: justify,
                textAlign: align,
                color: str(element.props.color, "#ffffff"),
                fontFamily: str(element.props.fontFamily, "system-ui, sans-serif"),
                fontSize: baseFontSize * fit,
                whiteSpace: "pre-wrap",
              }}
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
        <TabIndentationPlugin />
        <ParagraphSpacingPlugin />
        <OnChangePlugin
          onChange={(editorState) => {
            const content = lexicalStateToRichTextDoc(editorState);
            latestRef.current = { content, text: richTextToPlainString(content) };
            // Lexical mutates the contentEditable DOM directly, so a keystroke
            // doesn't necessarily re-render this component — re-check here too,
            // not just from the layout effect, or fit only catches up once
            // something else happens to trigger a render.
            resetAndCheckFit();
          }}
        />
      </div>
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

/**
 * Tags each top-level paragraph's DOM node with `data-blank` so the
 * `[data-blank="true"]` CSS rule in editorTheme.ts can halve its
 * line-height — mirroring ElementRenderer.tsx's `TextElement`, which treats
 * a paragraph with no non-whitespace text as pure spacing and renders it at
 * half height. Without this, blank/spacer paragraphs look much taller while
 * editing than once you click away.
 *
 * useLayoutEffect (not useEffect) so this runs before RichTextEditor's own
 * checkFit layout effect in the same commit (children's layout effects fire
 * before their parent's) — otherwise the very first fit measurement sees
 * blank paragraphs still at full line-height, since they haven't been
 * tagged `data-blank` yet.
 */
function ParagraphSpacingPlugin() {
  const [editor] = useLexicalComposerContext();
  useLayoutEffect(() => {
    const applyBlankAttrs = () => {
      editor.getEditorState().read(() => {
        for (const node of $getRoot().getChildren()) {
          if (!$isParagraphNode(node)) continue;
          const dom = editor.getElementByKey(node.getKey());
          if (dom) dom.dataset.blank = node.getTextContent().trim() === "" ? "true" : "false";
        }
      });
    };
    applyBlankAttrs();
    return editor.registerUpdateListener(applyBlankAttrs);
  }, [editor]);
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
