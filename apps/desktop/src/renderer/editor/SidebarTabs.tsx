import { type CSSProperties } from "react";
import { useEditor } from "./store";
import { ScenePanel } from "./ScenePanel";
import { ProjectHierarchy } from "./ProjectHierarchy";

export function SidebarTabs() {
  const activeTab = useEditor((s) => s.activeTab);
  const setActiveTab = useEditor((s) => s.setActiveTab);

  return (
    <div style={sidebar}>
      {/* Tab bar */}
      <div style={tabBar}>
        <button
          style={{
            ...tab,
            ...(activeTab === "scene" ? tabActive : null),
          }}
          onClick={() => setActiveTab("scene")}
        >
          Scene
        </button>
        <button
          style={{
            ...tab,
            ...(activeTab === "project" ? tabActive : null),
          }}
          onClick={() => setActiveTab("project")}
        >
          Project
        </button>
      </div>

      {/* Content */}
      <div style={content}>
        {activeTab === "scene" ? <ScenePanel /> : <ProjectHierarchy />}
      </div>
    </div>
  );
}

const sidebar: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: 220,
  flexShrink: 0,
  background: "#0e1218",
  borderRight: "1px solid #1f2733",
  minHeight: 0,
};

const tabBar: CSSProperties = {
  display: "flex",
  gap: 2,
  background: "#0b1016",
  borderBottom: "1px solid #1f2733",
  padding: "0 8px",
};

const tab: CSSProperties = {
  flex: 1,
  padding: "8px 16px",
  background: "#161c26",
  border: "1px solid #1f2733",
  borderBottom: "none",
  borderTopLeftRadius: 6,
  borderTopRightRadius: 6,
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  position: "relative",
  top: 1,
};

const tabActive: CSSProperties = {
  background: "#0e1218",
  color: "#e2e8f0",
  borderColor: "#1f273300",
  boxShadow: "0 -2px 4px rgba(32, 53, 75, 0.82)",
};

const content: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};
