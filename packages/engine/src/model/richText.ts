/**
 * Canonical per-character rich-text model for `text` elements (`props.content`).
 * Replaces the old line-granular `props.runs` shape. Pure data + pure helpers
 * only — no editor (Lexical) or rendering (React) dependency, so both the
 * editor app and the read-only engine renderer can consume it.
 */

export interface RichTextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}

export interface RichTextParagraph {
  spans: RichTextSpan[];
  align?: "left" | "center" | "right";
  fontSize?: number;
  list?: { kind: "bullet" | "number"; level: number };
}

export interface RichTextDoc {
  version: 1;
  paragraphs: RichTextParagraph[];
}

/** Legacy line-granular shape written by the old PPTX importer / ElementRenderer's parseRuns. */
export interface LegacyTextRun {
  text: string;
  fontSize?: number;
  color?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  align?: "left" | "center" | "right";
}

export function richTextToPlainString(doc: RichTextDoc): string {
  return doc.paragraphs
    .map((p) => p.spans.map((s) => s.text).join(""))
    .join("\n");
}

export function plainTextToRichTextDoc(text: string): RichTextDoc {
  const lines = text.split("\n");
  return {
    version: 1,
    paragraphs: lines.map((line) => ({ spans: [{ text: line }] })),
  };
}

/** Migrates the old line-granular `TextRun[]` shape, one paragraph per run. */
export function legacyRunsToRichTextDoc(runs: LegacyTextRun[]): RichTextDoc {
  return {
    version: 1,
    paragraphs: runs.map((run) => ({
      spans: [
        {
          text: run.text,
          bold: run.fontWeight === "bold" ? true : undefined,
          italic: run.fontStyle === "italic" ? true : undefined,
          underline: run.textDecoration === "underline" ? true : undefined,
          color: run.color,
        },
      ],
      align: run.align,
      fontSize: run.fontSize,
    })),
  };
}
