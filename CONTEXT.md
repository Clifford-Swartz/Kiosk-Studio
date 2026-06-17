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
- Navigate: `goToScene`
- Mutate props: `setProp`, `toggle`
- Control media: `playMedia`, `togglePlayPause`, `seekVideo`, `setVolume`, `setSpeed`
- Send data: `sendData` (reserved)
- Animate: `animate` (reserved)

Actions write to an **override store** (ephemeral, runtime-only mutations). Overrides apply on top of bindings and reset on scene change.

### Data Source
External data connector (REST, MQTT, WebSocket, serial, BLE, file). Lives in the Project schema; connectors run in the main process and push values to the renderer via IPC.

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
