import React, { useEffect, useRef } from "react";
import type { Element } from "@kiosk/engine";
import { useEditor } from "./store.js";
import { importPickedImage, importContentFile, validateAudioFile } from "./assets.js";
import { InteractionsEditor } from "./InteractionsEditor.js";

/**
 * Debounce a value to reduce rapid history entries. The value updates
 * immediately in local state but only commits to the store after a delay.
 */
function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useRef((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }).current as T;
}

/**
 * Right panel: edit the selected element. Geometry (x/y/w/h/rotation/opacity)
 * plus a type-specific section. Two-way bound to the store, so canvas and layer
 * tree update live as you type.
 */
export function PropertiesPanel() {
  const scene = useEditor((s) => s.activeScene());
  const selectedId = useEditor((s) => s.selectedId);
  const updateElement = useEditor((s) => s.updateElement);
  const updateProps = useEditor((s) => s.updateElementProps);
  const removeElement = useEditor((s) => s.removeElement);

  const el = scene.elements.find((e) => e.id === selectedId) ?? null;

  // IMPORTANT: Call all hooks BEFORE any conditional returns (Rules of Hooks)
  // Debounce geometry changes to avoid creating history entry per keystroke
  const debouncedNum = useDebouncedCallback(
    (k: keyof Element, v: string) => {
      if (el) {
        updateElement(el.id, { [k]: Number(v) } as Partial<Element>);
      }
    },
    300
  );
  const debouncedNumCb = (k: keyof Element) => (v: string) => debouncedNum(k, v);

  // No selection: show scene settings (size + background) instead.
  if (!el) return <SceneSettings />;

  return (
    <div style={panel}>
      <div style={heading}>Properties · {el.type}</div>

      <Row label="X"><Num value={el.x} onChange={debouncedNumCb("x")} /></Row>
      <Row label="Y"><Num value={el.y} onChange={debouncedNumCb("y")} /></Row>
      <Row label="W"><Num value={el.width} onChange={debouncedNumCb("width")} /></Row>
      <Row label="H"><Num value={el.height} onChange={debouncedNumCb("height")} /></Row>
      <Row label="Rotation"><Num value={el.rotation} onChange={debouncedNumCb("rotation")} /></Row>
      <Row label="Opacity">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={el.opacity}
          onChange={(e) => updateElement(el.id, { opacity: Number(e.target.value) })}
          style={{ width: "100%" }}
        />
      </Row>

      <div style={{ ...heading, marginTop: 14 }}>{el.type} content</div>
      <TypeFields element={el} updateProps={updateProps} />

      <InteractionsEditor elementId={el.id} />

      <button
        onClick={() => removeElement(el.id)}
        style={{ ...deleteBtn, marginTop: 16 }}
      >
        Delete element
      </button>
    </div>
  );
}

function TypeFields({
  element: el,
  updateProps,
}: {
  element: Element;
  updateProps: (id: string, props: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: unknown) => updateProps(el.id, { [k]: v });
  const debouncedSet = useDebouncedCallback(set, 300);
  const p = el.props;

  switch (el.type) {
    case "text":
      return (
        <>
          <Row label="Text">
            <textarea
              value={str(p.text)}
              onChange={(e) => set("text", e.target.value)}
              style={{ ...input, height: 60, resize: "vertical" }}
            />
          </Row>
          <BindControl elementId={el.id} targetProp="text" />
          <Row label="Size"><Num value={n(p.fontSize, 32)} onChange={(v) => debouncedSet("fontSize", Number(v))} /></Row>
          <Row label="Color"><Color value={str(p.color, "#ffffff")} onChange={(v) => set("color", v)} /></Row>
          <Row label="Align">
            <div style={{ display: "flex", gap: 4 }}>
              {(["left", "center", "right"] as const).map((alignment) => (
                <button
                  key={alignment}
                  onClick={() => set("align", alignment)}
                  style={{
                    ...input,
                    flex: 1,
                    cursor: "pointer",
                    background: str(p.align, "left") === alignment ? "#2563eb" : "#161c26",
                    color: str(p.align, "left") === alignment ? "#fff" : "#e2e8f0",
                    border: str(p.align, "left") === alignment ? "1px solid #1d4ed8" : "1px solid #232c3a",
                  }}
                >
                  {alignment.charAt(0).toUpperCase() + alignment.slice(1)}
                </button>
              ))}
            </div>
          </Row>
        </>
      );
    case "rectangle":
      return (
        <>
          <Row label="Fill"><Color value={str(p.fill, "#3b82f6")} onChange={(v) => set("fill", v)} /></Row>
          <Row label="Radius"><Num value={n(p.radius, 0)} onChange={(v) => set("radius", Number(v))} /></Row>
        </>
      );
    case "button":
      return (
        <>
          <Row label="Label"><Text value={str(p.label, "Button")} onChange={(v) => set("label", v)} /></Row>
          <Row label="Fill"><Color value={str(p.fill, "#2563eb")} onChange={(v) => set("fill", v)} /></Row>
          <Row label="Text"><Color value={str(p.color, "#ffffff")} onChange={(v) => set("color", v)} /></Row>
        </>
      );
    case "image":
    case "video":
      return (
        <>
          <button
            style={chooseBtn}
            onClick={async () => {
              const filePath = useEditor.getState().filePath;
              if (!filePath) {
                alert("Save the project first.");
                return;
              }
              const type = el.type === "image" ? "image" : "video";
              const rel = await importContentFile(filePath, type);
              if (rel) set("src", rel);
            }}
          >
            Choose {el.type}…
          </button>
          <div style={{ color: "#64748b", fontSize: 11, margin: "2px 4px 6px" }}>
            …or paste (Ctrl+V) / drag a file onto the canvas.
          </div>
          <Row label="Source">
            <input
              type="text"
              value={str(p.src) === "__placeholder__" ? "" : str(p.src)}
              onChange={(e) => {
                const val = e.target.value.trim();
                // If cleared, revert to placeholder for images (not videos)
                set("src", val === "" && el.type === "image" ? "__placeholder__" : val);
              }}
              placeholder={el.type === "image" ? "Using default placeholder" : ""}
              style={input}
            />
          </Row>
          {el.type === "image" && str(p.src) !== "" && str(p.src) !== "__placeholder__" && (
            <button
              style={{ ...chooseBtn, marginTop: 4, fontSize: 11, padding: "4px 8px" }}
              onClick={() => set("src", "__placeholder__")}
            >
              Reset to placeholder
            </button>
          )}
        </>
      );
    case "audio":
      return (
        <>
          <button
            style={chooseBtn}
            onClick={async () => {
              const filePath = useEditor.getState().filePath;
              if (!filePath) {
                alert("Save the project first.");
                return;
              }
              const rel = await importContentFile(filePath, "audio");
              if (rel) {
                const validation = validateAudioFile(rel);
                if (!validation.valid) {
                  alert(`Audio validation failed: ${validation.error}`);
                  return;
                }
                set("src", rel);
              }
            }}
          >
            Choose audio…
          </button>
          <Row label="Source">
            <Text value={str(p.src)} onChange={(v) => set("src", v)} />
          </Row>
          <BindControl elementId={el.id} targetProp="props.src" />
          <Row label="Volume">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={n(p.volume, 1)}
              onChange={(e) => set("volume", Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </Row>
          <Row label="Fade (ms)">
            <Num value={n(p.fade, 0)} onChange={(v) => set("fade", Math.max(0, Number(v)))} />
          </Row>
          <Row label="Autoplay">
            <input
              type="checkbox"
              checked={bool(p.autoplay, false)}
              onChange={(e) => set("autoplay", e.target.checked)}
            />
          </Row>
          <Row label="Loop">
            <input
              type="checkbox"
              checked={bool(p.loop, false)}
              onChange={(e) => set("loop", e.target.checked)}
            />
          </Row>
          <Row label="Muted">
            <input
              type="checkbox"
              checked={bool(p.muted, false)}
              onChange={(e) => set("muted", e.target.checked)}
            />
          </Row>
        </>
      );
    case "collection":
      return <CollectionFields el={el} set={set} />;
    default:
      return null;
  }
}

/**
 * Scene settings (shown when nothing is selected): the scene's width/height and
 * background. Set the size to match the target display so the Player fills the
 * screen edge-to-edge instead of letterboxing. Presets cover common kiosk
 * orientations plus "Match this display" (the actual monitor resolution).
 */
const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "1920 × 1080 (Landscape HD)", w: 1920, h: 1080 },
  { label: "1080 × 1920 (Portrait HD)", w: 1080, h: 1920 },
  { label: "3840 × 2160 (4K)", w: 3840, h: 2160 },
  { label: "1280 × 800", w: 1280, h: 800 },
];

function SceneSettings() {
  const scene = useEditor((s) => s.activeScene());
  const project = useEditor((s) => s.project);
  const updateActiveScene = useEditor((s) => s.updateActiveScene);
  const updateProjectSize = useEditor((s) => s.updateProjectSize);

  const presetValue =
    SIZE_PRESETS.find((p) => p.w === project.width && p.h === project.height)?.label ?? "custom";

  return (
    <div style={panel}>
      <div style={heading}>Canvas &amp; Scene</div>

      <div style={{ color: "#7c8aa0", fontSize: 11, margin: "0 2px 4px" }}>
        Canvas size (all scenes)
      </div>
      <Row label="Preset">
        <select
          value={presetValue}
          onChange={(e) => {
            const p = SIZE_PRESETS.find((x) => x.label === e.target.value);
            if (p) updateProjectSize({ width: p.w, height: p.h });
          }}
          style={input}
        >
          <option value="custom" disabled>
            — choose —
          </option>
          {SIZE_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>{p.label}</option>
          ))}
        </select>
      </Row>

      <button
        style={{ ...chooseBtn, marginBottom: 8 }}
        onClick={async () => {
          const d = await window.kiosk.getDisplaySize();
          updateProjectSize({ width: d.width, height: d.height });
        }}
      >
        Match this display
      </button>

      <Row label="Width"><Num value={project.width} onChange={(v) => updateProjectSize({ width: Number(v) })} /></Row>
      <Row label="Height"><Num value={project.height} onChange={(v) => updateProjectSize({ height: Number(v) })} /></Row>

      <div style={{ color: "#7c8aa0", fontSize: 11, margin: "14px 2px 4px" }}>
        Scene “{scene.name}”
      </div>
      <Row label="Background"><Color value={scene.background} onChange={(v) => updateActiveScene({ background: v })} /></Row>

      <div style={{ color: "#64748b", fontSize: 11, marginTop: 12, padding: "0 2px" }}>
        Tip: the canvas size applies to every scene — set it to match the kiosk screen so
        the Player fills it with no black bars. Background is per-scene.
      </div>
    </div>
  );
}

type CollItem = { id: string; title?: string; subtitle?: string; image?: string };

/** Properties for a collection: layout + knobs + the static items editor. */
function CollectionFields({
  el,
  set,
}: {
  el: Element;
  set: (k: string, v: unknown) => void;
}) {
  const p = el.props;
  const layout = str(p.layout, "grid");
  const list: CollItem[] = Array.isArray(p.items) ? (p.items as CollItem[]) : [];

  const setItems = (next: CollItem[]) => set("items", next);
  const patchItem = (id: string, patch: Partial<CollItem>) =>
    setItems(list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const addItem = () =>
    setItems([...list, { id: `i${Date.now().toString(36)}`, title: "New item", subtitle: "", image: "" }]);
  const removeItem = (id: string) => setItems(list.filter((it) => it.id !== id));
  const moveItem = (id: string, dir: -1 | 1) => {
    const i = list.findIndex((it) => it.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };

  return (
    <>
      <Row label="Layout">
        <select value={layout} onChange={(e) => set("layout", e.target.value)} style={input}>
          <option value="grid">Grid</option>
          <option value="carousel">Carousel</option>
          <option value="coverflow">Coverflow</option>
          <option value="kenburns">Ken Burns</option>
        </select>
      </Row>
      {layout === "grid" && (
        <Row label="Columns"><Num value={n(p.columns, 3)} onChange={(v) => set("columns", Number(v))} /></Row>
      )}
      {(layout === "grid") && (
        <Row label="Gap"><Num value={n(p.gap, 16)} onChange={(v) => set("gap", Number(v))} /></Row>
      )}
      {layout === "kenburns" && (
        <Row label="Interval (ms)"><Num value={n(p.intervalMs, 4000)} onChange={(v) => set("intervalMs", Number(v))} /></Row>
      )}
      <Row label="Item bg"><Color value={str(p.itemBg, "#1e293b")} onChange={(v) => set("itemBg", v)} /></Row>

      <div style={{ color: "#7c8aa0", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "12px 2px 6px" }}>
        Items ({list.length})
      </div>
      <button style={chooseBtn} onClick={addItem}>＋ Add item</button>

      {list.map((it, i) => (
        <div key={it.id} style={{ border: "1px solid #232c3a", borderRadius: 8, padding: 8, marginTop: 6 }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
            <span style={{ color: "#64748b", fontSize: 11, flex: 1 }}>#{i + 1}</span>
            <button style={miniBtn} onClick={() => moveItem(it.id, -1)} title="Up">▲</button>
            <button style={miniBtn} onClick={() => moveItem(it.id, 1)} title="Down">▼</button>
            <button style={{ ...miniBtn, color: "#fca5a5" }} onClick={() => removeItem(it.id)} title="Remove">✕</button>
          </div>
          <input placeholder="Title" value={it.title ?? ""} onChange={(e) => patchItem(it.id, { title: e.target.value })} style={{ ...input, marginBottom: 4 }} />
          <input placeholder="Subtitle" value={it.subtitle ?? ""} onChange={(e) => patchItem(it.id, { subtitle: e.target.value })} style={{ ...input, marginBottom: 4 }} />
          <div style={{ display: "flex", gap: 4 }}>
            <input placeholder="image path" value={it.image ?? ""} onChange={(e) => patchItem(it.id, { image: e.target.value })} style={{ ...input, flex: 1 }} />
            <button
              style={{ ...miniBtn, border: "1px solid #2563eb", color: "#e0f2fe" }}
              onClick={async () => {
                const picked = await window.kiosk.pickImage();
                if (!picked) return;
                const rel = await importPickedImage(picked);
                if (rel) patchItem(it.id, { image: rel });
              }}
            >
              🖼
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * "Bind to data" control for a single target prop. Pick a data source + an
 * optional JSON path; the bound value overrides the static prop at render. Shows
 * a chip with an unbind when active.
 */
function BindControl({ elementId, targetProp }: { elementId: string; targetProp: string }) {
  const scene = useEditor((s) => s.activeScene());
  const sources = useEditor((s) => s.project.dataSources);
  const setBinding = useEditor((s) => s.setBinding);
  const clearBinding = useEditor((s) => s.clearBinding);
  const el = scene.elements.find((e) => e.id === elementId);
  const binding = el?.bindings.find((b) => b.targetProp === targetProp);

  if (sources.length === 0) {
    return (
      <div style={{ color: "#475569", fontSize: 11, margin: "2px 4px 6px" }}>
        Add a data source to bind this.
      </div>
    );
  }

  return (
    <div style={{ margin: "2px 0 8px", padding: "6px 8px", background: "#0e1218", border: "1px solid #1f2733", borderRadius: 6 }}>
      <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>
        Bind “{targetProp}” to data {binding && <span style={{ color: "#38bdf8" }}>● live</span>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <select
          value={binding?.source ?? ""}
          onChange={(e) =>
            e.target.value
              ? setBinding(elementId, { targetProp, source: e.target.value, path: binding?.path })
              : clearBinding(elementId, targetProp)
          }
          style={{ ...input, flex: 1 }}
        >
          <option value="">— none —</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {binding && (
          <button style={{ ...input, width: "auto", cursor: "pointer" }} onClick={() => clearBinding(elementId, targetProp)}>
            ✕
          </button>
        )}
      </div>
      {binding && (
        <input
          placeholder="path e.g. main.temp"
          value={binding.path ?? ""}
          onChange={(e) => setBinding(elementId, { ...binding, path: e.target.value || undefined })}
          style={{ ...input, marginTop: 4 }}
        />
      )}
    </div>
  );
}

// --- field primitives ---
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "3px 0" }}>
      <span style={{ width: 64, color: "#94a3b8", fontSize: 12 }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </label>
  );
}
function Num({ value, onChange }: { value: number; onChange: (v: string) => void }) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} style={input} />;
}
function Text({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={input} />;
}
function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 32, height: 28, padding: 0, border: "none", background: "none" }} />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, flex: 1 }} />
    </span>
  );
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function n(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

const panel: React.CSSProperties = {
  width: 260,
  flexShrink: 0,
  background: "#0e1218",
  borderLeft: "1px solid #1f2733",
  padding: 12,
  overflowY: "auto",
};
const heading: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  margin: "4px 4px 10px",
};
const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "5px 8px",
};
const miniBtn: React.CSSProperties = {
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 4,
  color: "#cbd5e1",
  fontSize: 11,
  padding: "2px 6px",
  cursor: "pointer",
};
const chooseBtn: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  background: "#1e3a52",
  border: "1px solid #2563eb",
  borderRadius: 6,
  color: "#e0f2fe",
  fontSize: 13,
  cursor: "pointer",
  marginBottom: 4,
};
const deleteBtn: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  background: "#3f1d2b",
  border: "1px solid #7f1d1d",
  borderRadius: 6,
  color: "#fca5a5",
  fontSize: 13,
  cursor: "pointer",
};
