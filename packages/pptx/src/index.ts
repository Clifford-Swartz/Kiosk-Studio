import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

/**
 * Minimal PowerPoint (.pptx) parser → editable scene data. A .pptx is a ZIP of
 * OpenXML. We extract, per slide, text boxes and pictures with their
 * position/size (converted from EMU to px at 96 DPI). Pure & Node-only; returns
 * image bytes for the caller to persist. Approximate fidelity: text + pictures
 * only (no shapes/tables/charts/animations).
 */

const EMU_PER_PX = 914400 / 96; // 9525

/** One paragraph (line) of a text box, with its own resolved style. */
export interface PptxLine {
  text: string;       // includes bullet prefix/indent if bulleted
  fontPt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
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
  align?: "left" | "center" | "right";
}
export interface PptxImage {
  x: number; y: number; width: number; height: number;
  bytes: Uint8Array;
  ext: string; // e.g. "png", "jpg"
}
export interface ParsedSlide {
  texts: PptxText[];
  images: PptxImage[];
}
export interface ParsedDeck {
  slideW: number; // px
  slideH: number; // px
  slides: ParsedSlide[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep arrays predictable for repeated nodes we walk.
  isArray: (name) => ["p:sp", "p:pic", "a:p", "a:r", "p:sldId"].includes(name),
});

function emuToPx(emu: number): number {
  return Math.round(emu / EMU_PER_PX);
}
function num(v: unknown): number {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
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

/** Extract { x, y, w, h } from a shape's a:xfrm (EMU → px), or null. */
function xfrmRect(shape: Record<string, unknown>): { x: number; y: number; width: number; height: number } | null {
  const xfrms = collect(shape, "a:xfrm");
  const xf = xfrms[0] as Record<string, unknown> | undefined;
  if (!xf) return null;
  const off = xf["a:off"] as Record<string, unknown> | undefined;
  const ext = xf["a:ext"] as Record<string, unknown> | undefined;
  if (!off || !ext) return null;
  return {
    x: emuToPx(num(off["@_x"])),
    y: emuToPx(num(off["@_y"])),
    width: emuToPx(num(ext["@_cx"])),
    height: emuToPx(num(ext["@_cy"])),
  };
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
    // Pictures on the layout/master = branding (logos, banners).
    for (const pic of collect(doc, "p:pic") as Record<string, unknown>[]) {
      const rect = xfrmRect(pic);
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

/** Resolve a shape's rect: its own a:xfrm, else the layout placeholder's. */
function resolveRect(shape: Record<string, unknown>, rects: Map<string, Rect>): Rect | null {
  return xfrmRect(shape) ?? phLookup(rects, placeholderKey(shape)) ?? null;
}

interface RunStyle {
  fontPt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
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

/**
 * Build a scheme-name → "#rrggbb" map for a slide: the theme's clrScheme
 * (dk1/lt1/accent1…) plus the master's clrMap aliases (tx1→dk1, bg1→lt1, etc.)
 * so run colors like schemeClr val="tx1" resolve to real hex.
 */
function buildColorScheme(files: Record<string, Uint8Array>, slidePath: string): Record<string, string> {
  const scheme: Record<string, string> = {};
  // Find the master for this slide: slide→layout→master.
  const base = slidePath.split("/").pop()!;
  const sRels = relsFor(files, slidePath.replace(/\/[^/]+$/, ""), base);
  const layoutTarget = [...sRels.values()].find((t) => /slideLayout/.test(t));
  if (!layoutTarget) return scheme;
  const layoutName = layoutTarget.split("/").pop()!;
  const lRels = relsFor(files, "ppt/slideLayouts", layoutName);
  const masterTarget = [...lRels.values()].find((t) => /slideMaster/.test(t));
  if (!masterTarget) return scheme;
  const masterName = masterTarget.split("/").pop()!;
  const masterXml = findFile(files, "ppt/slideMasters/" + masterName);
  // Theme is referenced from the master's rels.
  const mRels = relsFor(files, "ppt/slideMasters", masterName);
  const themeTarget = [...mRels.values()].find((t) => /theme/.test(t));
  if (!themeTarget) return scheme;
  const themeXml = findFile(files, "ppt/theme/" + themeTarget.split("/").pop());
  if (!themeXml) return scheme;

  // theme clrScheme: dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink
  const theme = parser.parse(strFromU8(themeXml));
  const cs = collect(theme, "a:clrScheme")[0] as Record<string, unknown> | undefined;
  const base16: Record<string, string> = {};
  if (cs) {
    for (const [k, v] of Object.entries(cs)) {
      if (k.startsWith("@_")) continue;
      const node = v as Record<string, unknown>;
      const srgb = (node["a:srgbClr"] as Record<string, unknown>)?.["@_val"];
      const sys = (node["a:sysClr"] as Record<string, unknown>)?.["@_lastClr"];
      const hex = (srgb ?? sys) as string | undefined;
      if (typeof hex === "string" && /^[0-9a-fA-F]{6}$/.test(hex)) base16[k] = `#${hex}`;
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
  return scheme;
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
 * Bullet prefix for a paragraph at list level `lvl`. PowerPoint encodes bullets
 * in pPr (buChar/buAutoNum/buNone); we approximate with a simple glyph + indent
 * by level so the imported text reads like a bulleted list. A paragraph with an
 * explicit a:buNone gets no prefix.
 */
function bulletPrefix(ppr: Record<string, unknown> | undefined, lvl: number): string {
  if (!ppr) return "";
  if ("a:buNone" in ppr) return "";
  const hasBullet = "a:buChar" in ppr || "a:buAutoNum" in ppr;
  // Heuristic: body placeholders are bulleted by default; only suppress when
  // buNone is present. Indent two spaces per level.
  const indent = "  ".repeat(Math.max(0, lvl));
  const glyph = lvl > 0 ? "◦ " : "• ";
  // If no explicit bullet props, still bullet body text (master defines bullets
  // at the list-style level we don't fully parse) — caller decides via `bulleted`.
  void hasBullet;
  return indent + glyph;
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
 * its list level → the paragraph's own pPr/defRPr → the first run's a:rPr.
 * `levelStyles` is `title` for title placeholders, else the body bodyLevels[].
 */
function shapeLines(
  shape: Record<string, unknown>,
  levelStyles: { title: RunStyle; bodyLevels: RunStyle[] },
  isTitle: boolean,
  scheme: Record<string, string>,
  fontScalePct: number
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

    // Base style: master level default.
    let style: RunStyle = isTitle
      ? { ...levelStyles.title }
      : { ...(levelStyles.bodyLevels[lvl] ?? levelStyles.bodyLevels[0] ?? {}) };

    // Paragraph-level defRPr override (endParaRPr / pPr defRPr).
    const pDefRpr = ppr ? (collect(ppr, "a:defRPr")[0] as Record<string, unknown> | undefined) : undefined;
    if (pDefRpr) {
      const sz = num(pDefRpr["@_sz"]);
      if (sz > 0) style.fontPt = sz / 100;
      if (pDefRpr["@_b"] === "1" || pDefRpr["@_b"] === 1) style.bold = true;
      else if (pDefRpr["@_b"] === "0" || pDefRpr["@_b"] === 0) style.bold = false;
      if (pDefRpr["@_i"] === "1" || pDefRpr["@_i"] === 1) style.italic = true;
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
      const c = colorFromFill(rpr, scheme);
      if (c) style.color = c;
    }

    // Paragraph alignment overrides level default.
    const algn = ppr?.["@_algn"];
    if (algn === "ctr") style.align = "center";
    else if (algn === "r") style.align = "right";
    else if (algn === "l") style.align = "left";

    style.fontPt = applyScale(style.fontPt);

    // Compose the visible text: bullet prefix for non-title body paragraphs.
    let prefix = "";
    if (!isTitle && raw.trim()) {
      prefix = bulletPrefix(ppr, lvl);
    }
    lines.push({
      text: prefix + raw,
      fontPt: style.fontPt,
      color: style.color,
      bold: style.bold,
      italic: style.italic,
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
      slideW = emuToPx(num(sz["@_cx"]));
      slideH = emuToPx(num(sz["@_cy"]));
    }
  }

  const order = slideOrder(files);
  const slides: ParsedSlide[] = [];

  for (const slidePath of order) {
    const xml = findFile(files, slidePath);
    if (!xml) continue;
    const doc = parser.parse(strFromU8(xml));
    const rels = slideRels(files, slidePath);
    const scheme = buildColorScheme(files, slidePath);
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

    const texts: PptxText[] = [];
    for (const sp of collect(doc, "p:sp") as Record<string, unknown>[]) {
      const rect = resolveRect(sp, info.rects);
      const ph = placeholderKey(sp);
      const isTitle = ph?.type === "title" || ph?.type === "ctrTitle";
      // Apply autofit shrink: <a:normAutofit fontScale="62500"> = 62.5% of nominal.
      const naf = collect(sp, "a:normAutofit")[0] as Record<string, unknown> | undefined;
      const scalePct = naf ? num(naf["@_fontScale"]) : 0;
      const { lines, text } = shapeLines(sp, masterStyles, !!isTitle, scheme, scalePct);
      if (!text.trim()) continue;
      // Fallback geometry so placeholder text is never lost.
      const finalRect = rect ?? { x: emuToPx(457200), y: texts.length === 0 ? emuToPx(274638) : emuToPx(1600200), width: slideW - emuToPx(914400), height: emuToPx(800100) };
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
        align: head?.align,
      });
    }

    // Slide's own pictures on top of branding.
    for (const pic of collect(doc, "p:pic") as Record<string, unknown>[]) {
      const rect = resolveRect(pic, info.rects);
      const blip = collect(pic, "a:blip")[0] as Record<string, unknown> | undefined;
      const embed = blip ? String(blip["@_r:embed"]) : "";
      const target = rels.get(embed);
      if (!rect || !target) continue;
      const mediaPath = resolveMedia(target);
      const bytes = findFile(files, mediaPath) ?? findFile(files, "ppt/media/" + target.split("/").pop());
      if (!bytes) continue;
      const ext = (target.split(".").pop() || "png").toLowerCase();
      images.push({ ...rect, bytes, ext });
    }

    slides.push({ texts, images });
  }

  return { slideW, slideH, slides };
}
