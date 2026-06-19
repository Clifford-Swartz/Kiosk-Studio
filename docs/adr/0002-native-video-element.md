# 2. Use native `<video>` element instead of Video.js

Date: 2026-06-18

## Status

Accepted

## Context

Video.js integration caused recurring issues:

1. **Source corruption** - repeated src changes corrupted player state, requiring page reload
2. **Dimension/positioning bugs** - Video.js overrode wrapper styles, required complex workarounds (player.width/height API + direct style manipulation + nested wrapper divs)
3. **Unnecessary complexity** - Video.js adds ~240KB + controls UI we don't use

Kiosk apps don't need Video.js features:
- Controls UI not used (programmatic playback via interactions)
- Responsive/fluid modes redundant (ScaledStage handles viewport scaling)
- Advanced features (playlists, plugins, adaptive streaming) unused

Native `<video>` provides all needed functionality:
- Autoplay, loop, muted, preload (native attrs)
- Programmatic control (play/pause/seek/volume/speed via HTMLVideoElement API)
- Object-fit for aspect ratio

## Decision

Replace Video.js with native `<video>` element. Use wrapper div pattern (matches image/audio elements):

```jsx
<div style={baseStyle}>        // positioning + dims
  <video style={{width: "100%", height: "100%"}} />
</div>
```

Programmatic control via HTMLVideoElement API in Player.tsx video control methods.

Props sync via React JSX attrs (no useEffect needed).

## Consequences

**Positive:**
- Simpler code (~150 lines removed from VideoElement)
- No third-party bugs (corruption, positioning issues)
- Smaller bundle (~240KB smaller)
- Consistent element pattern (wrapper + fill, like image/audio)

**Negative:**
- No controls UI (must build custom if needed in future - use button elements + interactions)
- Manual MIME type detection gone (browser auto-detects from extension - sufficient for standard formats)

**Neutral:**
- Same programmatic API surface (play/pause/seek/volume/speed still available via interactions)
