# ADR 0011: Scene State Machine

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Design team, engine team

## Context

Multi-step interactions currently require multiple scenes. Example: A hub with 3 buttons, each revealing detail panels and demo content. This becomes:
- Scene 1: Hub (3 buttons)
- Scene 2-4: Button A detail/demo/results
- Scene 5-7: Button B detail/demo/results
- Scene 8-10: Button C detail/demo/results

13 scenes for one logical screen. Navigation history gets polluted. User can't easily "undo" to hub without explicit back buttons on every scene.

Use case: Immersive demos (server rack with 8 blades, factory floor with 5 stations). Each sub-component needs detail view + interactive demo. Should be one scene with state transitions, not 40+ scenes.

## Decision

Implement scene-level state system with named states that control element visibility and property overrides.

### State Storage Model

**Scene schema addition:**

```typescript
interface Scene {
  // ... existing fields
  states?: {
    [stateName: string]: {
      elements: {
        [elementId: string]: {
          visible?: boolean;
          props?: Record<string, unknown>;
        }
      }
    }
  };
}
```

**Example:**
```json
{
  "id": "server-rack",
  "name": "Server Rack Demo",
  "states": {
    "blade3_detail": {
      "elements": {
        "panelA": { "visible": true },
        "panelB": { "visible": false },
        "buttonA": { "props": { "fill": "#3b82f6", "imageSrc": "blade3.jpg" } },
        "image1": { "props": { "src": "blade3-closeup.jpg" } }
      }
    },
    "blade5_detail": {
      "elements": {
        "panelA": { "visible": false },
        "panelC": { "visible": true },
        "buttonB": { "props": { "fill": "#10b981" } }
      }
    }
  }
}
```

### Default State

Every scene has implicit "default" state:
- Represents base scene (elements as defined in schema, no overrides)
- Always exists, can't be deleted or edited
- Scene loads with no active state → elements render from schema defaults

Custom states apply **on top** of default. Elements not mentioned in state definition → use default visibility + props.

### Supported Property Overrides (v1)

**Visibility:**
- `visible` (boolean) — controls CSS `display: none/block`

**Visual properties:**
- `text`, `label` — text content (string)
- `fill`, `color` — colors (hex string)
- `src` — media source for image/video/audio elements (string)
- `imageSrc` — button fill image (string)

**Not supported v1:** fontSize, radius, geometry (x/y/width/height — use animations instead), loop/muted.

### setState Action

**Action schema:**

```typescript
{
  type: "setState",
  params: {
    stateName: string;        // "default", "blade3_detail", etc.
    animated?: boolean;       // default: false (instant)
    duration?: number;        // milliseconds (only if animated=true)
  }
}
```

**Behavior:**
- `animated: false` (default) — Instant swap. Visibility + props change same frame.
- `animated: true` — Fade transition. Fade out (opacity 1→0), swap visibility+props instant, fade in (0→1). Numeric props not individually tweened (too complex for v1).
- `stateName: "default"` — Clears all state overrides, returns to base scene.

**Execution:** setState is **non-blocking** in interactions. Action completes instantly (or after fade duration if animated). Next action in sequence runs immediately (or after fade).

### Rendering Pipeline Order

State overrides apply as third layer (after bindings, before interaction overrides):

1. **Project schema** — Base element properties
2. **Bindings** — Live data updates (EventBus dataChanged events)
3. **State overrides** — Visibility + props from active state (if any)
4. **Interaction overrides** — setProp writes from interactions (runtime-only)
5. **Animations** — Tweens in progress (final layer, per ADR 0010)

**Conflict resolution:**
- State overrides **block** bindings for same property. If state sets `text`, binding to `text` ignored.
- Interaction overrides (setProp) **override** state props. setState then setProp → setProp wins.
- Animations **override** everything for animated property duration.

### UI Implementation

**New tab in right toolbar: States**

Located next to Properties tab. Drill-in navigation:

**View 1: State list**
```
Scene: Server Rack Demo

[+ New State]

default (initial)
blade3_detail
blade5_detail
```

- `default` shown in gray, not clickable
- Custom states clickable → drills into state editor
- Click state name → navigate to View 2

**View 2: State editor**
```
← Back to States

State: blade3_detail

Name
[blade3_detail            ]

[Delete State]

─────────────────────────────

Click an element on canvas to
configure overrides, or select
from list below:

• panelA (visible, 2 overrides)
• buttonA (1 override)
```

- Back button returns to state list
- State name inline-editable (text input)
- Element list clickable, hover highlights element in canvas
- Clicking element (canvas or list) → navigate to View 3

**View 3: Element overrides**
```
← Back to States

State: blade3_detail
Element: panelA

Visibility
☑ Visible in this state

▼ Property Overrides

  [+ Add Override ▾]

  fill
  [#3b82f6        ] [🗑]

  opacity
  [0.9            ] [🗑]

[Remove from State]
```

- Visibility checkbox controls element show/hide in this state
- Add Override dropdown shows curated prop list (element-type-aware: text/label, fill/color, src/imageSrc)
- Individual override delete buttons (🗑)
- Remove from State button clears all overrides + unchecks visibility

**Context behavior:**
- Scene switch while in state editor → auto-navigate back to state list for new scene
- Element delete (keyboard shortcut) while editing state → deletes element from project (normal delete), not just from state

**Keyboard shortcuts:**
- `Escape` in state editor → back to state list

### InteractionsEditor Changes

**setState action UI:**
```
1. setState
   State      [blade3_detail      ▾]
   Transition [instant            ▾]
   Duration   [300    ] ms
```

State dropdown includes "default" option + all custom states from current scene. Transition dropdown: instant / animated. Duration field only shows when animated selected.

## Consequences

### Positive

- **Collapses multi-scene flows into one scene** — 40-scene server rack demo becomes 1 scene + 8 states. Easier to edit, cleaner navigation history.
- **Declarative configuration** — States are named snapshots. Interaction says "go to blade3_detail state", not 20 setProp calls.
- **Reusable** — Multiple interactions can setState("blade3_detail"). DRY principle.
- **Composable with bindings** — Live data still flows through bindings. State controls visibility + static overrides, bindings control dynamic values.

### Negative

- **No cross-scene states** — Can't share state definitions between scenes. Acceptable for v1 (scenes represent distinct contexts).
- **No state transitions with conditions** — Can't define "on exit blade3_detail, if X then Y". Must encode in interactions. Acceptable (interactions already handle conditionals via dataChanged triggers).
- **Limited animation on setState** — Only fade in/out, not per-property tweens. Complex state transitions need explicit animate actions. Acceptable for v1.

### Edge Cases

**Active state + scene navigation:**
When user navigates away from scene → active state cleared. Returning to scene → loads with default state (or no state if no default). States are scene-local, not session-persistent.

**State override + binding + setProp:**
Element has all three:
- Schema: `text: "Ready"`
- Binding: `text → data.status` (value "Running")
- State: `text: "Demo Mode"`
- Interaction: `setProp(text, "Override")`

Result: `"Override"` (interaction setProp wins, applies last). If setProp not called, state "Demo Mode" wins (blocks binding per rendering order).

**State change mid-animation:**
Element animating `opacity 1→0`. setState called with `visible: false` for that element. Animation cancelled immediately (nothing to render). Expected behavior per ADR 0010 visibility rule.

## Alternatives Considered

### Visibility-only states (rejected)

Simpler implementation (no prop overrides). But:
- Can't swap images/text per state
- Still need 4 separate buttons for different fill colors
- Doesn't solve "one scene" goal for immersive demos

Prop overrides critical for collapsing multi-scene flows.

### Global state machine (rejected)

One state machine for entire project, shared across scenes. But:
- State namespace pollution (40 states across 10 scenes)
- Cross-scene state leakage (accidentally reference state from different scene)
- Harder to reason about (which scene is this state for?)

Scene-local states clearer. One screen = one scene = one state set.

### Full statecharts (rejected)

Hierarchical states, parallel regions, guards, history. Industry standard (XState, statecharts.dev). But:
- Massive scope (3-5 week implementation)
- Complex UI (flowchart editor, transition arrows)
- Overkill for v1 use cases (most demos need 3-5 flat states)

Revisit in v2 if users need nested states or transition guards.

## Implementation Notes

**Files to create:**
- `packages/engine/src/runtime/StateRuntime.ts` — Active state tracking, apply overrides

**Files to modify:**
- `packages/engine/src/model/schema.ts` — Add Scene.states field, setState action type
- `packages/engine/src/runtime/interactions.ts` — Add setState action handler
- `packages/engine/src/render/Player.tsx` — Instantiate StateRuntime, track active state
- `packages/engine/src/render/ElementRenderer.tsx` — Apply state overrides in rendering pipeline
- `apps/desktop/src/renderer/RightToolbar.tsx` — Add States tab
- `apps/desktop/src/renderer/editor/StatesPanel.tsx` — New component (state list + editor)
- `apps/desktop/src/renderer/editor/InteractionsEditor.tsx` — Add setState action UI

**Schema migration:** Add `Scene.states` as optional field (default empty object). Existing projects load without states. New editor version can add states to old projects without breaking runtime.

## Related

- ADR 0010: Animation System — Animations compose with state transitions
- ADR 0007: Event-Driven Data Architecture — Bindings interact with state overrides in rendering pipeline
- CONTEXT.md: Scene section documents state model, setState action
