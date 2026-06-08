import { createElement, createProject, createScene, newId, type Project } from "@kiosk/engine";
import { ensureProjectSaved } from "./assets.js";

/**
 * Build a Kiosk Studio project from a parsed PowerPoint deck. Each slide → a
 * scene; texts → text elements, images → image elements (written into the
 * project's assets/), all scaled from slide px to the project canvas. Adds
 * invisible left/right edge tap zones that navigate prev/next (goToScene).
 */

interface DeckLine {
  text: string;
  fontPt?: number; color?: string; bold?: boolean; italic?: boolean;
  align?: "left" | "center" | "right";
}
interface DeckText {
  x: number; y: number; width: number; height: number; text: string;
  lines?: DeckLine[];
  fontPt?: number; color?: string; bold?: boolean; italic?: boolean;
  align?: "left" | "center" | "right";
}
interface DeckImage { x: number; y: number; width: number; height: number; ext: string; base64: string }
interface DeckSlide { texts: DeckText[]; images: DeckImage[] }
export interface ParsedDeck { slideW: number; slideH: number; slides: DeckSlide[] }

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

      for (const t of slide.texts) {
        // pt → px (×1.333) then scale to canvas.
        const toPx = (pt?: number) => Math.round((pt ?? 18) * 1.333 * scale);
        // Per-line runs preserve mixed styling (e.g. bold lvl-0 bullets,
        // non-bold sub-bullets) that a single box style can't represent.
        const runs = (t.lines ?? []).map((l) => ({
          text: l.text,
          fontSize: toPx(l.fontPt),
          color: l.color ?? t.color ?? "#0f172a",
          fontWeight: l.bold ? "700" : "normal",
          align: l.align ?? t.align ?? "left",
          ...(l.italic ? { fontStyle: "italic" } : {}),
        }));
        elements.push(
          createElement("text", {
            x: px(t.x), y: px(t.y), width: px(t.width), height: px(t.height),
            zIndex: elements.length + 1,
            props: {
              text: t.text,
              ...(runs.length ? { runs } : {}),
              color: t.color ?? "#0f172a",
              fontSize: toPx(t.fontPt),
              fontWeight: t.bold ? "700" : "normal",
              align: t.align ?? "left",
              ...(t.italic ? { fontStyle: "italic" } : {}),
            },
          })
        );
      }

      for (const im of slide.images) {
        // Persist the image into the project's assets/ and reference it.
        const rel = await window.kiosk.saveAsset(projectPath, `slide${i + 1}.${im.ext}`, im.base64);
        elements.push(
          createElement("image", {
            x: px(im.x), y: px(im.y), width: px(im.width), height: px(im.height),
            zIndex: elements.length + 1,
            props: { src: rel, fit: "contain" },
          })
        );
      }

      return createScene({ id: `slide-${i + 1}-${newId("s")}`, name: `Slide ${i + 1}`, background: "#ffffff", elements });
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
          interactions: [{ id: newId("int"), trigger: "tap", actions: [{ type: "goToScene", params: { sceneId: next.id } }] }],
        })
      );
    }
    if (prev) {
      scene.elements.push(
        createElement("rectangle", {
          name: "◀ prev", x: 0, y: 0, width: zoneW, height: h, zIndex: 9998,
          props: { fill: "rgba(0,0,0,0.001)" },
          interactions: [{ id: newId("int"), trigger: "tap", actions: [{ type: "goToScene", params: { sceneId: prev.id } }] }],
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
