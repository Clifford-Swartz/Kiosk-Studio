import { useMemo } from "react";
import { $getRoot } from "lexical";
import { ListNode, ListItemNode } from "@lexical/list";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import type { RichTextDoc } from "@kiosk/engine";
import { lexicalStateToRichTextDoc, richTextDocToLexicalNodes } from "./lexicalAdapter.js";
import { FormattingButtons, useSelectionFormatState } from "./FormattingToolbar.js";
import { RTE_THEME } from "./editorTheme.js";

/**
 * Panel-embeddable rich text editor for property-override value editors
 * (StatesPanel state overrides, InteractionsEditor "Set Property" actions) —
 * same RichTextDoc model and Lexical setup as the canvas RichTextEditor, but
 * laid out as a normal bordered box with an always-visible toolbar instead
 * of a canvas overlay + selection-driven floating toolbar.
 */
export function RichTextValueEditor({ value, onChange }: { value: RichTextDoc; onChange: (doc: RichTextDoc) => void }) {
  const initialConfig: InitialConfigType = useMemo(
    () => ({
      namespace: `richtext-value-${Math.random().toString(36).slice(2)}`,
      nodes: [ListNode, ListItemNode],
      theme: RTE_THEME,
      onError: (error: Error) => console.error("[RichTextValueEditor]", error),
      editorState: () => {
        const root = $getRoot();
        for (const node of richTextDocToLexicalNodes(value)) root.append(node);
      },
    }),
    // Read once — Lexical's initialConfig.editorState only runs on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <Toolbar />
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            style={{
              minHeight: 60,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #2a3441",
              background: "#0e1218",
              color: "#e2e8f0",
              fontSize: 13,
              whiteSpace: "pre-wrap",
              outline: "none",
            }}
          />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ListPlugin />
      <TabIndentationPlugin />
      <OnChangePlugin onChange={(editorState) => onChange(lexicalStateToRichTextDoc(editorState))} />
    </LexicalComposer>
  );
}

function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const { state } = useSelectionFormatState(editor);
  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        padding: 4,
        marginBottom: 4,
        borderRadius: 6,
        background: "#161b22",
        border: "1px solid #2a3441",
      }}
    >
      <FormattingButtons editor={editor} state={state} />
    </div>
  );
}
