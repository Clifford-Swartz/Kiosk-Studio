import React, { useEffect, useRef } from "react";
import type { Element } from "@kiosk/engine";
import { isRestConnector } from "@kiosk/engine";
import { useEditor } from "./store.js";
import { importContentFile, importVideoAware, validateAudioFile } from "./assets.js";
import { InteractionsEditor } from "./InteractionsEditor.js";
import { Row } from "./components/Row.js";

/** Checkbox/toggle row: label and control side by side on one line, rather than stacked. */
function CheckRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Row label={label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {children}
    </Row>
  );
}

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
 * Web-safe fonts available on both Windows and macOS without bundling any
 * font files — matches what `TextElement` in the engine can actually render.
 */
const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "System Default", value: "system-ui, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Impact", value: "Impact, sans-serif" },
  { label: "Comic Sans MS", value: "'Comic Sans MS', sans-serif" },
];

/**
 * Right panel: edit the selected element. Geometry (x/y/w/h/rotation/opacity)
 * plus a type-specific section. Two-way bound to the store, so canvas and layer
 * tree update live as you type.
 */
export function PropertiesPanel() {
  const scene = useEditor((s) => s.activeScene());
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const updateElement = useEditor((s) => s.updateElement);
  const updateProps = useEditor((s) => s.updateElementProps);
  const removeElement = useEditor((s) => s.removeElement);

  // Helper to find element recursively
  const findElement = (elements: any[], id: string): any => {
    for (const el of elements) {
      if (el.id === id) return el;
      if (el.children) {
        const found = findElement(el.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  // Helper to find parent layer/collection of an element
  const findParentLayer = (elements: any[], childId: string): any => {
    for (const el of elements) {
      if ((el.type === "layer" || el.type === "collection") && el.children) {
        // Direct child?
        if (el.children.some((c: any) => c.id === childId)) {
          return el;
        }
        // Recurse
        const found = findParentLayer(el.children, childId);
        if (found) return found;
      }
    }
    return null;
  };

  const el = findElement(scene.elements, selectedId ?? "") ?? null;

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

  // Multi-select mode
  if (selectedIds.size > 0) {
    const elements = Array.from(selectedIds).map(id => findElement(scene.elements, id)).filter(Boolean);
    if (elements.length === 0) return <SceneSettings />;

    // All same type? Show common properties
    const firstType = elements[0].type;
    const allSameType = elements.every(e => e.type === firstType);

    if (allSameType && firstType === "layer") {
      return <MultiLayerProperties elements={elements} />;
    }

    // Check if all selected elements are direct children of the same layer
    const parentLayer = findParentLayer(scene.elements, elements[0].id);
    if (parentLayer) {
      const allSameParent = elements.every(el => {
        const parent = findParentLayer(scene.elements, el.id);
        return parent?.id === parentLayer.id;
      });

      if (allSameParent) {
        // All selected elements are children of same layer -> show layer props
        return (
          <div style={panel}>
            <div style={heading}>Properties · layer</div>
            <div style={{ color: "#94a3b8", fontSize: 11, padding: "4px 4px 8px" }}>
              {elements.length} children selected
            </div>
            <TypeFields element={parentLayer} updateProps={updateProps} updateElement={updateElement} />
          </div>
        );
      }
    }

    return (
      <div style={panel}>
        <div style={heading}>Multi-select ({elements.length})</div>
        <div style={{ color: "#94a3b8", fontSize: 12, padding: "8px 4px" }}>
          {allSameType ? `${elements.length} ${firstType} elements selected` : "Mixed element types selected"}
        </div>
        <div style={{ color: "#64748b", fontSize: 11, padding: "4px" }}>
          Ctrl+click to add/remove from selection
        </div>
      </div>
    );
  }

  // No selection: show scene settings (size + background) instead.
  if (!el) return <SceneSettings />;

  return (
    <div style={panel}>
      <div style={heading}>Properties · {el.type}</div>

      {el.type !== "layer" && (
        <>
          <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
            <Row label="X" style={{ flex: 1, margin: 0 }}><Num value={el.x} onChange={debouncedNumCb("x")} /></Row>
            <Row label="Y" style={{ flex: 1, margin: 0 }}><Num value={el.y} onChange={debouncedNumCb("y")} /></Row>
          </div>
          <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
            <Row label="W" style={{ flex: 1, margin: 0 }}><Num value={el.width} onChange={debouncedNumCb("width")} /></Row>
            <Row label="H" style={{ flex: 1, margin: 0 }}><Num value={el.height} onChange={debouncedNumCb("height")} /></Row>
          </div>
          <Row label="Rotation"><Num value={el.rotation} onChange={debouncedNumCb("rotation")} /></Row>
        </>
      )}
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
      <TypeFields element={el} updateProps={updateProps} updateElement={updateElement} />

      <InteractionsEditor elementId={el.id} />

      <button
        onClick={() => removeElement(el.id)}
        style={{ ...deleteBtn, marginTop: 16 }}
        title="Delete element (Delete or Backspace)"
      >
        Delete element
      </button>
    </div>
  );
}

function TypeFields({
  element: el,
  updateProps,
  updateElement,
}: {
  element: Element;
  updateProps: (id: string, props: Record<string, unknown>) => void;
  updateElement: (id: string, patch: Partial<Element>) => void;
}) {
  const set = (k: string, v: unknown) => updateProps(el.id, { [k]: v });
  const debouncedSet = useDebouncedCallback(set, 300);
  const p = el.props;

  switch (el.type) {
    case "text":
      // Free-text editing, per-character bold/italic/underline/color, lists,
      // and per-paragraph alignment all now live in the in-canvas rich-text
      // editor + its selection-driven formatting toolbar (double-click to
      // edit). What's left here is the element's default/base style — the
      // fallback a span/paragraph uses when it carries no formatting of its
      // own — plus the data binding.
      return (
        <>
          <BindControl elementId={el.id} targetProp="text" />
          <Row label="Size"><Num value={n(p.fontSize, 32)} onChange={(v) => debouncedSet("fontSize", Number(v))} /></Row>
          <Row label="Font">
            <select
              value={str(p.fontFamily, "system-ui, sans-serif")}
              onChange={(e) => set("fontFamily", e.target.value)}
              style={{ ...input, fontFamily: str(p.fontFamily, "system-ui, sans-serif") }}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                  {f.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Color"><Color value={str(p.color, "#ffffff")} onChange={(v) => set("color", v)} /></Row>
        </>
      );
    case "html":
      return (
        <Row label="HTML Source">
          <textarea
            value={str(p.html)}
            onChange={(e) => debouncedSet("html", e.target.value)}
            style={{ ...input, minHeight: 160, fontFamily: "monospace", resize: "vertical" }}
          />
        </Row>
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
          <CheckRow label="Disabled">
            <input
              type="checkbox"
              checked={el.visible === false}
              onChange={(e) => updateElement(el.id, { visible: !e.target.checked })}
            />
          </CheckRow>

          <Row label="Label"><Text value={str(p.label, "Button")} onChange={(v) => set("label", v)} /></Row>

          <Row label="Fill Type">
            <select
              value={str(p.fillType, "color")}
              onChange={(e) => set("fillType", e.target.value)}
              style={input}
            >
              <option value="color">Color</option>
              <option value="image">Image</option>
            </select>
          </Row>

          {str(p.fillType, "color") === "color" ? (
            <Row label="Fill Color">
              <Color value={str(p.fill, "#2563eb")} onChange={(v) => set("fill", v)} />
            </Row>
          ) : (
            <>
              <button
                style={chooseBtn}
                onClick={async () => {
                  const filePath = useEditor.getState().filePath;
                  if (!filePath) {
                    alert("Save the project first.");
                    return;
                  }
                  const rel = await importContentFile("image");
                  if (rel) set("imageSrc", rel);
                }}
              >
                Choose fill image…
              </button>
              <Row label="Image Source">
                <input
                  type="text"
                  value={str(p.imageSrc) === "__placeholder__" ? "" : str(p.imageSrc)}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    set("imageSrc", val === "" ? "__placeholder__" : val);
                  }}
                  placeholder="Using default placeholder"
                  style={input}
                />
              </Row>
              {str(p.imageSrc) !== "" && str(p.imageSrc) !== "__placeholder__" && (
                <button
                  style={{ ...chooseBtn, marginTop: 4, fontSize: 11, padding: "4px 8px" }}
                  onClick={() => set("imageSrc", "__placeholder__")}
                >
                  Reset to placeholder
                </button>
              )}
              <Row label="Image Fit">
                <select
                  value={str(p.imageFit, "cover")}
                  onChange={(e) => set("imageFit", e.target.value)}
                  style={input}
                >
                  <option value="cover">Cover</option>
                  <option value="contain">Contain</option>
                  <option value="fill">Fill</option>
                </select>
              </Row>
            </>
          )}

          <Row label="Text"><Color value={str(p.color, "#ffffff")} onChange={(v) => set("color", v)} /></Row>
          <Row label="Radius"><Num value={n(p.radius, 12)} onChange={(v) => set("radius", Number(v))} /></Row>
        </>
      );
    case "image":
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
              const rel = await importContentFile("image");
              if (rel) set("src", rel);
            }}
          >
            Choose image…
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
                set("src", val === "" ? "__placeholder__" : val);
              }}
              placeholder="Using default placeholder"
              style={input}
            />
          </Row>
          {str(p.src) !== "" && str(p.src) !== "__placeholder__" && (
            <button
              style={{ ...chooseBtn, marginTop: 4, fontSize: 11, padding: "4px 8px" }}
              onClick={() => set("src", "__placeholder__")}
            >
              Reset to placeholder
            </button>
          )}

          <Row label="Fit">
            <select
              value={str(p.fit, "cover")}
              onChange={(e) => set("fit", e.target.value)}
              style={input}
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="fill">Fill</option>
            </select>
          </Row>
        </>
      );

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
              const rel = await importVideoAware("video");
              if (rel) set("src", rel);
            }}
          >
            Choose video…
          </button>

          <Row label="Source">
            <input
              type="text"
              value={str(p.src)}
              onChange={(e) => set("src", e.target.value)}
              style={input}
            />
          </Row>

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

          <Row label="Speed">
            <select
              value={n(p.playbackRate, 1)}
              onChange={(e) => set("playbackRate", Number(e.target.value))}
              style={input}
            >
              <option value={0.5}>0.5x (Slow)</option>
              <option value={1}>1x (Normal)</option>
              <option value={1.5}>1.5x (Fast)</option>
              <option value={2}>2x (Very Fast)</option>
            </select>
          </Row>

          <CheckRow label="Autoplay">
            <input
              type="checkbox"
              checked={bool(p.autoplay, true)}
              onChange={(e) => set("autoplay", e.target.checked)}
            />
          </CheckRow>

          <CheckRow label="Loop">
            <input
              type="checkbox"
              checked={bool(p.loop, true)}
              onChange={(e) => set("loop", e.target.checked)}
            />
          </CheckRow>

          <CheckRow label="Muted">
            <input
              type="checkbox"
              checked={bool(p.muted, true)}
              onChange={(e) => set("muted", e.target.checked)}
            />
          </CheckRow>

          <CheckRow label="Show controls">
            <input
              type="checkbox"
              checked={bool(p.showControls, false)}
              onChange={(e) => set("showControls", e.target.checked)}
            />
          </CheckRow>

          <Row label="Fit">
            <select
              value={str(p.fit, "cover")}
              onChange={(e) => set("fit", e.target.value)}
              style={input}
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="fill">Fill</option>
            </select>
          </Row>

          <Row label="Preload">
            <select
              value={str(p.preload, "auto")}
              onChange={(e) => set("preload", e.target.value)}
              style={input}
            >
              <option value="auto">Auto (full video)</option>
              <option value="metadata">Metadata only</option>
              <option value="none">None</option>
            </select>
          </Row>
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
              const rel = await importContentFile("audio");
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
          <CheckRow label="Autoplay">
            <input
              type="checkbox"
              checked={bool(p.autoplay, false)}
              onChange={(e) => set("autoplay", e.target.checked)}
            />
          </CheckRow>
          <CheckRow label="Loop">
            <input
              type="checkbox"
              checked={bool(p.loop, false)}
              onChange={(e) => set("loop", e.target.checked)}
            />
          </CheckRow>
          <CheckRow label="Muted">
            <input
              type="checkbox"
              checked={bool(p.muted, false)}
              onChange={(e) => set("muted", e.target.checked)}
            />
          </CheckRow>
        </>
      );
    case "collection":
      return <CollectionFields el={el} set={set} />;
    case "layer":
      return <LayerFields el={el} />;
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
      <Row label="Canvas Size">
        <select
          value={presetValue}
          onChange={(e) => {
            const p = SIZE_PRESETS.find((x) => x.label === e.target.value);
            if (p) updateProjectSize({ width: p.w, height: p.h });
          }}
          style={input}
        >
          <option value="custom">Custom</option>
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

      <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
        <Row label="Width" style={{ flex: 1, margin: 0 }}>
          <Num value={project.width} onChange={(v) => updateProjectSize({ width: Number(v) })} />
        </Row>
        <Row label="Height" style={{ flex: 1, margin: 0 }}>
          <Num value={project.height} onChange={(v) => updateProjectSize({ height: Number(v) })} />
        </Row>
      </div>

      <Row label="Background">
        <Color
          value={scene.background.startsWith('#') ? scene.background : '#0f172a'}
          onChange={(v) => updateActiveScene({ background: v })}
        />
      </Row>

      <div style={{ color: "#7185b4", fontSize: 14, fontWeight: 500, letterSpacing: 0.3, margin: "12px 2px 6px" }}>
        Background Image / Video
      </div>
      <button
        style={chooseBtn}
        onClick={async () => {
          const filePath = useEditor.getState().filePath;
          if (!filePath) {
            alert("Save the project first.");
            return;
          }
          const rel = await importVideoAware("media");
          if (rel) updateActiveScene({ background: rel });
        }}
      >
        Choose background image or video…
      </button>

      {scene.background && !scene.background.startsWith('#') && (
        <>
          <Row label="Source">
            <input
              type="text"
              value={scene.background}
              onChange={(e) => updateActiveScene({ background: e.target.value })}
              style={input}
            />
          </Row>

          <Row label="Size">
            <select
              value={scene.backgroundSize || 'cover'}
              onChange={(e) => updateActiveScene({ backgroundSize: e.target.value as "cover" | "contain" | "fill" })}
              style={input}
            >
              <option value="cover">Cover (fill, may crop)</option>
              <option value="contain">Contain (fit, may letterbox)</option>
              <option value="fill">Fill (stretch, may distort)</option>
            </select>
          </Row>

          <button
            style={{ ...chooseBtn, background: '#3f1d2b', borderColor: '#7f1d1d', color: '#fca5a5', marginTop: 8 }}
            onClick={() => updateActiveScene({ background: '#0f172a', backgroundSize: undefined })}
          >
            ✕ Remove background media
          </button>
        </>
      )}

      <Row label="Scene Transition (On Entrance)">
        <select
          value={scene.transition?.type ?? "none"}
          onChange={(e) => {
            const type = e.target.value as "none" | "fade" | "slide" | "push" | "zoom";
            if (type === "none") {
              updateActiveScene({ transition: undefined });
            } else {
              updateActiveScene({
                transition: {
                  type,
                  duration: scene.transition?.duration ?? 300,
                  direction: scene.transition?.direction ?? "left",
                  elementsOnly: scene.transition?.elementsOnly ?? false,
                },
              });
            }
          }}
          style={input}
        >
          <option value="none">None (instant)</option>
          <option value="fade">Fade</option>
          <option value="slide">Slide</option>
          <option value="push">Push</option>
          <option value="zoom">Zoom</option>
        </select>
      </Row>

      {scene.transition && scene.transition.type !== "none" && (
        <>
          <Row label="Duration (ms)">
            <Num
              value={scene.transition.duration ?? 300}
              onChange={(v) =>
                updateActiveScene({
                  transition: { ...scene.transition!, duration: Number(v) },
                })
              }
            />
          </Row>

          {(scene.transition.type === "slide" || scene.transition.type === "push") && (
            <Row label="Direction">
              <select
                value={scene.transition.direction ?? "left"}
                onChange={(e) =>
                  updateActiveScene({
                    transition: {
                      ...scene.transition!,
                      direction: e.target.value as "up" | "down" | "left" | "right",
                    },
                  })
                }
                style={input}
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </Row>
          )}

          {(scene.transition.type === "fade" || scene.transition.type === "zoom") && (
            <CheckRow label="Elements only">
              <input
                type="checkbox"
                checked={scene.transition.elementsOnly ?? false}
                onChange={(e) =>
                  updateActiveScene({
                    transition: { ...scene.transition!, elementsOnly: e.target.checked },
                  })
                }
                title="Transition only the elements, not the background"
              />
            </CheckRow>
          )}
        </>
      )}

      <div style={{ color: "#64748b", fontSize: 11, marginTop: 12, padding: "0 2px" }}>
        Tip: the canvas size applies to every scene — set it to match the kiosk screen so
        the Player fills it with no black bars. Background is per-scene.
      </div>
    </div>
  );
}

/** Properties for multiple selected layers: show common layer controls. */
function MultiLayerProperties({ elements }: { elements: Element[] }) {
  const updateElement = useEditor((s) => s.updateElement);

  // Get common values (use first element as reference)
  const firstEl = elements[0];
  const commonLocked = elements.every(e => e.locked === firstEl.locked);

  return (
    <div style={panel}>
      <div style={heading}>Multi-Layer Properties ({elements.length})</div>

      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "12px 2px 6px" }}>
        Layer Lock
      </div>
      <CheckRow label="Locked">
        <input
          type="checkbox"
          checked={commonLocked && (firstEl.locked ?? false)}
          onChange={(e) => {
            elements.forEach(el => updateElement(el.id, { locked: e.target.checked }));
          }}
        />
      </CheckRow>
      <div style={{ color: "#64748b", fontSize: 11, margin: "2px 4px 6px" }}>
        {commonLocked ? "All layers have the same lock state" : "Mixed lock states"}
      </div>

      <div style={{ color: "#64748b", fontSize: 11, marginTop: 12, padding: "4px" }}>
        Tint and mask editing available for single-layer selection only.
      </div>
    </div>
  );
}

/** Properties for a layer: tint overlay, mask editor, lock control. */
function LayerFields({ el }: { el: Element }) {
  const updateElement = useEditor((s) => s.updateElement);
  const startMaskEditing = useEditor((s) => s.startMaskEditing);
  const tint = el.tint ?? { color: "#000000", opacity: 0 };
  const hasMask = !!el.mask;

  const setTint = (patch: Partial<typeof tint>) =>
    updateElement(el.id, { tint: { ...tint, ...patch } });

  return (
    <>
      <div style={{ color: "#7185b4", fontSize: 14, fontWeight: 500, letterSpacing: 0.3, margin: "12px 2px 6px" }}>
        Tint Overlay
      </div>
      <Row label="Color">
        <Color value={tint.color} onChange={(v) => setTint({ color: v })} />
      </Row>
      <Row label="Strength">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={tint.opacity}
          onChange={(e) => setTint({ opacity: Number(e.target.value) })}
          style={{ width: "100%" }}
        />
        <span style={{ color: "#64748b", fontSize: 11, marginLeft: 8 }}>
          {Math.round(tint.opacity * 100)}%
        </span>
      </Row>

      <div style={{ color: "#7185b4", fontSize: 14, fontWeight: 500, letterSpacing: 0.3, margin: "12px 2px 6px" }}>
        Mask
      </div>
      {hasMask && (
        <div style={{ background: "#0e1218", border: "1px solid #1f2733", borderRadius: 6, padding: 8, marginBottom: 6 }}>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>
            {el.mask!.type === "rect" ? "Rectangle mask" : "Polygon mask"} ({el.mask!.points.length} points)
          </div>
          <button
            style={{ ...chooseBtn, padding: "4px 8px", fontSize: 11 }}
            onClick={() => startMaskEditing(el.id)}
          >
            Edit Mask
          </button>
          <button
            style={{ ...miniBtn, width: "100%", marginTop: 4, color: "#fca5a5" }}
            onClick={() => updateElement(el.id, { mask: undefined })}
          >
            ✕ Delete Mask
          </button>
        </div>
      )}
      {!hasMask && (
        <button
          style={chooseBtn}
          onClick={() => startMaskEditing(el.id)}
        >
          Create Mask
        </button>
      )}

      <div style={{ color: "#7185b4", fontSize: 14, fontWeight: 500, letterSpacing: 0.3, margin: "12px 2px 6px" }}>
        Layer Lock
      </div>
      <CheckRow label="Locked">
        <input
          type="checkbox"
          checked={el.locked ?? false}
          onChange={(e) => updateElement(el.id, { locked: e.target.checked })}
        />
      </CheckRow>
      <div style={{ color: "#64748b", fontSize: 11, margin: "2px 4px 6px" }}>
        When locked, layer and children cannot be selected or edited on canvas.
      </div>
    </>
  );
}

type CollItem = { id: string; title?: string; subtitle?: string; image?: string; thumbnail?: string };

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
    setItems([...list, { id: `i${Date.now().toString(36)}`, title: "New item", subtitle: "", image: "", thumbnail: "" }]);
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
          <option value="wheel">Wheel</option>
          <option value="kenburns">Ken Burns</option>
        </select>
      </Row>
      <Row label="Fit">
        <select value={str(p.fit, "cover")} onChange={(e) => set("fit", e.target.value)} style={input}>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="fill">Fill</option>
        </select>
      </Row>
      {layout === "grid" && (
        <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
          <Row label="Columns" style={{ flex: 1, margin: 0 }}><Num value={n(p.columns, 3)} onChange={(v) => set("columns", Number(v))} /></Row>
          <Row label="Gap" style={{ flex: 1, margin: 0 }}><Num value={n(p.gap, 16)} onChange={(v) => set("gap", Number(v))} /></Row>
        </div>
      )}
      {layout === "kenburns" && (
        <Row label="Interval (ms)"><Num value={n(p.intervalMs, 4000)} onChange={(v) => set("intervalMs", Number(v))} /></Row>
      )}
      <Row label="Item bg">
        <span style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
          <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              checked={str(p.itemBg, "#1e293b") === "transparent"}
              onChange={(e) => set("itemBg", e.target.checked ? "transparent" : "#1e293b")}
            />
            Transparent
          </label>
          {str(p.itemBg, "#1e293b") !== "transparent" && (
            <Color value={str(p.itemBg, "#1e293b")} onChange={(v) => set("itemBg", v)} />
          )}
        </span>
      </Row>

      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "12px 2px 6px" }}>
        Video Settings
      </div>
      {layout === "grid" && (
        <CheckRow label="Show controls">
          <input type="checkbox" checked={bool(p.showControls, false)} onChange={(e) => set("showControls", e.target.checked)} />
        </CheckRow>
      )}
      <CheckRow label="Video muted">
        <input type="checkbox" checked={bool(p.videoMuted, true)} onChange={(e) => set("videoMuted", e.target.checked)} />
      </CheckRow>
      <CheckRow label="Video loop">
        <input
          type="checkbox"
          checked={bool(p.videoLoop, true)}
          onChange={(e) => {
            set("videoLoop", e.target.checked);
            if (e.target.checked && bool(p.advanceOnVideoEnd, false)) {
              set("advanceOnVideoEnd", false);
            }
          }}
        />
      </CheckRow>
      <CheckRow label="Advance on end">
        <input
          type="checkbox"
          checked={bool(p.advanceOnVideoEnd, false)}
          onChange={(e) => {
            set("advanceOnVideoEnd", e.target.checked);
            if (e.target.checked && bool(p.videoLoop, true)) {
              set("videoLoop", false);
            }
          }}
        />
      </CheckRow>
      {bool(p.advanceOnVideoEnd, false) && (
        <Row label="Delay (ms)"><Num value={n(p.advanceDelayMs, 0)} onChange={(v) => set("advanceDelayMs", Number(v))} /></Row>
      )}

      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "12px 2px 6px" }}>
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
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input placeholder="focused media path (image or video)" value={it.image ?? ""} onChange={(e) => patchItem(it.id, { image: e.target.value })} style={{ ...input, flex: 1 }} />
            <button
              style={{ ...miniBtn, border: "1px solid #2563eb", color: "#e0f2fe" }}
              onClick={async () => {
                const rel = await importVideoAware("media");
                if (rel) patchItem(it.id, { image: rel });
              }}
              title="Choose focused image or video"
            >
              🎬
            </button>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <input placeholder="thumbnail (grid view)" value={it.thumbnail ?? ""} onChange={(e) => patchItem(it.id, { thumbnail: e.target.value })} style={{ ...input, flex: 1 }} />
            <button
              style={{ ...miniBtn, border: "1px solid #2563eb", color: "#e0f2fe" }}
              onClick={async () => {
                const rel = await importContentFile("image");
                if (rel) patchItem(it.id, { thumbnail: rel });
              }}
              title="Choose thumbnail image"
            >
              🖼️
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
  const connectors = useEditor((s) => s.project.dataConnectors || []);
  const sources = connectors.filter(isRestConnector).filter((c) => c.input?.enabled); // Only input-enabled connectors can be bound
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
        Bind "{targetProp}" to data {binding && <span style={{ color: "#38bdf8" }}>● live</span>}
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
  color: "#7185b4",
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
