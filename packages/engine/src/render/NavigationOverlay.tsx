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
          bottom: 20,
          left: 20,
          display: "flex",
          flexDirection: "column-reverse",
          gap: 8,
          pointerEvents: "auto",
        }}
      >
        {/* Back button (bottom) */}
        {showBackButton && (
          <button
            onClick={onBack}
            style={{
              width: 50,
              height: 50,
              borderRadius: "50%",
              border: "none",
              background: "rgba(0, 0, 0, 0.6)",
              color: "#fff",
              fontSize: 24,
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
              width: 50,
              height: 50,
              borderRadius: "50%",
              border: "none",
              background: "rgba(0, 0, 0, 0.6)",
              color: "#fff",
              fontSize: 24,
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
