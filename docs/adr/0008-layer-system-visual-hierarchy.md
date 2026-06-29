# ADR 0008: Layer System for Visual Hierarchy

**Date:** 2026-06-29  
**Status:** Accepted  
**Deciders:** Brandon Stih

## Context

The original Kiosk Studio schema included a `group` element type intended for organizational hierarchy. However:
1. **Never used** - No code created or consumed `group` elements
2. **Underspecified** - No clear semantics beyond "container with children"
3. **Missing features** - Designers needed visual effects (tints, masks) and locking that `group` didn't provide

Kiosk experiences require:
- **Compositional layers** for z-index management (backgrounds, content, overlays)
- **Visual effects** applied to groups of elements (color tints, clip masks)
- **Edit protection** to prevent accidental changes to layout structure
- **Hierarchical organization** visible in the editor's scene tree

## Decision

Replace `group` with **Layer**: a fullscreen container with visual effects and organizational capabilities.

### Schema Changes (schemaVersion 2 → 3)

1. **Element type enum**: Replace `"group"` with `"layer"`
2. **New properties**:
   - `tint?: { color: string; opacity: number }` - Color overlay (hex + 0-1 opacity)
   - `mask?: { type: "rect" | "polygon"; points: [number, number][] }` - Vector clip region
   - `locked?: boolean` - Prevents selection/editing of layer + descendants
3. **Migration**: Auto-convert existing `group` elements to `layer` in `parseProject()`

### Rendering

- **Geometry enforcement**: Layers always render at `x:0, y:0, width:projectWidth, height:projectHeight` (override user-set values)
- **Clip mask**: SVG `<clipPath>` with rect or polygon shape, applied to children container
- **Tint overlay**: Absolute-positioned div with `backgroundColor` + `opacity`, `pointerEvents: none`, renders on top of children
- **Canvas exclusion**: Layers filtered out of hit targets (not selectable via canvas click/drag)

### Editor Features

**SceneStructure panel:**
- Tree rendering with collapse/expand arrows (▸/▾)
- Indentation (20px per depth level)
- Darker background for layer rows
- Lock/unlock button (🔒/🔓) per layer
- "+ Layer" button in panel header

**PropertiesPanel:**
- Hide geometry inputs (x/y/width/height/rotation) when layer selected
- Show tint controls: color picker + opacity slider (0-100%)
- Show mask section: [Edit Mask] button + thumbnail preview
- Show lock checkbox with explanation text

**MaskEditorModal:**
- Fullscreen overlay with canvas showing desaturated scene preview
- Rectangle tool: click-drag creates 2-point rect mask
- Polygon tool: click adds points, double-click or Enter closes shape
- Edit mode: drag existing points to reposition
- Visual: blue outline + 30% fill overlay, 6px control point circles
- Toolbar: [Rectangle] [Polygon] [Delete Mask] [Cancel] [Done]

### Constraints

1. **Depth limit**: Maximum 2 layers deep (layer → layer → elements, but not deeper)
   - Rationale: Prevent infinite nesting complexity, keep scene tree scannable
2. **Fullscreen only**: No custom positioning/sizing
   - Rationale: Layers are organizational/effect containers, not positioned elements
3. **Collections can nest in layers**, but **layers cannot nest in collections**
   - Rationale: Collections own their layout algorithm, layers don't participate
4. **Single-shape masks only** (no boolean unions/intersections in v1)
   - Rationale: Keep mask editor simple, defer complex CSG operations

## Implementation Notes

### Mask Rendering (SVG clipPath)

Browser support: IE 9+, all modern browsers. Rect and polygon both use `<clipPath>` with appropriate child:
```jsx
<clipPath id={clipId}>
  {mask.type === "rect" ? (
    <rect x={p[0][0]} y={p[0][1]} width={w} height={h} />
  ) : (
    <polygon points={pointsStr} />
  )}
</clipPath>
<div style={{ clipPath: `url(#${clipId})` }}>
  {children}
</div>
```

### Undo Granularity

Each polygon point add = new undo snapshot (consistent with all editor mutations). Rect drag = single snapshot on mouseUp (not per pixel move).

### Empty Layer Deletion

When deleting a layer with children, children are **promoted to scene root** (not deleted with parent). Prevents accidental data loss. Layer deletion = reparent children, then remove layer element.

## Consequences

### Positive

- **Compositional hierarchy**: Designers can organize elements into background/content/overlay layers
- **Visual effects**: Tint overlays (brand colors, night mode) and masks (non-rectangular viewports) now possible
- **Edit safety**: Lock layers to prevent accidental structure changes during detailed work
- **Cleaner schema**: Replace unused `group` with well-defined `layer` semantics

### Negative

- **Breaking change**: Projects with `group` elements require migration (auto-handled by parseProject)
- **Canvas complexity**: Layer hit detection (must click-through) adds special-case logic
- **Depth limit enforcement**: Editor must validate and prevent >2 layer nesting (not yet implemented)

### Neutral

- **Mask editor learning curve**: Polygon tool less discoverable than rect, but matches design tool conventions (Figma, Sketch)

## Future Work

1. **Drag-drop reparenting**: Visual affordance for moving elements into/out of layers
2. **Multi-select**: Click layer row → select all direct children, show layer props
3. **Mask boolean operations**: Union/intersect/subtract for complex clip shapes
4. **Blend modes**: Multiply, screen, overlay for tint layers (requires canvas/SVG filter chains)
5. **Layer effects**: Blur, drop shadow, inner shadow (CSS filters or SVG)

## Related

- **ADR 0003**: Save-as-checkpoint undo/redo (layer ops create history snapshots)
- **ADR 0007**: Event-driven data architecture (layers participate in binding pipeline)
- **Schema migration**: `schemaVersion: 2 → 3` handled by `migrateGroupsToLayers()`

## Files Modified

### Core Schema & Model
- `packages/engine/src/model/schema.ts` - LayerTintSchema, LayerMaskSchema, Element fields
- `packages/engine/src/model/factory.ts` - createElement() defaults for layers
- `packages/engine/src/model/types.ts` - LayerMask type export

### Rendering
- `packages/engine/src/render/ElementRenderer.tsx` - Layer case with mask + tint rendering
- `packages/engine/src/render/Player.tsx` - Enforce fullscreen geometry for layers

### Editor UI
- `apps/desktop/src/renderer/editor/Canvas.tsx` - Filter layers from hit targets
- `apps/desktop/src/renderer/editor/store.ts` - collapsedElementIds, toggleElementCollapse, createLayer
- `apps/desktop/src/renderer/editor/SceneStructure.tsx` - Tree UI with collapse + lock
- `apps/desktop/src/renderer/editor/PropertiesPanel.tsx` - LayerFields component
- `apps/desktop/src/renderer/editor/MaskEditorModal.tsx` - NEW: Mask editing interface

### Documentation
- `CONTEXT.md` - Layer concept added, Element types updated
- `docs/adr/0008-layer-system-visual-hierarchy.md` - This ADR
