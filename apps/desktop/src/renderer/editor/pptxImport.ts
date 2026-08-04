import { createElement, createProject, createScene, newId, type Project, type RichTextDoc } from "@kiosk/engine";
import type { ParsedDeckWire } from "@kiosk/pptx";
import { ensureProjectSaved } from "./assets.js";

/**
 * Build a Kiosk Studio project from a parsed PowerPoint deck. Each slide → a
 * scene; texts → text elements, images → image elements (written into the
 * project's assets/), all scaled from slide px to the project canvas. Adds
 * invisible left/right edge tap zones that navigate prev/next (goToScene).
 *
 * `ParsedDeckWire` is the single source of truth for this shape (defined in
 * @kiosk/pptx, alongside the IPC handler that produces it) — don't
 * re-declare it here, the two copies will drift.
 */
export type ParsedDeck = ParsedDeckWire;

/** Target canvas: keep the slide aspect, normalize to ~1920 wide. */
function targetSize(slideW: number, slideH: number): { w: number; h: number; scale: number } {
  const w = 1920;
  const scale = w / (slideW || 1280);
  return { w, h: Math.round((slideH || 720) * scale), scale };
}

/**
 * Import a deck into a new project. Images are written to assets/ (requires a
 * project save location — ensureProjectSaved handles prompting/auto-workspace).
 * Returns { project, projectPath } so the caller can load it WITH that path
 * (so assetBaseUrl resolves and the logos/images render), or null if canceled.
 */
export async function buildProjectFromDeck(
  deck: ParsedDeck
): Promise<{ project: Project; projectPath: string } | null> {
  const { w, h, scale } = targetSize(deck.slideW, deck.slideH);

  // Images need a home (assets/), which requires a save location. ensureProjectSaved
  // establishes one (auto-workspace or prompt); we write assets next to it.
  const projectPath = await ensureProjectSaved();
  if (!projectPath) return null;

  const px = (v: number) => Math.round(v * scale);

  const scenes = await Promise.all(
    deck.slides.map(async (slide, i) => {
      const elements = [];

      // Background image (from theme/layout/master or the slide itself) sits
      // behind everything else — laid down first so its zIndex is lowest.
      if (slide.background?.image) {
        try {
          const rel = await window.kiosk.saveAsset(
            projectPath,
            `slide${i + 1}-bg.${slide.background.image.ext}`,
            slide.background.image.base64
          );
          elements.push(
            createElement("image", {
              x: 0, y: 0, width: w, height: h,
              zIndex: 0,
              props: { src: rel, fit: "cover" },
            })
          );
        } catch (err) {
          console.warn(`[pptx import] Skipped background image on slide ${i + 1}:`, err);
        }
      }

      for (const t of slide.texts) {
        // pt → px (×1.333) then scale to canvas.
        const toPx = (pt?: number) => Math.round((pt ?? 18) * 1.333 * scale);
        // One paragraph per PptxLine, each a single span carrying that line's
        // resolved style — preserves mixed styling (e.g. bold lvl-0 bullets,
        // non-bold sub-bullets) that a single box style can't represent, and
        // carries list metadata straight through to RichTextParagraph.list.
        const paragraphs = (t.lines ?? []).map((l) => ({
          spans: [
            {
              text: l.text,
              bold: l.bold || undefined,
              italic: l.italic || undefined,
              underline: l.underline || undefined,
              color: l.color ?? t.color ?? "#0f172a",
            },
          ],
          align: l.align ?? t.align ?? "left",
          fontSize: toPx(l.fontPt),
          ...(l.list ? { list: l.list } : {}),
        }));
        const content: RichTextDoc = {
          version: 1,
          paragraphs: paragraphs.length ? paragraphs : [{ spans: [{ text: t.text }] }],
        };
        elements.push(
          createElement("text", {
            x: px(t.x), y: px(t.y), width: px(t.width), height: px(t.height),
            zIndex: elements.length + 1,
            props: {
              text: t.text,
              content,
              color: t.color ?? "#0f172a",
              fontSize: toPx(t.fontPt),
              fontWeight: t.bold ? "700" : "normal",
              align: t.align ?? "left",
              ...(t.italic ? { fontStyle: "italic" } : {}),
              ...(t.underline ? { textDecoration: "underline" } : {}),
              // Box-level fill/outline, same props.fill/props.border convention
              // rectangle elements use (see ElementRenderer.tsx).
              ...(t.fill ? { fill: t.fill } : {}),
              ...(t.borderColor ? { border: `${t.borderWidth ?? 1}px solid ${t.borderColor}` } : {}),
            },
          })
        );
      }

      for (const [imIndex, im] of slide.images.entries()) {
        // Persist the image into the project's assets/ and reference it. One
        // failed write (disk full, bad bytes, etc.) shouldn't abort the whole
        // import — skip just this image and keep the rest of the slide.
        try {
          const rel = await window.kiosk.saveAsset(projectPath, `slide${i + 1}-${imIndex + 1}.${im.ext}`, im.base64);
          elements.push(
            createElement("image", {
              x: px(im.x), y: px(im.y), width: px(im.width), height: px(im.height),
              zIndex: elements.length + 1,
              props: {
                src: rel,
                // PowerPoint stretches a picture to fill its shape's box by
                // default ("contain" was introducing letterboxing PowerPoint
                // never shows); a real crop (below) supersedes this anyway.
                fit: "fill",
                ...(im.crop ? { crop: im.crop } : {}),
                ...(im.borderColor ? { border: `${im.borderWidth ?? 1}px solid ${im.borderColor}` } : {}),
              },
            })
          );
        } catch (err) {
          console.warn(`[pptx import] Skipped image ${imIndex + 1} on slide ${i + 1}:`, err);
        }
      }

      for (const t of slide.tables) {
        elements.push(
          createElement("table", {
            x: px(t.x), y: px(t.y), width: px(t.width), height: px(t.height),
            zIndex: elements.length + 1,
            props: {
              colWidths: t.colWidths.map(px),
              rowHeights: t.rowHeights.map(px),
              cells: t.cells,
              borderColor: t.borderColor,
              borderWidth: t.borderWidth,
            },
          })
        );
      }

      for (const c of slide.connectors) {
        elements.push(
          createElement("line", {
            x: px(c.x), y: px(c.y), width: px(c.width), height: px(c.height),
            zIndex: elements.length + 1,
            props: {
              x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2,
              strokeColor: c.strokeColor,
              strokeWidth: c.strokeWidth,
              startArrow: c.startArrow,
              endArrow: c.endArrow,
              dash: c.dash,
            },
          })
        );
      }

      return createScene({
        id: `slide-${i + 1}-${newId("s")}`,
        name: `Slide ${i + 1}`,
        background: slide.background?.color ?? "#ffffff",
        elements,
      });
    })
  );

  // Wire prev/next edge tap zones on each scene (goToScene). Invisible-ish.
  const zoneW = Math.round(w * 0.12);
  scenes.forEach((scene, i) => {
    const prev = scenes[i - 1];
    const next = scenes[i + 1];
    if (next) {
      scene.elements.push(
        createElement("rectangle", {
          name: "▶ next", x: w - zoneW, y: 0, width: zoneW, height: h, zIndex: 9998,
          props: { fill: "rgba(0,0,0,0.001)" },
          interactions: [{ id: newId("int"), trigger: "tap", actions: [{ id: newId("act"), type: "goToScene", params: { sceneId: next.id } }] }],
        })
      );
    }
    if (prev) {
      scene.elements.push(
        createElement("rectangle", {
          name: "◀ prev", x: 0, y: 0, width: zoneW, height: h, zIndex: 9998,
          props: { fill: "rgba(0,0,0,0.001)" },
          interactions: [{ id: newId("int"), trigger: "tap", actions: [{ id: newId("act"), type: "goToScene", params: { sceneId: prev.id } }] }],
        })
      );
    }
  });

  const project = createProject({
    name: "Imported deck",
    width: w,
    height: h,
    startSceneId: scenes[0]?.id,
    scenes,
  });

  // Persist to the workspace path so the project + its assets/ live together
  // and the caller can load with that path (→ assetBaseUrl resolves images).
  await window.kiosk.saveProject(JSON.stringify(project, null, 2), projectPath);
  return { project, projectPath };
}
