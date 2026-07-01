# Kiosk Studio Domain Model

## Core Concepts

### Project
A kiosk experience. Contains Scenes, defines canvas size (one size for all scenes—a kiosk has one screen), and data connectors (input sources for live bindings, output sinks for analytics export).

**Storage model (2026-07):** Projects stored as `.kproj` folders in `<app-dir>/Exports/`. Each contains `project.json` + `assets/` subfolder. Assets reference shared `<app-dir>/user-content/` library (not per-project folders). Export action creates bundled sibling with `{name}-exported.kproj` suffix — copies user-content refs into bundled `assets/`, rewrites paths, sets `exported: true` flag. See ADR 0008.

### Scene
A screen in the kiosk experience. Contains Elements arranged on a canvas. Background can be a color or image.

### Element
A visual or interactive component on a Scene. Types: rectangle, text, image, video, audio, button, layer, collection. Elements have:
- **Geometry**: x, y, width, height, rotation, opacity, zIndex
- **Props**: type-specific properties (e.g., text content, fill color, src URL)
- **Bindings**: connections to live data sources that update props in real-time
- **Interactions**: trigger → action mappings (e.g., tap → goToScene)
- **Children**: optional array for `layer` and `collection` types only

### Layer
Fullscreen organizational container with visual effects. Unlike other elements, layers are always positioned at `x:0, y:0` with dimensions matching the project canvas size. Layers provide:
- **Tint**: Color overlay with adjustable opacity (0-1). Applied on top of all children.
- **Mask**: Vector clip region (rect or polygon) that hides content outside the shape. Defined as an array of points in scene-absolute coordinates. **Layer-exclusive feature** — only layers can have masks (schema allows mask on all element types as artifact, but editor and renderer ignore mask on non-layer elements).
- **Lock**: When locked, the layer and all its children cannot be selected or edited on the canvas.
- **Depth limit**: Maximum 2 layers deep (layer can contain a layer, but not deeper).

Children use scene-absolute x/y coordinates (layer always at 0,0, doesn't offset children). Not selectable on canvas (click-through). Collections can be nested inside layers, but layers cannot be nested inside collections.

_Avoid:_ Group (old term, replaced by layer in schemaVersion 3)

### Collection
A templated set of items (images and videos) laid out in a chosen style: **grid**, **carousel**, **coverflow**, or **kenburns**. Each `CollectionItem` has a media source (image or video), optional title, and optional subtitle.

**Active item model:** One item is "active" at any time. For video items, the active video auto-plays; all inactive videos pause and reset to the beginning. The active item is determined by layout:
- **Grid**: User taps a card to make it active (enters focused state—card fills collection bounds). Tap again to unfocus (return to grid).
- **Carousel/Coverflow**: Active item is centered/featured. Users navigate via swipe gestures or nav buttons.
- **Ken Burns**: Active item shown fullscreen. Auto-advances on timer or when video ends.

**Video orchestration:** Collections manage video playback internally (active plays, others paused + muted). Collection videos don't register with the Player—they're not targetable by interactions like standalone video elements are.

### EventBus
Central event pipeline for all kiosk system events. Every significant action flows through EventBus as a `KioskEvent`: data source updates, scene navigation, user interactions, media playback. Singleton in renderer process, synchronous dispatch (in-order).

**Event shape:** `{ kind, timestamp, sessionId, sceneId, payload }`. EventBus auto-injects `timestamp`, `sessionId` (current play session), and `sceneId` (active scene). Payload is kind-specific flexible data.

**Event kinds:** `dataChanged` (connector values), `sceneEnter`/`sceneExit` (navigation), `sessionStart`/`sessionEnd` (Player lifecycle), `elementTap`/`elementHover` (interactions), `videoPlay`/`videoPause`/`videoComplete` (media), `actionRun` (interaction execution).

Producers: Player, interactions.ts, ElementRenderer, data connectors. Consumers: BindingContext (subscribes to dataChanged), AnalyticsStore (buffers events per sink config). See ADR 0007.

### Binding
A connection from a data connector to an element property. Live data flows through bindings to update rendered elements without mutating the Project.

**Architecture (2026-06):** BindingContext subscribes to EventBus `dataChanged` events. When connector emits new value → EventBus dispatches → BindingContext updates internal map → triggers React re-render → bound elements resolve with fresh data.

**Contract:**
- `targetProp` can be: geometry field (`x`, `y`, `width`, etc.), `props.key`, or bare key (treated as `props.key`)
- `path` dot-walks into source value (e.g., `"data.temp"` extracts `value.data.temp`)
- Missing sources silently ignored (no throw, no warn by default)
- Text props (`text`, `label`) coerced to string; other props passed through

Intra-frame caching: resolved elements cached by `element.id + version`. Cache clears on dataChanged event and on project structure changes (editor mutations).

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

### Data Connector
Bidirectional bridge between kiosk and external systems. A connector can have **input** (data flows IN: REST poll, MQTT subscribe, serial read → emit `dataChanged` events), **output** (data flows OUT: subscribe to kiosk events, export to CSV/REST/console), or both.

**Implemented kinds:** REST (bidirectional: poll IN + POST batches OUT), CSV/JSON/JSONL (output only: file export), console (output only: DevTools logging). Reserved: MQTT, WebSocket, serial, BLE.

**Input connectors** run in main process (need Node APIs), emit events via IPC bridge to renderer EventBus. **Output connectors** run in renderer (AnalyticsStore manages), use IPC for file writes (CSV) or fetch for REST POST.

Lives in Project schema as `dataConnectors: DataConnectorDef[]`. Replaced `dataSources` field in schemaVersion 2 (breaking change). See ADR 0007.

_Avoid:_ Data Source (old term, input-only)

### Analytics Sink
Output-only data connector that subscribes to kiosk events and exports them. Part of the unified Data Connector model with `output` config enabled.

**Use cases:** Session analytics (track scene time, user taps, video engagement), export to CSV for stakeholder analysis, live dashboard via REST POST, debugging via console logging.

**Buffering:** Per-sink buffers collect events. Flush triggers: time interval (default 30s) OR buffer size limit (default 1000 events), whichever first. Manual flush on sessionEnd.

**Event filtering:** Configure which event kinds each sink exports (granular checkboxes: sceneEnter, elementTap, videoPlay, etc.). One sink can export all events, another only navigation events.

_Avoid:_ Export Target, Analytics Connector

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
2. **EventBus** dispatches `dataChanged` events from connectors
3. **Bindings** apply (live data) via `BindingContext` subscription
4. **Overrides** apply (interaction mutations) via `applyOverrides()`
5. **ElementRenderer** draws resolved element, emits media events to EventBus

All kiosk events flow through EventBus: Player emits navigation (`sceneEnter`/`sceneExit`), interactions.ts emits user actions (`elementTap`), ElementRenderer emits media events (`videoPlay`). Consumers subscribe: BindingContext for data binding, AnalyticsStore for export.

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

**Modal edit optimization:** Pause history capture during modal editing sessions (mask edit, inline text edit). Resume on Done/Cancel with single snapshot. Entire edit session = one undo entry.

**Files:** `store.ts` (Zustand actions), `useUndoRedo.ts` (capture logic, keyboard wiring, pause/resume).

### Modal Editing (2026-06)

**Pattern:** Certain editor operations enter modal state — exclusive focus mode blocking other interactions.

**Active modals:**
- **Inline text edit** (`editingId`) — double-click text/button element
- **Mask edit** (`maskEditingId`) — Edit Mask button on layer

**Enforcement:** Store-level guards. `isModalEditingActive()` computed from `editingId || maskEditingId`. All mutation actions check modal state, return early if active:
- `selectElement()` — blocked (can't switch selection mid-edit)
- `setActiveScene()` — blocked (can't switch scenes mid-edit)
- Undo/redo — blocked (modal has explicit Done/Cancel)
- Drag/resize/rotate — blocked (beginMove/beginResize/beginRotate check modal)
- Delete/copy/paste — blocked (keyboard shortcuts check modal)

**Allowed during modal:** Zoom/pan canvas (view-only, no state mutation), Escape (cancel modal), modal-specific shortcuts (Enter closes polygon, Delete removes last point).

**Undo behavior:** Modal edit pauses history capture (via pauseCapture/resumeCapture hooks). Done commits entire edit as single snapshot. Cancel exits without snapshot. Prevents per-action pollution (50-point polygon = 1 undo entry, not 50).

**Why modal instead of inline?** Past bugs from incomplete interaction blocking (undo mid-edit, selection change orphans staged data, keyboard shortcuts fire unexpectedly). Modal = systemic prevention, single enforcement point.

### Modularity
- **Engine** (`packages/engine`): framework-agnostic core (React only in render/, uses plain classes/functions elsewhere)
- **Desktop app** (`apps/desktop`): Electron + React, wraps engine Player, adds editing UI

---

## Event-Driven Architecture Notes (2026-06)

### EventBus Implementation

**Location:** `packages/engine/src/events/EventBus.ts` (singleton, renderer process)

**Key decisions:**
- Sync dispatch (not async) - simpler, order guaranteed, kiosk scale small
- Per-kind subscription (not wildcard scan) - efficient, explicit intent
- Auto-inject sessionId + sceneId - emitters don't manage global state
- Flexible payload (not discriminated union) - 20+ event types, trust emitters

**Integration pattern:**
```typescript
// Producer (Player, interactions.ts, ElementRenderer)
eventBus.emit({ kind: "sceneEnter", payload: { sceneId, sceneName } });

// Consumer (BindingContext, AnalyticsStore)
eventBus.subscribe("dataChanged", (event) => {
  const { sourceId, value } = event.payload;
  // handle...
});
```

**Process boundary:** Main-side connectors (REST poll, MQTT, serial) emit via IPC bridge. Renderer EventBus receives, dispatches to subscribers. Output sinks (CSV, REST POST) in renderer, use IPC for fs writes.

### BindingContext Migration

**Before:** Main → IPC `data:value` → liveSession → `bindingHost.setValue()` → bump version → React re-render

**After:** Main → IPC `event:emit` → EventBus → BindingContext subscriber → internal setValue → bump → re-render

**Removed from public API:** `BindingHost.setValue()` (now private, only EventBus calls it). Tests emit through EventBus instead.

**Kept:** `BindingHost.reset()` (Player unmount), `clearCache()` (project structure changes in editor).

### Analytics Architecture

**Per-sink buffers:** Map<sinkId, KioskEvent[]>. Each sink has own buffer, flush independently.

**Flush triggers:** Timer (per-sink interval, default 30s) OR size limit (default 1000 events) OR manual (sessionEnd). Whichever first.

**Subscription optimization:** If 3 sinks want `elementTap`, subscribe once, fan out to 3 buffers. Reduces EventBus listener count.

**CSV columns (flattened):** timestamp, sessionId, sceneId, kind, elementId?, elementType?, duration?, actionType?, sourceId?, error?. JSON.stringify nested objects in value column. Sparse (omit null/undefined).

**REST batching:** POST array of events. No retry on failure (log error, drop batch). Optional headers field for auth. 10s timeout.

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
