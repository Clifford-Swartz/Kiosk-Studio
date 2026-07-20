import { useState, type CSSProperties } from "react";
import { useEditor } from "./store.js";
import type { DataConnectorDef, EventKind } from "@kiosk/engine";
import { isRestConnector } from "@kiosk/engine";

const EVENT_KINDS: EventKind[] = [
  "sessionStart",
  "sessionEnd",
  "sceneEnter",
  "sceneExit",
  "elementTap",
  "elementHover",
  "elementPress",
  "elementRelease",
  "actionRun",
  "videoPlay",
  "videoPause",
  "videoComplete",
  "videoSeek",
  "audioPlay",
  "audioPause",
  "audioComplete",
  "dataChanged",
  "dataError",
];

/**
 * Left-column panel for data connectors (input sources + output sinks).
 * Tabbed UI: Sources (REST input) | Sinks (CSV/JSON/REST output).
 */
export function DataSourcesPanel() {
  const connectors = useEditor((s) => s.project.dataConnectors || []);
  const addDataConnector = useEditor((s) => s.addDataConnector);
  const updateDataConnector = useEditor((s) => s.updateDataConnector);
  const removeDataConnector = useEditor((s) => s.removeDataConnector);

  const [activeTab, setActiveTab] = useState<"sources" | "sinks">("sources");
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  // Filter connectors by tab
  const sources = connectors.filter(isRestConnector).filter((c) => c.input?.enabled);
  const sinks = connectors.filter((c) => c.output?.enabled);

  async function testSource(id: string, url: string) {
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
      <div style={heading}>Data connectors</div>

      {/* Tabs */}
      <div style={tabRow}>
        <button
          style={activeTab === "sources" ? activeTabBtn : tabBtn}
          onClick={() => setActiveTab("sources")}
        >
          Sources
        </button>
        <button
          style={activeTab === "sinks" ? activeTabBtn : tabBtn}
          onClick={() => setActiveTab("sinks")}
        >
          Sinks
        </button>
      </div>

      {/* Sources tab */}
      {activeTab === "sources" && (
        <>
          <button style={addBtn} onClick={() => addDataConnector("rest")}>
            ＋ REST source
          </button>

          {sources.length === 0 && (
            <div style={emptyMsg}>
              No input sources. Add a REST source to poll live data.
            </div>
          )}

          {sources.map((c) => {
            if (c.kind !== "rest" || !c.input) return null;
            const url = c.input.url;
            const interval = c.input.intervalMs;

            return (
              <div key={c.id} style={card}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    value={c.name}
                    onChange={(e) => updateDataConnector(c.id, { name: e.target.value })}
                    style={{ ...input, flex: 1, fontWeight: 600 }}
                  />
                  <button
                    title="Remove"
                    style={delBtn}
                    onClick={() => removeDataConnector(c.id)}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ color: "#64748b", fontSize: 10, margin: "4px 0 2px" }}>
                  {c.id}
                </div>
                <input
                  placeholder="https://api.example.com/data.json"
                  value={url}
                  onChange={(e) =>
                    updateDataConnector(c.id, {
                      input: { ...c.input!, url: e.target.value },
                    } as any)
                  }
                  style={input}
                />
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                  <span style={{ color: "#94a3b8", fontSize: 11 }}>every</span>
                  <input
                    type="number"
                    value={interval}
                    onChange={(e) =>
                      updateDataConnector(c.id, {
                        input: { ...c.input!, intervalMs: Number(e.target.value) },
                      } as any)
                    }
                    style={{ ...input, width: 80 }}
                  />
                  <span style={{ color: "#94a3b8", fontSize: 11 }}>ms</span>
                  <button style={testBtn} onClick={() => testSource(c.id, url)}>
                    Test
                  </button>
                </div>
                {testResult[c.id] && <pre style={preview}>{testResult[c.id]}</pre>}
              </div>
            );
          })}
        </>
      )}

      {/* Sinks tab */}
      {activeTab === "sinks" && (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            <button style={addBtn2} onClick={() => addDataConnector("csv")}>
              ＋ CSV
            </button>
            <button style={addBtn2} onClick={() => addDataConnector("json")}>
              ＋ JSON
            </button>
            <button style={addBtn2} onClick={() => addDataConnector("jsonl")}>
              ＋ JSONL
            </button>
            <button style={addBtn2} onClick={() => addDataConnector("console")}>
              ＋ Console
            </button>
          </div>

          {sinks.length === 0 && (
            <div style={emptyMsg}>
              No output sinks. Add one to export analytics.
            </div>
          )}

          {sinks.map((c) => {
            if (!c.output) return null;

            return (
              <div key={c.id} style={card}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    value={c.name}
                    onChange={(e) => updateDataConnector(c.id, { name: e.target.value })}
                    style={{ ...input, flex: 1, fontWeight: 600 }}
                  />
                  <span style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase" }}>
                    {c.kind}
                  </span>
                  <button
                    title="Remove"
                    style={delBtn}
                    onClick={() => removeDataConnector(c.id)}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ color: "#64748b", fontSize: 10, margin: "4px 0 6px" }}>
                  {c.id}
                </div>

                {/* Path field (CSV/JSON/JSONL) */}
                {(c.kind === "csv" || c.kind === "json" || c.kind === "jsonl") && (
                  <input
                    placeholder="analytics/session.csv"
                    value={c.output.path}
                    onChange={(e) =>
                      updateDataConnector(c.id, {
                        output: { ...c.output!, path: e.target.value },
                      } as any)
                    }
                    style={input}
                  />
                )}

                {/* Console format dropdown */}
                {c.kind === "console" && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ color: "#94a3b8", fontSize: 11 }}>format:</span>
                    <select
                      value={c.output.format}
                      onChange={(e) =>
                        updateDataConnector(c.id, {
                          output: {
                            ...c.output!,
                            format: e.target.value as "table" | "json" | "compact",
                          },
                        } as any)
                      }
                      style={input}
                    >
                      <option value="table">Table</option>
                      <option value="json">JSON</option>
                      <option value="compact">Compact</option>
                    </select>
                  </div>
                )}

                {/* Event checkboxes */}
                <EventCheckboxes
                  connector={c}
                  onUpdate={(events) =>
                    updateDataConnector(c.id, {
                      output: { ...c.output!, events },
                    } as any)
                  }
                />

                {/* Flush interval (not console) */}
                {c.kind !== "console" && c.kind !== "rest" && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                    <span style={{ color: "#94a3b8", fontSize: 11 }}>flush every</span>
                    <input
                      type="number"
                      value={c.output.flushIntervalMs}
                      onChange={(e) =>
                        updateDataConnector(c.id, {
                          output: { ...c.output!, flushIntervalMs: Number(e.target.value) },
                        } as any)
                      }
                      style={{ ...input, width: 80 }}
                    />
                    <span style={{ color: "#94a3b8", fontSize: 11 }}>ms</span>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function EventCheckboxes({
  connector,
  onUpdate,
}: {
  connector: DataConnectorDef;
  onUpdate: (events: EventKind[]) => void;
}) {
  if (!connector.output) return null;

  const selected = new Set(connector.output.events);
  const allSelected = EVENT_KINDS.every((k) => selected.has(k));

  const toggle = (kind: EventKind) => {
    const next = new Set(selected);
    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }
    onUpdate(Array.from(next));
  };

  const toggleAll = () => {
    if (allSelected) {
      onUpdate([]);
    } else {
      onUpdate([...EVENT_KINDS]);
    }
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <span style={{ color: "#94a3b8", fontSize: 11 }}>events:</span>
        <button style={selectAllBtn} onClick={toggleAll}>
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div style={eventGrid}>
        {EVENT_KINDS.map((kind) => (
          <label key={kind} style={eventLabel}>
            <input
              type="checkbox"
              checked={selected.has(kind)}
              onChange={() => toggle(kind)}
              style={{ marginRight: 4 }}
            />
            <span style={{ fontSize: 10, color: "#cbd5e1" }}>{kind}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// --- Styles ---

const panel: CSSProperties = {
  borderTop: "4px solid #0a0e13",
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

const tabRow: CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 10,
};

const tabBtn: CSSProperties = {
  flex: 1,
  padding: "6px",
  background: "#0e1218",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#94a3b8",
  fontSize: 12,
  cursor: "pointer",
};

const activeTabBtn: CSSProperties = {
  ...tabBtn,
  background: "#1e3a52",
  borderColor: "#2563eb",
  color: "#e0f2fe",
  fontWeight: 600,
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

const addBtn2: CSSProperties = {
  flex: 1,
  padding: "6px",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 11,
  cursor: "pointer",
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

const selectAllBtn: CSSProperties = {
  marginLeft: "auto",
  background: "#0e1218",
  border: "1px solid #232c3a",
  borderRadius: 4,
  color: "#94a3b8",
  fontSize: 10,
  padding: "2px 6px",
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

const emptyMsg: CSSProperties = {
  color: "#64748b",
  fontSize: 12,
  padding: "4px 2px",
};

const eventGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 4,
  maxHeight: 180,
  overflowY: "auto",
  padding: 4,
  background: "#0b1016",
  border: "1px solid #1f2733",
  borderRadius: 6,
};

const eventLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  cursor: "pointer",
  padding: 2,
};
