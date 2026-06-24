import { type CSSProperties } from "react";
import { Palette } from "./Palette";
import { SceneStructure } from "./SceneStructure";
import { DataSourcesPanel } from "./DataSourcesPanel";

/**
 * Scene tab content: groups Palette, SceneStructure, and DataSourcesPanel.
 */
export function ScenePanel() {
  return (
    <div style={panel}>
      <Palette />
      <SceneStructure />
      <DataSourcesPanel />
    </div>
  );
}

const panel: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
};
