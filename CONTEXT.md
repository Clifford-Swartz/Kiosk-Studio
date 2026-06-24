# Kiosk Studio Domain Model

## Core Concepts

### Project
A kiosk experience. Contains Scenes, defines canvas size (one size for all scenes—a kiosk has one screen), and data sources for live bindings.

### Scene
A screen in the kiosk experience. Contains Elements arranged on a canvas. Background can be a color or image.

### Element
A visual or interactive component on a Scene. Types: rectangle, text, image, video, audio, button, group, collection. Elements have:
- **Geometry**: x, y, width, height, rotation, opacity, zIndex
- **Props**: type-specific properties (e.g., text content, fill color, src URL)
- **Bindings**: connections to live data sources that update props in real-time
- **Interactions**: trigger → action mappings (e.g., tap → goToScene)

### Collection
A templated set of items (images and videos) laid out in a chosen style: **grid**, **carousel**, **coverflow**, or **kenburns**. Each `CollectionItem` has a media source (image or video), optional title, and optional subtitle.

**Active item model:** One item is "active" at any time. For video items, the active video auto-plays; all inactive videos pause and reset to the beginning. The active item is determined by layout:
- **Grid**: User taps a card to make it active (enters focused state—card fills collection bounds). Tap again to unfocus (return to grid).
- **Carousel/Coverflow**: Active item is centered/featured. Users navigate via swipe gestures or nav buttons.
- **Ken Burns**: Active item shown fullscreen. Auto-advances on timer or when video ends.

**Video orchestration:** Collections manage video playback internally (active plays, others paused + muted). Collection videos don't register with the Player—they're not targetable by interactions like standalone video elements are.

### Binding
A connection from a data source to an element property. Live data flows through bindings to update rendered elements without mutating the Project.

**Architecture (2026-06):** Consolidated into `BindingContext` module (`packages/engine/src/data/BindingContext.ts`). Provides two interfaces:
- **BindingContext** (React-facing): `useElement(element)` subscribes and resolves bindings
- **BindingHost** (connector-facing): `setValue(sourceId, value)` and `reset()` for lifecycle

Previously scattered across: bindingStore (subscription) + applyBindings (resolution) + useBindings (React hook). Now consolidated behind a single seam with intra-frame caching (cache clears on every setValue).

**Contract:**
- `targetProp` can be: geometry field (`x`, `y`, `width`, etc.), `props.key`, or bare key (treated as `props.key`)
- `path` dot-walks into source value (e.g., `"data.temp"` extracts `value.data.temp`)
- Missing sources silently ignored (no throw, no warn by default—see commented warn in BindingContext)
- Text props (`text`, `label`) coerced to string; other props passed through

### Interaction
A trigger (tap, hover, press, enterScene, dataChanged) paired with a sequence of actions. Actions can:
- Navigate: `goToScene`, `goBack`
- Mutate props: `setProp`, `toggle`
- Control media: `playMedia`, `togglePlayPause`, `seekVideo`, `setVolume`, `setSpeed`
- Send data: `sendData` (reserved)
- Animate: `animate` (reserved)

Actions write to an **override store** (ephemeral, runtime-only mutations). Overrides apply on top of bindings and reset on scene change.

### Transition

The visual effect that plays when entering a Scene. Attached to the destination scene (scene-inbound), not to the `goToScene` action that triggered navigation. When a user taps a button to navigate, the transition defined on the *target* scene determines how it appears.

**Types:** none (instant cut), fade, slide, push, zoom. Each type has configurable parameters (direction, duration, elementsOnly).

**elementsOnly mode:** When true, only the scene's elements participate in the transition animation — the background stays constant. Used when consecutive scenes share the same background and you want a cleaner transition (fade elements out → swap background imperceptibly → fade new elements in). Only supported on `fade` and `zoom` transitions.

**Default behavior:** When a Scene has no transition field or `type: "none"`, scenes swap instantly (no animation). The first scene on project load never transitions — it appears immediately regardless of its transition configuration.

**Not** an Action — Actions are trigger-driven behaviors on Elements. Transitions are presentation-level effects on Scenes. The timing is: goToScene called → transition animates (Player locked, further goToScene ignored) → transition completes → enterScene triggers fire on the new scene's elements.

### Data Source
External data connector (REST, MQTT, WebSocket, serial, BLE, file). Lives in the Project schema; connectors run in the main process and push values to the renderer via IPC.

### Back and Home Buttons
Optional overlay navigation controls in the runtime Player. When enabled via project-level flags (`enableBackButton`, `enableHomeButton`), circular icon buttons render in the bottom-left corner on top of scene content (max z-index). Both buttons are hidden on the home scene. Only visible in Play/Kiosk mode, not in the editor Canvas preview.

**Back button** (`◀`): Navigates to the previous scene by popping the Navigation History stack. Implemented as a `goBack` action type. Hidden when Navigation History is empty (no previous scenes to return to).

**Home button** (`⌂`): Navigates to the home scene (project's `startSceneId` or first scene as fallback). Uses the existing `goToScene` action internally, not a special action type.

**Visual specs:** 50×50px circular buttons, dark semi-transparent background (`rgba(0,0,0,0.6)`), white icons (24px), 8px vertical gap between them, 20px margin from viewport edges. Hover brightness feedback on desktop. No animation on show/hide (instant conditional render).

### Navigation History
Stack of scene IDs tracking the user's navigation path through the kiosk. Maintained in Player component state during runtime. Used by the Back button to enable "undo last navigation" behavior.

**Push behavior:** Every `goToScene` call pushes the current scene ID to the stack before navigating, UNLESS the destination is the home scene. Internal flag prevents re-pushing when `goBack` action calls `goToScene`.

**Clear behavior:** Stack automatically clears (resets to empty array) when arriving at the home scene by any means: back button navigation, home button tap, `goToScene` action targeting home, or initial project load.

**No size cap:** Unlimited stack depth (each entry is a scene ID string, ~36 bytes). Resets on Player unmount (exiting Play/Kiosk mode).

## Architecture Patterns

### Rendering Pipeline
1. **Project** (immutable, persisted) → active Scene
2. **Bindings** apply (live data) via `BindingContext.useElement()`
3. **Overrides** apply (interaction mutations) via `applyOverrides()`
4. **ElementRenderer** draws the resolved element

### Editor vs. Player
- **Editor** (`apps/desktop`): Zustand store for project mutations, undo/redo, Canvas with drag/snap
- **Player** (`packages/engine`): Read-only renderer, executes interactions, subscribes to bindings
- Both share the same Scene Model (schema.ts) and rendering primitives (ElementRenderer)

### Undo/Redo System (2026-06)

**Model:** Snapshot-based history (full Project clones). Every mutation captured after 50ms debounce. 50-entry FIFO cap (~2.5-5MB memory).

**Lifecycle:**
- **On save:** Clear `undoHistory[]`, reset index to -1. Save = checkpoint, wipe history.
- **On project load:** Clear history (prevent mixing projects).
- **On edit:** Capture snapshot, `dirty: true`.
- **On undo/redo to empty history:** `dirty: false` (empty = clean slate).

**Dirty tracking:** `dirty = undoHistory.length > 0`. Simple invariant: history exists = unsaved changes exist.

**Selection preservation:** After undo/redo, keep `selectedId` if element still exists in restored project. Otherwise clear to null.

**Keyboard shortcuts:** Registered via `useKeyboardShortcuts` hook (Mod+Z, Mod+Shift+Z, Mod+Y). No custom listeners, no stale ref bugs.

**Drag optimization:** Pause history capture during pointer drag (pointerdown → pointerup), resume with forced final snapshot. Prevents 100s of micro-move snapshots per drag.

**Files:** `store.ts` (Zustand actions), `useUndoRedo.ts` (capture logic, keyboard wiring, pause/resume).

### Modularity
- **Engine** (`packages/engine`): framework-agnostic core (React only in render/, uses plain classes/functions elsewhere)
- **Desktop app** (`apps/desktop`): Electron + React, wraps engine Player, adds editing UI

---

## BindingContext: Design vs Reality (2026-06)

### Initial Design (What We Planned):

```typescript
interface BindingContext {
  setValue(sourceId: string, value: unknown): void;
  reset(): void;
  useElement(element: Element): Element;  // ← Elegant, one call
}

// Usage:
const resolved = bindingContext.useElement(element);
```

### Final Implementation (What We Built):

```typescript
interface BindingContext {
  useBindings(): (element: Element) => Element;  // ← Two-step pattern
}

interface BindingHost {
  setValue(sourceId: string, value: unknown): void;
  reset(): void;
  clearCache(): void;  // ← EXTRA addition
}

// Usage:
const resolveBindings = bindingContext.useBindings();
const resolved = resolveBindings(element);
```

### What We Stuck With (Original Plan):

✅ Split interface (BindingContext + BindingHost) - clean separation  
✅ Singleton pattern - one shared instance  
✅ Caching strategy (clear on setValue, intra-frame reuse)  
✅ Silent errors with commented warn  
✅ Consolidated bindingStore + applyBindings + useBindings  
✅ File location (data/BindingContext.ts)

### What Changed (Forced by Reality):

❌ Interface signature: `useElement(element)` → `useBindings()` returns resolver  
❌ Usage pattern: Direct call → two-step (get resolver, call resolver)  
❌ Added `clearCache()` - not in original design  
❌ useMemo timing - cache clear must run DURING render, not in effect

### Extra Additions:

1. **`clearCache()` method** - handles project structure changes (editor mutations) separately from data changes (setValue)
2. **Stable resolver pattern** - arrow function bound to instance for React identity stability
3. **useMemo for cache invalidation** - timing constraint (must run during render, not after)
4. **Explicit cache invalidation in Player** - `useMemo(() => clearCache(), [project])`

### Complexity Comparison:

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Files to trace | 3 | 1 | ✅ 67% reduction |
| Conceptual steps | "subscribe, get getter, pass to fn" | "get resolver, call" | ✅ Simpler |
| Lines in Player | 3 | 2 | ✅ 33% reduction |
| API surface | 8 methods | 4 methods | ✅ 50% reduction |
| Ergonomics | `resolveBindings(el, getValue)` | `resolver(el)` | ✅ Cleaner |
| Initial call | N/A | `const resolver = useBindings()` | ❌ Extra step |

### Rating: 6.5/10

**Why not higher (-3.5):**
- Interface messier than planned (-2): forced two-step pattern by React Rules of Hooks
- Extra API surface (-1): clearCache() addition necessary but unplanned
- Less ergonomic usage (-0.5): indirect vs. direct call

**Why not lower (+6.5):**
- Core goal achieved (+3): pipeline consolidated (5 modules → 1)
- Testability improved (+2): clear seam for mocking, isolated cache behavior
- Locality improved (+1.5): all logic in one file, changes don't ripple

### Verdict:

**Succeeded** at architectural goal (consolidate scattered pipeline, improve testability) but interface ergonomics took a hit due to:

1. **React Rules of Hooks** - can't call hook in loop, forced two-step pattern
2. **React identity checks** - stable references matter, forced stable resolver
3. **Editor mutation model** - cache invalidation on structure changes, not just data

The deviations were **necessary**, not mistakes. Initial design didn't account for React's constraints. The consolidation works, but it's messier than ideal.

**Lesson:** When consolidating React hooks, account for Rules of Hooks (call order, no loops/conditions) and React identity checks (stable references) upfront. Pure functional interfaces (original applyBindings) don't have these constraints—adding React integration changes the design space.

---

## Video Element: Native `<video>` Implementation (2026-06)

### Problem (Video.js Era):
- Source corruption on repeated src changes (playback failed after multiple updates)
- Dimension/position bugs (Video.js overrode wrapper styles, required complex workarounds)
- ~240KB dependency overhead for features not used (controls UI, adaptive streaming, plugins)

### Solution (Native `<video>` Refactor):
Replaced Video.js with native HTML5 `<video>` element. Wrapper div pattern (matches image/audio):

```jsx
<div style={baseStyle}>  // positioning + dims
  {hasSource && (
    <video src={src} style={{width: "100%", height: "100%"}} />
  )}
</div>
```

**Key implementation details:**

1. **Autoplay race condition fix** - Original effect fired play() before video loaded:
   ```typescript
   useEffect(() => {
     if (video.readyState >= 3) {
       video.play();  // Already loaded
     } else {
       video.addEventListener("canplaythrough", tryPlay, { once: true });
     }
   }, [playing, hasSource, src]);
   ```

2. **Protocol handler MIME types** - Electron's `kioskasset://` protocol returned wrong Content-Type, causing SRC_NOT_SUPPORTED (error code 4). Fixed by explicit MIME headers:
   ```typescript
   protocol.handle(ASSET_SCHEME, async (request) => {
     const ext = extname(absPath).toLowerCase();
     const mimeMap = { ".mp4": "video/mp4", ".webm": "video/webm", ... };
     return new Response(body, {
       headers: { "Content-Type": mimeMap[ext], "Accept-Ranges": "bytes" }
     });
   });
   ```

3. **Conditional render guard** - Don't mount `<video>` when `src=""` (empty source triggers error):
   ```jsx
   {hasSource && <video src={src} />}
   ```

### Files Modified:
- `packages/engine/src/render/ElementRenderer.tsx` - VideoElement refactor (~150 lines simpler)
- `packages/engine/src/render/Player.tsx` - Native HTMLVideoElement API (play/pause/seek/volume/speed)
- `apps/desktop/src/main/index.ts` - Protocol handler MIME + error handling
- `packages/engine/src/model/factory.ts` - Removed dead props (controls/responsive/fluid)
- `apps/desktop/src/renderer/editor/PropertiesPanel.tsx` - Removed controls checkbox
- `docs/adr/0002-native-video-element.md` - Decision record

### Result:
- ✅ No corruption on rapid src changes
- ✅ Dimensions/positioning work correctly (wrapper pattern)
- ✅ ~240KB smaller bundle
- ✅ Consistent element architecture (wrapper + fill, like image/audio)
- ✅ Same programmatic API surface (play/pause/seek via interactions)
