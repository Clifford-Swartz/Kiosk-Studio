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

      {(() => {
        // Group consecutive hover/hoverEnd and press/release pairs into sections
        const groups: Array<{ kind: "single" | "sections"; interactions: typeof el.interactions }> = [];
        let i = 0;

        while (i < el.interactions.length) {
          const curr = el.interactions[i];
          const next = el.interactions[i + 1];

          // Detect hover pair
          if (curr.trigger === "hover" && next?.trigger === "hoverEnd") {
            groups.push({ kind: "sections", interactions: [curr, next] });
            i += 2;
          }
          // Detect press pair
          else if (curr.trigger === "press" && next?.trigger === "release") {
            groups.push({ kind: "sections", interactions: [curr, next] });
            i += 2;
          }
          // Single trigger
          else {
            groups.push({ kind: "single", interactions: [curr] });
            i += 1;
          }
        }

        return groups.map((group) => {
          if (group.kind === "single") {
            const it = group.interactions[0];
            return (
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
                    const videoElements = scene.elements.filter((e) => e.type === "video");
                    const defaults: Record<string, unknown> =
                      t === "goToScene" ? { sceneId: project.scenes[0]?.id }
                      : t === "setProp" ? { target: otherElements[0]?.id ?? elementId, key: "text", value: "" }
                      : t === "togglePlayPause" ? { target: videoElements[0]?.id ?? "" }
                      : t === "seekVideo" ? { target: videoElements[0]?.id ?? "", time: 0 }
                      : t === "setVolume" ? { target: videoElements[0]?.id ?? "", volume: 1 }
                      : t === "setSpeed" ? { target: videoElements[0]?.id ?? "", rate: 1 }
                      : { target: otherElements[0]?.id ?? elementId };
                    addAction(elementId, it.id, { type: t, params: defaults });
                  }}
                  style={{ ...input, marginTop: 4 }}
                >
                  <option value="">+ Add action…</option>
                  <option value="goToScene">Go to scene</option>
                  <option value="setProp">Set property</option>
                  <option value="toggle">Toggle visibility</option>
                  <option value="togglePlayPause">Toggle play/pause</option>
                  <option value="seekVideo">Seek video to time</option>
                  <option value="setVolume">Set volume</option>
                  <option value="setSpeed">Set playback speed</option>
                </select>
              </div>
            );
          }

          // Sections card (hover or press pair)
          const [enter, exit] = group.interactions;
          const isHover = enter.trigger === "hover";
          const label = isHover ? "Hover" : "Press";

          return (
            <div key={`${enter.id}-${exit.id}`} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={triggerChip}>When {label}</span>
                <button
                  style={{ ...miniBtn, marginLeft: "auto", color: "#fca5a5" }}
                  onClick={() => {
                    removeInteraction(elementId, enter.id);
                    removeInteraction(elementId, exit.id);
                  }}
                  title="Remove trigger"
                >
                  ✕
                </button>
              </div>

              {/* On Enter / On Press section */}
              <div style={section}>
                <div style={sectionLabel}>On {isHover ? "Enter" : "Press"}</div>
                {enter.actions.map((a, idx) => (
                  <ActionRow
                    key={idx}
                    action={a}
                    scenes={project.scenes}
                    targets={targets}
                    onChange={(patch) => updateAction(elementId, enter.id, idx, patch)}
                    onRemove={() => removeAction(elementId, enter.id, idx)}
                  />
                ))}
                <select
                  value=""
                  onChange={(e) => {
                    const t = e.target.value as ActionType;
                    if (!t) return;
                    const videoElements = scene.elements.filter((e) => e.type === "video");
                    const defaults: Record<string, unknown> =
                      t === "goToScene" ? { sceneId: project.scenes[0]?.id }
                      : t === "setProp" ? { target: otherElements[0]?.id ?? elementId, key: "text", value: "" }
                      : t === "togglePlayPause" ? { target: videoElements[0]?.id ?? "" }
                      : t === "seekVideo" ? { target: videoElements[0]?.id ?? "", time: 0 }
                      : t === "setVolume" ? { target: videoElements[0]?.id ?? "", volume: 1 }
                      : t === "setSpeed" ? { target: videoElements[0]?.id ?? "", rate: 1 }
                      : { target: otherElements[0]?.id ?? elementId };
                    addAction(elementId, enter.id, { type: t, params: defaults });
                  }}
                  style={{ ...input, marginTop: 4 }}
                >
                  <option value="">+ Add action…</option>
                  <option value="goToScene">Go to scene</option>
                  <option value="setProp">Set property</option>
                  <option value="toggle">Toggle visibility</option>
                  <option value="togglePlayPause">Toggle play/pause</option>
                  <option value="seekVideo">Seek video to time</option>
                  <option value="setVolume">Set volume</option>
                  <option value="setSpeed">Set playback speed</option>
                </select>
              </div>

              {/* On Exit / On Release section */}
              <div style={section}>
                <div style={sectionLabel}>On {isHover ? "Exit" : "Release"}</div>
                {exit.actions.map((a, idx) => (
                  <ActionRow
                    key={idx}
                    action={a}
                    scenes={project.scenes}
                    targets={targets}
                    onChange={(patch) => updateAction(elementId, exit.id, idx, patch)}
                    onRemove={() => removeAction(elementId, exit.id, idx)}
                  />
                ))}
                <select
                  value=""
                  onChange={(e) => {
                    const t = e.target.value as ActionType;
                    if (!t) return;
                    const videoElements = scene.elements.filter((e) => e.type === "video");
                    const defaults: Record<string, unknown> =
                      t === "goToScene" ? { sceneId: project.scenes[0]?.id }
                      : t === "setProp" ? { target: otherElements[0]?.id ?? elementId, key: "text", value: "" }
                      : t === "togglePlayPause" ? { target: videoElements[0]?.id ?? "" }
                      : t === "seekVideo" ? { target: videoElements[0]?.id ?? "", time: 0 }
                      : t === "setVolume" ? { target: videoElements[0]?.id ?? "", volume: 1 }
                      : t === "setSpeed" ? { target: videoElements[0]?.id ?? "", rate: 1 }
                      : { target: otherElements[0]?.id ?? elementId };
                    addAction(elementId, exit.id, { type: t, params: defaults });
                  }}
                  style={{ ...input, marginTop: 4 }}
                >
                  <option value="">+ Add action…</option>
                  <option value="goToScene">Go to scene</option>
                  <option value="setProp">Set property</option>
                  <option value="toggle">Toggle visibility</option>
                  <option value="togglePlayPause">Toggle play/pause</option>
                  <option value="seekVideo">Seek video to time</option>
                  <option value="setVolume">Set volume</option>
                  <option value="setSpeed">Set playback speed</option>
                </select>
              </div>
            </div>
          );
        });
      })()}

      <select
        value=""
        onChange={(e) => {
          const trigger = e.target.value;
          if (!trigger) return;

          // Hover/Press create paired interactions (enter+exit / press+release)
          if (trigger === "hover") {
            addInteraction(elementId, "hover");
            addInteraction(elementId, "hoverEnd");
          } else if (trigger === "press") {
            addInteraction(elementId, "press");
            addInteraction(elementId, "release");
          } else {
            addInteraction(elementId, trigger as any);
          }

          e.target.value = "";
        }}
        style={addTriggerBtn}
      >
        <option value="">+ Add trigger…</option>
        <option value="tap">Tap</option>
        <option value="hover">Hover</option>
        <option value="press">Press</option>
        <option value="enterScene">Enter scene</option>
      </select>
    </div>
  );
}

/**
 * Get editable properties for an element type.
 * Returns flat list (no geometry: no x, y, width, height, rotation, opacity, zIndex).
 */
function getEditableProps(type: string): { key: string; label: string; valueType: "color" | "number" | "text" }[] {
  switch (type) {
    case "text":
      return [
        { key: "text", label: "Text", valueType: "text" },
        { key: "fontSize", label: "Font Size", valueType: "number" },
        { key: "color", label: "Text Color", valueType: "color" },
      ];
    case "rectangle":
      return [
        { key: "fill", label: "Fill Color", valueType: "color" },
        { key: "radius", label: "Border Radius", valueType: "number" },
      ];
    case "button":
      return [
        { key: "label", label: "Label", valueType: "text" },
        { key: "fill", label: "Fill Color", valueType: "color" },
        { key: "color", label: "Text Color", valueType: "color" },
      ];
    case "video":
      return [
        { key: "volume", label: "Volume", valueType: "number" },
        { key: "playbackRate", label: "Playback Speed", valueType: "number" },
      ];
    case "audio":
      return [
        { key: "volume", label: "Volume", valueType: "number" },
      ];
    default:
      return [];
  }
}

/**
 * Smart value input: switches between color picker, number input, or textarea
 * based on property type. Updates immediately (cheap React conditional render).
 */
function SmartValueInput({
  valueType,
  value,
  onChange,
}: {
  valueType: "color" | "number" | "text";
  value: string;
  onChange: (v: string) => void;
}) {
  switch (valueType) {
    case "color":
      return (
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}>
          <input
            type="color"
            value={value || "#ffffff"}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: 32, height: 28, padding: 0, border: "none", background: "none" }}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#ffffff"
            style={{ ...input, flex: 1 }}
          />
        </div>
      );

    case "number":
      return (
        <input
          type="number"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          style={{ ...input, marginTop: 4 }}
        />
      );

    case "text":
      return (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter text"
          style={{ ...input, marginTop: 4, minHeight: 60, resize: "vertical" }}
        />
      );
  }
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
  const setParam = (k: string, v: unknown) => onChange({ params: { ...p, [k]: v } });
  const targetLabel = (t: { id: string; type: string; name?: string }) => t.name || `${t.type} (${t.id.slice(0, 6)})`;
  const videoElements = targets.filter((t) => t.type === "video");
  const audioVideoElements = targets.filter((t) => t.type === "video" || t.type === "audio");

  const actionLabels: Record<string, string> = {
    goToScene: "Go to scene",
    setProp: "Set property",
    toggle: "Toggle visibility",
    togglePlayPause: "Toggle play/pause",
    seekVideo: "Seek video",
    setVolume: "Set volume",
    setSpeed: "Set playback speed",
  };

  return (
    <div style={actionRow}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 600 }}>
          {actionLabels[action.type] || action.type}
        </span>
        <button style={{ ...miniBtn, marginLeft: "auto", color: "#fca5a5" }} onClick={onRemove} title="Remove action">✕</button>
      </div>

      {action.type === "goToScene" && (
        <select value={str(p.sceneId)} onChange={(e) => setParam("sceneId", e.target.value)} style={input}>
          {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}

      {action.type === "setProp" && (() => {
        const targetEl = targets.find((t) => t.id === str(p.target));
        const editableProps = targetEl ? getEditableProps(targetEl.type) : [];
        const selectedProp = editableProps.find((ep) => ep.key === str(p.key));

        return (
          <>
            {/* Target Element Dropdown */}
            <select
              value={str(p.target)}
              onChange={(e) => {
                const newTarget = targets.find((t) => t.id === e.target.value);
                const newProps = newTarget ? getEditableProps(newTarget.type) : [];
                // Batch all updates into single onChange call
                onChange({
                  params: {
                    ...p,
                    target: e.target.value,
                    key: newProps.length > 0 ? newProps[0].key : "",
                    value: "",
                  }
                });
              }}
              style={{ ...input, marginTop: 4 }}
            >
              <option value="">— choose element —</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {targetLabel(t)}
                </option>
              ))}
            </select>

            {/* Property Dropdown (type-specific) */}
            {editableProps.length > 0 && (
              <select
                value={str(p.key)}
                onChange={(e) => {
                  // Batch updates into single onChange call
                  onChange({
                    params: {
                      ...p,
                      key: e.target.value,
                      value: "",
                    }
                  });
                }}
                style={{ ...input, marginTop: 4 }}
              >
                <option value="">— choose property —</option>
                {editableProps.map((ep) => (
                  <option key={ep.key} value={ep.key}>
                    {ep.label}
                  </option>
                ))}
              </select>
            )}

            {/* Smart Value Input (switches based on property type) */}
            {selectedProp && (
              <SmartValueInput
                valueType={selectedProp.valueType}
                value={str(p.value)}
                onChange={(v) => setParam("value", v)}
              />
            )}

            {editableProps.length === 0 && targetEl && (
              <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
                No editable properties for {targetEl.type}
              </div>
            )}
          </>
        );
      })()}

      {action.type === "toggle" && (
        <select value={str(p.target)} onChange={(e) => setParam("target", e.target.value)} style={input}>
          {targets.map((t) => <option key={t.id} value={t.id}>{targetLabel(t)}</option>)}
        </select>
      )}

      {action.type === "togglePlayPause" && (
        <select value={str(p.target)} onChange={(e) => setParam("target", e.target.value)} style={input}>
          <option value="">— choose video —</option>
          {videoElements.map((t) => <option key={t.id} value={t.id}>{targetLabel(t)}</option>)}
        </select>
      )}

      {action.type === "seekVideo" && (
        <>
          <select value={str(p.target)} onChange={(e) => setParam("target", e.target.value)} style={input}>
            <option value="">— choose video —</option>
            {videoElements.map((t) => <option key={t.id} value={t.id}>{targetLabel(t)}</option>)}
          </select>
          <input
            type="number"
            min={0}
            step={0.1}
            placeholder="Time (seconds)"
            value={typeof p.time === "number" ? p.time : ""}
            onChange={(e) => setParam("time", Number(e.target.value))}
            style={{ ...input, marginTop: 4 }}
          />
        </>
      )}

      {action.type === "setVolume" && (
        <>
          <select value={str(p.target)} onChange={(e) => setParam("target", e.target.value)} style={input}>
            <option value="">— choose audio/video —</option>
            {audioVideoElements.map((t) => <option key={t.id} value={t.id}>{targetLabel(t)}</option>)}
          </select>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={typeof p.volume === "number" ? p.volume : 1}
            onChange={(e) => setParam("volume", Number(e.target.value))}
            style={{ width: "100%", marginTop: 4 }}
          />
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Volume: {Math.round((typeof p.volume === "number" ? p.volume : 1) * 100)}%
          </div>
        </>
      )}

      {action.type === "setSpeed" && (
        <>
          <select value={str(p.target)} onChange={(e) => setParam("target", e.target.value)} style={input}>
            <option value="">— choose video —</option>
            {videoElements.map((t) => <option key={t.id} value={t.id}>{targetLabel(t)}</option>)}
          </select>
          <select
            value={typeof p.rate === "number" ? p.rate : 1}
            onChange={(e) => setParam("rate", Number(e.target.value))}
            style={{ ...input, marginTop: 4 }}
          >
            <option value={0.5}>0.5x (Slow)</option>
            <option value={1}>1x (Normal)</option>
            <option value={1.5}>1.5x (Fast)</option>
            <option value={2}>2x (Very Fast)</option>
          </select>
        </>
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
const section: CSSProperties = {
  background: "#0a0e13",
  border: "1px solid #1a1f28",
  borderRadius: 6,
  padding: 8,
  marginTop: 8,
};
const sectionLabel: CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 6,
};
