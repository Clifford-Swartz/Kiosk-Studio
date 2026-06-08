import { type CSSProperties } from "react";
import type { Action, ActionType } from "@kiosk/engine";
import { useEditor } from "./store.js";

/**
 * Triggers & Actions editor for the selected element. Lists the element's
 * interactions (trigger → actions); add a tap trigger, then add/configure
 * actions (Go to scene / Set property / Toggle visibility) with param forms.
 * Writes through the store; the Player runs these live.
 */
export function InteractionsEditor({ elementId }: { elementId: string }) {
  const scene = useEditor((s) => s.activeScene());
  const project = useEditor((s) => s.project);
  const addInteraction = useEditor((s) => s.addInteraction);
  const removeInteraction = useEditor((s) => s.removeInteraction);
  const addAction = useEditor((s) => s.addAction);
  const updateAction = useEditor((s) => s.updateAction);
  const removeAction = useEditor((s) => s.removeAction);

  const el = scene.elements.find((e) => e.id === elementId);
  if (!el) return null;

  const otherElements = scene.elements.filter((e) => e.id !== elementId);
  const targets = scene.elements; // setProp/toggle can target any element (incl. self)

  return (
    <div style={{ marginTop: 14 }}>
      <div style={heading}>Interactions</div>

      {el.interactions.length === 0 && (
        <div style={{ color: "#64748b", fontSize: 12, padding: "2px 2px 8px" }}>
          No interactions yet.
        </div>
      )}

      {el.interactions.map((it) => (
        <div key={it.id} style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={triggerChip}>When {it.trigger}</span>
            <button style={{ ...miniBtn, marginLeft: "auto", color: "#fca5a5" }} onClick={() => removeInteraction(elementId, it.id)} title="Remove trigger">✕</button>
          </div>

          {it.actions.map((a, idx) => (
            <ActionRow
              key={idx}
              action={a}
              scenes={project.scenes}
              targets={targets}
              onChange={(patch) => updateAction(elementId, it.id, idx, patch)}
              onRemove={() => removeAction(elementId, it.id, idx)}
            />
          ))}

          <select
            value=""
            onChange={(e) => {
              const t = e.target.value as ActionType;
              if (!t) return;
              const defaults: Record<string, unknown> =
                t === "goToScene" ? { sceneId: project.scenes[0]?.id }
                : t === "setProp" ? { target: otherElements[0]?.id ?? elementId, key: "text", value: "" }
                : { target: otherElements[0]?.id ?? elementId };
              addAction(elementId, it.id, { type: t, params: defaults });
            }}
            style={{ ...input, marginTop: 4 }}
          >
            <option value="">+ Add action…</option>
            <option value="goToScene">Go to scene</option>
            <option value="setProp">Set property</option>
            <option value="toggle">Toggle visibility</option>
          </select>
        </div>
      ))}

      <button style={addTriggerBtn} onClick={() => addInteraction(elementId, "tap")}>
        + Add trigger (tap)
      </button>
    </div>
  );
}

function ActionRow({
  action,
  scenes,
  targets,
  onChange,
  onRemove,
}: {
  action: Action;
  scenes: { id: string; name: string }[];
  targets: { id: string; type: string; name?: string }[];
  onChange: (patch: Partial<Action>) => void;
  onRemove: () => void;
}) {
  const p = action.params;
  const setParam = (k: string, v: unknown) => onChange({ params: { [k]: v } });
  const targetLabel = (t: { id: string; type: string; name?: string }) => t.name || `${t.type} (${t.id.slice(0, 6)})`;

  return (
    <div style={actionRow}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 600 }}>
          {action.type === "goToScene" ? "Go to scene" : action.type === "setProp" ? "Set property" : "Toggle visibility"}
        </span>
        <button style={{ ...miniBtn, marginLeft: "auto", color: "#fca5a5" }} onClick={onRemove} title="Remove action">✕</button>
      </div>

      {action.type === "goToScene" && (
        <select value={str(p.sceneId)} onChange={(e) => setParam("sceneId", e.target.value)} style={input}>
          {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}

      {action.type === "setProp" && (
        <>
          <select value={str(p.target)} onChange={(e) => setParam("target", e.target.value)} style={input}>
            {targets.map((t) => <option key={t.id} value={t.id}>{targetLabel(t)}</option>)}
          </select>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <input placeholder="prop (e.g. text)" value={str(p.key)} onChange={(e) => setParam("key", e.target.value)} style={{ ...input, flex: 1 }} />
            <input placeholder="value" value={str(p.value)} onChange={(e) => setParam("value", e.target.value)} style={{ ...input, flex: 1 }} />
          </div>
        </>
      )}

      {action.type === "toggle" && (
        <select value={str(p.target)} onChange={(e) => setParam("target", e.target.value)} style={input}>
          {targets.map((t) => <option key={t.id} value={t.id}>{targetLabel(t)}</option>)}
        </select>
      )}
    </div>
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

const heading: CSSProperties = {
  color: "#7c8aa0",
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  margin: "0 2px 8px",
};
const card: CSSProperties = {
  background: "#0e1218",
  border: "1px solid #1f2733",
  borderRadius: 8,
  padding: 8,
  marginBottom: 8,
};
const actionRow: CSSProperties = {
  background: "#11161f",
  border: "1px solid #232c3a",
  borderRadius: 6,
  padding: 6,
  marginBottom: 4,
};
const triggerChip: CSSProperties = {
  background: "#1e3a52",
  color: "#e0f2fe",
  fontSize: 12,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 12,
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
const miniBtn: CSSProperties = {
  background: "none",
  border: "none",
  color: "#cbd5e1",
  cursor: "pointer",
  fontSize: 12,
  padding: "0 2px",
};
const addTriggerBtn: CSSProperties = {
  width: "100%",
  padding: "7px",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  cursor: "pointer",
};
