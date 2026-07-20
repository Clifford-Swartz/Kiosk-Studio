import React, { useState, useEffect, useRef } from "react";
import { useEditor } from "./store.js";
import { importContentFile } from "./assets.js";

/**
 * Custom debounced callback hook - delays callback execution until user stops typing.
 * Same pattern as PropertiesPanel.tsx.
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
 * States tab: drill-in UI for scene state machine (ADR 0011).
 * View 1: State list → View 2: State editor → View 3: Element overrides.
 */
export function StatesPanel() {
  const [view, setView] = useState<"list" | { type: "editor"; stateName: string } | { type: "overrides"; stateName: string; elementId: string }>("list");
  const selectedId = useEditor((s) => s.selectedId);
  const scene = useEditor((s) => s.activeScene());

  // When element selected on canvas AND we're in state editor view, navigate to element overrides
  useEffect(() => {
    if (selectedId && view !== "list" && view.type === "editor") {
      const states = scene.states ?? {};
      const state = states[view.stateName];
      if (state) {
        // Add element to state if not already there
        if (!state.elements[selectedId]) {
          const updateActiveScene = useEditor.getState().updateActiveScene;
          updateActiveScene({
            states: {
              ...states,
              [view.stateName]: {
                ...state,
                elements: {
                  ...state.elements,
                  [selectedId]: { visible: true },
                },
              },
            },
          });
        }
        setView({ type: "overrides", stateName: view.stateName, elementId: selectedId });
      }
    }
  }, [selectedId]);

  if (view === "list") {
    return <StateList onSelectState={(name) => setView({ type: "editor", stateName: name })} />;
  }
  if (view.type === "editor") {
    return (
      <StateEditor
        stateName={view.stateName}
        onBack={() => setView("list")}
        onSelectElement={(elementId) => setView({ type: "overrides", stateName: view.stateName, elementId })}
        setView={setView}
      />
    );
  }
  return (
    <ElementOverrides
      stateName={view.stateName}
      elementId={view.elementId}
      onBack={() => setView({ type: "editor", stateName: view.stateName })}
    />
  );
}

/**
 * View 1: State list. Shows "default" (gray, non-clickable) + custom states.
 */
function StateList({ onSelectState }: { onSelectState: (name: string) => void }) {
  const scene = useEditor((s) => s.activeScene());
  const updateActiveScene = useEditor((s) => s.updateActiveScene);
  const states = scene.states ?? {};
  const customStateNames = Object.keys(states);

  const createState = () => {
    const name = `state_${Date.now().toString(36)}`;
    updateActiveScene({
      states: {
        ...states,
        [name]: { elements: {} },
      },
    });
    onSelectState(name);
  };

  return (
    <div style={panel}>
      <div style={heading}>Scene States</div>
      <div style={{ color: "#64748b", fontSize: 11, margin: "4px 4px 8px" }}>
        Scene: {scene.name}
      </div>

      <button style={chooseBtn} onClick={createState}>
        + New State
      </button>

      <div style={{ marginTop: 12 }}>
        <div
          style={{
            padding: "8px",
            background: "#0e1218",
            border: "1px solid #1f2733",
            borderRadius: 6,
            color: "#64748b",
            fontSize: 12,
            marginBottom: 4,
            cursor: "not-allowed",
          }}
        >
          default (initial)
        </div>

        {customStateNames.map((name) => (
          <div
            key={name}
            onClick={() => onSelectState(name)}
            style={{
              padding: "8px",
              background: "#161c26",
              border: "1px solid #232c3a",
              borderRadius: 6,
              color: "#e2e8f0",
              fontSize: 12,
              marginBottom: 4,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#1e293b";
              e.currentTarget.style.borderColor = "#2563eb";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#161c26";
              e.currentTarget.style.borderColor = "#232c3a";
            }}
          >
            {name}
          </div>
        ))}
      </div>

      <div style={{ color: "#64748b", fontSize: 11, marginTop: 12, padding: "4px" }}>
        Click a state to edit visibility and property overrides per element.
      </div>
    </div>
  );
}

/**
 * View 2: State editor. Shows state name, delete button, element list.
 */
function StateEditor({
  stateName,
  onBack,
  onSelectElement,
  setView,
}: {
  stateName: string;
  onBack: () => void;
  onSelectElement: (elementId: string) => void;
  setView: (v: "list" | { type: "editor"; stateName: string } | { type: "overrides"; stateName: string; elementId: string }) => void;
}) {
  const scene = useEditor((s) => s.activeScene());
  const updateActiveScene = useEditor((s) => s.updateActiveScene);
  const hoverElement = useEditor((s) => s.hoverElement);
  const states = scene.states ?? {};
  const state = states[stateName];

  // Local state buffer for rename input
  const [localStateName, setLocalStateName] = useState(stateName);

  // Sync buffer when prop changes (navigating to different state)
  useEffect(() => {
    setLocalStateName(stateName);
  }, [stateName]);

  if (!state) {
    onBack();
    return null;
  }

  const elementIds = Object.keys(state.elements);
  const allElements = getAllElements(scene.elements);

  const commitRename = () => {
    const trimmed = localStateName.trim();

    // Validation: empty or unchanged
    if (!trimmed || trimmed === stateName) {
      setLocalStateName(stateName); // Reset to original
      return;
    }

    // Validation: duplicate check
    if (states[trimmed] && trimmed !== stateName) {
      alert(`A state named "${trimmed}" already exists.`);
      setLocalStateName(stateName); // Reset to original
      return;
    }

    // Perform rename: single batched update
    const { [stateName]: removed, ...rest } = states;
    updateActiveScene({
      states: {
        ...rest,
        [trimmed]: removed,
      },
    });

    // CRITICAL: Update parent view to track new key
    setView({ type: "editor", stateName: trimmed });
  };

  const deleteState = () => {
    if (!confirm(`Delete state "${stateName}"?`)) return;
    const { [stateName]: removed, ...rest } = states;
    updateActiveScene({ states: rest });
    onBack();
  };

  return (
    <div style={panel}>
      <button style={backBtn} onClick={onBack}>
        ← Back to States
      </button>

      <div style={heading}>State Editor</div>

      <Row label="Name">
        <input
          type="text"
          value={localStateName}
          onChange={(e) => setLocalStateName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur(); // Triggers onBlur → commitRename
            }
            if (e.key === 'Escape') {
              setLocalStateName(stateName); // Cancel edit
              e.currentTarget.blur();
            }
          }}
          style={input}
        />
      </Row>

      <button
        style={{ ...chooseBtn, background: "#3f1d2b", borderColor: "#7f1d1d", color: "#fca5a5", marginTop: 8 }}
        onClick={deleteState}
      >
        Delete State
      </button>

      <div style={{ ...heading, marginTop: 16 }}>Element Overrides</div>

      <div style={{ color: "#64748b", fontSize: 11, margin: "4px 4px 8px" }}>
        Click an element on canvas or select from list:
      </div>

      {elementIds.length === 0 && (
        <div style={{ color: "#475569", fontSize: 11, padding: "8px", fontStyle: "italic" }}>
          No element overrides yet. Click an element on canvas to configure.
        </div>
      )}

      {elementIds.map((elementId) => {
        const el = allElements.find((e) => e.id === elementId);
        if (!el) return null;
        const overrides = state.elements[elementId];
        const visibleCount = overrides.visible !== undefined ? 1 : 0;
        const propsCount = overrides.props ? Object.keys(overrides.props).length : 0;
        const totalCount = visibleCount + propsCount;

        return (
          <div
            key={elementId}
            onClick={() => onSelectElement(elementId)}
            onMouseEnter={() => hoverElement(elementId)}
            onMouseLeave={() => hoverElement(null)}
            style={{
              padding: "8px",
              background: "#161c26",
              border: "1px solid #232c3a",
              borderRadius: 6,
              color: "#e2e8f0",
              fontSize: 12,
              marginBottom: 4,
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 500 }}>{el.type} · {elementId.slice(0, 8)}</div>
            <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
              {totalCount === 0 ? "No overrides" : `${totalCount} override${totalCount === 1 ? "" : "s"}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * View 3: Element overrides. Shows visibility checkbox, property overrides list.
 */
function ElementOverrides({
  stateName,
  elementId,
  onBack,
}: {
  stateName: string;
  elementId: string;
  onBack: () => void;
}) {
  const scene = useEditor((s) => s.activeScene());
  const updateActiveScene = useEditor((s) => s.updateActiveScene);
  const states = scene.states ?? {};
  const state = states[stateName];
  const overrides = state?.elements[elementId];

  if (!state || !overrides) {
    onBack();
    return null;
  }

  const allElements = getAllElements(scene.elements);
  const element = allElements.find((e) => e.id === elementId);
  if (!element) {
    onBack();
    return null;
  }

  const updateOverrides = (patch: Partial<typeof overrides>) => {
    updateActiveScene({
      states: {
        ...states,
        [stateName]: {
          ...state,
          elements: {
            ...state.elements,
            [elementId]: { ...overrides, ...patch },
          },
        },
      },
    });
  };

  const setPropOverride = (key: string, value: unknown) => {
    updateOverrides({
      props: {
        ...(overrides.props ?? {}),
        [key]: value,
      },
    });
  };

  // Debounced version for text inputs to avoid history spam
  const debouncedSetProp = useDebouncedCallback(
    (key: string, value: unknown) => {
      setPropOverride(key, value);
    },
    300
  );

  const removePropOverride = (key: string) => {
    const { [key]: removed, ...rest } = overrides.props ?? {};
    updateOverrides({ props: rest });
  };

  const removeFromState = () => {
    const { [elementId]: removed, ...rest } = state.elements;
    updateActiveScene({
      states: {
        ...states,
        [stateName]: {
          ...state,
          elements: rest,
        },
      },
    });
    onBack();
  };

  // Property suggestions based on element type (ADR 0011: text/label, fill/color, src/imageSrc)
  const propSuggestions: string[] = [];
  if (element.type === "text") propSuggestions.push("text", "color");
  if (element.type === "button") propSuggestions.push("label", "fill", "color", "imageSrc");
  if (element.type === "rectangle") propSuggestions.push("fill");
  if (element.type === "image") propSuggestions.push("src");
  if (element.type === "video") propSuggestions.push("src");
  if (element.type === "audio") propSuggestions.push("src");

  const existingKeys = Object.keys(overrides.props ?? {});
  const availableProps = propSuggestions.filter((p) => !existingKeys.includes(p));

  return (
    <div style={panel}>
      <button style={backBtn} onClick={onBack}>
        ← Back to State
      </button>

      <div style={heading}>Element Overrides</div>
      <div style={{ color: "#64748b", fontSize: 11, margin: "4px 4px 8px" }}>
        State: {stateName}
      </div>
      <div style={{ color: "#94a3b8", fontSize: 12, margin: "4px 4px 8px" }}>
        Element: {element.type} · {elementId.slice(0, 8)}
      </div>

      <Row label="Visible">
        <input
          type="checkbox"
          checked={overrides.visible ?? true}
          onChange={(e) => updateOverrides({ visible: e.target.checked })}
        />
      </Row>

      <div style={{ ...heading, marginTop: 14 }}>Property Overrides</div>

      {availableProps.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                setPropOverride(e.target.value, getDefaultValue(e.target.value));
              }
            }}
            style={input}
          >
            <option value="">+ Add Override</option>
            {availableProps.map((prop) => (
              <option key={prop} value={prop}>
                {prop}
              </option>
            ))}
          </select>
        </div>
      )}

      {existingKeys.length === 0 && (
        <div style={{ color: "#475569", fontSize: 11, padding: "8px", fontStyle: "italic" }}>
          No property overrides yet.
        </div>
      )}

      {existingKeys.map((key) => {
        const value = overrides.props![key];
        const isColor = key === "fill" || key === "color";
        const isSrc = key === "src" || key === "imageSrc";

        return (
          <div
            key={key}
            style={{
              background: "#0e1218",
              border: "1px solid #1f2733",
              borderRadius: 6,
              padding: 8,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 500 }}>{key}</span>
              <button
                style={{ ...miniBtn, color: "#fca5a5" }}
                onClick={() => removePropOverride(key)}
                title="Remove override"
              >
                🗑
              </button>
            </div>

            {isColor ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="color"
                  value={String(value)}
                  onChange={(e) => setPropOverride(key, e.target.value)}
                  style={{ width: 32, height: 28, padding: 0, border: "none", background: "none" }}
                />
                <input
                  type="text"
                  value={String(value)}
                  onChange={(e) => debouncedSetProp(key, e.target.value)}
                  style={{ ...input, flex: 1 }}
                />
              </div>
            ) : isSrc ? (
              <>
                <button
                  style={{ ...chooseBtn, marginBottom: 4, fontSize: 12, padding: "6px 8px" }}
                  onClick={async () => {
                    const filePath = useEditor.getState().filePath;
                    if (!filePath) {
                      alert("Save the project first.");
                      return;
                    }
                    // Determine file type based on element type
                    const fileType = element.type === "video" ? "video" : element.type === "audio" ? "audio" : "image";
                    const rel = await importContentFile(fileType);
                    if (rel) setPropOverride(key, rel);
                  }}
                >
                  Choose {element.type === "video" ? "video" : element.type === "audio" ? "audio" : "image"}…
                </button>
                <input
                  type="text"
                  value={String(value)}
                  onChange={(e) => debouncedSetProp(key, e.target.value)}
                  style={input}
                  placeholder="Or enter path manually"
                />
              </>
            ) : (
              <input
                type="text"
                value={String(value)}
                onChange={(e) => debouncedSetProp(key, e.target.value)}
                style={input}
              />
            )}
          </div>
        );
      })}

      <button
        style={{
          ...chooseBtn,
          background: "#3f1d2b",
          borderColor: "#7f1d1d",
          color: "#fca5a5",
          marginTop: 16,
        }}
        onClick={removeFromState}
      >
        Remove from State
      </button>
    </div>
  );
}

// --- Helpers ---

function getAllElements(elements: any[]): any[] {
  let all: any[] = [];
  for (const el of elements) {
    all.push(el);
    if (el.children) {
      all = all.concat(getAllElements(el.children));
    }
  }
  return all;
}

function getDefaultValue(propName: string): unknown {
  if (propName === "fill" || propName === "color") return "#3b82f6";
  if (propName === "text" || propName === "label") return "Text";
  if (propName === "src" || propName === "imageSrc") return "";
  return "";
}

// --- Styles ---

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0" }}>
      <span style={{ width: 64, color: "#94a3b8", fontSize: 12 }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </label>
  );
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

const backBtn: React.CSSProperties = {
  width: "100%",
  padding: "6px",
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#94a3b8",
  fontSize: 12,
  cursor: "pointer",
  marginBottom: 12,
  textAlign: "left",
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
