import { create } from "zustand";
import {
  createElement,
  createScene,
  newId,
  type Action,
  type Binding,
  type DataConnectorDef,
  type Element,
  type ElementType,
  type Interaction,
  type Project,
  type Scene,
  type TriggerKind,
} from "@kiosk/engine";

/**
 * The editor's single source of truth. Holds the working Project plus UI
 * selection state, and exposes immutable edit operations. The Canvas, layer
 * tree, and Properties panel all read/write through this store, so they stay
 * in sync automatically. Designed so undo/redo can later wrap the ops.
 */
export interface EditorState {
  project: Project;
  activeSceneId: string;
  selectedId: string | null;
  /** Set of selected element IDs (for multi-select support). When empty, selectedId is used. */
  selectedIds: Set<string>;
  /** Element to outline on canvas without changing selection/Properties (e.g. hovering a states-panel row). */
  hoveredElementId: string | null;
  /** Path the project was loaded from / last saved to, if any. */
  filePath: string | null;
  /** Unsaved changes since last load/save. */
  dirty: boolean;
  /**
   * Bumped by loadProject and markSaved. The undo/redo hook watches this to
   * know when to wipe its history (save-as-checkpoint / load = fresh slate).
   * See ADR 0003. History itself lives in the hook, not the store.
   */
  historyNonce: number;
  /** Editor UI: snap-to-guides on/off (not part of the saved project). */
  snapEnabled: boolean;
  /** Clipboard: holds a copy of the last copied/cut element(s). */
  clipboard: Element | Element[] | null;
  /** Canvas viewport state (UI-only, not saved to project). */
  canvasViewport: {
    userZoom: number; // 1.0 = fit-to-window, range 0.1 to 5.0
    panX: number;     // Pan offset in screen pixels
    panY: number;
  };
  /** Active sidebar tab (scene tools vs project hierarchy). */
  activeTab: "scene" | "project";
  /** Collapsed scene IDs in project hierarchy. */
  collapsedScenes: Set<string>;
  /** Visual parent overrides (sceneId → parentId) for manual nesting. */
  visualParents: Map<string, string>;
  /** Collapsed element IDs in scene structure tree (persists across scene switches). */
  collapsedElementIds: Set<string>;
  /** Inline text editing mode: element ID being edited, or null. */
  editingId: string | null;
  /** Mask editing mode: element ID being edited, or null. */
  maskEditingId: string | null;

  // --- selectors (derived) ---
  activeScene: () => Scene;
  isModalEditingActive: () => boolean;

  // --- project lifecycle ---
  loadProject: (project: Project, filePath?: string | null) => void;
  markSaved: (filePath: string) => void;
  /**
   * Restore a project from undo/redo history WITHOUT bumping historyNonce
   * (so the hook doesn't treat its own restore as a fresh load) and WITHOUT
   * marking dirty. Preserves the current selection if that element still
   * exists in the restored project, else clears it. See ADR 0003.
   */
  restoreFromHistory: (project: Project) => void;

  // --- element ops (operate on the active scene) ---
  addElement: (type: ElementType) => void;
  /** Add an image element with the given src, optionally at a position. */
  addImageElement: (src: string, pos?: { x: number; y: number }) => void;
  /** Set the src of the currently selected image/video element. */
  setSelectedImageSrc: (src: string) => void;
  updateElement: (id: string, patch: Partial<Element>) => void;
  updateElementProps: (id: string, props: Record<string, unknown>) => void;
  moveElement: (id: string, x: number, y: number) => void;
  resizeElement: (
    id: string,
    rect: { x: number; y: number; width: number; height: number }
  ) => void;
  removeElement: (id: string) => void;
  /** Reorder by moving element `id` to a new index in the scene's array. */
  reorderElement: (id: string, toIndex: number) => void;
  /** Reparent element into a new parent (or scene root if null). Returns error message if invalid. */
  reparentElement: (elementId: string, newParentId: string | null) => string | null;
  selectElement: (id: string | null) => void;
  /** Set/clear the hovered-element outline shown on canvas, independent of selection. */
  hoverElement: (id: string | null) => void;
  /** Select multiple elements (replaces current selection). */
  selectElements: (ids: Set<string>) => void;
  /** Add elements to current selection. */
  addToSelection: (ids: string[]) => void;
  /** Toggle collapse state for an element in the scene structure tree. */
  toggleElementCollapse: (id: string) => void;
  /** Create a new layer at the scene root. */
  createLayer: () => void;

  // --- clipboard ops ---
  copyElement: () => void;
  cutElement: () => void;
  pasteElement: () => void;

  // --- editor ui ---
  toggleSnap: () => void;
  setUserZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  resetViewport: () => void;
  startTextEditing: (elementId: string) => void;
  exitTextEditing: () => void;
  startMaskEditing: (elementId: string) => void;
  exitMaskEditing: () => void;
  setActiveTab: (tab: "scene" | "project") => void;
  toggleSceneCollapse: (sceneId: string) => void;
  setVisualParent: (sceneId: string, parentId: string | null) => void;
  addChildScene: (parentId: string) => void;

  // --- scene ops ---
  addScene: () => void;
  renameScene: (id: string, name: string) => void;
  /** Update active scene properties (background, backgroundSize, backgroundPosition, transition, states — canvas size is project-wide). */
  updateActiveScene: (patch: Partial<Pick<Scene, "background" | "backgroundSize" | "backgroundPosition" | "transition" | "states">>) => void;
  /** Update the project-wide canvas size (applies to all scenes). */
  updateProjectSize: (size: { width?: number; height?: number }) => void;
  removeScene: (id: string) => void;
  setActiveScene: (id: string) => void;

  // --- navigation settings ---
  setEnableBackButton: (enabled: boolean) => void;
  setEnableHomeButton: (enabled: boolean) => void;

  // --- data connectors & bindings (live data) ---
  addDataConnector: (kind: "rest" | "csv" | "json" | "jsonl" | "console") => string;
  updateDataConnector: (id: string, patch: Partial<DataConnectorDef>) => void;
  removeDataConnector: (id: string) => void;
  /** Add or replace a binding on an element (matched by targetProp). */
  setBinding: (elementId: string, binding: Binding) => void;
  clearBinding: (elementId: string, targetProp: string) => void;

  // --- interactions (triggers & actions) ---
  addInteraction: (elementId: string, trigger: TriggerKind) => void;
  removeInteraction: (elementId: string, interactionId: string) => void;
  addAction: (elementId: string, interactionId: string, action: Action) => void;
  updateAction: (elementId: string, interactionId: string, index: number, patch: Partial<Action>) => void;
  removeAction: (elementId: string, interactionId: string, index: number) => void;
}

/** Replace the active scene via a transform, returning a new scenes array. */
function withActiveScene(
  state: EditorState,
  transform: (scene: Scene) => Scene
): Project {
  return {
    ...state.project,
    scenes: state.project.scenes.map((s) =>
      s.id === state.activeSceneId ? transform(s) : s
    ),
  };
}

/** Map over a scene's elements, patching the one matching `id`. Recursively searches nested children. */
function patchElement(
  scene: Scene,
  id: string,
  transform: (el: Element) => Element
): Scene {
  const patchRecursive = (elements: Element[]): Element[] => {
    return elements.map((el) => {
      if (el.id === id) {
        return transform(el);
      }
      if (el.children) {
        return { ...el, children: patchRecursive(el.children) };
      }
      return el;
    });
  };
  return { ...scene, elements: patchRecursive(scene.elements) };
}

/**
 * Move element `id` to `toIndex` within whichever sibling array currently
 * contains it (top-level scene.elements, or a layer/collection's `children`).
 * Reordering never crosses containers — moving into a different parent is
 * reparentElement's job. zIndex is renumbered within that same sibling array
 * so each layer's children keep their own local stacking order.
 */
function reorderWithinSiblings(elements: Element[], id: string, toIndex: number): Element[] {
  const from = elements.findIndex((e) => e.id === id);
  if (from !== -1) {
    const els = [...elements];
    const [moved] = els.splice(from, 1);
    els.splice(Math.max(0, Math.min(toIndex, els.length)), 0, moved);
    return els.map((e, i) => ({ ...e, zIndex: i + 1 }));
  }
  return elements.map((el) =>
    el.children ? { ...el, children: reorderWithinSiblings(el.children, id, toIndex) } : el
  );
}

/** Find an element by ID, searching recursively through nested children. */
function findElement(elements: Element[], id: string): Element | null {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.children) {
      const found = findElement(el.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Deep clone an element with new IDs for itself and all nested children. */
function deepCloneElement(element: Element): Element {
  return {
    ...element,
    id: newId("el"),
    children: element.children ? element.children.map(deepCloneElement) : undefined,
  };
}

/** Find the parent element of a given element ID. Returns null if element is at root level. */
function findParent(elements: Element[], targetId: string): Element | null {
  for (const el of elements) {
    if (el.children) {
      // Check if target is a direct child
      if (el.children.some(child => child.id === targetId)) {
        return el;
      }
      // Recursively search in children
      const parent = findParent(el.children, targetId);
      if (parent) return parent;
    }
  }
  return null;
}

export const useEditor = create<EditorState>((set, get) => ({
  // Placeholder until loadProject runs; replaced on first render.
  project: { schemaVersion: 3, id: "", name: "", width: 1920, height: 1080, scenes: [createScene()], dataConnectors: [], enableBackButton: false, enableHomeButton: false },
  activeSceneId: "",
  selectedId: null,
  selectedIds: new Set(),
  hoveredElementId: null,
  filePath: null,
  dirty: false,
  historyNonce: 0,
  snapEnabled: true,
  clipboard: null,
  canvasViewport: { userZoom: 1, panX: 0, panY: 0 },
  activeTab: "scene",
  collapsedScenes: new Set(),
  visualParents: new Map(),
  collapsedElementIds: new Set(),
  editingId: null,
  maskEditingId: null,

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

  setUserZoom: (zoom) => set((s) => ({
    canvasViewport: { ...s.canvasViewport, userZoom: zoom }
  })),

  setPan: (panX, panY) => set((s) => ({
    canvasViewport: { ...s.canvasViewport, panX, panY }
  })),

  resetViewport: () => set({ canvasViewport: { userZoom: 1, panX: 0, panY: 0 } }),

  startTextEditing: (elementId) => set({ editingId: elementId, selectedId: elementId }),
  exitTextEditing: () => set({ editingId: null }),
  startMaskEditing: (elementId) => set({ maskEditingId: elementId, selectedId: elementId }),
  exitMaskEditing: () => set({ maskEditingId: null }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  toggleSceneCollapse: (sceneId) =>
    set((state) => {
      const next = new Set(state.collapsedScenes);
      if (next.has(sceneId)) {
        next.delete(sceneId);
      } else {
        next.add(sceneId);
      }
      return { collapsedScenes: next };
    }),

  setVisualParent: (sceneId, parentId) =>
    set((state) => {
      const next = new Map(state.visualParents);
      if (parentId === null) {
        next.delete(sceneId);
      } else {
        next.set(sceneId, parentId);
      }
      return { visualParents: next };
    }),

  addChildScene: (parentId) =>
    set((state) => {
      const newScene = createScene({ name: `Scene ${state.project.scenes.length + 1}` });

      const scenes = [...state.project.scenes, newScene];

      const visualParents = new Map(state.visualParents);
      visualParents.set(newScene.id, parentId);

      return {
        project: { ...state.project, scenes },
        activeSceneId: newScene.id,
        visualParents,
        dirty: true,
      };
    }),

  activeScene: () => {
    const s = get();
    return (
      s.project.scenes.find((sc) => sc.id === s.activeSceneId) ?? s.project.scenes[0]
    );
  },

  isModalEditingActive: () => {
    const s = get();
    return s.editingId !== null || s.maskEditingId !== null;
  },

  loadProject: (project, filePath = null) =>
    set((state) => ({
      project,
      activeSceneId: project.startSceneId ?? project.scenes[0]?.id ?? "",
      selectedId: null,
      filePath,
      dirty: false,
      // New project → tell the hook to wipe history (no cross-project undo).
      historyNonce: state.historyNonce + 1,
    })),

  // Save = checkpoint. Bumping the nonce wipes undo history (ADR 0003) and
  // deselecting reinforces the "committed state" moment.
  markSaved: (filePath) =>
    set((state) => ({
      filePath,
      dirty: false,
      selectedId: null,
      historyNonce: state.historyNonce + 1,
    })),

  restoreFromHistory: (project) =>
    set((state) => {
      // Keep the selection if the element still exists in the restored project,
      // so the user can keep editing without reselecting.
      const scene = project.scenes.find((s) => s.id === state.activeSceneId);
      const stillExists =
        state.selectedId != null &&
        !!scene?.elements.some((e) => e.id === state.selectedId);
      return {
        project,
        selectedId: stillExists ? state.selectedId : null,
        // Restores are not edits: don't mark dirty, don't bump the nonce.
      };
    }),

  addElement: (type) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      const scene = state.activeScene();
      // Auto-number: count existing elements of this type
      const count = scene.elements.filter(e => e.type === type).length;
      const el = createElement(type, {
        name: `${type}${count + 1}`,
        // Stack new elements above existing ones.
        zIndex: scene.elements.length + 1,
      });
      return {
        project: withActiveScene(state, (scene) => ({
          ...scene,
          elements: [...scene.elements, el],
        })),
        selectedId: el.id,
        dirty: true,
      };
    }),

  addImageElement: (src, pos) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      const scene = state.activeScene();
      // Auto-number: count existing image elements
      const count = scene.elements.filter(e => e.type === "image").length;
      const el = createElement("image", {
        name: `image${count + 1}`,
        props: { src, fit: "cover", alt: "" },
        zIndex: scene.elements.length + 1,
        ...(pos ? { x: pos.x, y: pos.y } : {}),
      });
      return {
        project: withActiveScene(state, (scene) => ({
          ...scene,
          elements: [...scene.elements, el],
        })),
        selectedId: el.id,
        dirty: true,
      };
    }),

  setSelectedImageSrc: (src) =>
    set((state) => {
      const id = state.selectedId;
      if (!id) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, id, (el) => ({ ...el, props: { ...el.props, src } }))
        ),
        dirty: true,
      };
    }),

  updateElement: (id, patch) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, id, (el) => ({ ...el, ...patch }))
        ),
        dirty: true,
      };
    }),

  updateElementProps: (id, props) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, id, (el) => ({ ...el, props: { ...el.props, ...props } }))
        ),
        dirty: true,
      };
    }),

  moveElement: (id, x, y) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      const scene = state.project.scenes.find((s) => s.id === state.activeSceneId);
      if (!scene) return state;

      // Find parent to convert absolute coordinates to relative
      const parent = findParent(scene.elements, id);
      const relativeX = parent ? x - parent.x : x;
      const relativeY = parent ? y - parent.y : y;

      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, id, (el) => ({ ...el, x: relativeX, y: relativeY }))
        ),
        dirty: true,
      };
    }),

  resizeElement: (id, rect) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, id, (el) => ({ ...el, ...rect }))
        ),
        dirty: true,
      };
    }),

  removeElement: (id) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      // Recursively remove element from tree (handles nested children in layers)
      const removeFromTree = (elements: Element[]): Element[] => {
        return elements
          .filter((e) => e.id !== id)
          .map((e) => ({
            ...e,
            children: e.children ? removeFromTree(e.children) : undefined,
          }));
      };

      return {
        project: withActiveScene(state, (scene) => ({
          ...scene,
          elements: removeFromTree(scene.elements),
        })),
        selectedId: state.selectedId === id ? null : state.selectedId,
        dirty: true,
      };
    }),

  reorderElement: (id, toIndex) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) => ({
          ...scene,
          elements: reorderWithinSiblings(scene.elements, id, toIndex),
        })),
        dirty: true,
      };
    }),

  reparentElement: (elementId, newParentId) => {
    const state = get();
    if (state.isModalEditingActive()) return "Cannot reparent during modal editing";
    const scene = state.activeScene();

    // Helper to calculate layer depth
    const getLayerDepth = (elements: Element[], targetId: string, currentDepth = 0): number => {
      for (const el of elements) {
        if (el.id === targetId) {
          return el.type === "layer" ? currentDepth + 1 : currentDepth;
        }
        if (el.children) {
          const childDepth = getLayerDepth(el.children, targetId, el.type === "layer" ? currentDepth + 1 : currentDepth);
          if (childDepth > -1) return childDepth;
        }
      }
      return -1;
    };

    // Helper to remove element from anywhere in tree
    const removeFromTree = (elements: Element[], id: string): { elements: Element[]; removed: Element | null } => {
      for (let i = 0; i < elements.length; i++) {
        if (elements[i].id === id) {
          const removed = elements[i];
          return { elements: [...elements.slice(0, i), ...elements.slice(i + 1)], removed };
        }
        if (elements[i].children) {
          const result = removeFromTree(elements[i].children!, id);
          if (result.removed) {
            return {
              elements: elements.map((e, idx) =>
                idx === i ? { ...e, children: result.elements } : e
              ),
              removed: result.removed,
            };
          }
        }
      }
      return { elements, removed: null };
    };

    // Helper to add element to parent or root
    const addToParent = (elements: Element[], child: Element, parentId: string | null): Element[] => {
      if (parentId === null) {
        return [...elements, child];
      }
      return elements.map((el) => {
        if (el.id === parentId) {
          return { ...el, children: [child, ...(el.children ?? [])] };
        }
        if (el.children) {
          return { ...el, children: addToParent(el.children, child, parentId) };
        }
        return el;
      });
    };

    // Validation 1: Element exists
    const element = findElement(scene.elements, elementId);
    if (!element) return "Element not found";

    // Validation 2: Parent exists (if specified)
    const newParent = newParentId ? findElement(scene.elements, newParentId) : null;
    if (newParentId && !newParent) return "Parent not found";

    // Validation 3: Can't reparent to self
    if (elementId === newParentId) return "Cannot reparent element to itself";

    // Validation 4: Can't reparent to own descendant
    const isDescendant = (elements: Element[], ancestorId: string, descendantId: string): boolean => {
      for (const el of elements) {
        if (el.id === ancestorId) {
          if (el.children) {
            if (el.children.some(c => c.id === descendantId)) return true;
            if (isDescendant(el.children, ancestorId, descendantId)) return true;
          }
        }
        if (el.children && isDescendant(el.children, ancestorId, descendantId)) return true;
      }
      return false;
    };
    if (newParentId && isDescendant(scene.elements, elementId, newParentId)) {
      return "Cannot reparent element to its own descendant";
    }

    // Validation 5: Layers can only contain elements, not other layers (except 1 level deep)
    if (newParent && newParent.type === "layer" && element.type === "layer") {
      const parentDepth = getLayerDepth(scene.elements, newParentId!);
      if (parentDepth >= 1) {
        return "Maximum layer depth is 2 (layer → layer → elements)";
      }
    }

    // Validation 6: Collections cannot contain layers
    if (newParent && newParent.type === "collection" && element.type === "layer") {
      return "Collections cannot contain layers";
    }

    // Validation 7: Layers cannot be nested in collections
    const isInsideCollection = (elements: Element[], targetId: string): boolean => {
      for (const el of elements) {
        if (el.type === "collection" && el.children) {
          if (el.children.some(c => c.id === targetId)) return true;
          if (isInsideCollection(el.children, targetId)) return true;
        }
        if (el.children && isInsideCollection(el.children, targetId)) return true;
      }
      return false;
    };
    if (newParent && newParent.type === "collection" || (newParentId && isInsideCollection(scene.elements, newParentId))) {
      return "Layers cannot be nested inside collections";
    }

    // Perform reparenting
    const { elements: afterRemove, removed } = removeFromTree(scene.elements, elementId);
    if (!removed) return "Failed to remove element from tree";

    const afterAdd = addToParent(afterRemove, removed, newParentId);

    set((state) => ({
      project: withActiveScene(state, (scene) => ({
        ...scene,
        elements: afterAdd,
      })),
      dirty: true,
    }));

    return null; // Success
  },

  selectElement: (id) => {
    if (get().isModalEditingActive()) return;
    set({ selectedId: id, selectedIds: new Set() });
  },

  hoverElement: (id) => {
    set({ hoveredElementId: id });
  },

  selectElements: (ids) => {
    if (get().isModalEditingActive()) return;
    set({ selectedIds: ids, selectedId: null });
  },

  addToSelection: (ids) => {
    if (get().isModalEditingActive()) return;
    set((state) => {
      const next = new Set(state.selectedIds);
      ids.forEach(id => next.add(id));
      return { selectedIds: next, selectedId: null };
    });
  },

  toggleElementCollapse: (id) =>
    set((state) => {
      const next = new Set(state.collapsedElementIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { collapsedElementIds: next };
    }),

  createLayer: () =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      const scene = state.activeScene();
      const count = scene.elements.filter(e => e.type === 'layer').length;
      const layer = createElement('layer', {
        name: `Layer ${count + 1}`,
        x: 0,
        y: 0,
        width: state.project.width,
        height: state.project.height,
        zIndex: scene.elements.length + 1,
      });
      return {
        project: withActiveScene(state, (scene) => ({
          ...scene,
          elements: [...scene.elements, layer],
        })),
        selectedId: layer.id,
        dirty: true,
      };
    }),

  // --- clipboard ops ---
  copyElement: () => {
    const { selectedId, selectedIds, activeScene } = get();
    // Multi-select: copy all selected elements as array
    if (selectedIds.size > 0) {
      const scene = activeScene();
      const els = Array.from(selectedIds)
        .map(id => findElement(scene.elements, id))
        .filter((el): el is Element => el !== null);
      if (els.length > 0) set({ clipboard: els });
      return;
    }
    // Single-select: copy one element
    if (!selectedId) return;
    const el = findElement(activeScene().elements, selectedId);
    if (el) set({ clipboard: el });
  },

  cutElement: () => {
    const { selectedId, selectedIds, copyElement, removeElement, isModalEditingActive } = get();
    if (isModalEditingActive()) return;
    copyElement();
    // Multi-select: delete all
    if (selectedIds.size > 0) {
      Array.from(selectedIds).forEach(id => removeElement(id));
      return;
    }
    // Single-select: delete one
    if (selectedId) removeElement(selectedId);
  },

  pasteElement: () => {
    const { clipboard, isModalEditingActive } = get();
    if (isModalEditingActive() || !clipboard) return;

    // Multi-paste: array of elements
    if (Array.isArray(clipboard)) {
      const cloned = clipboard.map((el) => {
        const c = deepCloneElement(el);
        c.x = el.x + 20;
        c.y = el.y + 20;
        return c;
      });
      set((state) => ({
        project: withActiveScene(state, (scene) => ({
          ...scene,
          elements: [...scene.elements, ...cloned],
        })),
        selectedIds: new Set(cloned.map(c => c.id)),
        selectedId: null,
        dirty: true,
      }));
      return;
    }

    // Single-paste: one element
    const cloned = deepCloneElement(clipboard);
    cloned.x = clipboard.x + 20;
    cloned.y = clipboard.y + 20;
    set((state) => ({
      project: withActiveScene(state, (scene) => ({
        ...scene,
        elements: [...scene.elements, cloned],
      })),
      selectedId: cloned.id,
      dirty: true,
    }));
  },

  addScene: () =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      const scene = createScene({ name: `Scene ${state.project.scenes.length + 1}` });
      return {
        project: { ...state.project, scenes: [...state.project.scenes, scene] },
        activeSceneId: scene.id,
        selectedId: null,
        dirty: true,
      };
    }),

  renameScene: (id, name) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map((s) => (s.id === id ? { ...s, name } : s)),
        },
        dirty: true,
      };
    }),

  removeScene: (id) =>
    set((state) => {
      if (state.isModalEditingActive() || state.project.scenes.length <= 1) return state;

      const scenes = state.project.scenes.filter((s) => s.id !== id);

      // Break goToScene actions pointing to deleted scene
      const cleanedScenes = scenes.map((scene) => ({
        ...scene,
        elements: scene.elements.map((el) => ({
          ...el,
          interactions: el.interactions.map((int) => ({
            ...int,
            actions: int.actions.filter(
              (act) => !(act.type === "goToScene" && act.params.sceneId === id)
            ),
          })),
        })),
      }));

      // Clean up visual parent relationships
      const visualParents = new Map(state.visualParents);
      visualParents.delete(id); // Remove deleted scene's visual parent entry
      // Orphan children: remove entries where this scene was the parent
      for (const [childId, parentId] of visualParents.entries()) {
        if (parentId === id) {
          visualParents.delete(childId);
        }
      }

      const newHomeId =
        state.project.startSceneId === id ? cleanedScenes[0].id : state.project.startSceneId;

      const newActiveId = state.activeSceneId === id ? cleanedScenes[0].id : state.activeSceneId;

      return {
        project: {
          ...state.project,
          scenes: cleanedScenes,
          startSceneId: newHomeId,
        },
        activeSceneId: newActiveId,
        selectedId: null,
        visualParents,
        dirty: true,
      };
    }),

  setActiveScene: (id) => {
    if (get().isModalEditingActive()) return;
    set({ activeSceneId: id, selectedId: null });
  },

  updateActiveScene: (patch) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) => ({ ...scene, ...patch })),
        dirty: true,
      };
    }),

  updateProjectSize: ({ width, height }) =>
    set((state) => ({
      project: {
        ...state.project,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      },
      dirty: true,
    })),

  setEnableBackButton: (enabled) =>
    set((state) => ({
      project: { ...state.project, enableBackButton: enabled },
      dirty: true,
    })),

  setEnableHomeButton: (enabled) =>
    set((state) => ({
      project: { ...state.project, enableHomeButton: enabled },
      dirty: true,
    })),

  // --- data connectors & bindings ---
  addDataConnector: (kind) => {
    const id = newId("conn");
    let connector: DataConnectorDef;

    // Create typed connector objects to satisfy discriminated union
    switch (kind) {
      case "rest":
        connector = {
          id,
          name: "REST connector",
          kind: "rest",
          input: { enabled: true, url: "", intervalMs: 5000 },
        };
        break;
      case "csv":
        connector = {
          id,
          name: "CSV sink",
          kind: "csv",
          output: { enabled: true, path: "analytics/session.csv", events: [], flushIntervalMs: 30000, maxBufferSize: 1000, appendMode: true },
        };
        break;
      case "json":
        connector = {
          id,
          name: "JSON sink",
          kind: "json",
          output: { enabled: true, path: "analytics/session.json", events: [], flushIntervalMs: 30000, maxBufferSize: 1000 },
        };
        break;
      case "jsonl":
        connector = {
          id,
          name: "JSONL sink",
          kind: "jsonl",
          output: { enabled: true, path: "analytics/session.jsonl", events: [], flushIntervalMs: 30000, maxBufferSize: 1000, appendMode: true },
        };
        break;
      case "console":
        connector = {
          id,
          name: "Console sink",
          kind: "console",
          output: { enabled: true, events: [], format: "table" as const, maxEvents: 100 },
        };
        break;
    }

    set((state) => ({
      project: { ...state.project, dataConnectors: [...(state.project.dataConnectors || []), connector] },
      dirty: true,
    }));
    return connector.id;
  },

  updateDataConnector: (id, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        dataConnectors: (state.project.dataConnectors || []).map((c) =>
          c.id === id ? ({ ...c, ...patch } as any) : c
        ),
      },
      dirty: true,
    })),

  removeDataConnector: (id) =>
    set((state) => ({
      project: {
        ...state.project,
        dataConnectors: (state.project.dataConnectors || []).filter((c) => c.id !== id),
        // Also drop any bindings that referenced it as a source.
        scenes: state.project.scenes.map((s) => ({
          ...s,
          elements: s.elements.map((e) => ({
            ...e,
            bindings: e.bindings.filter((b) => b.source !== id),
          })),
        })),
      },
      dirty: true,
    })),

  setBinding: (elementId, binding) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, elementId, (el) => ({
            ...el,
            bindings: [
              ...el.bindings.filter((b) => b.targetProp !== binding.targetProp),
              binding,
            ],
          }))
        ),
        dirty: true,
      };
    }),

  clearBinding: (elementId, targetProp) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, elementId, (el) => ({
            ...el,
            bindings: el.bindings.filter((b) => b.targetProp !== targetProp),
          }))
        ),
        dirty: true,
      };
    }),

  // --- interactions ---
  addInteraction: (elementId, trigger) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, elementId, (el) => ({
            ...el,
            interactions: [...el.interactions, { id: newId("int"), trigger, actions: [] }],
          }))
        ),
        dirty: true,
      };
    }),

  removeInteraction: (elementId, interactionId) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, elementId, (el) => ({
            ...el,
            interactions: el.interactions.filter((i) => i.id !== interactionId),
          }))
        ),
        dirty: true,
      };
    }),

  addAction: (elementId, interactionId, action) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, elementId, (el) => ({
            ...el,
            interactions: el.interactions.map((i: Interaction) =>
              i.id === interactionId ? { ...i, actions: [...i.actions, action] } : i
            ),
          }))
        ),
        dirty: true,
      };
    }),

  updateAction: (elementId, interactionId, index, patch) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, elementId, (el) => ({
            ...el,
            interactions: el.interactions.map((i: Interaction) =>
              i.id === interactionId
                ? {
                    ...i,
                    actions: i.actions.map((a: Action, idx: number) =>
                      idx === index ? { ...a, ...patch, params: { ...a.params, ...(patch.params ?? {}) } } : a
                    ),
                  }
                : i
            ),
          }))
        ),
        dirty: true,
      };
    }),

  removeAction: (elementId, interactionId, index) =>
    set((state) => {
      if (state.isModalEditingActive()) return state;
      return {
        project: withActiveScene(state, (scene) =>
          patchElement(scene, elementId, (el) => ({
            ...el,
            interactions: el.interactions.map((i: Interaction) =>
              i.id === interactionId
                ? { ...i, actions: i.actions.filter((_: Action, idx: number) => idx !== index) }
                : i
            ),
          }))
        ),
        dirty: true,
      };
    }),
}));
