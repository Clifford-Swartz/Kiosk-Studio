import type { Element, ElementType, Project, Scene } from "./types.js";

/**
 * Factories for new model objects. The editor (and any future tooling) build
 * elements/scenes/projects through these so defaults live in exactly one place
 * and always satisfy the Zod schema.
 */

/** Short unique id. crypto.randomUUID is available in Electron's renderer. */
export function newId(prefix = "el"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

/** Sensible per-type default props + size so a newly added element is visible. */
const TYPE_DEFAULTS: Record<
  ElementType,
  { width: number; height: number; props: Record<string, unknown> }
> = {
  rectangle: { width: 240, height: 160, props: { fill: "#3b82f6", radius: 8 } },
  text: {
    width: 480,
    height: 80,
    props: { text: "Text", color: "#ffffff", fontSize: 40, align: "left" },
  },
  image: {
    width: 320,
    height: 240,
    props: { src: "__placeholder__", fit: "cover", alt: "" },
  },
  video: {
    width: 480,
    height: 270,
    props: {
      src: "",
      fit: "cover",
      autoplay: true,
      loop: true,
      muted: true,
      volume: 1.0,
      playbackRate: 1.0,
      preload: "metadata",
      showControls: false,
    },
  },
  audio: {
    width: 90,
    height: 90,
    props: { src: "", volume: 1, fade: 0, autoplay: false, loop: false, muted: false },
  },
  button: {
    width: 280,
    height: 96,
    props: {
      label: "Button",
      fillType: "color",
      fill: "#2563eb",
      imageSrc: "__placeholder__",
      imageFit: "cover",
      color: "#ffffff",
      radius: 12,
      fontSize: 28
    },
  },
  layer: { width: 1920, height: 1080, props: {} },
  table: {
    width: 400,
    height: 160,
    props: {
      colWidths: [200, 200],
      rowHeights: [40, 40, 40, 40],
      cells: [
        [{ text: "Header 1", bold: true }, { text: "Header 2", bold: true }],
        [{ text: "" }, { text: "" }],
        [{ text: "" }, { text: "" }],
        [{ text: "" }, { text: "" }],
      ],
      borderColor: "#94a3b8",
      borderWidth: 1,
    },
  },
  line: {
    width: 240,
    height: 120,
    props: {
      x1: 0, y1: 0, x2: 1, y2: 1,
      strokeColor: "#0f172a",
      strokeWidth: 2,
      startArrow: "none",
      endArrow: "none",
      dash: "solid",
    },
  },
  collection: {
    width: 900,
    height: 520,
    props: {
      layout: "grid",
      fit: "cover",
      columns: 3,
      gap: 16,
      activeIndex: 0,
      intervalMs: 4000,
      itemBg: "#1e293b",
      titleColor: "#f8fafc",
      subtitleColor: "#94a3b8",
      showControls: false,
      items: [
        { id: "i1", title: "Item One", subtitle: "Subtitle", image: "", thumbnail: "" },
        { id: "i2", title: "Item Two", subtitle: "Subtitle", image: "", thumbnail: "" },
        { id: "i3", title: "Item Three", subtitle: "Subtitle", image: "", thumbnail: "" },
      ],
    },
  },
};

export function createElement(
  type: ElementType,
  partial: Partial<Element> = {}
): Element {
  const d = TYPE_DEFAULTS[type];
  return {
    id: partial.id ?? newId(type),
    type,
    name: partial.name,
    x: partial.x ?? (type === "layer" ? 0 : 100),
    y: partial.y ?? (type === "layer" ? 0 : 100),
    width: partial.width ?? d.width,
    height: partial.height ?? d.height,
    rotation: partial.rotation ?? 0,
    opacity: partial.opacity ?? 1,
    zIndex: partial.zIndex ?? 0,
    props: { ...d.props, ...(partial.props ?? {}) },
    bindings: partial.bindings ?? [],
    interactions: partial.interactions ?? [],
    tint: partial.tint,
    mask: partial.mask,
    locked: partial.locked ?? false,
    children: partial.children,
  };
}

export function createScene(partial: Partial<Scene> = {}): Scene {
  // Size is project-wide now; scenes no longer carry width/height.
  return {
    id: partial.id ?? newId("scene"),
    name: partial.name ?? "New scene",
    background: partial.background ?? "#0f172a",
    backgroundSize: partial.backgroundSize,
    backgroundPosition: partial.backgroundPosition,
    elements: partial.elements ?? [],
  };
}

export function createProject(partial: Partial<Project> = {}): Project {
  const scenes = partial.scenes ?? [createScene({ name: "Home" })];
  return {
    schemaVersion: 3,
    id: partial.id ?? newId("proj"),
    name: partial.name ?? "Untitled",
    width: partial.width ?? 1920,
    height: partial.height ?? 1080,
    startSceneId: partial.startSceneId ?? scenes[0]?.id,
    scenes,
    dataConnectors: partial.dataConnectors ?? [],
    enableBackButton: partial.enableBackButton ?? false,
    enableHomeButton: partial.enableHomeButton ?? false,
  };
}
