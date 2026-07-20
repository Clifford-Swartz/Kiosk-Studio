# 6. Add video support to Collection elements

Date: 2026-06-23

## Status

Accepted

## Context

Collections currently support only images in their item template (`CollectionItem.image` field). Users want to display video content in collections (product demos, tutorials, media galleries) with the same layout options (grid, carousel, coverflow, Ken Burns).

Key requirements:
- Only one video plays at a time (the "active" item)
- Inactive videos pause and reset to beginning
- User interaction determines which video plays
- Mixed collections (some items with videos, some with images)

## Decision

### Data Model

**Repurpose `image` field as media source** (backward compatible). Keep the field name `image` but accept both image and video file paths. Use file extension to determine rendering:

```typescript
function isVideo(src: string): boolean {
  const ext = src.split('.').pop()?.toLowerCase();
  return ext === 'mp4' || ext === 'webm' || ext === 'mov' || ext === 'ogg';
}
```

**Why not add separate `video` field?**
- Each item shows one piece of media, not both
- Simpler UI (one file picker per item)
- Cleaner mental model ("item media" not "item image and maybe also video")

**Why not explicit `mediaType` field?**
- Redundant authoring (user picks file, then tells system "this is a video")
- Extension detection is instant and accurate enough
- Matches existing protocol handler pattern (`apps/desktop/src/main/index.ts` MIME map)

**Error handling:** Failed loads (bad path, unsupported codec) render "no media" placeholder (existing image fallback reused).

### Active Item Orchestration

**One active item drives playback.** The active video plays; all others pause + reset to `currentTime = 0` + muted. This applies across all layouts:

- **Grid:** User taps card → becomes active. No active item initially (browsing state).
- **Carousel/Coverflow:** Active item is centered/featured. Navigate via swipe or nav buttons.
- **Ken Burns:** Active item is fullscreen. Auto-advances via timer or video end.

**State ownership:** `CollectionRenderer` lifts state from individual layouts. Manages:
- `activeIndex` (which item is active)
- `videoRefs` (Map of item.id → HTMLVideoElement)
- Play/pause orchestration (effect watches activeIndex, controls all videos)

**Why lift state vs. shared hook?**
- Single source of truth (no state duplication across layouts)
- Simpler layouts (pure presentation, receive `activeIndex` + `onSetActive`)
- Easier to reason about (one component owns video lifecycle)

**Video refs collected via Map:**
```typescript
const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
// ItemCard sets: ref={(el) => el && videoRefs.current.set(item.id, el)}
```

**Why ref map vs. callback drilling?**
- Shorter prop chain (CollectionRenderer → layout → ItemCard is 2 levels, not 3)
- Cleaner than Context API (overkill for local ref collection)

**Videos don't register with Player.** Collection videos are internal—interactions can't target them directly (no `playMedia` by video ID). Collections manage their own playback state.

**Why not register?**
- Conflict with collection logic (interaction says play, collection says pause—who wins?)
- Collections are curated sets with internal rules, not raw video elements
- Future: add collection-level interaction actions (`nextItem`, `prevItem`) if needed

### New Collection Props

Four new video-related properties (collection-level, not per-item):

```typescript
videoLoop: boolean = true              // videos restart when finished
advanceOnVideoEnd: boolean = false     // advance to next item when video ends
advanceDelayMs: number = 0             // delay (ms) before advancing
videoMuted: boolean = true             // audio on/off for active video
```

**`videoLoop` and `advanceOnVideoEnd` are mutually exclusive** (enforced in UI—enabling one disables the other). When video ends:
- If `videoLoop: true` → restart, stay on same item
- If `advanceOnVideoEnd: true` → pause, advance after `advanceDelayMs`

**Why mutually exclusive?**
- Logical conflict: can't both "loop forever" and "advance on end"
- Clear intent: author picks one behavior, not ambiguous combo

**Defaults:**
- `videoLoop: true` — matches standalone video element (loops by default)
- `advanceOnVideoEnd: false` — collections don't auto-advance unless explicitly enabled
- `advanceDelayMs: 0` — immediate advance (no surprise delays)
- `videoMuted: true` — matches standalone video (kiosk videos often silent)

### Layout-Specific Behavior

#### Grid: Browsing + Focused States

**Browsing state:** All cards visible in grid layout. No active item initially.

**Focused state:** User taps card → card expands to fill collection bounds, others hidden. Tap anywhere to unfocus (return to grid).

**Why two states?**
- Grid shows many items simultaneously (unlike carousel/coverflow which feature one)
- Small thumbnails don't do videos justice—focused state gives immersive view
- Matches "one active item" model without abandoning grid layout

**Focused state applies to both videos AND images:**
- Videos: expand + auto-play
- Images: expand + show (like a lightbox/detail view)

**Why focus images too?**
- Consistent interaction (all grid items tappable, no guessing)
- Useful (thumbnails cropped with `cover`, focused shows full image with `contain`)
- Predictable UX (tap to focus, tap to unfocus—works for all media)

**Focused state persists through advances.** If `advanceOnVideoEnd: true` triggers while focused, collection advances to next item but stays in focused mode (next item now focused).

**No manual navigation in focused state.** Focused mode is single-item view (watch this video, view this image). To browse, user unfocuses. Carousel/coverflow already handle multi-item browsing with nav.

#### Carousel/Coverflow/Ken Burns: No Focused Mode

These layouts already prominently feature the active item:
- Carousel: active card centered at 60% width
- Coverflow: active card front-center in 3D space
- Ken Burns: active item fullscreen

**No "tap to zoom" needed**—the active item is already the visual focus. Videos auto-play when active (no separate interaction required).

#### Mixed Collections (Images + Videos)

When `advanceOnVideoEnd: true` and Ken Burns `intervalMs` both configured:

**Video items:** Ignore `intervalMs`, use video duration. Advance when video ends (+ `advanceDelayMs`).

**Image items:** Use `intervalMs` timer (existing Ken Burns behavior).

**Why not couple image timing to video duration?**
- Each media type uses its natural timing (videos self-determine, images use timer)
- Decoupled (adding/removing videos doesn't affect image timing)
- Ken Burns with only images still works (no special cases)

### Visual Treatment

#### ItemCard Thumbnails (Browsing State)

Same wrapper structure for videos and images:
```jsx
<div style={{ flex: 1, minHeight: 0, background: "#0b1016" }}>
  {isVideo(src) ? (
    <video src={resolvedSrc} style={{width: "100%", height: "100%", objectFit: "cover"}} />
  ) : (
    <img src={resolvedSrc} style={{width: "100%", height: "100%", objectFit: "cover"}} />
  )}
</div>
```

**Why `objectFit: cover` for videos?**
- Matches image behavior (cards always fully filled, no letterboxing)
- ItemCard design assumes filled image area (flex: 1 + fixed title/subtitle padding)
- Consistent grid/carousel aesthetics

#### Grid Focused State

Video/image fills collection bounds with `objectFit: contain` (preserve full frame, letterbox if needed).

**Why `contain` in focused vs. `cover` in thumbnails?**
- Focused = primary content (user wants to see it fully, not cropped)
- Thumbnails = preview (cropping acceptable for clean card design)
- Matches standalone video element behavior (no objectFit = defaults to contain)

**Title/subtitle overlaid** using Ken Burns pattern:
- Gradient: `linear-gradient(transparent, rgba(0,0,0,0.7))`
- Positioning: `position: absolute, left: 0, right: 0, bottom: 0, padding: 24px`
- Colors: `props.titleColor` / `props.subtitleColor` (respect collection theme)
- Font sizes: 32px title, 20px subtitle (larger than ItemCard's 22/16—focused is "fullscreen")

**Why overlay title/subtitle in focused state?**
- Context: User can see what they're watching (especially in mixed collections)
- Consistency: Ken Burns already uses this pattern for fullscreen items
- Requested explicitly during design discussion

#### No Browser Controls

Collection videos never show native browser controls (no `controls` attribute).

**Why?**
- Consistency with standalone videos (kiosk context = designed experiences)
- Interaction conflicts (collection logic pauses inactive videos; user seeking/pausing would conflict)
- Clean aesthetics (ItemCard has designed layout; browser controls break it)
- Focus on collection state (tap-to-close is primary interaction, not play/pause buttons)

### Preload Strategy

**Active video:** `preload="auto"` (browser fully loads, ready for instant playback)

**Inactive videos:** `preload="metadata"` (load enough to show first frame + duration, not full download)

**Why not all `auto`?**
- 10-20 videos downloading simultaneously = slow initial load, wasted bandwidth
- Most users won't view all items—only active video needs full buffer

**Why not collection-level config?**
- Most users won't understand preload nuances
- Smart default (active auto, inactive metadata) handles 90% of cases
- Per-video effect manages switching (when item becomes active, upgrade to auto)

**Implementation:** Each video's effect watches `isActive`, updates its own preload attribute.

### Lifecycle & Cleanup

**On mount (collection appears):** If `playing={true}` (Player/Kiosk mode), active item's video auto-plays immediately.

**Why auto-play vs. user-initiated?**
- Matches standalone video behavior (autoplay when scene enters)
- Kiosk context (media plays automatically, not YouTube-style user initiation)
- Ken Burns pattern (images appear immediately, videos should too)

**On activeIndex change:** Old active video pauses + resets to `currentTime = 0`. New active video resets + plays.

**On unmount (scene exit):** All videos pause + reset to beginning. Clean state for next scene load.

**Why pause AND reset?**
- Clean state (next time scene loads, collection starts from first item, videos at beginning)
- Resource cleanup (pausing stops decode, resetting releases buffered data)
- Matches existing patterns (override store resets on scene change, enterScene triggers on new scene)

## Consequences

### Positive

- **One playback model** works across all layouts (active plays, others paused)
- **Flexible timing** (videos self-determine duration, images use timer, advanceOnVideoEnd optional)
- **Grid stays Grid** (focused state keeps collection bounds, no fullscreen breakout)
- **Backward compatible** (repurposed `image` field, no schema migration needed)
- **Consistent with standalone videos** (same preload/autoplay/muted defaults)

### Negative

- **Grid complexity** (two states vs. carousel/coverflow's single state—more mental model)
- **Extension-based detection** (less robust than MIME detection, but acceptable trade-off)
- **No per-item video config** (all videos share `videoLoop`/`muted`—can't have one item looped, another not)

### Future Considerations

- **Collection-level interactions** (`nextItem`, `prevItem`, `goToItem` actions) if users need programmatic control
- **Per-item video props** (if users request different loop/muted per item—would need `CollectionItem.videoLoop`, etc.)
- **Lazy mounting** (unmount distant items, mount only active + neighbors—if 100-item collections on low-end hardware become common)
- **MIME-based detection** (replace extension check with Content-Type header if reliability issues arise)
