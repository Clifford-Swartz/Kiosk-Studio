import { create } from "zustand";
import {
  createElement,
  createScene,
  newId,
  type Action,
  type Binding,
  type DataSourceDef,
  type DataSourceKind,
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
  /** Clipboard: holds a copy of the last copied/cut element. */
  clipboard: Element | null;
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

  // --- selectors (derived) ---
  activeScene: () => Scene;

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
  selectElement: (id: string | null) => void;

  // --- clipboard ops ---
  copyElement: () => void;
  cutElement: () => void;
  pasteElement: () => void;

  // --- editor ui ---
  toggleSnap: () => void;
  setUserZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  resetViewport: () => void;
  setActiveTab: (tab: "scene" | "project") => void;
  toggleSceneCollapse: (sceneId: string) => void;
  setVisualParent: (sceneId: string, parentId: string | null) => void;
  addChildScene: (parentId: string) => void;

  // --- scene ops ---
  addScene: () => void;
  renameScene: (id: string, name: string) => void;
  /** Update active scene properties (background, backgroundSize, backgroundPosition, transition — canvas size is project-wide). */
  updateActiveScene: (patch: Partial<Pick<Scene, "background" | "backgroundSize" | "backgroundPosition" | "transition">>) => void;
  /** Update the project-wide canvas size (applies to all scenes). */
  updateProjectSize: (size: { width?: number; height?: number }) => void;
  removeScene: (id: string) => void;
  setActiveScene: (id: string) => void;

  // --- navigation settings ---
  setEnableBackButton: (enabled: boolean) => void;
  setEnableHomeButton: (enabled: boolean) => void;

  // --- data sources & bindings (live data) ---
  addDataSource: (kind: DataSourceKind) => string;
  updateDataSource: (id: string, patch: Partial<DataSourceDef>) => void;
  removeDataSource: (id: string) => void;
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

/** Map over a scene's elements, patching the one matching `id`. */
function patchElement(
  scene: Scene,
  id: string,
  transform: (el: Element) => Element
): Scene {
  return { ...scene, elements: scene.elements.map((e) => (e.id === id ? transform(e) : e)) };
}

export const useEditor = create<EditorState>((set, get) => ({
  // Placeholder until loadProject runs; replaced on first render.
  project: { schemaVersion: 1, id: "", name: "", width: 1920, height: 1080, scenes: [createScene()], dataSources: [], enableBackButton: false, enableHomeButton: false },
  activeSceneId: "",
  selectedId: null,
  filePath: null,
  dirty: false,
  historyNonce: 0,
  snapEnabled: true,
  clipboard: null,
  canvasViewport: { userZoom: 1, panX: 0, panY: 0 },
  activeTab: "scene",
  collapsedScenes: new Set(),
  visualParents: new Map(),

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

  setUserZoom: (zoom) => set((s) => ({
    canvasViewport: { ...s.canvasViewport, userZoom: zoom }
  })),

  setPan: (panX, panY) => set((s) => ({
    canvasViewport: { ...s.canvasViewport, panX, panY }
  })),

  resetViewport: () => set({ canvasViewport: { userZoom: 1, panX: 0, panY: 0 } }),

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
    set((state) => ({
      project: withActiveScene(state, (scene) =>
        patchElement(scene, id, (el) => ({ ...el, ...patch }))
      ),
      dirty: true,
    })),

  updateElementProps: (id, props) =>
    set((state) => ({
      project: withActiveScene(state, (scene) =>
        patchElement(scene, id, (el) => ({ ...el, props: { ...el.props, ...props } }))
      ),
      dirty: true,
    })),

  moveElement: (id, x, y) =>
    set((state) => ({
      project: withActiveScene(state, (scene) =>
        patchElement(scene, id, (el) => ({ ...el, x, y }))
      ),
      dirty: true,
    })),

  resizeElement: (id, rect) =>
    set((state) => ({
      project: withActiveScene(state, (scene) =>
        patchElement(scene, id, (el) => ({ ...el, ...rect }))
      ),
      dirty: true,
    })),

  removeElement: (id) =>
    set((state) => ({
      project: withActiveScene(state, (scene) => ({
        ...scene,
        elements: scene.elements.filter((e) => e.id !== id),
      })),
      selectedId: state.selectedId === id ? null : state.selectedId,
      dirty: true,
    })),

  reorderElement: (id, toIndex) =>
    set((state) => ({
      project: withActiveScene(state, (scene) => {
        const els = [...scene.elements];
        const from = els.findIndex((e) => e.id === id);
        if (from === -1) return scene;
        const [moved] = els.splice(from, 1);
        els.splice(Math.max(0, Math.min(toIndex, els.length)), 0, moved);
        // Renumber zIndex to match array order so draw order is explicit.
        return { ...scene, elements: els.map((e, i) => ({ ...e, zIndex: i + 1 })) };
      }),
      dirty: true,
    })),

  selectElement: (id) => set({ selectedId: id }),

  // --- clipboard ops ---
  copyElement: () => {
    const { selectedId, activeScene } = get();
    if (!selectedId) return;
    const el = activeScene().elements.find((e) => e.id === selectedId);
    if (el) set({ clipboard: el });
  },

  cutElement: () => {
    const { selectedId, copyElement, removeElement } = get();
    if (!selectedId) return;
    copyElement();
    removeElement(selectedId);
  },

  pasteElement: () => {
    const { clipboard } = get();
    if (!clipboard) return;
    // Clone element with new ID, offset by 20px so not stacked directly on top
    const cloned: Element = {
      ...clipboard,
      id: newId("el"),
      x: clipboard.x + 20,
      y: clipboard.y + 20,
    };
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
      const scene = createScene({ name: `Scene ${state.project.scenes.length + 1}` });
      return {
        project: { ...state.project, scenes: [...state.project.scenes, scene] },
        activeSceneId: scene.id,
        selectedId: null,
        dirty: true,
      };
    }),

  renameScene: (id, name) =>
    set((state) => ({
      project: {
        ...state.project,
        scenes: state.project.scenes.map((s) => (s.id === id ? { ...s, name } : s)),
      },
      dirty: true,
    })),

  removeScene: (id) =>
    set((state) => {
      if (state.project.scenes.length <= 1) return state; // keep at least one

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

  setActiveScene: (id) => set({ activeSceneId: id, selectedId: null }),

  updateActiveScene: (patch) =>
    set((state) => ({
      project: withActiveScene(state, (scene) => ({ ...scene, ...patch })),
      dirty: true,
    })),

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

  // --- data sources & bindings ---
  addDataSource: (kind) => {
    const ds: DataSourceDef = {
      id: newId("src"),
      name: `${kind.toUpperCase()} source`,
      kind,
      config: kind === "rest" ? { url: "", intervalMs: 5000 } : {},
    };
    set((state) => ({
      project: { ...state.project, dataSources: [...state.project.dataSources, ds] },
      dirty: true,
    }));
    return ds.id;
  },

  updateDataSource: (id, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        dataSources: state.project.dataSources.map((d) =>
          d.id === id ? { ...d, ...patch, config: { ...d.config, ...(patch.config ?? {}) } } : d
        ),
      },
      dirty: true,
    })),

  removeDataSource: (id) =>
    set((state) => ({
      project: {
        ...state.project,
        dataSources: state.project.dataSources.filter((d) => d.id !== id),
        // Also drop any bindings that referenced it.
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
    set((state) => ({
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
    })),

  clearBinding: (elementId, targetProp) =>
    set((state) => ({
      project: withActiveScene(state, (scene) =>
        patchElement(scene, elementId, (el) => ({
          ...el,
          bindings: el.bindings.filter((b) => b.targetProp !== targetProp),
        }))
      ),
      dirty: true,
    })),

  // --- interactions ---
  addInteraction: (elementId, trigger) =>
    set((state) => ({
      project: withActiveScene(state, (scene) =>
        patchElement(scene, elementId, (el) => ({
          ...el,
          interactions: [...el.interactions, { id: newId("int"), trigger, actions: [] }],
        }))
      ),
      dirty: true,
    })),

  removeInteraction: (elementId, interactionId) =>
    set((state) => ({
      project: withActiveScene(state, (scene) =>
        patchElement(scene, elementId, (el) => ({
          ...el,
          interactions: el.interactions.filter((i) => i.id !== interactionId),
        }))
      ),
      dirty: true,
    })),

  addAction: (elementId, interactionId, action) =>
    set((state) => ({
      project: withActiveScene(state, (scene) =>
        patchElement(scene, elementId, (el) => ({
          ...el,
          interactions: el.interactions.map((i: Interaction) =>
            i.id === interactionId ? { ...i, actions: [...i.actions, action] } : i
          ),
        }))
      ),
      dirty: true,
    })),

  updateAction: (elementId, interactionId, index, patch) =>
    set((state) => ({
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
    })),

  removeAction: (elementId, interactionId, index) =>
    set((state) => ({
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
    })),
}));
