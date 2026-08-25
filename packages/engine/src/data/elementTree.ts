import type { Element } from "../model/types.js";

/**
 * Element types whose `children` array is ever walked. `children` is
 * schema-legal on every element type but semantically only meaningful for
 * layer/collection — this is the single predicate every tree-walk in this
 * module uses, so it can't drift the way independent local walkers
 * previously did across store.ts, Canvas.tsx, sceneHierarchy.ts, Player.tsx.
 */
export const NESTABLE_TYPES: ReadonlySet<Element["type"]> = new Set(["layer", "collection"]);

export function canHaveChildren(el: Element): boolean {
  return NESTABLE_TYPES.has(el.type) && !!el.children && el.children.length > 0;
}

export interface FlattenOptions {
  /**
   * Accumulate ancestor layer/collection x/y into each descendant's x/y.
   * Default false (relative coordinates, as stored in the schema).
   */
  absoluteCoords?: boolean;
}

/**
 * Flatten a tree into a single list. Containers (layer/collection) are
 * included in the result alongside their descendants.
 */
export function flattenElements(elements: Element[], options?: FlattenOptions): Element[] {
  const absolute = options?.absoluteCoords ?? false;
  const walk = (els: Element[], parentX: number, parentY: number): Element[] => {
    const result: Element[] = [];
    for (const el of els) {
      const positioned = absolute ? { ...el, x: el.x + parentX, y: el.y + parentY } : el;
      result.push(positioned);
      if (canHaveChildren(el)) {
        result.push(...walk(el.children!, parentX + el.x, parentY + el.y));
      }
    }
    return result;
  };
  return walk(elements, 0, 0);
}

/** Find an element by id, relative coordinates (as stored in the schema). */
export function findElement(elements: Element[], id: string): Element | null {
  for (const el of elements) {
    if (el.id === id) return el;
    if (canHaveChildren(el)) {
      const found = findElement(el.children!, id);
      if (found) return found;
    }
  }
  return null;
}

/** Find an element by id, with ancestor layer/collection offsets applied. */
export function findElementAbsolute(elements: Element[], id: string): Element | null {
  const walk = (els: Element[], parentX: number, parentY: number): Element | null => {
    for (const el of els) {
      if (el.id === id) {
        return { ...el, x: el.x + parentX, y: el.y + parentY };
      }
      if (canHaveChildren(el)) {
        const found = walk(el.children!, parentX + el.x, parentY + el.y);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(elements, 0, 0);
}

/** Find the direct parent container of an element id, or null if it's at the root. */
export function findParent(elements: Element[], targetId: string): Element | null {
  for (const el of elements) {
    if (canHaveChildren(el)) {
      if (el.children!.some((child) => child.id === targetId)) return el;
      const parent = findParent(el.children!, targetId);
      if (parent) return parent;
    }
  }
  return null;
}

/** True if `id` is anywhere in the subtree rooted at `ancestorId`. */
export function isDescendant(elements: Element[], ancestorId: string, id: string): boolean {
  const ancestor = findElement(elements, ancestorId);
  if (!ancestor || !canHaveChildren(ancestor)) return false;
  return findElement(ancestor.children!, id) !== null;
}

/** Nearest ancestor "layer" container id for an element, or null if it's on the root/base layer. */
export function findNearestLayerId(elements: Element[], id: string): string | null {
  let currentId = id;
  while (true) {
    const parent = findParent(elements, currentId);
    if (!parent) return null;
    if (parent.type === "layer") return parent.id;
    currentId = parent.id;
  }
}

/** True if the element itself, or any ancestor container, is locked. */
export function isLockedOrChildOfLocked(elements: Element[], id: string): boolean {
  for (const el of elements) {
    if (el.id === id) return el.locked ?? false;
    if (canHaveChildren(el)) {
      if (isLockedOrChildOfLocked(el.children!, id)) return true;
      if (el.locked && findElement(el.children!, id) !== null) return true;
    }
  }
  return false;
}

/** Visit every element in the tree, pre-order, honoring the nestable-types predicate. */
export function walkElementTree(elements: Element[], visit: (el: Element) => void): void {
  for (const el of elements) {
    visit(el);
    if (canHaveChildren(el)) {
      walkElementTree(el.children!, visit);
    }
  }
}

/** Collect elements matching `predicate` (defaults to all elements). */
export function collectElements(elements: Element[], predicate?: (el: Element) => boolean): Element[] {
  const result: Element[] = [];
  walkElementTree(elements, (el) => {
    if (!predicate || predicate(el)) result.push(el);
  });
  return result;
}

/**
 * Collect elements matching `predicate`, cascading a match down into every
 * descendant of a matched layer/collection — a layer's own visibility/props
 * change also changes how everything nested inside it appears, even though
 * only the layer itself is named in whatever produced `predicate` (e.g. a
 * scene state's override map).
 */
export function collectElementsWithDescendants(elements: Element[], predicate: (el: Element) => boolean): Element[] {
  const result: Element[] = [];
  const walk = (els: Element[], inherited: boolean): void => {
    for (const el of els) {
      const matched = inherited || predicate(el);
      if (matched) result.push(el);
      if (canHaveChildren(el)) {
        walk(el.children!, matched);
      }
    }
  };
  walk(elements, false);
  return result;
}

/** Immutably apply `transform` to the element matching `id`, rebuilding only the path to it. */
export function patchElement(elements: Element[], id: string, transform: (el: Element) => Element): Element[] {
  return elements.map((el) => {
    if (el.id === id) return transform(el);
    if (canHaveChildren(el)) {
      return { ...el, children: patchElement(el.children!, id, transform) };
    }
    return el;
  });
}
