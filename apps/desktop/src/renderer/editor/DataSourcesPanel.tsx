import { useState, type CSSProperties } from "react";
import { useEditor } from "./store.js";

/**
 * Left-column panel for live data sources. v1 supports REST: name, URL, poll
 * interval, and a "Test fetch" that previews the response so you can find the
 * path to bind. Sources persist in the project; the live session (App) starts
 * connectors for them automatically.
 */
export function DataSourcesPanel() {
  const sources = useEditor((s) => s.project.dataSources);
  const addDataSource = useEditor((s) => s.addDataSource);
  const updateDataSource = useEditor((s) => s.updateDataSource);
  const removeDataSource = useEditor((s) => s.removeDataSource);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  async function test(id: string, url: string) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      let preview = text;
      try {
        preview = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* keep raw */
      }
      setTestResult((r) => ({ ...r, [id]: preview.slice(0, 400) }));
    } catch (e) {
      setTestResult((r) => ({ ...r, [id]: `Error: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }

  return (
    <div style={panel}>
      <div style={heading}>Data sources</div>
      <button style={addBtn} onClick={() => addDataSource("rest")}>＋ REST source</button>

      {sources.length === 0 && (
        <div style={{ color: "#64748b", fontSize: 12, padding: "4px 2px" }}>
          No data sources. Add one to bind live values.
        </div>
      )}

      {sources.map((d) => {
        const url = typeof d.config.url === "string" ? d.config.url : "";
        const interval = typeof d.config.intervalMs === "number" ? d.config.intervalMs : 5000;
        return (
          <div key={d.id} style={card}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={d.name}
                onChange={(e) => updateDataSource(d.id, { name: e.target.value })}
                style={{ ...input, flex: 1, fontWeight: 600 }}
              />
              <button title="Remove" style={delBtn} onClick={() => removeDataSource(d.id)}>✕</button>
            </div>
            <div style={{ color: "#64748b", fontSize: 10, margin: "4px 0 2px" }}>{d.id}</div>
            <input
              placeholder="https://api.example.com/data.json"
              value={url}
              onChange={(e) => updateDataSource(d.id, { config: { url: e.target.value } })}
              style={input}
            />
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              <span style={{ color: "#94a3b8", fontSize: 11 }}>every</span>
              <input
                type="number"
                value={interval}
                onChange={(e) => updateDataSource(d.id, { config: { intervalMs: Number(e.target.value) } })}
                style={{ ...input, width: 80 }}
              />
              <span style={{ color: "#94a3b8", fontSize: 11 }}>ms</span>
              <button style={testBtn} onClick={() => test(d.id, url)}>Test</button>
            </div>
            {testResult[d.id] && (
              <pre style={preview}>{testResult[d.id]}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

const panel: CSSProperties = {
  borderTop: "4px solid #0b1016",
  padding: "14px 12px",
  overflowY: "auto",
};
const heading: CSSProperties = {
  color: "#7c8aa0",
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  margin: "0 2px 10px",
};
const addBtn: CSSProperties = {
  width: "100%",
  padding: "7px",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  cursor: "pointer",
  marginBottom: 8,
};
const card: CSSProperties = {
  background: "#0e1218",
  border: "1px solid #1f2733",
  borderRadius: 8,
  padding: 8,
  marginBottom: 8,
};
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 12,
  padding: "4px 6px",
};
const delBtn: CSSProperties = {
  background: "none",
  border: "none",
  color: "#fca5a5",
  cursor: "pointer",
  fontSize: 12,
};
const testBtn: CSSProperties = {
  marginLeft: "auto",
  background: "#1e3a52",
  border: "1px solid #2563eb",
  borderRadius: 6,
  color: "#e0f2fe",
  fontSize: 11,
  padding: "3px 8px",
  cursor: "pointer",
};
const preview: CSSProperties = {
  marginTop: 6,
  maxHeight: 120,
  overflow: "auto",
  background: "#0b1016",
  border: "1px solid #1f2733",
  borderRadius: 6,
  color: "#9ca3af",
  fontSize: 10,
  padding: 6,
  whiteSpace: "pre-wrap",
};
