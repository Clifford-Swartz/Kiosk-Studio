# 5. Back and Home Navigation Buttons

Date: 2026-06-22

## Status

Accepted

## Context

Kiosk experiences often need navigation UI beyond the authored scene interactions. Users may want:

1. **Browser-like back button** — undo the last navigation, return to previous screen
2. **Home button** — quick return to the starting scene from anywhere in the kiosk
3. **Consistent navigation affordance** — persistent UI that works across all scenes without requiring manual wiring in every scene

Without these, kiosk authors must manually add back/home buttons to every scene as regular elements with `goToScene` actions. This creates:
- **Duplication** — same buttons copied to 20+ scenes, hard to update styling
- **Inconsistent placement** — buttons might be slightly offset between scenes (user error)
- **No history tracking** — back button would need custom logic to track navigation path
- **Scene pollution** — navigation chrome mixed with content elements

## Decision

Add **project-level navigation UI** with Back and Home buttons as overlay controls in the runtime Player.

### 1. Overlay UI Layer (Not In-Scene Elements)

Buttons render as a React overlay on top of the scaled scene canvas, positioned absolutely in the bottom-left corner. They are NOT injected into scene element lists.

**Structure:**
```tsx
<Player>
  <ScaleContainer>
    <SceneCanvas>{/* scene elements */}</SceneCanvas>
    <NavigationOverlay>
      {/* Back and Home buttons */}
    </NavigationOverlay>
  </ScaleContainer>
</Player>
```

**Positioning:**
- **Back button**: bottom-left corner, 20px from edges (50×50px circular)
- **Home button**: 8px above back button (stacked vertically, both left-aligned)
- **Max z-index**: buttons always visible over scene content

**Why overlay not in-scene:** Navigation chrome is system UI, not authored content. Overlay ensures:
- Can't be accidentally covered by scene elements (no z-index conflict)
- Consistent positioning regardless of scene canvas size or element layout
- Doesn't pollute scene element arrays in project schema
- Simple to enable/disable globally (no need to mutate every scene)

### 2. History-Based Back (Not Hierarchy-Based)

Back button uses a **Navigation History stack** (array of scene IDs) maintained in Player component state. Every `goToScene` call pushes the current scene ID before navigating. Back button pops the stack and navigates to the previous scene.

**Example flow:**
```
User starts at Home → taps button (goToScene "Products")
  Before: current = Home, history = []
  Push Home to history → history = [Home]
  Navigate to Products → current = Products

User taps another button (goToScene "ProductDetail")
  Push Products to history → history = [Home, Products]
  Navigate to ProductDetail → current = ProductDetail

User taps back button
  Pop history → previous = Products, history = [Home]
  Navigate to Products → current = Products

User taps back button again
  Pop history → previous = Home, history = []
  Navigate to Home → current = Home (history clears on home arrival)
```

**Why history-based not hierarchy-based:**
- **Hierarchy is read-only topology**, not a navigation model. Multi-parent scenes (green in editor tree) have ambiguous parents—which would back go to? Orphan scenes (red) have no parent—would back be disabled?
- **History stack matches user mental model** from web browsers, mobile apps, kiosk systems. "Back" means "undo my last navigation," not "go to computed parent."
- **Simpler implementation**: maintain `navigationHistory: string[]`, push/pop on goToScene/goBack. No need to query auto-detected tree or handle ambiguous cases.
- **Auto-detected hierarchy useful for editing** (see structure, add scenes), but runtime navigation should follow user actions, not static topology.

### 3. History Clears on Home Arrival

Navigation History automatically resets to empty array (`[]`) when arriving at the home scene by ANY means:
- Back button navigation landing at home
- Home button tap
- `goToScene` action targeting home scene
- Initial project load
- `goBack` action when history has one entry (popping it navigates to home implicitly)

**Why clear on home:** Home scene is a "reset point" in the kiosk flow. Users expect:
- Back button doesn't work on home (nothing to go back to)
- Home button tap clears navigation context (fresh start)
- Returning home resets the session (no lingering history from previous branch)

This prevents confusing states like "I pressed home button, now I'm at Home, but back takes me to the scene I was just on" (defeats the purpose of a home button).

### 4. goBack Action Type (User Extensibility)

Back button functionality exposed as a `goBack` action type in the interaction schema. Users can wire custom back buttons (e.g., a styled text element with a `tap` → `goBack` interaction) instead of only using the overlay button.

**Implementation:**
```typescript
// PlayerContext interface
interface PlayerContext {
  goToScene: (sceneId: string) => void;
  goBack: () => void;  // NEW
  // ...
}

// Action schema
ActionTypeSchema = z.enum([
  "goToScene",
  "goBack",  // NEW - no parameters
  "setProp",
  // ...
]);

// Internal logic
ctx.goBack = () => {
  if (navigationHistory.length === 0) return; // Do nothing if empty
  const previousSceneId = navigationHistory[navigationHistory.length - 1];
  setNavigationHistory(h => h.slice(0, -1)); // Pop
  goToSceneInternal(previousSceneId, false); // Navigate without pushing
};
```

**Internal flag to prevent re-pushing:** `goToSceneInternal(sceneId, pushToHistory)` parameter ensures that when `goBack` calls `goToScene`, it doesn't re-push the scene to history (we already popped it).

**Why action type not just internal:** Users might want custom back buttons (different styling, position, labels). Exposing `goBack` as an action makes this possible without duplicating history logic.

### 5. Project-Level Toggles (Not Per-Scene)

Two boolean fields added to `ProjectSchema`:
```typescript
export const ProjectSchema = z.object({
  // ... existing fields
  enableBackButton: z.boolean().default(false),
  enableHomeButton: z.boolean().default(false),
});
```

**Top-level flat fields** (not nested in a settings object). Defaults to `false` (opt-in, doesn't surprise existing users on upgrade).

**Editor UI:** Checkboxes in Project tab, above the scene hierarchy tree, in a "Navigation" section with 2px subtle border separator.

**Why project-level not per-scene:**
- **Consistent navigation affordance** — users expect back/home buttons to either always be there or never be there, not appear/disappear between scenes
- **Simpler mental model** — one decision ("enable navigation UI") instead of 20+ per-scene decisions
- **Prevents confusion** — "why did the back button disappear when I switched scenes?" doesn't happen

**Automatic per-scene hiding:** Both buttons automatically hide on the home scene (back has no previous scene, home is already home). This is logical behavior, not manual configuration.

### 6. Visibility: Play/Kiosk Mode Only (Not Editor Canvas)

Navigation buttons only appear when `Player` component is rendered in Play/Kiosk mode (`hideAudioIcons={true}` prop). They are hidden in the editor Canvas preview (`hideAudioIcons={false}`).

**Why not in Canvas:**
- **Canvas is for authoring, not testing navigation flow** — editor already has scene hierarchy tree for navigation while editing
- **Would clutter Canvas** — buttons might cover elements you're trying to select/edit in bottom-left corner
- **Clearer mental model** — navigation UI is end-user feature (runtime), not authoring feature (editor)
- **Play/Kiosk buttons exist for runtime testing** — that's when you want to see the actual kiosk UX

Implementation: Player checks a `showNavigationUI` prop derived from mode.

### 7. Button Visibility Conditions

**Back button visible when:**
- `project.enableBackButton === true` AND
- `navigationHistory.length > 0`

**Home button visible when:**
- `project.enableHomeButton === true` AND
- `currentSceneId !== homeSceneId` (where `homeSceneId = project.startSceneId ?? project.scenes[0]?.id`)

**Both buttons hidden on home scene:** History is empty (cleared on arrival) AND already at home → neither button has meaningful action.

**Instant show/hide:** No fade/slide animations. Buttons appear/disappear via conditional render. Simpler implementation, follows "no unnecessary ceremony" principle, avoids half-state confusion.

### 8. Button Visual Design

**Styling:**
- **Shape**: 50×50px circular buttons (good touch target, clean look)
- **Background**: `rgba(0, 0, 0, 0.6)` (dark semi-transparent, works over any scene content)
- **Icons**: White 24px unicode symbols
  - Back: `◀` (left triangle, `◀`)
  - Home: `⌂` (house outline, `⌂`)
- **Hover**: `rgba(0, 0, 0, 0.75)` on desktop (subtle brightness feedback, 200ms transition)
- **No press state**: Touch is instant, no need for active state styling

**Why icon-only not text labels:** Universal symbols (← triangle for back, house for home) are language-agnostic and space-efficient. Text labels ("Back", "Home") waste space and don't add clarity.

**Why unicode not SVG:** Simpler (no asset dependencies), renders reliably across platforms. Custom SVG could be added later for visual polish if needed.

### 9. Home Button Implementation

Home button calls `goToScene(homeSceneId)` directly. No special `goHome` action type needed.

**Why reuse goToScene:**
- **Home button is UI convenience** — equivalent to a button element with a `goToScene` action pointing to home
- **Reuses existing logic** — `goToScene` already handles clearing history when arriving at home
- **Simpler schema** — one less action type to document, validate, test
- **goBack is special because it's stateful** — needs access to history stack (internal state). Home button just needs the home scene ID (already in project schema).

Fallback logic: `project.startSceneId ?? project.scenes[0]?.id` (consistent with Player initialization).

### 10. Navigation History Storage

History lives in Player component state:
```typescript
const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
```

**Why Player state not singleton:**
- **History is session state** — should reset when Player unmounts (exiting Play/Kiosk mode). Return to editing, then re-enter Play mode → fresh start at home.
- **Simpler than external store** — no cleanup, reset, or cross-instance sync needed
- **Consistent with scene state** — `sceneLayers` and `isTransitioning` already Player state

**No size cap:** Unlimited stack depth. Each entry is a scene ID string (~36 bytes), so 1000 navigations ≈ 36KB. Typical kiosk sessions won't hit 100+ navigations. Add cap later if real-world usage shows issues (premature optimization).

## Consequences

**Positive:**
- ✅ Browser-like navigation UX for kiosk end-users (back/home buttons familiar from web/mobile)
- ✅ No duplication — navigation UI defined once at project level, not copied to 20+ scenes
- ✅ Consistent placement — overlay ensures buttons always render in exact same position
- ✅ Extensible — `goBack` action allows custom back buttons if users want different styling
- ✅ Simple mental model — history-based back matches user expectations from every other UI system
- ✅ Clean schema — two boolean flags, one new action type (goBack), no per-scene config sprawl
- ✅ No scene pollution — navigation chrome separate from authored content elements

**Negative:**
- ❌ History stack RAM usage — unlimited stack could theoretically grow large on very long sessions (mitigated: 36 bytes per entry, reset on home, unmount clears state)
- ❌ One more Player state field — `navigationHistory` adds complexity to Player lifecycle (manageable, ~20 lines of logic)
- ❌ Can't customize button position — fixed bottom-left placement (mitigated: can add positioning config later if users request it)
- ❌ History-based back doesn't match editor hierarchy tree — user might expect back to follow parent/child relationships from auto-detected topology (trade-off: history is more intuitive for runtime navigation)

**Neutral:**
- History clearing on home arrival is a choice — alternative (preserve history through home) would allow "back through home to previous branch," but complicates mental model
- Overlay UI pattern could apply to other system controls later (volume, settings, help) — not premature abstraction, just establishes the pattern
- goBack action exposed but not required — users can enable buttons without ever using the action type in custom interactions

## Alternatives Considered

### 1. In-Scene Navigation Elements (Rejected)

**Approach:** Automatically inject back/home button elements into every scene's element list when `enableBackButton`/`enableHomeButton` are true. Treat them like authored elements with special system IDs.

**Pros:**
- Buttons render as regular elements (no special overlay logic)
- Could be styled via Properties panel like other elements

**Cons:**
- **Pollutes scene elements** — navigation chrome mixed with content, confusing in scene structure tree
- **Z-index conflicts** — scene elements could accidentally cover system buttons
- **Positioning fragility** — if scene has 1920×1080 canvas but another has 1280×720, button positions would be off (overlay scales with viewport, not canvas)
- **Harder to maintain** — need to inject/remove elements on toggle changes, sync across all scenes
- **No clear system/content boundary** — everything looks like authored elements

**Rejected:** Overlay pattern cleaner (navigation chrome is system UI, not content).

### 2. Hierarchy-Based Back (Rejected)

**Approach:** Back button navigates to the scene's parent in the auto-detected hierarchy tree. ProductDetail → back goes to Products because Products is its single goToScene parent.

**Pros:**
- Aligns with editor's scene hierarchy tree view
- No history state to maintain (just query the tree)

**Cons:**
- **Ambiguous for multi-parent scenes** — Cart has goToScene from Products and Services → which parent does back go to? Flattens to root in tree (no parent), so back would be disabled (confusing).
- **Broken for orphan scenes** — red scenes have no goToScene parent → back always disabled (even if user navigated there via custom interaction).
- **Doesn't match user mental model** — "back" means "undo last action" in every other system (browser, mobile OS, kiosk), not "go to computed parent."
- **Hierarchy is read-only topology** — useful for editing/visualizing structure, but runtime navigation should follow user actions, not static analysis.

**Rejected:** History-based back is more intuitive and handles all cases (multi-parent, orphan, circular flows).

### 3. Per-Scene Navigation Toggles (Rejected)

**Approach:** Each scene has `showBackButton` and `showHomeButton` boolean fields. Scene A shows both, Scene B shows only home, Scene C shows neither.

**Pros:**
- Maximum flexibility (per-scene control)

**Cons:**
- **Inconsistent UX** — users expect navigation controls to be persistent or absent, not appear/disappear between scenes ("why did back button vanish?")
- **Config sprawl** — 20 scenes × 2 toggles = 40 boolean decisions to manage
- **No clear logic** — why would back button be disabled on Scene 5 but enabled on Scene 6? Hard to reason about.
- **Exception handling** — what if user enables back on home scene? Need to document/prevent that.

**Rejected:** Project-level toggles simpler and more consistent. Automatic per-scene hiding (both buttons on home) handles the only logical exception.

### 4. Editor Canvas Visibility (Rejected)

**Approach:** Show back/home buttons in the editor Canvas preview (when `live=true`), not just Play/Kiosk mode.

**Pros:**
- Test navigation while editing without switching to Play mode

**Cons:**
- **Clutters Canvas** — buttons in bottom-left corner might cover elements you're trying to select/edit
- **Editor has scene hierarchy tree** — already provides navigation during editing (click scene in tree to switch)
- **Confusing mental model** — Canvas is for authoring (move/style elements), not testing runtime behavior (that's what Play/Kiosk mode is for)
- **Would need "hide navigation" toggle** — adds another editor preference, complicates UI

**Rejected:** Play/Kiosk mode is the right place for runtime testing. Canvas should stay focused on authoring.

### 5. goHome Action Type (Rejected)

**Approach:** Create a dedicated `goHome` action type (like `goBack`) instead of reusing `goToScene` for the home button.

**Pros:**
- Symmetry with goBack (both are special navigation actions)
- Slightly clearer intent in interaction inspector ("goHome" vs "goToScene with homeId")

**Cons:**
- **Redundant** — functionally identical to `goToScene(project.startSceneId)`, just with a different name
- **Schema bloat** — adds an action type for no functional benefit
- **goBack is special because it's stateful** — needs access to history stack. goHome is just a navigation shortcut (home ID already in project schema).
- **Users could already do this** — any button with goToScene targeting home is a home button. No need to formalize it.

**Rejected:** Reusing goToScene keeps schema simpler. Home button is just UI convenience, not a new capability.

## Implementation Notes

**Files to modify:**
- `packages/engine/src/model/schema.ts` — add `enableBackButton`, `enableHomeButton` to ProjectSchema; add `"goBack"` to ActionTypeSchema
- `packages/engine/src/runtime/interactions.ts` — add `goBack()` to PlayerContext interface; implement goBack action handler
- `packages/engine/src/render/Player.tsx` — add `navigationHistory` state; modify goToScene to push/clear history; add `goBack()` to ctx; render NavigationOverlay conditionally
- `packages/engine/src/render/NavigationOverlay.tsx` — NEW component, render back/home buttons with visibility logic
- `apps/desktop/src/renderer/editor/ProjectHierarchy.tsx` — add navigation settings section above tree (checkboxes for enable flags)
- `apps/desktop/src/renderer/editor/store.ts` — add actions `setEnableBackButton`, `setEnableHomeButton` (update project schema)

**Key patterns:**
- `goToSceneInternal(sceneId, pushToHistory: boolean)` internal method handles both normal navigation (push=true) and goBack navigation (push=false)
- History push condition: `if (pushToHistory && sceneId !== homeSceneId)`
- History clear condition: `if (sceneId === homeSceneId)` (after navigation completes)
- Back button visibility: `enableBackButton && navigationHistory.length > 0`
- Home button visibility: `enableHomeButton && currentSceneId !== getHomeSceneId()`

**Verification steps:**
1. Enable both buttons in Project tab → Play mode → see both in bottom-left (stacked, home on top)
2. Navigate Home → A → B → back button shows (home hidden on home scene)
3. Tap back → returns to A (history = [home])
4. Tap back → returns to Home, both buttons disappear (history cleared)
5. Navigate Home → A, tap home button → returns to Home directly (history cleared)
6. Add custom element with goBack interaction → tap it → same back behavior as overlay button
7. Disable buttons in Project tab → Play mode → no overlay buttons visible

**Rollback:** Revert 5 files (1 new component, 4 modified). Changes isolated to Player navigation and Project tab settings, doesn't touch Canvas/Properties/Scene rendering.

## Related

- ADR 0004 (Tabbed Sidebar Scene Hierarchy) - Auto-detected hierarchy tree is for editing/visualization, not runtime navigation model
- CLAUDE.md § UX/UI principles - "Visual not textual" (icons only), "Immediate validation" (history clears on home = reset point), "Consolidated actions" (project-level toggles)
- CONTEXT.md § Interaction - goBack added to action type list alongside goToScene
- CONTEXT.md § Navigation History - new domain concept, maintains navigation stack for back button
