# 12. Video support for scene backgrounds

Date: 2026-07-29

## Status

Accepted

## Context

Scene backgrounds (`Scene.background`) currently support only a solid color or a static image, distinguished by content (leading `#` = color, else an image path rendered via CSS `background-image`). Users want to use video (ambient loops, brand motion) as a scene background.

## Decision

### Data model

**Repurpose `background` as a generic media source** (backward compatible) — no schema change, no new `mediaType` field. Detect video the same way Collections already do (ADR 0006), via a shared helper:

```typescript
// packages/engine/src/render/ElementRenderer.tsx
export function isVideoSrc(src: string): boolean {
  const ext = src.split(".").pop()?.toLowerCase();
  return ext === "mp4" || ext === "webm" || ext === "mov" || ext === "ogg";
}
```

`CollectionRenderer`'s local `isVideo()` was replaced with this shared export rather than keeping two copies of the same extension list.

**Why extension detection again, not MIME/explicit flag?** Same reasoning as ADR 0006: redundant authoring, extension detection is instant and already the established pattern in this codebase for one-field-does-double-duty media sources.

### Rendering

CSS can't autoplay a video via `background-image`, so a video background renders as a real `<video>` element, absolutely positioned to fill the scene container, placed *behind* the scene's elements. This lands in both places that build scene background styling:

- `packages/engine/src/render/Player.tsx` — actual playback (kiosk runtime and the live preview embedded in the editor).
- `apps/desktop/src/renderer/editor/Canvas.tsx` — the editor's outer stage div. This layer sits behind the embedded `<Player>` and is fully covered by it, so for video it just falls back to a black background rather than emitting a broken `background-image: url(*.mp4)`.

`backgroundSize` (`cover`/`contain`/`fill`) and `backgroundPosition` carry over unchanged, mapped to the video's `object-fit`/`object-position` — same field drives both image and video sizing.

### No exposed playback controls

Background video is **hardcoded** `autoplay`, `loop`, `muted`, `playsInline`, with no `controls` attribute — and, unlike the standalone `video` element (which exposes Autoplay/Loop/Muted/Show-controls checkboxes in `PropertiesPanel`), **none of these are exposed as editable options** for backgrounds.

**Why no toggles?**
- A background is scene furniture, not an interactive media object — there's no scenario where a kiosk background should be paused, unmuted, or show a scrubber.
- Matches the "no browser controls" precedent already established for Collection videos (ADR 0006) and the standalone video element's own controls-free default (ADR 0002) — consistency across every place video renders in this app.
- Keeps the Scene settings panel simple: one "Choose background image or video…" button, unchanged `Size` selector, no new UI surface.

## Consequences

### Positive
- Backward compatible — old projects with a color or image background are untouched (`isVideoSrc` only matches video-extension paths).
- No schema migration.
- Consistent with the existing Collection video pattern; one shared `isVideoSrc` helper instead of duplicated extension lists.

### Negative
- Extension-based detection carries the same limitation noted in ADR 0006 — a mislabeled or extensionless file won't be detected as video.
- No per-scene override of loop/mute — acceptable since backgrounds are intentionally not configurable in this way.
