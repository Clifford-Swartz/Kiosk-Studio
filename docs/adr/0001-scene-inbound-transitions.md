# Scene-inbound transitions with elementsOnly mode

Transitions are attached to the destination scene, not to the `goToScene` action that triggers navigation. Each scene declares its own entrance transition (type, direction, duration, elementsOnly flag). When undefined, scenes swap instantly with no animation.

## Why scene-inbound

We considered three attachment points:

1. **Scene-outbound**: Each scene defines what transition plays when leaving it
2. **Action-based**: Each `goToScene` action carries a transition parameter
3. **Scene-inbound**: Each scene defines what transition plays when entering it (chosen)

Scene-inbound wins because:

- **Consistency**: Every navigation path into Scene B uses the same transition. If five buttons on five different scenes all navigate to "Settings," they all get Settings' entrance effect — no per-button configuration duplication.
- **Ownership**: The destination scene owns its presentation concerns (background, layout, now transition). Adding a new navigation path doesn't require transition re-configuration.
- **Scalability**: In a 20-scene kiosk with 50 navigation paths, scene-inbound requires 20 transition configurations. Action-based would require 50. Scene-outbound breaks the "add new button to Settings" case (every source scene needs configuration).

**Trade-off**: You lose per-navigation-path variety. If Button A and Button B both go to Scene C, they trigger the same transition. This is acceptable for kiosks — these are scripted flows where consistency is a feature, not a limitation. If per-path variety becomes necessary, we can add action-level transition overrides later (scene defines default, action can override).

## Why elementsOnly as a flag

Kiosks often have scenes with the same brand background where only content changes. Fading the entire scene (background + elements) wastes time fading identical backgrounds. The `elementsOnly` flag enables a cleaner transition: fade elements out → swap background imperceptibly → fade elements in.

We considered:

1. **Separate transition types** (`fadeElements`, `zoomElements`, etc.)
2. **Boolean flag on applicable transitions** (`elementsOnly: true` on `fade` and `zoom`, ignored on others) — chosen

Flag wins because:

- **Extensibility**: If we later add a `dissolve` or `blur` transition, it can also support `elementsOnly` — no new transition type needed
- **Simpler catalog**: 5 transition types instead of 8+ (fade, fadeElements, zoom, zoomElements, slide, push…)
- **Semantic clarity**: "This is a fade, but only the elements participate" is clearer than "this is a different kind of fade"

**Constraint**: `elementsOnly` only applies to `fade` and `zoom`. Directional transitions (`slide`, `push`) operate on the full viewport — isolating just elements breaks the spatial illusion. The editor UI hides the checkbox when a directional transition is selected.

## Consequences

- **Schema**: Scene gains optional `transition: { type, params: { direction?, duration?, elementsOnly? } }`
- **Player architecture**: `TransitionController` manages state machine (idle | transitioning), locks `goToScene` during transitions, delegates to transition registry
- **Editor UI**: Scene properties panel (when no element selected) shows transition dropdown + direction/duration/elementsOnly controls
- **Timing contract**: `enterScene` triggers fire *after* transition completes, not during
- **First-scene handling**: Initial scene appears instantly regardless of its transition config (no "fade in from black" on load)
- **Migration path**: Existing projects have no transition field → instant cuts (backwards compatible). If we later need per-action overrides, add optional `transition` param to `goToScene` action — scene's transition becomes the default, action's becomes the override.
