# Kiosk Studio

Kiosk Studio is a visual editor and runtime for building interactive kiosk experiences. It combines a desktop editor app with an embeddable engine for rendering and executing designs.

## Agent skills

### Issue tracker

Issues are tracked in [GitHub Issues](https://github.com/Clifford-Swartz/Kiosk-Studio/issues). See `docs/agents/issue-tracker.md`.

### Triage labels

Uses standard triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at the repo root for all packages (desktop app and engine). See `docs/agents/domain.md`.

## Architecture notes

### Runtime contexts

**Current state (2026-07):** `ElementResolver` (`packages/engine/src/data/ElementResolver.ts`) is the single consolidated interface for the rendering pipeline — owns binding values and interaction overrides directly, and wires in `StateRuntime`/`AnimationRuntime` as external providers (`setStateProvider`/`setAnimationProvider`). `useResolveElement()` resolves all five pipeline layers (schema → bindings → state → overrides → animations) behind one call.

The second and third runtime contexts anticipated below (state, animation) did emerge, but weren't extracted into a `context/` folder — they were absorbed as providers into `ElementResolver` instead (ADR 0010, ADR 0011). The older `BindingContext` + `overrideStore`/`applyOverrides`/`useOverrides` split was deleted 2026-07 (dead code, fully superseded by `ElementResolver`).

**Speculative refactor trigger:** If `MediaContext` or `AssetContext`-shaped concerns emerge (playback coordination/playlists, or CDN switching/preloading/caching), reassess whether they fit the same provider pattern as `StateRuntime`/`AnimationRuntime`, or warrant extraction into their own module.

### ElementResolver implementation lessons (2026-06, orig. BindingContext)

**Issue:** Initial consolidation broke video elements—src updates didn't apply, elements rendered wrong size.

**Root causes:**
1. **React hook violation:** `useElement(element)` called `useSyncExternalStore` internally but was invoked inside `.map()` loop, violating Rules of Hooks ("Rendered more hooks than during the previous render").
2. **Unstable resolver:** Resolver function recreated every render → React saw elements as "changed" → video lifecycle broke.
3. **Stale cache:** Cache keyed by `element.id`. When editor mutated element (add video src), ID stayed same but props changed. Cache returned old element with no src.

**Solutions:**
1. **Split interface:** `BindingContext.useBindings()` returns resolver function. Hook called at component top-level (safe), resolver called in loop (safe).
2. **Stable resolver:** `this.resolveElement` bound to instance → same reference every call → React sees stable identity.
3. **Cache invalidation:** `bindingHost.clearCache()` called in `useMemo(() => clearCache(), [project])` in Player → clears BEFORE render uses cache, not after (useEffect too late).

**Key insight:** Cache for binding resolution must clear on **project structure changes** (editor mutations), not just on **data value changes** (setValue). Two separate invalidation triggers.

## UX/UI design principles (2026-06)

### Core values

**Visual, not textual.** Icons over labels. Color thumbnails over type names. Show the thing, not a description of it. Users scan faster than they read.

**Contextual, not generic.** Inputs adapt to data type. Editing fill color → color picker + hex input. Editing font size → number input. Editing text → textarea. No "enter any value" text boxes—show the right control for the property type.

**Immediate validation.** Dropdowns over text inputs for property names. User picks from known-valid options, can't typo "borderRadius" when codebase uses "radius". Smart dropdowns pull editable properties from element type (text shows text/fontSize/color, rectangle shows fill/radius, button shows label/fill/color).

**Discoverable hierarchy.** Scene structure shows z-index numbers + color thumbnails. Rectangle with red fill → red rect thumbnail. Text with blue color → blue "T". Scan layer stack at a glance, no need to click each element to see properties.

**Consolidated actions.** Dropdowns over sprawling button rows. TopBar: File dropdown (Open/Save/Import) + Scene dropdown (Add/Rename/Delete) + 4 icon buttons (Kiosk/Play/Undo/Redo). Before: 15+ buttons spread across bar. After: 2 dropdowns + 4 icons. Keep frequent actions visible, tuck infrequent ones into menus.

**Compact density.** Palette: 3-column icon grid vs vertical list. ~180px tall vs ~320px. Icons only, labels on hover. Same functionality, half the height.

### Technical patterns

**Batch React state updates.** NEVER call multiple `setState` or `setParam` in sequence—last update might clobber earlier ones (race condition). Instead, batch all updates into one call:

```typescript
// ❌ BAD: Three separate state updates
setParam("target", id);
setParam("key", newKey);
setParam("value", "");

// ✅ GOOD: Single batched update
onChange({
  params: {
    ...params,
    target: id,
    key: newKey,
    value: "",
  }
});
```

**Example:** InteractionsEditor setProp target dropdown—changing target must reset property and value. Three `setParam()` calls lost updates (property dropdown didn't reset). Fixed by batching into single `onChange()` call.

**Inline SVG for thumbnails.** Cheap (1-2ms per icon), no canvas context, no async rendering, no file I/O. Extract color from `element.props.fill` or `element.props.color`, render `<svg><rect fill={color} /></svg>`. Fallback to default colors if prop missing.

**Smart input switching via conditional render.** `SmartValueInput` component switches between `<input type="color">`, `<input type="number">`, `<textarea>` based on `valueType` prop. No expensive compute, just React conditional JSX. Switch happens same render cycle (no state update needed).
