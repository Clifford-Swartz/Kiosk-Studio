import type { Element } from "@kiosk/engine";

/**
 * Snapping logic for the editor canvas — pure functions, no React. While an
 * element is moved or resized, its edges/centers snap to nearby reference lines
 * (other elements' edges/centers + the scene's edges/center), and we report the
 * matched lines so the canvas can draw alignment guides.
 *
 * All coordinates are in SCENE units. The caller passes a threshold already in
 * scene units (typically 8 / scale, so the snap feels constant on screen).
 */

export interface GuideLine {
  axis: "x" | "y";
  /** Position in scene units along that axis. */
  pos: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Candidate snap positions along each axis. */
export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/**
 * Build the set of snap positions from the canvas size and the OTHER elements
 * (the dragged element must be excluded by the caller). For each element we
 * offer left / centerX / right (xs) and top / centerY / bottom (ys); the canvas
 * contributes 0, center, and width|height.
 */
export function collectTargets(others: Element[], sceneW: number, sceneH: number): SnapTargets {
  const xs: number[] = [0, sceneW / 2, sceneW];
  const ys: number[] = [0, sceneH / 2, sceneH];
  for (const el of others) {
    xs.push(el.x, el.x + el.width / 2, el.x + el.width);
    ys.push(el.y, el.y + el.height / 2, el.y + el.height);
  }
  return { xs, ys };
}

/** Nearest target to `value` within `threshold`; returns null if none. */
function nearest(value: number, targets: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const t of targets) {
    const d = Math.abs(t - value);
    if (d <= bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

/**
 * Snap a moving rect. Each axis is handled independently: we test the rect's
 * three anchors on that axis (start / center / end), keep the closest match
 * within threshold, and shift the rect so that anchor lands exactly on the
 * target. Returns the adjusted x/y plus a guide line per snapped axis.
 */
export function snapMove(
  rect: Rect,
  targets: SnapTargets,
  threshold: number
): { x: number; y: number; guides: GuideLine[] } {
  const guides: GuideLine[] = [];

  const xAnchors = [
    { offset: 0, val: rect.x },
    { offset: rect.width / 2, val: rect.x + rect.width / 2 },
    { offset: rect.width, val: rect.x + rect.width },
  ];
  const yAnchors = [
    { offset: 0, val: rect.y },
    { offset: rect.height / 2, val: rect.y + rect.height / 2 },
    { offset: rect.height, val: rect.y + rect.height },
  ];

  let x = rect.x;
  let bestX: { dist: number; newX: number; pos: number } | null = null;
  for (const a of xAnchors) {
    const hit = nearest(a.val, targets.xs, threshold);
    if (hit !== null) {
      const dist = Math.abs(hit - a.val);
      if (!bestX || dist < bestX.dist) bestX = { dist, newX: hit - a.offset, pos: hit };
    }
  }
  if (bestX) {
    x = Math.round(bestX.newX);
    guides.push({ axis: "x", pos: bestX.pos });
  }

  let y = rect.y;
  let bestY: { dist: number; newY: number; pos: number } | null = null;
  for (const a of yAnchors) {
    const hit = nearest(a.val, targets.ys, threshold);
    if (hit !== null) {
      const dist = Math.abs(hit - a.val);
      if (!bestY || dist < bestY.dist) bestY = { dist, newY: hit - a.offset, pos: hit };
    }
  }
  if (bestY) {
    y = Math.round(bestY.newY);
    guides.push({ axis: "y", pos: bestY.pos });
  }

  return { x, y, guides };
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/**
 * Snap a resizing rect. Only the edges the active handle moves are snapped to
 * the nearest target. Keeps the opposite edge fixed (so the element grows/
 * shrinks toward the handle, matching the canvas resize math).
 */
export function snapResize(
  rect: Rect,
  handle: Handle,
  targets: SnapTargets,
  threshold: number
): { rect: Rect; guides: GuideLine[] } {
  const guides: GuideLine[] = [];
  let { x, y, width, height } = rect;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  if (handle.includes("e")) {
    const hit = nearest(right, targets.xs, threshold);
    if (hit !== null) {
      width = Math.max(1, Math.round(hit - x));
      guides.push({ axis: "x", pos: hit });
    }
  }
  if (handle.includes("w")) {
    const hit = nearest(x, targets.xs, threshold);
    if (hit !== null) {
      width = Math.max(1, Math.round(right - hit));
      x = Math.round(hit);
      guides.push({ axis: "x", pos: hit });
    }
  }
  if (handle.includes("s")) {
    const hit = nearest(bottom, targets.ys, threshold);
    if (hit !== null) {
      height = Math.max(1, Math.round(hit - y));
      guides.push({ axis: "y", pos: hit });
    }
  }
  if (handle.includes("n")) {
    const hit = nearest(y, targets.ys, threshold);
    if (hit !== null) {
      height = Math.max(1, Math.round(bottom - hit));
      y = Math.round(hit);
      guides.push({ axis: "y", pos: hit });
    }
  }

  return { rect: { x, y, width, height }, guides };
}
