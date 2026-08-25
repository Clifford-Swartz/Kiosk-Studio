# ADR 0013: Visibility/Interactivity Consolidation

**Status:** Accepted
**Date:** 2026-07-29
**Deciders:** Design team, engine team

## Context

The ask that triggered this: give button elements a toggle that makes them invisible and un-clickable, overridable per scene state.

Before adding that, an audit of how visibility already worked found it driven by four independent writers to `opacity`, composed by naive last-write-wins spread merges with no explicit precedence:

1. Base schema `opacity` field.
2. Scene-state `visible` override (`StateRuntime`), converted to opacity via `VisibilityManager.visibleToOpacity`.
3. The deprecated interaction-override `__hidden` flag (`ElementResolver`), converted to opacity via `VisibilityManager.hiddenToOpacity`.
4. Animation tweens (`AnimationRuntime`), the final pipeline layer per ADR 0010/0011.

Because these compose via plain object spreads with no terminal rule, whichever layer runs last wins — a running fade-in tween could silently fight a `visible: false` state override back to non-zero opacity.

Interactivity (whether pointer events / `onTap` etc. fire) was gated ad hoc and inconsistently per element type:

- Generic elements (`ElementRenderer`'s `isInteractive`/`isHoverable`/`isPressable`) checked only whether interactions were defined, ignoring opacity entirely — an invisible rectangle with a `tap` interaction was still clickable.
- `VideoElement` inferred visibility from `opacity > 0` for its own pointer-events check.
- `layer` elements used `visibility: hidden` at `opacity === 0`, for an unrelated reason (stopping fully-transparent layers from absorbing clicks meant for elements behind them).
- Buttons were the worst case: the real click target is a separate, always-`pointerEvents: auto` invisible overlay div rendered unconditionally, which checked nothing.

Adding a fifth ad hoc "enabled" writer/reader pair for buttons would have compounded this rather than fixed it.

## Decision

Introduce one boolean field, `visible?: boolean` (default `true`), as a top-level sibling of `opacity`/`locked` on the element schema. The name matches the scene-state override field that already existed (`StateElementOverrideSchema.visible`), so base elements and per-state overrides share one vocabulary instead of introducing a second name for the same concept.

`opacity` keeps its existing job as the continuous, animatable fade value. `visible` is the discrete on/off gate, and flows through `ElementResolver`'s schema → bindings → state → interaction-overrides → animations pipeline like any other field, with no clamp applied there.

An earlier version of this design clamped `opacity` to `0` inside `ElementResolver.resolveElement` itself whenever the resolved element had `visible === false`. That broke the editor: the desktop canvas renders through `<Player editorMode={true} .../>`, which resolves every element through this same shared pipeline before `ElementRenderer` ever sees it — so by the time `ElementRenderer` computed its dim-vs-hide decision, `opacity` had already been forced to `0` by the resolver, and the "dim to 0.4" case could never trigger (`opacity > 0` was always false). The fix moves the "`visible: false` always wins" enforcement to the one place that already knows whether it's rendering the editor or the Player — `ElementRenderer` itself — computed once and reused everywhere `baseStyle.opacity` (or an opacity-derived check) is needed:

```typescript
const editorDim = editorMode && !visible && opacity > 0;
const renderOpacity = editorMode
  ? (editorDim ? 0.4 : opacity)
  : (visible ? opacity : 0);
```

In `editorMode`, `renderOpacity` dims (0.4) rather than hides, preserving the true resolved `opacity` otherwise. Outside `editorMode` (Player/runtime), `renderOpacity` is forced to `0` whenever `!visible`, unconditionally — this is what makes `visible: false` always win regardless of which pipeline layer last touched `opacity`, closing the tween-vs-state-override race described above. `baseStyle.opacity` uses `renderOpacity`, and the `layer` case's `visibility: hidden` check (see below) was updated to key off `renderOpacity === 0` rather than the raw `opacity === 0`, for the same reason.

`VisibilityManager` collapses to a single predicate:

```typescript
static isVisible(element: Partial<Element>): boolean {
  return element.visible !== false;
}
```

used identically everywhere visibility or interactivity needs to be checked. `visibleToOpacity`, `hiddenToOpacity`, and `isVisibleInState` are removed — each is superseded by plain `visible` passthrough plus the terminal clamp.

`ElementRenderer` gates its three interaction flags on this predicate once, at the top of the component:

```typescript
const visible = VisibilityManager.isVisible(element);
const isInteractive = visible && element.interactions.some((i) => i.trigger === "tap");
const isHoverable = visible && element.interactions.some((i) => i.trigger === "hover" || i.trigger === "hoverEnd");
const isPressable = visible && element.interactions.some((i) => i.trigger === "press" || i.trigger === "release");
```

This is the single chokepoint: it fixes the latent "invisible-but-clickable" bug for every element type, not just buttons, and lets the button case simply skip rendering its click-catching overlay when not visible (`{!editorMode && visible && (...)}`).

A button's own on/off checkbox writes to this same `visible` field — no separate schema concept, since for a button "invisible" and "disabled" are the same state. Because the scene-state editor's existing "Visible" checkbox already writes the override sibling of this field, scene-state control of a button's on/off-ness came for free — no new state-override schema field or UI row.

**Editor-only dimming:** in the desktop editor canvas, an invisible element renders dimmed (`opacity: 0.4`) rather than fully hidden, so it stays selectable while editing; full invisibility applies only in the Player/runtime. This is computed once (`editorDim = editorMode && !visible && opacity > 0`) and folded into the shared `baseStyle.opacity`, so it applies uniformly to every element type that spreads `baseStyle` — not just buttons. The `opacity > 0` guard skips the dim override when the element's own base opacity is already 0 (a deliberate fully-transparent design choice) — there is nothing to dim.

**UI polarity:** the button-facing checkbox (Properties Panel and the scene-state override editor) is labeled "Disabled", not "Enabled" — checked = disabled/hidden, unchecked = normal. A checkbox should spend most of its life unchecked, and a button is enabled far more often than not, so this reads better than an "Enabled" checkbox that would sit checked almost always. It still writes the same `visible` field, inverted (checked → `visible: false`).

**Bonus fixes that fell out of this, not separately implemented:**
- The Scene Structure "eye" visibility toggle previously did `opacity: el.opacity === 0 ? 1 : 0`, which destroyed any partial opacity value (e.g. a 0.5 watermark) on hide/show. It now toggles `visible` instead, preserving `opacity`.
- The deprecated `toggle` interaction action (→ `ctx.toggleVisibility` → `__hidden` override) now also blocks/restores interactivity, not just opacity — previously an element with interactions remained clickable while "hidden" via this action.

## Out of Scope

- **Animation-cancel-on-hide.** ADR 0011 documents that animations should cancel when an element's visibility becomes `false` (`AnimationRuntime.cancelElement()`), but nothing in the current pipeline invokes it. This was already true before this change and remains an open gap.
- **`CollectionRenderer`'s decorative per-item opacity** (carousel/wheel/kenburns fades). It doesn't read element-level `visible`/`opacity` and isn't part of this consolidation.
- **Image crop-mode path.** `ElementRenderer`'s image element builds its style without spreading `baseStyle` when cropping, so cropped images don't pick up editor-dim treatment. Pre-existing quirk, not introduced by this change.

## Update (2026-07)

The `__hidden` override key described above as "deprecated" has been removed. `toggleOverride` and `applyOverrides` (`ElementResolver`) now write/read `visible` directly — the double-negation through a separate `__hidden` flag was pure indirection, since `applyOverrides` already had a generic `visible` handler from this same ADR. `ctx.toggleVisibility` (`Player.tsx`) now calls `overrideHost.toggleOverride(elementId, "visible")`. No schema or persisted-data change: the override store is runtime-only, and the `toggle` interaction action's shape is unchanged — only the internal storage key collapsed onto the one the rest of the pipeline already used.

## Alternatives Considered

### New `enabled` field duplicating `visible` (rejected)

An early design added a second boolean (`enabled`) alongside the existing scene-state `visible` override, plus marker-field smuggling (`_stateVisible`/`_stateEnabled`/`_interactive` cast through `as any`) and a multi-argument `VisibilityManager.resolve()`. Rejected as unnecessarily complex: it introduces a second name for the concept `visible` already covers, and the marker-smuggling defeats the point of a single terminal clamp. The field reuse (base `visible` + existing state-override `visible`) plus one clamp in `ElementResolver` covers the same cases with less surface area.

## Related

- ADR 0010: Animation System — animations are the final pipeline layer the terminal visibility clamp overrides.
- ADR 0011: Scene State Machine — introduced the `visible` state-override field this ADR's base-element `visible` field mirrors; also the source of the not-yet-implemented animation-cancel-on-hide behavior.
