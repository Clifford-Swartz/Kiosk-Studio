import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

/**
 * Minimal PowerPoint (.pptx) parser → editable scene data. A .pptx is a ZIP of
 * OpenXML. We extract, per slide, text boxes, pictures, tables, and
 * line/connector shapes, with position/size (converted from EMU to px at 96
 * DPI, including nested-group transforms). Pure & Node-only; returns image
 * bytes for the caller to persist. Approximate fidelity: charts, SmartArt,
 * and animations are still dropped.
 */

const EMU_PER_PX = 914400 / 96; // 9525

/** One paragraph (line) of a text box, with its own resolved style. */
export interface PptxLine {
  text: string;       // raw paragraph text — no bullet glyph baked in, see `list`
  list?: { kind: "bullet" | "number"; level: number };
  fontPt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
}
export interface PptxText {
  x: number; y: number; width: number; height: number;
  text: string;       // full text (newline-joined) — fallback / search
  // Per-paragraph styled lines. Different bullets can have different weight/size
  // (e.g. bold lvl-0 bullets, non-bold sub-bullets). Renderer styles each line.
  lines: PptxLine[];
  // Box-level fallback style (first line's), for single-style consumers.
  fontPt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  // Box-level fill/outline (the shape's own spPr, not text run styling).
  fill?: string;
  borderColor?: string;
  borderWidth?: number;
}
/** PowerPoint crop rectangle (a:srcRect), as 0-1 fractions cropped from each edge. */
export interface PptxCrop {
  left: number; top: number; right: number; bottom: number;
}
export interface PptxImage {
  x: number; y: number; width: number; height: number;
  bytes: Uint8Array;
  ext: string; // e.g. "png", "jpg"
  borderColor?: string;
  borderWidth?: number;
  crop?: PptxCrop;
}
/** Slide background: a solid/theme color, a background image, or both absent. */
export interface PptxBackground {
  color?: string;
  image?: { bytes: Uint8Array; ext: string };
}
/** One table cell — null marks a cell absorbed by a neighboring merge. */
export interface PptxTableCell {
  text: string;
  fill?: string;
  color?: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
  colSpan?: number;
  rowSpan?: number;
}
export interface PptxTable {
  x: number; y: number; width: number; height: number;
  colWidths: number[]; // px
  rowHeights: number[]; // px
  cells: (PptxTableCell | null)[][]; // [row][col]
  borderColor?: string;
  borderWidth?: number;
}
/** A line/connector shape (straight/bent/curved connectors, or line-geometry autoshapes). */
export interface PptxConnector {
  x: number; y: number; width: number; height: number;
  x1: number; y1: number; x2: number; y2: number; // fractions 0..1 of width/height
  strokeColor: string;
  strokeWidth: number;
  startArrow: "none" | "triangle";
  endArrow: "none" | "triangle";
  dash: "solid" | "dash" | "dot";
}
export interface ParsedSlide {
  texts: PptxText[];
  images: PptxImage[];
  tables: PptxTable[];
  connectors: PptxConnector[];
  background?: PptxBackground;
}
export interface ParsedDeck {
  slideW: number; // px
  slideH: number; // px
  slides: ParsedSlide[];
}

/**
 * Wire-safe variants of the above for the Electron IPC boundary: raw image
 * `Uint8Array`s don't survive structured-clone reliably across the
 * context-isolation bridge, so images carry base64 instead. This is the
 * single source of truth for that shape — the renderer imports it rather
 * than re-declaring its own copy, so the two sides can't drift apart.
 */
export interface PptxImageWire {
  x: number; y: number; width: number; height: number;
  ext: string;
  base64: string;
  borderColor?: string;
  borderWidth?: number;
  crop?: PptxCrop;
}
/** Wire-safe variant of `PptxBackground` — image bytes carried as base64 (see `PptxImageWire`). */
export interface PptxBackgroundWire {
  color?: string;
  image?: { ext: string; base64: string };
}
export interface ParsedSlideWire {
  texts: PptxText[];
  images: PptxImageWire[];
  tables: PptxTable[];
  connectors: PptxConnector[];
  background?: PptxBackgroundWire;
}
export interface ParsedDeckWire {
  slideW: number;
  slideH: number;
  slides: ParsedSlideWire[];
}

/** Convert a parsed deck's image bytes to base64 for IPC transport. */
export function toWireDeck(deck: ParsedDeck): ParsedDeckWire {
  return {
    slideW: deck.slideW,
    slideH: deck.slideH,
    slides: deck.slides.map((s) => ({
      texts: s.texts,
      tables: s.tables,
      connectors: s.connectors,
      images: s.images.map((im) => ({
        x: im.x, y: im.y, width: im.width, height: im.height, ext: im.ext,
        base64: Buffer.from(im.bytes).toString("base64"),
        borderColor: im.borderColor,
        borderWidth: im.borderWidth,
        crop: im.crop,
      })),
      ...(s.background
        ? {
            background: {
              color: s.background.color,
              ...(s.background.image
                ? { image: { ext: s.background.image.ext, base64: Buffer.from(s.background.image.bytes).toString("base64") } }
                : {}),
            },
          }
        : {}),
    })),
  };
}

/**
 * Runtime guard for a `ParsedDeckWire` received over IPC (typed `unknown` at
 * that boundary since Electron's `ipcRenderer.invoke` can't carry a type).
 * Structural only — checks shape, not every field — but catches the case
 * that matters: a `pptx:import` handler that stops returning what the
 * renderer expects.
 */
export function isParsedDeckWire(value: unknown): value is ParsedDeckWire {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  if (typeof d.slideW !== "number" || typeof d.slideH !== "number" || !Array.isArray(d.slides)) return false;
  return d.slides.every((s) => {
    if (!s || typeof s !== "object") return false;
    const slide = s as Record<string, unknown>;
    return Array.isArray(slide.texts) && Array.isArray(slide.images);
  });
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep arrays predictable for repeated nodes we walk.
  isArray: (name) => ["p:sp", "p:pic", "a:p", "a:r", "p:sldId", "p:grpSp", "p:cxnSp"].includes(name),
});

function emuToPx(emu: number): number {
  return Math.round(emu / EMU_PER_PX);
}
function num(v: unknown): number {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}
/** Like `num`, but rejects non-positive results (corrupt/adversarial EMU or
 * size attributes) in favor of `fallback` — a malformed slide shouldn't be
 * able to produce a zero/negative dimension downstream. */
function posNum(v: unknown, fallback: number): number {
  const n = num(v);
  return n > 0 ? n : fallback;
}
/** Clamp a font size (pt) to a sane range so a corrupt sz/fontScale attribute
 * can't produce invisible (≤0) or absurdly huge text. */
function clampFontPt(pt: number): number {
  return Math.min(500, Math.max(1, pt));
}

/** Recursively collect all nodes with a given key from a parsed-XML object. */
function collect(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) {
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    }
    if (v && typeof v === "object") collect(v, key, out);
  }
  return out;
}

/** A rect in raw EMU (no px conversion) — used while composing group transforms. */
type EmuRect = { x: number; y: number; width: number; height: number };

/**
 * Extract { x, y, width, height } from a shape's a:xfrm in raw EMU, or null.
 * `allowZeroDim` permits ONE (or both) of width/height to be exactly 0 — a
 * legitimate encoding for a perfectly horizontal/vertical straight connector
 * (PowerPoint stores those with cy="0" or cx="0"), which callers resolving
 * connector geometry must opt into. Negative values are always rejected
 * (corrupt/adversarial data) regardless of this flag.
 */
function xfrmRectEmu(shape: Record<string, unknown>, allowZeroDim = false): EmuRect | null {
  const xfrms = collect(shape, "a:xfrm");
  const xf = xfrms[0] as Record<string, unknown> | undefined;
  if (!xf) return null;
  const off = xf["a:off"] as Record<string, unknown> | undefined;
  const ext = xf["a:ext"] as Record<string, unknown> | undefined;
  if (!off || !ext) return null;
  const width = num(ext["@_cx"]);
  const height = num(ext["@_cy"]);
  const invalid = allowZeroDim ? width < 0 || height < 0 : width <= 0 || height <= 0;
  if (invalid) return null;
  return { x: num(off["@_x"]), y: num(off["@_y"]), width, height };
}

/** Extract { x, y, w, h } from a shape's a:xfrm (EMU → px), or null. */
function xfrmRect(shape: Record<string, unknown>): { x: number; y: number; width: number; height: number } | null {
  const emu = xfrmRectEmu(shape);
  if (!emu) return null;
  return { x: emuToPx(emu.x), y: emuToPx(emu.y), width: emuToPx(emu.width), height: emuToPx(emu.height) };
}

/** A function mapping a shape's local EMU rect to slide-absolute EMU coordinates. */
type RectTransform = (rect: EmuRect) => EmuRect;
const IDENTITY_TRANSFORM: RectTransform = (rect) => rect;

/**
 * Build a group's own child→slide coordinate transform from its
 * <p:grpSpPr><a:xfrm> (a:off/a:ext = the group's box in its PARENT's space,
 * a:chOff/a:chExt = the coordinate space its children's own a:xfrm values are
 * expressed in). Returns the identity transform when the group has no usable
 * xfrm (better an unmoved shape than a NaN-positioned one).
 */
function groupTransform(grpSp: Record<string, unknown>): RectTransform {
  const grpSpPr = collect(grpSp, "p:grpSpPr")[0] as Record<string, unknown> | undefined;
  const xf = grpSpPr ? (collect(grpSpPr, "a:xfrm")[0] as Record<string, unknown> | undefined) : undefined;
  if (!xf) return IDENTITY_TRANSFORM;
  const off = xf["a:off"] as Record<string, unknown> | undefined;
  const ext = xf["a:ext"] as Record<string, unknown> | undefined;
  const chOff = xf["a:chOff"] as Record<string, unknown> | undefined;
  const chExt = xf["a:chExt"] as Record<string, unknown> | undefined;
  if (!off || !ext || !chOff || !chExt) return IDENTITY_TRANSFORM;
  const chExtCx = num(chExt["@_cx"]);
  const chExtCy = num(chExt["@_cy"]);
  if (chExtCx <= 0 || chExtCy <= 0) return IDENTITY_TRANSFORM;
  const offX = num(off["@_x"]);
  const offY = num(off["@_y"]);
  const chOffX = num(chOff["@_x"]);
  const chOffY = num(chOff["@_y"]);
  const scaleX = num(ext["@_cx"]) / chExtCx;
  const scaleY = num(ext["@_cy"]) / chExtCy;
  return (rect) => ({
    x: offX + (rect.x - chOffX) * scaleX,
    y: offY + (rect.y - chOffY) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  });
}

/** Compose two rect transforms: apply `inner` first, then `outer`. */
function composeTransform(outer: RectTransform, inner: RectTransform): RectTransform {
  return (rect) => outer(inner(rect));
}

/** Preset geometries that are lines/connectors, not filled autoshapes. */
const LINE_GEOM_PRESETS = new Set([
  "line", "straightConnector1",
  "bentConnector2", "bentConnector3", "bentConnector4", "bentConnector5",
  "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5",
]);

/** True if a <p:sp>'s own geometry (a:prstGeom@prst) is a line/connector shape
 * rather than a filled autoshape — these get diverted into `connectors`. */
function isLineGeomShape(sp: Record<string, unknown>): boolean {
  const geom = collect(sp, "a:prstGeom")[0] as Record<string, unknown> | undefined;
  const prst = geom?.["@_prst"];
  return typeof prst === "string" && LINE_GEOM_PRESETS.has(prst);
}

/**
 * Walk a slide's shape tree (<p:spTree>, recursing into <p:grpSp>) collecting
 * every <p:sp>/<p:pic>/<p:cxnSp>, each paired with the coordinate transform
 * accumulated from its ancestor groups' own a:xfrm (identity if it's not
 * inside a group). Deliberately narrow (branches only on sp/pic/cxnSp/grpSp)
 * rather than the generic `collect()` walk — that flattened group children
 * without ever composing their group's transform, which is exactly the bug
 * this fixes. Connector shapes (<p:cxnSp>, and any <p:sp> whose own geometry
 * is a line preset) are diverted into `connectors` rather than `shapes` since
 * they render as strokes, not filled/text boxes.
 */
function collectSpTree(
  doc: unknown,
  transform: RectTransform = IDENTITY_TRANSFORM,
  out: {
    shapes: { shape: Record<string, unknown>; transform: RectTransform }[];
    pics: { shape: Record<string, unknown>; transform: RectTransform }[];
    connectors: { shape: Record<string, unknown>; transform: RectTransform }[];
  } = { shapes: [], pics: [], connectors: [] }
): typeof out {
  if (!doc || typeof doc !== "object") return out;
  const node = doc as Record<string, unknown>;
  for (const [k, v] of Object.entries(node)) {
    if (k === "p:sp") {
      for (const sp of v as Record<string, unknown>[]) {
        if (isLineGeomShape(sp)) out.connectors.push({ shape: sp, transform });
        else out.shapes.push({ shape: sp, transform });
      }
    } else if (k === "p:pic") {
      for (const pic of v as Record<string, unknown>[]) out.pics.push({ shape: pic, transform });
    } else if (k === "p:cxnSp") {
      for (const cxn of v as Record<string, unknown>[]) out.connectors.push({ shape: cxn, transform });
    } else if (k === "p:grpSp") {
      for (const grp of v as Record<string, unknown>[]) {
        collectSpTree(grp, composeTransform(transform, groupTransform(grp)), out);
      }
    } else if (v && typeof v === "object") {
      // Descend into everything else (p:sld > p:cSld > p:spTree, and any
      // other wrapper) to reach further-nested sp/pic/cxnSp/grpSp — mirrors
      // `collect()`'s generic recursion, just with grpSp given special
      // (transform-composing) handling instead of being flattened through.
      collectSpTree(v, transform, out);
    }
  }
  return out;
}

/** A shape's own box-level fill/outline (distinct from its text run styling). */
interface ShapeFillAndLine {
  fill?: string;
  borderColor?: string;
  borderWidth?: number;
}

/** Clamp a border width (px) to a sane range for the same reason `clampFontPt`
 * clamps font size — a corrupt/adversarial `a:ln@w` shouldn't produce an
 * invisible or absurdly thick outline. */
function clampBorderPx(px: number): number {
  return Math.min(100, Math.max(0, px));
}

/** Resolve a:srgbClr/a:schemeClr directly on a node (e.g. a:fillRef), unlike
 * `colorFromFill` which looks one level down inside an a:solidFill child. */
function directColor(node: Record<string, unknown> | undefined, scheme: Record<string, string>): string | undefined {
  if (!node) return undefined;
  const srgb = node["a:srgbClr"] as Record<string, unknown> | undefined;
  const v = srgb?.["@_val"];
  if (typeof v === "string" && /^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
  const sc = node["a:schemeClr"] as Record<string, unknown> | undefined;
  const name = sc?.["@_val"];
  if (typeof name === "string" && scheme[name]) return scheme[name];
  return undefined;
}

/**
 * Resolve a shape's own box fill/outline from its <p:spPr> — NOT its text run
 * styling (that's `defRprStyle`/paragraph rPr). Distinguishes "explicitly no
 * fill/line" (a:noFill) from "not specified" (undefined) so the caller doesn't
 * paint a default color/border PowerPoint never asked for.
 *
 * Falls back to the shape's Quick Style (<p:style><a:fillRef>/<a:lnRef>) when
 * spPr has nothing of its own — most theme-colored autoshapes (e.g. diagram
 * boxes) get their fill this way, not via a literal solidFill.
 */
function shapeFillAndLine(
  shape: Record<string, unknown>,
  scheme: Record<string, string>,
  fillStyles: ColorMod[],
  lnStyles: LnStyle[]
): ShapeFillAndLine {
  const spPr = collect(shape, "p:spPr")[0] as Record<string, unknown> | undefined;
  const out: ShapeFillAndLine = {};
  let literalFill = false;
  let literalLine = false;
  if (spPr) {
    if ("a:noFill" in spPr) {
      literalFill = true;
    } else {
      const fill = colorFromFill(spPr, scheme);
      if (fill) {
        out.fill = fill;
        literalFill = true;
      }
    }
    const ln = spPr["a:ln"] as Record<string, unknown> | undefined;
    if (ln) {
      if ("a:noFill" in ln) {
        literalLine = true;
      } else {
        const borderColor = colorFromFill(ln, scheme);
        if (borderColor) {
          out.borderColor = borderColor;
          const w = num(ln["@_w"]);
          out.borderWidth = w > 0 ? clampBorderPx(emuToPx(w)) : 1;
          literalLine = true;
        }
      }
    }
  }

  const style = collect(shape, "p:style")[0] as Record<string, unknown> | undefined;
  if (style) {
    if (!literalFill) {
      const fillRef = style["a:fillRef"] as Record<string, unknown> | undefined;
      const idx = num(fillRef?.["@_idx"]);
      const base = directColor(fillRef, scheme);
      if (base && idx > 0) out.fill = applyColorMod(base, fillStyles[idx - 1]);
    }
    if (!literalLine) {
      const lnRef = style["a:lnRef"] as Record<string, unknown> | undefined;
      const idx = num(lnRef?.["@_idx"]);
      const base = directColor(lnRef, scheme);
      if (base && idx > 0) {
        const lnStyle = lnStyles[idx - 1];
        out.borderColor = applyColorMod(base, lnStyle?.mod);
        out.borderWidth = lnStyle?.widthPx ?? 1;
      }
    }
  }

  return out;
}

/**
 * Read a picture's crop rectangle from <p:blipFill><a:srcRect l t r b>
 * (values in 1/1000 percent, i.e. divide by 100000 for a 0-1 fraction).
 * Returns undefined when there's no srcRect (the common case — most pictures
 * aren't cropped) so the caller doesn't apply a no-op crop.
 */
function imageCrop(pic: Record<string, unknown>): PptxCrop | undefined {
  const blipFill = collect(pic, "p:blipFill")[0] as Record<string, unknown> | undefined;
  const srcRect = blipFill?.["a:srcRect"] as Record<string, unknown> | undefined;
  if (!srcRect) return undefined;
  const frac = (v: unknown) => Math.max(0, Math.min(1, num(v) / 100000));
  const left = frac(srcRect["@_l"]);
  const top = frac(srcRect["@_t"]);
  const right = frac(srcRect["@_r"]);
  const bottom = frac(srcRect["@_b"]);
  if (!left && !top && !right && !bottom) return undefined;
  return { left, top, right, bottom };
}

/** Read a shape's placeholder descriptor (<p:ph type=… idx=…>), if any. */
function placeholderKey(shape: Record<string, unknown>): { type: string; idx: string } | null {
  const ph = collect(shape, "p:ph")[0] as Record<string, unknown> | undefined;
  if (!ph) return null;
  return { type: String(ph["@_type"] ?? "body"), idx: String(ph["@_idx"] ?? "") };
}

/**
 * Build a map of placeholder geometry from a slide layout (and its master),
 * keyed by "type|idx" and also by "type" and "idx" alone for loose matching.
 * Real slides leave placeholder shapes without a:xfrm, inheriting from here.
 */
type Rect = { x: number; y: number; width: number; height: number };
interface LayoutInfo {
  rects: Map<string, Rect>;
  styles: Map<string, RunStyle>;
  /** Layout + master picture elements (logos/banners) as positioned images. */
  pics: { rect: Rect; relId: string; layoutName: string }[];
}

/** Default run style from a placeholder's lstStyle defRPr (size in 1/100pt, color). */
function defRprStyle(sp: Record<string, unknown>, scheme: Record<string, string>): RunStyle {
  const out: RunStyle = {};
  // lvl1pPr > defRPr is the typical title/body default.
  const ppr = collect(sp, "a:lvl1pPr")[0] as Record<string, unknown> | undefined;
  const defRpr = collect(ppr ?? sp, "a:defRPr")[0] as Record<string, unknown> | undefined;
  if (defRpr) {
    const sz = num(defRpr["@_sz"]);
    if (sz > 0) out.fontPt = sz / 100;
    if (defRpr["@_b"] === "1") out.bold = true;
    if (defRpr["@_u"] !== undefined && defRpr["@_u"] !== "none") out.underline = true;
    const c = colorFromFill(defRpr, scheme);
    if (c) out.color = c;
  }
  const algn = ppr?.["@_algn"];
  if (algn === "ctr") out.align = "center";
  else if (algn === "r") out.align = "right";
  else if (algn === "l") out.align = "left";
  return out;
}

/**
 * Gather placeholder geometry + default styles from the slide's layout (and
 * master), plus layout/master picture shapes (logos/branding). Real slides
 * inherit placeholder position AND text styling from here.
 */
function layoutInfo(files: Record<string, Uint8Array>, slidePath: string, scheme: Record<string, string>): LayoutInfo {
  const rects = new Map<string, Rect>();
  const styles = new Map<string, RunStyle>();
  const pics: { rect: Rect; relId: string; layoutName: string }[] = [];
  const base = slidePath.split("/").pop()!;
  const relsXml = findFile(files, slidePath.replace(/[^/]+$/, "") + "_rels/" + base + ".rels");
  if (!relsXml) return { rects, styles, pics };
  const rels = parser.parse(strFromU8(relsXml));
  const layoutRel = (collect(rels, "Relationship") as Record<string, unknown>[]).find((r) =>
    String(r["@_Type"]).endsWith("/slideLayout")
  );
  if (!layoutRel) return { rects, styles, pics };
  const layoutName = String(layoutRel["@_Target"]).split("/").pop()!;

  const collectFrom = (xml: Uint8Array | undefined, srcName: string) => {
    if (!xml) return;
    const doc = parser.parse(strFromU8(xml));
    for (const sp of collect(doc, "p:sp") as Record<string, unknown>[]) {
      const ph = placeholderKey(sp);
      const rect = xfrmRect(sp);
      if (ph) {
        const style = defRprStyle(sp, scheme);
        for (const k of [`${ph.type}|${ph.idx}`, `t:${ph.type}`, ...(ph.idx ? [`i:${ph.idx}`] : [])]) {
          if (rect && !rects.has(k)) rects.set(k, rect);
          if (Object.keys(style).length && !styles.has(k)) styles.set(k, style);
        }
      }
    }
    // Pictures on the layout/master = branding (logos, banners). Collected AFTER
    // shapes above so a placeholder pic with no own a:xfrm (inheriting geometry
    // from the master, like a slide-level placeholder would) can fall back to the
    // rect a matching placeholder shape just contributed to `rects` — without this,
    // such logos/pics were silently dropped instead of positioned.
    for (const pic of collect(doc, "p:pic") as Record<string, unknown>[]) {
      const rect = xfrmRect(pic) ?? phLookup(rects, placeholderKey(pic));
      const blip = collect(pic, "a:blip")[0] as Record<string, unknown> | undefined;
      const relId = blip ? String(blip["@_r:embed"]) : "";
      if (rect && relId) pics.push({ rect, relId, layoutName: srcName });
    }
  };

  collectFrom(findFile(files, "ppt/slideLayouts/" + layoutName), layoutName);
  const layoutRelsXml = findFile(files, "ppt/slideLayouts/_rels/" + layoutName + ".rels");
  if (layoutRelsXml) {
    const lr = parser.parse(strFromU8(layoutRelsXml));
    const masterRel = (collect(lr, "Relationship") as Record<string, unknown>[]).find((r) =>
      String(r["@_Type"]).endsWith("/slideMaster")
    );
    if (masterRel) {
      const masterName = String(masterRel["@_Target"]).split("/").pop()!;
      collectFrom(findFile(files, "ppt/slideMasters/" + masterName), masterName);
    }
  }
  return { rects, styles, pics };
}

function phLookup<T>(map: Map<string, T>, ph: { type: string; idx: string } | null): T | undefined {
  if (!ph) return undefined;
  // Exact type|idx first. If the shape has an idx, match ONLY by idx (idx is
  // unique per placeholder) — never cross to a different same-type placeholder
  // (that mispainted content with a subtitle's color). Type fallback only when
  // there's no idx.
  const exact = map.get(`${ph.type}|${ph.idx}`);
  if (exact !== undefined) return exact;
  if (ph.idx) return map.get(`i:${ph.idx}`);
  return map.get(`t:${ph.type}`);
}

/**
 * Resolve a shape's rect: its own a:xfrm, transformed through any ancestor
 * group's coordinate space, else the layout placeholder's. A shape nested in
 * a <p:grpSp> stores its xfrm in the group's child coordinate space, not
 * slide-absolute — `transform` (from `collectSpTree`) maps it there. The
 * `phLookup` fallback is never inside a group in practice, so it passes
 * through untransformed.
 */
function resolveRectWithTransform(
  shape: Record<string, unknown>,
  rects: Map<string, Rect>,
  transform: RectTransform,
  allowZeroDim = false
): Rect | null {
  const emu = xfrmRectEmu(shape, allowZeroDim);
  if (emu) {
    const t = transform(emu);
    const valid = allowZeroDim ? t.width >= 0 && t.height >= 0 : t.width > 0 && t.height > 0;
    if (valid) {
      return { x: emuToPx(t.x), y: emuToPx(t.y), width: emuToPx(t.width), height: emuToPx(t.height) };
    }
  }
  return phLookup(rects, placeholderKey(shape)) ?? null;
}

/** A connector/line shape's own a:xfrm flip flags (false when absent). */
function xfrmFlips(shape: Record<string, unknown>): { flipH: boolean; flipV: boolean } {
  const xf = collect(shape, "a:xfrm")[0] as Record<string, unknown> | undefined;
  const flipH = xf?.["@_flipH"];
  const flipV = xf?.["@_flipV"];
  return {
    flipH: flipH === "1" || flipH === 1,
    flipV: flipV === "1" || flipV === 1,
  };
}

/**
 * Parse a connector/line shape (<p:cxnSp>, or a line-preset <p:sp>) into a
 * PptxConnector: endpoints as 0-1 fractions of its bounding box (derived from
 * flipH/flipV — bent/curved connectors are approximated as straight lines
 * between the same corner endpoints), stroke reused from `shapeFillAndLine`'s
 * a:ln handling, and arrowheads/dash read directly off a:ln.
 */
function parseConnector(
  shape: Record<string, unknown>,
  transform: RectTransform,
  rects: Map<string, Rect>,
  scheme: Record<string, string>,
  fillStyles: ColorMod[],
  lnStyles: LnStyle[]
): PptxConnector | null {
  const rect = resolveRectWithTransform(shape, rects, transform, true);
  if (!rect) return null;

  const { flipH, flipV } = xfrmFlips(shape);
  const [x1, y1, x2, y2] =
    flipH && flipV ? [1, 1, 0, 0] : flipH ? [1, 0, 0, 1] : flipV ? [0, 1, 1, 0] : [0, 0, 1, 1];

  const style = shapeFillAndLine(shape, scheme, fillStyles, lnStyles);
  const spPr = collect(shape, "p:spPr")[0] as Record<string, unknown> | undefined;
  const ln = spPr?.["a:ln"] as Record<string, unknown> | undefined;

  const arrow = (end: Record<string, unknown> | undefined): "none" | "triangle" =>
    end && end["@_type"] !== "none" ? "triangle" : "none";

  const dashVal = (ln?.["a:prstDash"] as Record<string, unknown> | undefined)?.["@_val"];
  const dash: "solid" | "dash" | "dot" =
    dashVal === "sysDot" || dashVal === "dot"
      ? "dot"
      : typeof dashVal === "string" && dashVal.toLowerCase().includes("dash")
        ? "dash"
        : "solid";

  return {
    ...rect,
    x1, y1, x2, y2,
    strokeColor: style.borderColor ?? "#0f172a",
    strokeWidth: style.borderWidth ?? 1,
    startArrow: arrow(ln?.["a:headEnd"] as Record<string, unknown> | undefined),
    endArrow: arrow(ln?.["a:tailEnd"] as Record<string, unknown> | undefined),
    dash,
  };
}

interface RunStyle {
  fontPt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
}

/**
 * Resolve a color from a fill-bearing node (e.g. an a:rPr), checking ONLY its
 * direct solidFill — not greedily anywhere in the subtree (that grabbed wrong
 * colors). Handles a:srgbClr (explicit hex) and a:schemeClr (theme color name,
 * resolved via the provided scheme→hex map, e.g. tx1/dk1/accent1).
 */
function colorFromFill(
  node: Record<string, unknown> | undefined,
  scheme: Record<string, string>
): string | undefined {
  if (!node) return undefined;
  const fill = node["a:solidFill"] as Record<string, unknown> | undefined;
  if (!fill) return undefined;
  const srgb = fill["a:srgbClr"] as Record<string, unknown> | undefined;
  const v = srgb?.["@_val"];
  if (typeof v === "string" && /^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
  const sc = fill["a:schemeClr"] as Record<string, unknown> | undefined;
  const name = sc?.["@_val"];
  if (typeof name === "string" && scheme[name]) return scheme[name];
  return undefined;
}

/** PowerPoint theme color modifiers, each a 0-1 fraction (val / 100000). */
interface ColorMod {
  lumMod?: number;
  lumOff?: number;
  shade?: number;
  tint?: number;
  satMod?: number;
}

/** Read shade/tint/lumMod/lumOff/satMod children off an a:schemeClr (or similar) node. */
function readColorMod(node: Record<string, unknown> | undefined): ColorMod {
  const mod: ColorMod = {};
  if (!node) return mod;
  const val = (key: string) => {
    const child = node[key] as Record<string, unknown> | undefined;
    const v = child?.["@_val"];
    return v != null ? num(v) / 100000 : undefined;
  };
  mod.lumMod = val("a:lumMod");
  mod.lumOff = val("a:lumOff");
  mod.shade = val("a:shade");
  mod.tint = val("a:tint");
  mod.satMod = val("a:satMod");
  return mod;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Apply PowerPoint theme color modifiers (shade/tint/lumMod/lumOff/satMod) to
 * a base hex color. Approximate — same convention python-pptx/docx tooling
 * uses, good enough for this project's stated "approximate fidelity" goal.
 */
function applyColorMod(hex: string, mod: ColorMod | undefined): string {
  if (!mod) return hex;
  let [r, g, b] = hexToRgb(hex);
  if (mod.shade != null) {
    r *= mod.shade; g *= mod.shade; b *= mod.shade;
  }
  if (mod.tint != null) {
    r = r * mod.tint + 255 * (1 - mod.tint);
    g = g * mod.tint + 255 * (1 - mod.tint);
    b = b * mod.tint + 255 * (1 - mod.tint);
  }
  if (mod.lumMod != null || mod.lumOff != null || mod.satMod != null) {
    let [h, s, l] = rgbToHsl(r, g, b);
    if (mod.satMod != null) s *= mod.satMod;
    if (mod.lumMod != null) l *= mod.lumMod;
    if (mod.lumOff != null) l += mod.lumOff;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    [r, g, b] = hslToRgb(h, s, l);
  }
  return rgbToHex(r, g, b);
}

/** A theme's fmtScheme line-style entry: an approximate width + color modifier. */
interface LnStyle {
  widthPx?: number;
  mod: ColorMod;
}

/** Scheme map plus the theme's fmtScheme fill/line style lists (Quick Style refs index into these). */
interface ThemeScheme {
  scheme: Record<string, string>;
  fillStyles: ColorMod[];
  lnStyles: LnStyle[];
  bgFillStyles: ColorMod[];
}

/**
 * Direct children of a style list (fillStyleLst/lnStyleLst), in the order
 * they were encountered. Best-effort: fast-xml-parser groups repeated same-tag
 * siblings into an array but keeps distinct tags as separate object keys, so
 * interleaved different-tag entries (rare in practice) may reorder — acceptable
 * given this project's "approximate fidelity" goal.
 */
function styleListEntries(listNode: Record<string, unknown> | undefined): { tag: string; node: Record<string, unknown> }[] {
  if (!listNode) return [];
  const out: { tag: string; node: Record<string, unknown> }[] = [];
  for (const [k, v] of Object.entries(listNode)) {
    if (k.startsWith("@_")) continue;
    if (Array.isArray(v)) out.push(...(v as Record<string, unknown>[]).map((node) => ({ tag: k, node })));
    else out.push({ tag: k, node: v as Record<string, unknown> });
  }
  return out;
}

/** Color modifier carried by a fillStyleLst entry (solidFill, or approximated from a gradFill's first stop). */
function fillEntryColorMod(entry: { tag: string; node: Record<string, unknown> } | undefined): ColorMod {
  if (!entry) return {};
  if (entry.tag === "a:gradFill") {
    const gsLst = entry.node["a:gsLst"] as Record<string, unknown> | undefined;
    const gsArr = gsLst?.["a:gs"];
    const firstGs = (Array.isArray(gsArr) ? gsArr[0] : gsArr) as Record<string, unknown> | undefined;
    return readColorMod(firstGs?.["a:schemeClr"] as Record<string, unknown> | undefined);
  }
  return readColorMod(entry.node["a:schemeClr"] as Record<string, unknown> | undefined);
}

/** Width + color modifier carried by an lnStyleLst entry (an a:ln node). */
function lnEntryStyle(entry: { tag: string; node: Record<string, unknown> } | undefined): LnStyle {
  if (!entry) return { mod: {} };
  const w = num(entry.node["@_w"]);
  const solid = entry.node["a:solidFill"] as Record<string, unknown> | undefined;
  return {
    widthPx: w > 0 ? clampBorderPx(emuToPx(w)) : undefined,
    mod: readColorMod(solid?.["a:schemeClr"] as Record<string, unknown> | undefined),
  };
}

/**
 * Build a scheme-name → "#rrggbb" map for a slide (the theme's clrScheme
 * dk1/lt1/accent1… plus the master's clrMap aliases tx1→dk1, bg1→lt1, etc., so
 * run colors like schemeClr val="tx1" resolve to real hex), plus the theme's
 * fmtScheme fillStyleLst/lnStyleLst (what Quick Style fillRef/lnRef idx values
 * index into).
 */
function buildColorScheme(files: Record<string, Uint8Array>, slidePath: string): ThemeScheme {
  const scheme: Record<string, string> = {};
  const empty: ThemeScheme = { scheme, fillStyles: [], lnStyles: [], bgFillStyles: [] };
  // Find the master for this slide: slide→layout→master.
  const base = slidePath.split("/").pop()!;
  const sRels = relsFor(files, slidePath.replace(/\/[^/]+$/, ""), base);
  const layoutTarget = [...sRels.values()].find((t) => /slideLayout/.test(t));
  if (!layoutTarget) return empty;
  const layoutName = layoutTarget.split("/").pop()!;
  const lRels = relsFor(files, "ppt/slideLayouts", layoutName);
  const masterTarget = [...lRels.values()].find((t) => /slideMaster/.test(t));
  if (!masterTarget) return empty;
  const masterName = masterTarget.split("/").pop()!;
  const masterXml = findFile(files, "ppt/slideMasters/" + masterName);
  // Theme is referenced from the master's rels.
  const mRels = relsFor(files, "ppt/slideMasters", masterName);
  const themeTarget = [...mRels.values()].find((t) => /theme/.test(t));
  if (!themeTarget) return empty;
  const themeXml = findFile(files, "ppt/theme/" + themeTarget.split("/").pop());
  if (!themeXml) return empty;

  // theme clrScheme: dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink
  const theme = parser.parse(strFromU8(themeXml));
  const cs = collect(theme, "a:clrScheme")[0] as Record<string, unknown> | undefined;
  const base16: Record<string, string> = {};
  if (cs) {
    for (const [k, v] of Object.entries(cs)) {
      if (k.startsWith("@_")) continue;
      // Tag names keep their "a:" prefix (e.g. "a:accent1"), but schemeClr
      // val="accent1" and clrMap's target attributes are unprefixed — strip
      // it so lookups by the plain name actually hit.
      const name = k.replace(/^a:/, "");
      const node = v as Record<string, unknown>;
      const srgb = (node["a:srgbClr"] as Record<string, unknown>)?.["@_val"];
      const sys = (node["a:sysClr"] as Record<string, unknown>)?.["@_lastClr"];
      const hex = (srgb ?? sys) as string | undefined;
      if (typeof hex === "string" && /^[0-9a-fA-F]{6}$/.test(hex)) base16[name] = `#${hex}`;
    }
  }
  Object.assign(scheme, base16);

  // master clrMap aliases the friendly names (tx1, bg1, tx2, bg2) to dk/lt.
  if (masterXml) {
    const master = parser.parse(strFromU8(masterXml));
    const clrMap = collect(master, "p:clrMap")[0] as Record<string, unknown> | undefined;
    if (clrMap) {
      for (const [alias, target] of Object.entries(clrMap)) {
        if (alias.startsWith("@_") === false) continue;
        const a = alias.slice(2); // strip "@_"
        const t = String(target);
        if (base16[t]) scheme[a] = base16[t];
      }
    }
  }
  // Common fallbacks.
  scheme.tx1 ??= base16.dk1 ?? "#000000";
  scheme.bg1 ??= base16.lt1 ?? "#ffffff";

  // fmtScheme's fillStyleLst/lnStyleLst: 3 entries each (subtle/moderate/intense),
  // indexed 1-based by p:style's fillRef/lnRef idx attribute.
  const fmtScheme = collect(theme, "a:fmtScheme")[0] as Record<string, unknown> | undefined;
  const fillStyleLst = fmtScheme?.["a:fillStyleLst"] as Record<string, unknown> | undefined;
  const lnStyleLst = fmtScheme?.["a:lnStyleLst"] as Record<string, unknown> | undefined;
  const bgFillStyleLst = fmtScheme?.["a:bgFillStyleLst"] as Record<string, unknown> | undefined;
  const fillStyles = styleListEntries(fillStyleLst).map(fillEntryColorMod);
  const lnStyles = styleListEntries(lnStyleLst).map(lnEntryStyle);
  const bgFillStyles = styleListEntries(bgFillStyleLst).map(fillEntryColorMod);

  return { scheme, fillStyles, lnStyles, bgFillStyles };
}

/** Read a <p:bg>'s single child from a parsed slide/layout/master doc — either
 * a literal <p:bgPr> or a theme-indexed <p:bgRef> — whichever is present. */
function bgNode(doc: unknown): { kind: "bgPr" | "bgRef"; node: Record<string, unknown> } | undefined {
  const bg = collect(doc, "p:bg")[0] as Record<string, unknown> | undefined;
  if (!bg) return undefined;
  const bgPr = collect(bg, "p:bgPr")[0] as Record<string, unknown> | undefined;
  if (bgPr) return { kind: "bgPr", node: bgPr };
  const bgRef = collect(bg, "p:bgRef")[0] as Record<string, unknown> | undefined;
  if (bgRef) return { kind: "bgRef", node: bgRef };
  return undefined;
}

/**
 * Resolve a <p:bgRef idx="N"> to a color. N in 1-999 indexes the theme's
 * fillStyleLst (Quick Style fills, shared with shape fillRef); N >= 1000
 * indexes bgFillStyleLst (N-1000, 1-based) — the OOXML convention for
 * background-specific Quick Styles. The bgRef's own schemeClr color mod (if
 * it carries one) overrides the style-list entry's mod, matching how a
 * shape's own fillRef schemeClr mod would.
 */
function backgroundFromBgRef(
  bgRef: Record<string, unknown> | undefined,
  scheme: Record<string, string>,
  fillStyles: ColorMod[],
  bgFillStyles: ColorMod[]
): PptxBackground | undefined {
  if (!bgRef) return undefined;
  const idx = num(bgRef["@_idx"]);
  if (idx <= 0) return undefined;
  const listMod = idx >= 1000 ? bgFillStyles[idx - 1000 - 1] : fillStyles[idx - 1];
  const sc = bgRef["a:schemeClr"] as Record<string, unknown> | undefined;
  const name = sc?.["@_val"];
  const base = typeof name === "string" ? scheme[name] : undefined;
  if (!base) return undefined;
  const ownMod = readColorMod(sc);
  const hasOwnMod = (Object.keys(ownMod) as (keyof ColorMod)[]).some((k) => ownMod[k] != null);
  return { color: applyColorMod(base, hasOwnMod ? ownMod : listMod) };
}

/**
 * Resolve a background fill/image from one <p:bgPr> node, given a resolver for
 * that doc's own media relationships. Returns undefined when the node defines
 * nothing usable (no fill, no resolvable image) so the caller can fall through
 * to the next tier of inheritance.
 */
function backgroundFromBgPr(
  bgPr: Record<string, unknown> | undefined,
  scheme: Record<string, string>,
  resolveRelMedia: (relId: string) => { bytes: Uint8Array; ext: string } | undefined
): PptxBackground | undefined {
  if (!bgPr || "a:noFill" in bgPr) return undefined;
  const color = colorFromFill(bgPr, scheme);
  const blipFill = bgPr["a:blipFill"] as Record<string, unknown> | undefined;
  const blip = blipFill ? (collect(blipFill, "a:blip")[0] as Record<string, unknown> | undefined) : undefined;
  const relId = blip ? String(blip["@_r:embed"] ?? "") : "";
  const image = relId ? resolveRelMedia(relId) : undefined;
  if (!color && !image) return undefined;
  return { color, image };
}

/**
 * Resolve a slide's background, walking slide → layout → master (PowerPoint's
 * own inheritance order) and stopping at the first tier that defines anything —
 * mirrors the same walk `layoutInfo()`/`buildColorScheme()` use for every other
 * layout-inherited property, so background doesn't get a different (and
 * inconsistent) resolution path from everything else that inherits this way.
 */
function resolveBackground(
  files: Record<string, Uint8Array>,
  slidePath: string,
  slideDoc: unknown,
  scheme: Record<string, string>,
  fillStyles: ColorMod[],
  bgFillStyles: ColorMod[]
): PptxBackground | undefined {
  const mediaByName = (name: string) => {
    const bytes = findFile(files, "ppt/media/" + name);
    return bytes ? { bytes, ext: (name.split(".").pop() || "png").toLowerCase() } : undefined;
  };
  const backgroundFromTier = (
    doc: unknown,
    resolveRelMedia: (relId: string) => { bytes: Uint8Array; ext: string } | undefined
  ): PptxBackground | undefined => {
    const bg = bgNode(doc);
    if (!bg) return undefined;
    return bg.kind === "bgPr"
      ? backgroundFromBgPr(bg.node, scheme, resolveRelMedia)
      : backgroundFromBgRef(bg.node, scheme, fillStyles, bgFillStyles);
  };

  const base = slidePath.split("/").pop()!;
  const sRels = relsFor(files, slidePath.replace(/\/[^/]+$/, ""), base);
  const slideBg = backgroundFromTier(slideDoc, (relId) => {
    const target = sRels.get(relId);
    return target ? mediaByName(target.split("/").pop()!) : undefined;
  });
  if (slideBg) return slideBg;

  const layoutTarget = [...sRels.values()].find((t) => /slideLayout/.test(t));
  if (!layoutTarget) return undefined;
  const layoutName = layoutTarget.split("/").pop()!;
  const layoutXml = findFile(files, "ppt/slideLayouts/" + layoutName);
  const lRels = relsFor(files, "ppt/slideLayouts", layoutName);
  if (layoutXml) {
    const layoutBg = backgroundFromTier(parser.parse(strFromU8(layoutXml)), (relId) => {
      const target = lRels.get(relId);
      return target ? mediaByName(target.split("/").pop()!) : undefined;
    });
    if (layoutBg) return layoutBg;
  }

  const masterTarget = [...lRels.values()].find((t) => /slideMaster/.test(t));
  if (!masterTarget) return undefined;
  const masterName = masterTarget.split("/").pop()!;
  const masterXml = findFile(files, "ppt/slideMasters/" + masterName);
  if (!masterXml) return undefined;
  const mRels = relsFor(files, "ppt/slideMasters", masterName);
  return backgroundFromTier(parser.parse(strFromU8(masterXml)), (relId) => {
    const target = mRels.get(relId);
    return target ? mediaByName(target.split("/").pop()!) : undefined;
  });
}

/**
 * The slide master's default text styles for title vs body placeholders
 * (p:txStyles → titleStyle/bodyStyle lvl1 defRPr). This is the LOWEST tier of
 * style inheritance — e.g. titles are bold here even when the run/layout don't
 * say so.
 */
function masterTextStyles(
  files: Record<string, Uint8Array>,
  slidePath: string,
  scheme: Record<string, string>
): { title: RunStyle; bodyLevels: RunStyle[] } {
  const empty = { title: {} as RunStyle, bodyLevels: [] as RunStyle[] };
  const base = slidePath.split("/").pop()!;
  const sRels = relsFor(files, slidePath.replace(/\/[^/]+$/, ""), base);
  const layoutTarget = [...sRels.values()].find((t) => /slideLayout/.test(t));
  if (!layoutTarget) return empty;
  const layoutName = layoutTarget.split("/").pop()!;
  const lRels = relsFor(files, "ppt/slideLayouts", layoutName);
  const masterTarget = [...lRels.values()].find((t) => /slideMaster/.test(t));
  if (!masterTarget) return empty;
  const masterXml = findFile(files, "ppt/slideMasters/" + masterTarget.split("/").pop());
  if (!masterXml) return empty;
  const master = parser.parse(strFromU8(masterXml));

  // Build a RunStyle from a specific lvlNpPr node. Bold IS honored here per
  // level — the master bodyStyle encodes which list levels are bold (e.g.
  // lvl1 bold, lvl2 not), which is how decks get mixed bold/non-bold bullets.
  const styleFromLvl = (lvl: Record<string, unknown> | undefined): RunStyle => {
    if (!lvl) return {};
    const defRpr = collect(lvl, "a:defRPr")[0] as Record<string, unknown> | undefined;
    const out: RunStyle = {};
    if (defRpr) {
      const sz = num(defRpr["@_sz"]);
      if (sz > 0) out.fontPt = sz / 100;
      if (defRpr["@_b"] === "1") out.bold = true;
      if (defRpr["@_i"] === "1") out.italic = true;
      if (defRpr["@_u"] !== undefined && defRpr["@_u"] !== "none") out.underline = true;
      const c = colorFromFill(defRpr, scheme);
      if (c) out.color = c;
    }
    const algn = (lvl["@_algn"] ?? "") as string;
    if (algn === "ctr") out.align = "center";
    else if (algn === "r") out.align = "right";
    else if (algn === "l") out.align = "left";
    return out;
  };

  const titleNode = collect(master, "p:titleStyle")[0] as Record<string, unknown> | undefined;
  const title = styleFromLvl((titleNode?.["a:lvl1pPr"] ?? titleNode) as Record<string, unknown> | undefined);

  const bodyNode = collect(master, "p:bodyStyle")[0] as Record<string, unknown> | undefined;
  const bodyLevels: RunStyle[] = [];
  if (bodyNode) {
    for (let i = 1; i <= 9; i++) {
      bodyLevels.push(styleFromLvl(bodyNode[`a:lvl${i}pPr`] as Record<string, unknown> | undefined));
    }
  }
  return { title, bodyLevels };
}

/**
 * List classification for a paragraph at list level `lvl`, from its pPr
 * bullet element (buChar/buAutoNum/buNone). Structured (kind + level) rather
 * than a baked-in glyph, so the editor/renderer can style bullets/numbers
 * itself (see RichTextParagraph.list) instead of matching a literal prefix.
 */
function bulletInfo(
  ppr: Record<string, unknown> | undefined,
  lvl: number
): { kind: "bullet" | "number"; level: number } | undefined {
  // Body placeholders are bulleted by default in PowerPoint — a paragraph
  // with NO pPr at all (the common case; PowerPoint only emits pPr when a
  // paragraph deviates from the level default) is still bulleted. Only an
  // explicit a:buNone suppresses it.
  if (ppr && "a:buNone" in ppr) return undefined;
  const kind = ppr && "a:buAutoNum" in ppr ? "number" : "bullet";
  return { kind, level: Math.max(0, lvl) };
}

/**
 * Read all text from a single a:p (paragraph), concatenating its runs.
 */
function paragraphText(p: Record<string, unknown>): string {
  const runs = collect(p, "a:r") as Record<string, unknown>[];
  let s = "";
  for (const r of runs) {
    const t = r["a:t"];
    if (typeof t === "string") s += t;
    else if (typeof t === "number") s += String(t);
  }
  // A paragraph with no runs but a literal a:t (rare) or just <a:br>.
  if (!s) {
    const t = (p as Record<string, unknown>)["a:t"];
    if (typeof t === "string") s = t;
  }
  return s;
}

/**
 * Build per-paragraph styled lines for a text shape. Each a:p becomes a
 * PptxLine, styled by (in increasing precedence): the master/level default for
 * its list level → this shape's own layout-placeholder override (`layoutStyle`,
 * from the slide layout's own lstStyle — e.g. a layout that right-aligns and
 * recolors its body text) → the paragraph's own pPr/defRPr → the first run's
 * a:rPr. `levelStyles` is `title` for title placeholders, else the body
 * bodyLevels[].
 */
function shapeLines(
  shape: Record<string, unknown>,
  levelStyles: { title: RunStyle; bodyLevels: RunStyle[] },
  isTitle: boolean,
  scheme: Record<string, string>,
  fontScalePct: number,
  isPlaceholder: boolean,
  layoutStyle?: RunStyle
): { lines: PptxLine[]; text: string } {
  const txBody = collect(shape, "p:txBody")[0] as Record<string, unknown> | undefined;
  const paras = collect(txBody ?? shape, "a:p") as Record<string, unknown>[];
  const lines: PptxLine[] = [];

  const applyScale = (pt?: number) =>
    pt != null && fontScalePct > 0 ? (pt * fontScalePct) / 100000 : pt;

  for (const p of paras) {
    const raw = paragraphText(p);
    const ppr = collect(p, "a:pPr")[0] as Record<string, unknown> | undefined;
    const lvl = ppr ? num(ppr["@_lvl"]) : 0;

    // Base style: master level default, then this shape's own layout override.
    let style: RunStyle = isTitle
      ? { ...levelStyles.title }
      : { ...(levelStyles.bodyLevels[lvl] ?? levelStyles.bodyLevels[0] ?? {}) };
    if (layoutStyle) style = { ...style, ...layoutStyle };

    // Paragraph-level defRPr override (endParaRPr / pPr defRPr).
    const pDefRpr = ppr ? (collect(ppr, "a:defRPr")[0] as Record<string, unknown> | undefined) : undefined;
    if (pDefRpr) {
      const sz = num(pDefRpr["@_sz"]);
      if (sz > 0) style.fontPt = sz / 100;
      if (pDefRpr["@_b"] === "1" || pDefRpr["@_b"] === 1) style.bold = true;
      else if (pDefRpr["@_b"] === "0" || pDefRpr["@_b"] === 0) style.bold = false;
      if (pDefRpr["@_i"] === "1" || pDefRpr["@_i"] === 1) style.italic = true;
      if (pDefRpr["@_u"] !== undefined) style.underline = pDefRpr["@_u"] !== "none";
      const c = colorFromFill(pDefRpr, scheme);
      if (c) style.color = c;
    }

    // First run's rPr is the strongest signal for the line's appearance.
    const firstRun = collect(p, "a:r")[0] as Record<string, unknown> | undefined;
    const rpr = firstRun ? (collect(firstRun, "a:rPr")[0] as Record<string, unknown> | undefined) : undefined;
    if (rpr) {
      const sz = num(rpr["@_sz"]);
      if (sz > 0) style.fontPt = sz / 100;
      if (rpr["@_b"] === "1" || rpr["@_b"] === 1) style.bold = true;
      else if (rpr["@_b"] === "0" || rpr["@_b"] === 0) style.bold = false;
      if (rpr["@_i"] === "1" || rpr["@_i"] === 1) style.italic = true;
      if (rpr["@_u"] !== undefined) style.underline = rpr["@_u"] !== "none";
      const c = colorFromFill(rpr, scheme);
      if (c) style.color = c;
    }

    // Paragraph alignment overrides level default.
    const algn = ppr?.["@_algn"];
    if (algn === "ctr") style.align = "center";
    else if (algn === "r") style.align = "right";
    else if (algn === "l") style.align = "left";

    style.fontPt = style.fontPt != null ? clampFontPt(applyScale(style.fontPt)!) : undefined;

    // List classification for non-title body paragraphs, but only when the
    // shape is a real placeholder/list body — plain autoshapes (diagram box
    // labels etc.) never had bullets in PowerPoint.
    const list = !isTitle && isPlaceholder && raw.trim() ? bulletInfo(ppr, lvl) : undefined;
    lines.push({
      text: raw,
      list,
      fontPt: style.fontPt,
      color: style.color,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      align: style.align,
    });
  }

  // Drop trailing fully-empty lines.
  while (lines.length && !lines[lines.length - 1].text.trim()) lines.pop();
  const text = lines.map((l) => l.text).join("\n");
  return { lines, text };
}

function findFile(files: Record<string, Uint8Array>, path: string): Uint8Array | undefined {
  return files[path] ?? files[path.replace(/^\/+/, "")];
}

/** Parse slide order from presentation.xml + the rels mapping rId → slide path. */
function slideOrder(files: Record<string, Uint8Array>): string[] {
  const presXml = findFile(files, "ppt/presentation.xml");
  const relsXml = findFile(files, "ppt/_rels/presentation.xml.rels");
  if (!presXml || !relsXml) {
    // Fallback: any slideN.xml in numeric order.
    return Object.keys(files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => num(a.match(/(\d+)/)?.[1]) - num(b.match(/(\d+)/)?.[1]));
  }
  const rels = parser.parse(strFromU8(relsXml));
  const relList = collect(rels, "Relationship") as Record<string, unknown>[];
  const idToTarget = new Map<string, string>();
  for (const r of relList) {
    idToTarget.set(String(r["@_Id"]), String(r["@_Target"]));
  }
  const pres = parser.parse(strFromU8(presXml));
  const ids = collect(pres, "p:sldId") as Record<string, unknown>[];
  const paths: string[] = [];
  for (const s of ids) {
    const rid = String(s["@_r:id"]);
    const target = idToTarget.get(rid);
    if (target) paths.push("ppt/" + target.replace(/^\/?ppt\//, "").replace(/^\.\.\//, ""));
  }
  return paths;
}

/** Map a slide's relationship ids to media file paths. */
function slideRels(files: Record<string, Uint8Array>, slidePath: string): Map<string, string> {
  const base = slidePath.split("/").pop()!;
  const relsPath = slidePath.replace(/[^/]+$/, "") + "_rels/" + base + ".rels";
  const relsXml = findFile(files, relsPath);
  const map = new Map<string, string>();
  if (!relsXml) return map;
  const rels = parser.parse(strFromU8(relsXml));
  for (const r of collect(rels, "Relationship") as Record<string, unknown>[]) {
    map.set(String(r["@_Id"]), String(r["@_Target"]));
  }
  return map;
}

/** Resolve a slide-relative media target to a normalized zip path. */
function resolveMedia(target: string): string {
  // targets look like "../media/image1.png"
  return ("ppt/slides/" + target).replace(/\/[^/]+\/\.\.\//g, "/");
}

/** Read a layout/master's rels (rId → media path) given its filename. */
function relsFor(files: Record<string, Uint8Array>, dir: string, name: string): Map<string, string> {
  const map = new Map<string, string>();
  const xml = findFile(files, `${dir}/_rels/${name}.rels`);
  if (!xml) return map;
  const rels = parser.parse(strFromU8(xml));
  for (const r of collect(rels, "Relationship") as Record<string, unknown>[]) {
    map.set(String(r["@_Id"]), String(r["@_Target"]));
  }
  return map;
}

export function parsePptx(buf: Uint8Array): ParsedDeck {
  const files = unzipSync(buf);

  // Slide size from presentation.xml.
  let slideW = 1280;
  let slideH = 720;
  const presXml = findFile(files, "ppt/presentation.xml");
  if (presXml) {
    const pres = parser.parse(strFromU8(presXml));
    const sz = collect(pres, "p:sldSz")[0] as Record<string, unknown> | undefined;
    if (sz) {
      // posNum: a corrupt/missing cx/cy would otherwise zero out the slide
      // size, which cascades into zero/negative fallback-rect widths below.
      slideW = posNum(emuToPx(num(sz["@_cx"])), slideW);
      slideH = posNum(emuToPx(num(sz["@_cy"])), slideH);
    }
  }

  const order = slideOrder(files);
  const slides: ParsedSlide[] = [];

  for (const slidePath of order) {
    const xml = findFile(files, slidePath);
    if (!xml) continue;
    const doc = parser.parse(strFromU8(xml));
    const rels = slideRels(files, slidePath);
    const { scheme, fillStyles, lnStyles, bgFillStyles } = buildColorScheme(files, slidePath);
    const masterStyles = masterTextStyles(files, slidePath, scheme);
    const info = layoutInfo(files, slidePath, scheme);

    const images: PptxImage[] = [];

    // Layout/master pictures FIRST (logos/banners) so they sit behind content.
    for (const lp of info.pics) {
      // The pic's relId resolves against its source (layout or master) rels.
      const dir = lp.layoutName.includes("Master") || lp.layoutName.startsWith("slideMaster")
        ? "ppt/slideMasters" : "ppt/slideLayouts";
      const target = relsFor(files, dir, lp.layoutName).get(lp.relId);
      if (!target) continue;
      const name = target.split("/").pop()!;
      const bytes = findFile(files, "ppt/media/" + name);
      if (!bytes) continue;
      images.push({ ...lp.rect, bytes, ext: (name.split(".").pop() || "png").toLowerCase() });
    }

    const spTree = collectSpTree(doc);

    const texts: PptxText[] = [];
    for (const { shape: sp, transform } of spTree.shapes) {
      const rect = resolveRectWithTransform(sp, info.rects, transform);
      const ph = placeholderKey(sp);
      const isTitle = ph?.type === "title" || ph?.type === "ctrTitle";
      // Apply autofit shrink: <a:normAutofit fontScale="62500"> = 62.5% of nominal.
      const naf = collect(sp, "a:normAutofit")[0] as Record<string, unknown> | undefined;
      const scalePct = naf ? num(naf["@_fontScale"]) : 0;
      const { lines, text } = shapeLines(sp, masterStyles, !!isTitle, scheme, scalePct, !!ph, phLookup(info.styles, ph));
      const boxStyle = shapeFillAndLine(sp, scheme, fillStyles, lnStyles);
      // A shape with no text and no fill/border is invisible — nothing to
      // carry into the deck. But a shape with a literal fill/outline and NO
      // text (a plain decorative box, common in diagrams) still needs to
      // become an element or its color/outline is lost entirely.
      if (!text.trim() && !boxStyle.fill && !boxStyle.borderColor) continue;
      // Fallback geometry so placeholder text is never lost.
      const finalRect = rect ?? { x: emuToPx(457200), y: texts.length === 0 ? emuToPx(274638) : emuToPx(1600200), width: posNum(slideW - emuToPx(914400), slideW), height: emuToPx(800100) };
      // Box-level fallback style = first non-empty line's style.
      const head = lines.find((l) => l.text.trim()) ?? lines[0];
      texts.push({
        ...finalRect,
        text,
        lines,
        fontPt: head?.fontPt,
        color: head?.color,
        bold: head?.bold,
        italic: head?.italic,
        underline: head?.underline,
        align: head?.align,
        fill: boxStyle.fill,
        borderColor: boxStyle.borderColor,
        borderWidth: boxStyle.borderWidth,
      });
    }

    // Slide's own pictures on top of branding.
    for (const { shape: pic, transform } of spTree.pics) {
      const rect = resolveRectWithTransform(pic, info.rects, transform);
      const blip = collect(pic, "a:blip")[0] as Record<string, unknown> | undefined;
      const embed = blip ? String(blip["@_r:embed"]) : "";
      const target = rels.get(embed);
      if (!rect || !target) continue;
      const mediaPath = resolveMedia(target);
      const bytes = findFile(files, mediaPath) ?? findFile(files, "ppt/media/" + target.split("/").pop());
      if (!bytes) continue;
      const ext = (target.split(".").pop() || "png").toLowerCase();
      const picStyle = shapeFillAndLine(pic, scheme, fillStyles, lnStyles);
      const crop = imageCrop(pic);
      images.push({
        ...rect, bytes, ext,
        borderColor: picStyle.borderColor,
        borderWidth: picStyle.borderWidth,
        ...(crop ? { crop } : {}),
      });
    }

    const tables: PptxTable[] = [];
    for (const gf of collect(doc, "p:graphicFrame") as Record<string, unknown>[]) {
      if (graphicFrameKind(gf) !== "table") continue;
      const table = parseTable(gf, scheme, files);
      if (table) tables.push(table);
    }

    const connectors: PptxConnector[] = [];
    for (const { shape: cxn, transform } of spTree.connectors) {
      const connector = parseConnector(cxn, transform, info.rects, scheme, fillStyles, lnStyles);
      if (connector) connectors.push(connector);
    }

    const background = resolveBackground(files, slidePath, doc, scheme, fillStyles, bgFillStyles);

    warnUnsupportedContent(doc, slides.length + 1);
    slides.push({ texts, images, tables, connectors, ...(background ? { background } : {}) });
  }

  return { slideW, slideH, slides };
}

/** Best-effort label for a skipped p:graphicFrame (table/chart/SmartArt all
 * use this tag, distinguished by their inner graphic type). */
function graphicFrameKind(gf: Record<string, unknown>): string {
  if (collect(gf, "a:tbl").length) return "table";
  const graphicData = collect(gf, "a:graphicData")[0] as Record<string, unknown> | undefined;
  const uri = graphicData ? String(graphicData["@_uri"] ?? "") : "";
  if (uri.includes("chart")) return "chart";
  if (uri.includes("diagram")) return "SmartArt diagram";
  return "unsupported graphic frame";
}

/**
 * A graphicFrame's own position, from its <p:xfrm> (note: "p:" prefixed, not
 * the "a:xfrm" shapes use — same a:off/a:ext children though).
 */
function graphicFrameRect(gf: Record<string, unknown>): { x: number; y: number; width: number; height: number } | null {
  const xf = collect(gf, "p:xfrm")[0] as Record<string, unknown> | undefined;
  if (!xf) return null;
  const off = xf["a:off"] as Record<string, unknown> | undefined;
  const ext = xf["a:ext"] as Record<string, unknown> | undefined;
  if (!off || !ext) return null;
  const width = emuToPx(num(ext["@_cx"]));
  const height = emuToPx(num(ext["@_cy"]));
  if (width <= 0 || height <= 0) return null;
  return { x: emuToPx(num(off["@_x"])), y: emuToPx(num(off["@_y"])), width, height };
}

/** A table cell's border color+width, approximated from whichever of its
 * lnL/lnR/lnT/lnB (left/right/top/bottom line) is present first — good enough
 * given this project's "approximate fidelity" bar for a uniform grid look. */
function cellBorder(tcPr: Record<string, unknown> | undefined, scheme: Record<string, string>): { color?: string; width?: number } {
  if (!tcPr) return {};
  for (const key of ["a:lnL", "a:lnR", "a:lnT", "a:lnB"]) {
    const ln = tcPr[key] as Record<string, unknown> | undefined;
    if (!ln || "a:noFill" in ln) continue;
    const color = colorFromFill(ln, scheme);
    if (color) {
      const w = num(ln["@_w"]);
      return { color, width: w > 0 ? clampBorderPx(emuToPx(w)) : 1 };
    }
  }
  return {};
}

/** One table-style "part" (wholeTbl/firstRow/band1H/etc.) resolved to concrete
 * fill/color/bold values against the slide's theme scheme. */
interface TableStylePart {
  fill?: string;
  color?: string;
  bold?: boolean;
}

/** Resolve a table-style part node (a:wholeTbl, a:firstRow, ...): its
 * a:tcStyle > a:fill > a:solidFill for cell fill, and a:tcTxStyle for text
 * color/bold. */
function tableStylePart(node: Record<string, unknown> | undefined, scheme: Record<string, string>): TableStylePart {
  const out: TableStylePart = {};
  if (!node) return out;
  const tcStyle = node["a:tcStyle"] as Record<string, unknown> | undefined;
  const solid = (tcStyle?.["a:fill"] as Record<string, unknown> | undefined)?.["a:solidFill"] as
    | Record<string, unknown>
    | undefined;
  if (solid) {
    const sc = solid["a:schemeClr"] as Record<string, unknown> | undefined;
    const name = sc?.["@_val"];
    const base = typeof name === "string" ? scheme[name] : undefined;
    if (base) out.fill = applyColorMod(base, readColorMod(sc));
    else {
      const srgb = solid["a:srgbClr"] as Record<string, unknown> | undefined;
      const v = srgb?.["@_val"];
      if (typeof v === "string") out.fill = `#${v}`;
    }
  }
  const tcTxStyle = node["a:tcTxStyle"] as Record<string, unknown> | undefined;
  if (tcTxStyle) {
    const b = tcTxStyle["@_b"];
    if (b === "on" || b === "1") out.bold = true;
    const sc = tcTxStyle["a:schemeClr"] as Record<string, unknown> | undefined;
    const name = sc?.["@_val"];
    const base = typeof name === "string" ? scheme[name] : undefined;
    if (base) out.color = applyColorMod(base, readColorMod(sc));
  }
  return out;
}

/** A table's resolved style parts, loaded from ppt/tableStyles.xml by the
 * GUID a table's own a:tblPr > a:tableStyleId references. */
interface TableStyle {
  wholeTbl: TableStylePart;
  band1H: TableStylePart;
  band2H: TableStylePart;
  firstRow: TableStylePart;
  lastRow: TableStylePart;
  firstCol: TableStylePart;
  lastCol: TableStylePart;
}

/** Load ppt/tableStyles.xml and resolve the a:tblStyle matching `styleId`, or
 * null if the deck has no table-styles part or no matching style (e.g. a
 * "No Style" table, which relies solely on literal per-cell a:tcPr). */
function loadTableStyle(files: Record<string, Uint8Array>, styleId: string, scheme: Record<string, string>): TableStyle | null {
  const xml = findFile(files, "ppt/tableStyles.xml");
  if (!xml) return null;
  const doc = parser.parse(strFromU8(xml));
  const styles = collect(doc, "a:tblStyle") as Record<string, unknown>[];
  const match = styles.find((s) => s["@_styleId"] === styleId);
  if (!match) return null;
  const part = (tag: string) => tableStylePart(match[tag] as Record<string, unknown> | undefined, scheme);
  return {
    wholeTbl: part("a:wholeTbl"),
    band1H: part("a:band1H"),
    band2H: part("a:band2H"),
    firstRow: part("a:firstRow"),
    lastRow: part("a:lastRow"),
    firstCol: part("a:firstCol"),
    lastCol: part("a:lastCol"),
  };
}

/** Parse a <p:graphicFrame> containing <a:tbl> into a PptxTable, or null if
 * it has no usable position/grid. */
function parseTable(gf: Record<string, unknown>, scheme: Record<string, string>, files: Record<string, Uint8Array>): PptxTable | null {
  const rect = graphicFrameRect(gf);
  const tbl = collect(gf, "a:tbl")[0] as Record<string, unknown> | undefined;
  if (!rect || !tbl) return null;

  const tblGrid = collect(tbl, "a:tblGrid")[0] as Record<string, unknown> | undefined;
  const gridCols = (tblGrid ? collect(tblGrid, "a:gridCol") : []) as Record<string, unknown>[];
  const colWidths = gridCols.map((c) => emuToPx(num(c["@_w"])));

  const rows = collect(tbl, "a:tr") as Record<string, unknown>[];
  const rowHeights = rows.map((r) => emuToPx(num(r["@_h"])));

  // Most real-world tables carry no literal per-cell styling at all — they
  // rely entirely on a Quick Style (tblPr > tableStyleId, resolved against
  // ppt/tableStyles.xml) plus firstRow/bandRow flags for header + banding.
  const tblPr = (collect(tbl, "a:tblPr")[0] as Record<string, unknown> | undefined) ?? {};
  const flagOn = (attr: string) => {
    const v = tblPr[`@_${attr}`];
    return v === "1" || v === 1;
  };
  const firstRowOn = flagOn("firstRow");
  const lastRowOn = flagOn("lastRow");
  const firstColOn = flagOn("firstCol");
  const lastColOn = flagOn("lastCol");
  const bandRowOn = flagOn("bandRow");
  const styleId = tblPr["a:tableStyleId"];
  const tableStyle = typeof styleId === "string" ? loadTableStyle(files, styleId, scheme) : null;

  let borderColor: string | undefined;
  let borderWidth: number | undefined;

  const cells: (PptxTableCell | null)[][] = rows.map((row, r) => {
    const tcs = collect(row, "a:tc") as Record<string, unknown>[];
    return tcs.map((tc, c) => {
      // hMerge/vMerge cells are continuations of a merge to their left/above —
      // not an anchor cell, so they contribute nothing of their own.
      if ("@_hMerge" in tc || "@_vMerge" in tc) return null;
      const { lines, text } = shapeLines(tc, { title: {}, bodyLevels: [] }, false, scheme, 0, false);
      const tcPr = collect(tc, "a:tcPr")[0] as Record<string, unknown> | undefined;
      const fill = tcPr ? colorFromFill(tcPr, scheme) : undefined;
      const border = cellBorder(tcPr, scheme);
      if (border.color && !borderColor) {
        borderColor = border.color;
        borderWidth = border.width;
      }
      const head = lines.find((l) => l.text.trim()) ?? lines[0];

      // Style-part precedence (low → high): whole table, row banding,
      // first/last column, first/last row — matching PowerPoint's own layering.
      let styled: TableStylePart = tableStyle?.wholeTbl ?? {};
      if (tableStyle && bandRowOn) {
        const bodyIdx = r - (firstRowOn ? 1 : 0);
        if (bodyIdx >= 0) styled = { ...styled, ...(bodyIdx % 2 === 0 ? tableStyle.band1H : tableStyle.band2H) };
      }
      if (tableStyle && firstColOn && c === 0) styled = { ...styled, ...tableStyle.firstCol };
      if (tableStyle && lastColOn && c === tcs.length - 1) styled = { ...styled, ...tableStyle.lastCol };
      if (tableStyle && firstRowOn && r === 0) styled = { ...styled, ...tableStyle.firstRow };
      if (tableStyle && lastRowOn && r === rows.length - 1) styled = { ...styled, ...tableStyle.lastRow };

      const colSpan = num(tc["@_gridSpan"]);
      const rowSpan = num(tc["@_rowSpan"]);
      return {
        text,
        fill: fill ?? styled.fill,
        color: head?.color ?? styled.color,
        bold: head?.bold ?? styled.bold,
        align: head?.align,
        ...(colSpan > 1 ? { colSpan } : {}),
        ...(rowSpan > 1 ? { rowSpan } : {}),
      };
    });
  });

  return { ...rect, colWidths, rowHeights, cells, borderColor, borderWidth };
}

/**
 * Log what this slide's content the parser can't represent, so a thin deck
 * isn't a silent mystery — text/pictures are the only content types handled
 * above; everything here is dropped rather than approximated. Dev-facing only
 * (console.warn); a user-facing summary is a separate, deferred feature.
 */
function warnUnsupportedContent(doc: unknown, slideNum: number): void {
  const graphicFrames = collect(doc, "p:graphicFrame") as Record<string, unknown>[];
  for (const kind of new Set(graphicFrames.map(graphicFrameKind))) {
    if (kind === "table") continue; // tables are imported now, not skipped
    const count = graphicFrames.filter((gf) => graphicFrameKind(gf) === kind).length;
    console.warn(`[pptx import] Slide ${slideNum}: skipped ${count} ${kind}${count > 1 ? "s" : ""} (unsupported).`);
  }
  const videoRefs = collect(doc, "a:videoFile");
  if (videoRefs.length) {
    console.warn(`[pptx import] Slide ${slideNum}: ${videoRefs.length} video(s) imported as a static poster image only — playback isn't supported.`);
  }
  const audioRefs = collect(doc, "a:audioFile");
  if (audioRefs.length) {
    console.warn(`[pptx import] Slide ${slideNum}: skipped ${audioRefs.length} audio clip(s) (unsupported).`);
  }
  if (collect(doc, "p:timing").length) {
    console.warn(`[pptx import] Slide ${slideNum}: skipped animation/timing data (unsupported).`);
  }
}
