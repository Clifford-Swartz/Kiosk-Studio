# 4. Tabbed Sidebar with Auto-Detected Scene Hierarchy

Date: 2026-06-22

## Status

Accepted

## Context

Original scene management had discoverability and organization problems:

1. **Hidden navigation structure** - TopBar dropdown showed flat list of scenes, no indication of goToScene flow (which scenes link where)
2. **Disconnected controls** - Scene management (Add/Rename/Delete) in TopBar, scene content tools (Palette, Layers, Data) in left sidebar → split attention, no spatial relationship
3. **No visual hierarchy** - 20-scene kiosk looked same as 3-scene kiosk in dropdown (alphabetical list), couldn't see navigation paths (Home → Products → ProductDetail) without clicking through interactions
4. **Cramped TopBar** - Scene dropdown + File + Undo/Redo + Play/Kiosk + Snap + Viewport reset → 8+ controls fighting for space

Users couldn't answer "which scenes are orphaned?" or "how do I get to Settings?" without manual traversal.

## Decision

Adopt **tabbed sidebar with auto-detected scene hierarchy**:

### 1. Sidebar Tab Structure

**Two tabs at top of left sidebar:**
- **Scene Tab** - existing tools (Palette, SceneStructure, DataSourcesPanel) for editing active scene content
- **Project Tab** - new scene hierarchy tree showing navigation topology

**Visual design:** Browser-style raised tabs (Chrome/VS Code pattern). Active tab connects to content area (no border between tab and panel), inactive tabs recessed.

**Why tabs not panels:** Consolidates related contexts (scene content vs project structure) in same spatial location. User learns "left sidebar = workspace controls" instead of hunting across TopBar and sidebar.

### 2. Auto-Detected Scene Hierarchy

**Algorithm:** Traverse all scenes → elements → interactions → extract goToScene actions → build parent map (childId → Set<parentIds>) → classify scenes by parent count.

**Star topology with flattening rules:**
- **Home scene** (blue text): `project.startSceneId`, always root level
- **Single-parent scenes**: nest under parent (only 1 goToScene points to them)
- **Multi-parent scenes** (green text): 2+ goToScene actions → flatten to root (ambiguous parent)
- **Orphan scenes** (red text): 0 goToScene actions → flatten to root (no navigation path)

**Example tree:**
```
Home (8)                      ← blue, root
├─ Products (5)               ← single parent: Home
│  └─ ProductDetail (12)      ← single parent: Products
└─ Services (3)               ← single parent: Home
Cart (15)                     ← green, multi-parent (Products + Services link here)
Settings (7)                  ← green, multi-parent (Home + Contact link here)
Archive (0)                   ← red, orphan (no goToScene points here)
```

**Why auto-detect not manual:** Navigation structure exists in goToScene actions—extracting it reveals actual flow. Manual hierarchy (user drags scenes into folders) duplicates structure and drifts when interactions change. Auto-detect is single source of truth.

**Why star topology:** Kiosks are radial flows (Home → feature branches), not deep trees. Multi-parent flattening prevents ambiguous nesting (is Cart child of Products or Services? Neither—it's shared). Orphans at root surface dead ends (scenes with no inbound path, likely bugs).

### 3. Visual Parent Overrides

**Use case:** User adds new scene via "+ Add child" action → creates scene visually nested under parent, but no goToScene action exists yet (red orphan status, nested position).

**Mechanism:** `visualParents: Map<sceneId, parentId>` in Zustand state. Hierarchy algorithm checks visualParents first, falls back to goToScene detection.

**Interaction with goToScene:**
- Scene has visual parent only → nest as red orphan (manual organization, no navigation path)
- Scene has 1 goToScene parent (matches visual) → nest, no color override (real single parent)
- Scene has 2+ goToScene parents → flatten to root with green text (multi-parent overrides visual)
- Delete parent → remove visual override, child becomes root-level red orphan

**Why separate from goToScene:** Visual parent is UI organization, goToScene is runtime navigation. Decoupling allows "add child scene, then wire interaction" workflow without forcing immediate navigation setup.

### 4. Per-Scene Inline Actions

**Hover reveals icons:** Add (+), Rename (✏), Delete (🗑)

**Add:** Creates new scene visually nested under this parent (visualParents Map entry). Scene starts as red orphan until goToScene added.

**Rename:** Immediate inline edit (input replaces name, Enter/blur saves, Escape cancels). Same pattern as SceneStructure inline rename.

**Delete:** Removes scene, breaks goToScene actions pointing to it, orphans visual children (remove visualParents entries), switches to Home if deleting active scene.

**Why inline not menu:** Frequent operations (especially Add during prototyping). Hover actions keep tools contextual (act on this scene), no mode switching to TopBar dropdown.

### 5. TopBar Simplification

**Removed:** Scene dropdown (Add/Rename/Delete menu), scene selector, inline rename input, scene-related state/functions.

**Kept:** File dropdown, Undo/Redo, Play/Kiosk, Snap toggle, Viewport reset.

**Result:** TopBar shrinks from 8+ controls to 6 (2 dropdowns + 4 icon buttons). More breathing room, clearer function separation (file/playback controls vs scene/content management).

## How This Supports Existing Principles

### Visual, not textual (CLAUDE.md § UX/UI principles)

- **Color-coded status** (blue/green/red) shows scene role at glance, no need to read labels like "orphan" or "multi-parent"
- **Tree connector lines** (│ ├─ └─) show parent-child relationships spatially, not via text descriptions
- **Element count thumbnails** `(n)` give content density feedback without opening scene

### Contextual, not generic

- **Smart Add button** creates child scene under clicked parent (contextual nesting), not generic "add to project" action
- **Hover actions** appear on scene being edited, not global toolbar (tools follow context)
- **Tab content adapts** to active tab (Scene tools vs Project tools), same spatial location different purpose

### Immediate validation

- **Auto-detected topology** validates navigation structure (orphans = scenes with no inbound path, likely forgotten)
- **Color feedback** signals structure issues (red = unreachable, green = ambiguous parent)
- **Star flattening** prevents invalid nesting (can't nest scene with 2 parents under 1 arbitrary parent)

### Discoverable hierarchy

- **Tree view reveals flow** at glance (Home → Products → ProductDetail path visible without clicking)
- **Inline expand/collapse** (chevron ▸/▾) lets user control detail level
- **Persistent state** (Zustand `collapsedScenes`) survives tab switches, user organizes view once

### Consolidated actions

- **Tabs group related tools** (Scene content vs Project structure) instead of scattering across TopBar and sidebar
- **Inline actions consolidate** scene operations at scene row (Add/Rename/Delete one hover away), no hunting for TopBar dropdown

### Batch React state updates (CLAUDE.md § Technical patterns)

- **addChildScene** batches 3 state changes (add scene to project, set visualParent, switch activeSceneId) into single `set()` call
- **removeScene** batches 5 updates (filter scenes, break goToScene, clean visualParents, update startSceneId, switch activeSceneId) into single `set()` call
- **No sequential `setState` calls** (follows existing undo/redo pattern from ADR 0003)

## Consequences

**Positive:**
- ✅ Navigation structure visible at glance (tree shows goToScene flow)
- ✅ Orphan detection automatic (red scenes = no inbound path, likely bugs)
- ✅ Scene management consolidated in sidebar (no TopBar hunting)
- ✅ TopBar decluttered (8+ controls → 6, more breathing room)
- ✅ Add child workflow intuitive (+ on parent → creates nested scene)
- ✅ Multi-parent ambiguity surfaced (green scenes = shared destinations, flatten to root)
- ✅ Spatial consistency (left sidebar = workspace tools, TopBar = file/playback)

**Negative:**
- ❌ One extra state Map (visualParents) to sync on delete (manageable, 10 lines in removeScene)
- ❌ Hierarchy rebuild on every project change (memoized, only recalcs when scenes/startSceneId/visualParents change)
- ❌ Star topology enforced (can't manually nest multi-parent scenes, trade-off for clarity)

**Neutral:**
- Tree rendering uses same recursive pattern as SceneStructure (consistent codebase style)
- Inline rename uses same immediate-edit pattern as existing TopBar rename (no new interaction model)
- Tab state in Zustand (not local) follows activeSceneId precedent (survives unmounts)

## Alternatives Considered

### 1. Manual Folder Hierarchy (Figma/VSCode Style)

**Approach:** User drags scenes into folders, hierarchy independent of goToScene actions.

**Pros:** Full control, can organize by feature/category (all checkout scenes in one folder).

**Cons:**
- Hierarchy drifts from runtime flow (folder says "Products → Cart" but goToScene shows "Services → Cart")
- Duplication (maintain both folder structure AND goToScene actions)
- No validation (orphans hidden in folders, multi-parents ambiguous)
- Complex sync (delete scene in folder, update goToScene elsewhere)

**Rejected:** Kiosks have inherent navigation structure (goToScene actions). Extracting it is simpler than duplicating it. Manual folders add ceremony without clarity.

### 2. Flat List with Filtering (Original Dropdown++)

**Approach:** Keep flat list, add filters for orphans/multi-parents/status.

**Pros:** Simpler algorithm (no tree recursion), familiar pattern.

**Cons:**
- Still can't see navigation paths (Home → Products → Detail requires clicking 3 scenes to understand)
- Filters are modes (user must switch view to see orphans, can't see all at once)
- No spatial relationship (tree shows "ProductDetail under Products" at glance, list requires filter + mental mapping)

**Rejected:** Fails discoverability goal. Users need to see whole structure, not slices.

### 3. Graph View (Node-Edge Visualization)

**Approach:** Render scenes as nodes, goToScene actions as edges (like React Flow).

**Pros:** Shows all navigation paths explicitly (every goToScene → arrow).

**Cons:**
- Overkill for 3-20 scene kiosks (graph layout for 5 nodes wastes space)
- No editing in place (graph view separate from scene list, need both)
- Complex interaction (drag nodes, pan/zoom graph, vs simple tree expand/collapse)
- Doesn't fit 220px sidebar (needs dedicated panel)

**Rejected:** Too complex for typical use. Tree view shows structure + enables editing in same space. Graph better for 100+ scene analysis (not editing).

### 4. Scene Dropdown with Inline Tree (No Tabs)

**Approach:** Replace dropdown with tree directly in TopBar, keep sidebar unchanged.

**Pros:** One fewer tab to click.

**Cons:**
- TopBar height explosion (tree needs vertical space, TopBar is horizontal strip)
- Cramped tree (TopBar width shared with File/Undo/Play, tree truncates names)
- Still disconnected (scene management in TopBar, scene content tools in sidebar)

**Rejected:** TopBar not suitable for vertical tree UI. Sidebar has space + spatial relationship to scene content tools.

## Implementation Notes

**Files created:**
- `apps/desktop/src/renderer/editor/sceneHierarchy.ts` - buildSceneHierarchy algorithm
- `apps/desktop/src/renderer/editor/SidebarTabs.tsx` - tab switcher component
- `apps/desktop/src/renderer/editor/ScenePanel.tsx` - Scene tab wrapper
- `apps/desktop/src/renderer/editor/ProjectHierarchy.tsx` - tree view component

**Files modified:**
- `apps/desktop/src/renderer/editor/store.ts` - add activeTab, collapsedScenes, visualParents state + methods
- `apps/desktop/src/renderer/editor/EditorShell.tsx` - replace sidebar with <SidebarTabs />
- `apps/desktop/src/renderer/editor/TopBar.tsx` - remove scene dropdown + selector

**Key patterns:**
- `useMemo(() => buildSceneHierarchy(...), [project.scenes, startSceneId, visualParents])` prevents rebuild on unrelated changes (e.g., element property edits)
- Recursive `renderNode(node, depth, isLast, parentLines)` matches SceneStructure tree pattern
- `visualParents` Map synced in `removeScene` (delete scene → orphan children + remove goToScene actions)
- Tree connector lines track parent state through recursion (`parentLines` boolean array)

**Verification:**
1. Create Home → Products → ProductDetail chain → tree shows 3-level nesting
2. Add goToScene from Services → ProductDetail → ProductDetail flattens to root (green)
3. Delete Products → ProductDetail stays at root (still has Services parent)
4. Click + on Home → new scene nested as red orphan
5. Add goToScene from Home to new scene → stays nested (single parent, red → default color)
6. Delete scene → goToScene actions pointing to it removed, visualParent entries cleaned
7. Switch Scene tab → Project tab → back → collapse state persists

**Rollback:** Revert 7 files (4 new, 3 modified). Changes isolated to sidebar + scene management, doesn't touch Canvas/Player/Properties.

## Related

- ADR 0003 (Undo/Redo save-as-checkpoint) - addChildScene/removeScene integrate with undo system via Zustand mutations
- CLAUDE.md § UX/UI principles - visual/contextual/consolidated design values justify tab structure and color coding
- SceneStructure.tsx - tree rendering pattern reused for ProjectHierarchy
