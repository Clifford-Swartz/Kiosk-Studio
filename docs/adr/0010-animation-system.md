# ADR 0010: Animation System

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Design team, engine team

## Context

Kiosk experiences need touch feedback and visual polish. Current system supports instant property changes via `setProp` action, but no smooth transitions. Users want button press feedback, element reveals, property tweens — all currently require multi-scene workarounds or feel abrupt.

Use case: Immersive demos (server rack, factory floor) need animations for:
- Touch feedback (button scale on press)
- State transitions (panel slides in)
- Data-driven motion (gauge needle moves)

## Decision

Implement property tween animation system with `animate` action type.

### Scope

**Animatable properties (geometry only, v1):**
- `position` — x, y coordinates (both axes animated together)
- `scale` — width, height dimensions (both animated together)
- `opacity` — transparency (0-1)
- `rotation` — degrees

**Not animatable v1:** Color, fontSize, text content, src (discrete values, complex interpolation).

### Action Schema

```typescript
{
  type: "animate",
  params: {
    target: string;           // element ID
    property: "position" | "scale" | "opacity" | "rotation";
    from?: number | { x: number, y: number } | { width: number, height: number };
    to: number | { x: number, y: number } | { width: number, height: number };
    duration: number;         // milliseconds
    easing?: "linear" | "easeIn" | "easeOut" | "easeInOut";  // default: linear
    delay?: number;           // milliseconds, default: 0
  }
}
```

**`from` parameter behavior:**
- If omitted: animate from current rendered value at animation start time (after bindings + state + overrides)
- If provided: use static captured value (snapshot from editor)

### Runtime Behavior

**Execution model:**
- Animations in interactions are **sequential blocking** — interaction waits for animation to complete before executing next action
- Animations from passive triggers (enterScene, dataChanged) are **non-blocking** — scene navigation allowed mid-animation
- Navigation (goToScene/goBack) during ambient animation → cancels all running tweens

**Interruption handling:**
- New tween on same element + property → **blocked** until current tween completes
- Console warning logged, second tween discarded
- Element visibility set to `false` → running animations on that element cancelled immediately

**Rendering pipeline integration:**
Animations apply as final layer (after bindings, state overrides, interaction overrides). During tween, animated properties override all prior layers.

### Architecture

**New runtime context: AnimationRuntime**

Located at `packages/engine/src/runtime/AnimationRuntime.ts`. Manages:
- Active tween registry (keyed by `elementId + property`)
- requestAnimationFrame loop for per-frame updates
- Easing curve implementations
- Completion callbacks for blocking interactions

**Easing curves:**
- `linear` — no easing
- `easeIn` — cubic (0, 0, 0.58, 1.0)
- `easeOut` — cubic (0.42, 0, 1.0, 1.0)
- `easeInOut` — cubic (0.42, 0, 0.58, 1.0)

Standard CSS cubic-bezier values, implemented via closed-form cubic solver (no external library).

### UI Implementation

**InteractionsEditor changes:**

When user adds `animate` action, editor shows:
- Target dropdown (existing element picker)
- Property dropdown (4 options)
- From/To inputs (dual inputs for position/scale, single for opacity/rotation)
- 📍 Capture buttons — reads current value from target element on canvas, fills input field
- Duration number input (ms)
- Easing dropdown (4 presets)
- Delay number input (ms, optional)

**Property-specific inputs:**
- `position` → From: X [  ] Y [  ], To: X [  ] Y [  ]
- `scale` → From: W [  ] H [  ], To: W [  ] H [  ]
- `opacity` / `rotation` → From: [  ], To: [  ]

No per-axis checkboxes — position animates both x+y, scale animates both width+height.

## Consequences

### Positive

- **No external dependencies** — RequestAnimationFrame + cubic math, ~200 lines
- **Interaction blocking provides feedback guarantees** — Button press animation completes before navigation
- **Composable with existing systems** — Animations layer on top of bindings/states/overrides without conflict
- **Simple interruption model** — Block duplicates, no blend/queue complexity

### Negative

- **Limited property scope** — Can't animate colors, font sizes. Acceptable for v1 (80% of use cases covered).
- **No timeline editor** — Can't scrub animations in editor, must test in Play mode. Acceptable tradeoff for v1.
- **Sequential blocking can chain delays** — Multiple 500ms animations in one interaction = 2.5s wait. User responsibility to keep feedback tweens short (50-300ms).

### Edge Cases

**Tween + binding conflict:**
Animation writes to `x` property while binding also updates `x` → animation wins (applies last). When animation completes, binding value applies again. Expected behavior for data-driven motion.

**Tween + setState conflict:**
setState changes element visibility mid-tween → tween cancelled. setState with `animated: true` parameter fades out, swaps props instant, fades in — doesn't individually tween each prop (too complex for v1).

## Alternatives Considered

### Spring physics (rejected)

Natural motion, auto-timing. But:
- Requires stiffness/damping tuning (non-intuitive for non-technical users)
- Heavier implementation (~500 lines vs ~200)
- Can't guarantee duration (springs oscillate until settled)

Interaction blocking needs predictable duration. Tweens provide this, springs don't.

### CSS transitions (rejected)

Cheap, browser-native. But:
- Transition state lost on React unmount (scene change)
- Can't capture mid-transition values for "animate from current" behavior
- Can't easily hook completion for interaction blocking

### Keyframe sequences (rejected)

Full timeline control (multi-stop animations). Overkill for touch feedback. Revisit in v2 if users need complex paths.

## Implementation Notes

**Files to create:**
- `packages/engine/src/runtime/AnimationRuntime.ts` — Core tween engine
- `packages/engine/src/runtime/easings.ts` — Cubic bezier solver

**Files to modify:**
- `packages/engine/src/model/schema.ts` — Add animate to ActionTypeSchema
- `packages/engine/src/runtime/interactions.ts` — Add animate action handler (async, awaits completion)
- `packages/engine/src/render/Player.tsx` — Instantiate AnimationRuntime, pass to interaction context
- `apps/desktop/src/renderer/editor/InteractionsEditor.tsx` — Add animate action UI

**Migration:** No breaking changes. Existing projects ignore animate actions (unknown action type warning in current runtime).

## Related

- ADR 0011: Scene State Machine — setState can trigger animated transitions
- CONTEXT.md: Interaction section documents animate action
