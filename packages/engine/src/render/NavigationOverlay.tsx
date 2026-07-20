import type { Project } from "../model/types.js";

export interface NavigationOverlayProps {
  project: Project;
  currentSceneId: string;
  navigationHistory: string[];
  onBack: () => void;
  onHome: () => void;
}

/**
 * Overlay navigation UI for Play/Kiosk mode. Renders back and home buttons
 * as positioned overlays (not in-scene elements) per ADR 0005.
 */
export function NavigationOverlay({
  project,
  currentSceneId,
  navigationHistory,
  onBack,
  onHome,
}: NavigationOverlayProps) {
  const homeSceneId = project.startSceneId ?? project.scenes[0]?.id;
  const showBackButton = project.enableBackButton && navigationHistory.length > 0;
  const showHomeButton = project.enableHomeButton && currentSceneId !== homeSceneId;

  if (!showBackButton && !showHomeButton) {
    return null;
  }

  // Sizes scale with the viewport (vmin) so buttons stay a consistent,
  // reachable touch target on 4K/8K kiosk displays instead of a fixed
  // pixel size that shrinks relative to screen size as resolution grows.
  // Clamped so small preview windows still get a usable minimum size.
  const buttonSize = "clamp(44px, 5vmin, 96px)";
  const iconSize = "clamp(20px, 2.4vmin, 46px)";
  const gap = "clamp(8px, 0.8vmin, 20px)";
  const edgeOffset = "clamp(16px, 2vmin, 40px)";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {/* Buttons positioned bottom-left, stacked vertically */}
      <div
        style={{
          position: "absolute",
          bottom: edgeOffset,
          left: edgeOffset,
          display: "flex",
          flexDirection: "column-reverse",
          gap,
          pointerEvents: "auto",
        }}
      >
        {/* Back button (bottom) */}
        {showBackButton && (
          <button
            onClick={onBack}
            style={{
              width: buttonSize,
              height: buttonSize,
              borderRadius: "50%",
              border: "none",
              background: "rgba(0, 0, 0, 0.6)",
              color: "#fff",
              fontSize: iconSize,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "background 200ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 0, 0, 0.75)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0, 0, 0, 0.6)";
            }}
            title="Back"
          >
            ◀
          </button>
        )}

        {/* Home button (top) */}
        {showHomeButton && (
          <button
            onClick={onHome}
            style={{
              width: buttonSize,
              height: buttonSize,
              borderRadius: "50%",
              border: "none",
              background: "rgba(0, 0, 0, 0.6)",
              color: "#fff",
              fontSize: iconSize,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "background 200ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 0, 0, 0.75)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0, 0, 0, 0.6)";
            }}
            title="Home"
          >
            ⌂
          </button>
        )}
      </div>
    </div>
  );
}
