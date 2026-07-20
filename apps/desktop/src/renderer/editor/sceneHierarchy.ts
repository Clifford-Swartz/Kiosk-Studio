import type { Project, Element } from "@kiosk/engine";

export interface SceneNode {
  sceneId: string;
  name: string;
  elementCount: number;
  children: SceneNode[];
  parentCount: number; // 0=orphan, 1=single, 2+=multi
  isHome: boolean;
}

/**
 * Build scene hierarchy from goToScene actions + visual parent overrides.
 * Returns root-level nodes (home, multi-parents, orphans) with nested children.
 */
export function buildSceneHierarchy(
  project: Project,
  visualParents: Map<string, string>
): SceneNode[] {
  const homeId = project.startSceneId ?? project.scenes[0]?.id;

  // 1. Build parent map from goToScene actions
  const goToSceneParents = new Map<string, Set<string>>();

  for (const scene of project.scenes) {
    for (const element of scene.elements) {
      traverseElement(element, scene.id);
    }
  }

  function traverseElement(el: Element, sceneId: string) {
    for (const interaction of el.interactions) {
      for (const action of interaction.actions) {
        if (action.type === "goToScene" && typeof action.params.sceneId === "string") {
          const targetId = action.params.sceneId;
          if (!goToSceneParents.has(targetId)) {
            goToSceneParents.set(targetId, new Set());
          }
          goToSceneParents.get(targetId)!.add(sceneId);
        }
      }
    }
    // Traverse children (groups)
    if (el.children) {
      for (const child of el.children) {
        traverseElement(child, sceneId);
      }
    }
  }

  // 2. Classify scenes by parent count
  const classification = new Map<
    string,
    { goToSceneCount: number; visualParent: string | null }
  >();

  for (const scene of project.scenes) {
    const goToSceneCount = goToSceneParents.get(scene.id)?.size ?? 0;
    const visualParent = visualParents.get(scene.id) ?? null;
    classification.set(scene.id, { goToSceneCount, visualParent });
  }

  // 3. Build tree recursively
  function buildNode(sceneId: string): SceneNode {
    const scene = project.scenes.find((s) => s.id === sceneId)!;
    const { goToSceneCount } = classification.get(sceneId)!;

    // Find children (scenes with this scene as single parent OR visual parent)
    const children: SceneNode[] = [];
    for (const [childId, childData] of classification.entries()) {
      if (childId === sceneId || childId === homeId) continue;

      // Child if:
      // - Single goToScene parent is this scene
      // - OR no goToScene parents but visual parent is this scene
      const goToSceneParentsSet = goToSceneParents.get(childId);
      const isSingleGoToSceneParent =
        childData.goToSceneCount === 1 && goToSceneParentsSet?.has(sceneId);
      const isVisualChild = childData.goToSceneCount === 0 && childData.visualParent === sceneId;

      if (isSingleGoToSceneParent || isVisualChild) {
        children.push(buildNode(childId));
      }
    }

    return {
      sceneId: scene.id,
      name: scene.name,
      elementCount: scene.elements.length,
      children,
      parentCount: goToSceneCount,
      isHome: scene.id === homeId,
    };
  }

  // 4. Assemble root level
  const root: SceneNode[] = [];

  // Home first (blue)
  if (homeId) {
    root.push(buildNode(homeId));
  }

  // Multi-parents (green) - scenes with 2+ goToScene parents
  for (const [sceneId, { goToSceneCount }] of classification.entries()) {
    if (sceneId !== homeId && goToSceneCount >= 2) {
      root.push(buildNode(sceneId));
    }
  }

  // Orphans (red) - scenes with 0 goToScene parents and no visual parent
  for (const [sceneId, { goToSceneCount, visualParent }] of classification.entries()) {
    if (sceneId !== homeId && goToSceneCount === 0 && !visualParent) {
      root.push(buildNode(sceneId));
    }
  }

  return root;
}
