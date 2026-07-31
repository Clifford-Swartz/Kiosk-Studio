import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { Action, ActionType, ElementShape, Interaction, Project, Scene } from "@kiosk/engine";
import { useEditor } from "./store.js";
import { getEditableProps } from "./elementProps.js";

/**
 * Recursively find an element by ID, including children of layers/collections.
 */
function findElementRecursive(elements: any[], id: string): any {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.children) {
      const found = findElementRecursive(el.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Recursively collect all elements, including children of layers/collections.
 */
function flattenAllElements(elements: any[]): any[] {
  const result: any[] = [];
  for (const el of elements) {
    result.push(el);
    if (el.children) {
      result.push(...flattenAllElements(el.children));
    }
  }
  return result;
}

/**
 * Triggers & Actions editor for the selected element. Lists the element's
 * interactions (trigger → actions); add a tap trigger, then add/configure
 * actions (Go to scene / Set property / Toggle visibility) with param forms.
 * Actions collapse to a one-line icon+summary by default; drag a row's handle
 * to reorder, or drop it on another row's middle zone to group them to run
 * concurrently ("parallel"). Writes through the store; the Player runs these live.
 */
export function InteractionsEditor({ elementId }: { elementId: string }) {
  const scene = useEditor((s) => s.activeScene());
  const project = useEditor((s) => s.project);
  const addInteraction = useEditor((s) => s.addInteraction);
  const removeInteraction = useEditor((s) => s.removeInteraction);

  // Expanded (uncollapsed) action ids. Default collapsed keeps the panel scannable.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const el = findElementRecursive(scene.elements, elementId);
  if (!el) return null;

  const allElements = flattenAllElements(scene.elements);
  const otherElements = allElements.filter((e) => e.id !== elementId);
  const targets = allElements; // setProp/toggle can target any element (incl. self)

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

                <ActionsSection
                  elementId={elementId}
                  interaction={it}
                  scene={scene}
                  project={project}
                  targets={targets}
                  otherElements={otherElements}
                  expandedIds={expandedIds}
                  toggleExpanded={toggleExpanded}
                />
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
                <ActionsSection
                  elementId={elementId}
                  interaction={enter}
                  scene={scene}
                  project={project}
                  targets={targets}
                  otherElements={otherElements}
                  expandedIds={expandedIds}
                  toggleExpanded={toggleExpanded}
                />
              </div>

              {/* On Exit / On Release section */}
              <div style={section}>
                <div style={sectionLabel}>On {isHover ? "Exit" : "Release"}</div>
                <ActionsSection
                  elementId={elementId}
                  interaction={exit}
                  scene={scene}
                  project={project}
                  targets={targets}
                  otherElements={otherElements}
                  expandedIds={expandedIds}
                  toggleExpanded={toggleExpanded}
                />
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
 * Icon shown for a collapsed action row's type.
 */
const ACTION_ICON: Record<string, string> = {
  goToScene: "→",
  setProp: "✎",
  toggle: "👁",
  animate: "◐",
  setState: "◇",
  togglePlayPause: "⏯",
  seekVideo: "⏩",
  scrubVideo: "⏮",
  setVolume: "🔊",
  setSpeed: "⏱",
  parallel: "⇶",
};

/**
 * One-line human summary for a collapsed action row, substituting the
 * actual target/scene/value so the row is scannable without expanding it.
 */
function summarizeAction(
  action: Action,
  targets: ElementShape[],
  scenes: { id: string; name: string }[]
): string {
  const p = action.params as Record<string, any>;
  const targetLabel = (id: unknown) => {
    const t = targets.find((t) => t.id === id);
    return t ? t.name || `${t.type} (${t.id.slice(0, 6)})` : "— choose —";
  };

  switch (action.type) {
    case "goToScene": {
      const s = scenes.find((s) => s.id === p.sceneId);
      return `Go to "${s?.name ?? "— choose scene —"}"`;
    }
    case "setProp":
      return `Set ${targetLabel(p.target)}.${p.key || "?"} = ${str(p.value) || "…"}`;
    case "toggle":
      return `Toggle visibility of ${targetLabel(p.target)}`;
    case "animate": {
      const to = typeof p.to === "object" && p.to !== null ? JSON.stringify(p.to) : str(p.to);
      return `Animate ${targetLabel(p.target)}.${p.property || "opacity"} → ${to || "…"} (${typeof p.duration === "number" ? p.duration : 300}ms)`;
    }
    case "setState":
      return `Change scene state to "${p.stateName || "default"}"`;
    case "togglePlayPause":
      return `Toggle play/pause on ${targetLabel(p.target)}`;
    case "seekVideo":
      return `Seek ${targetLabel(p.target)} to ${typeof p.time === "number" ? p.time : 0}s`;
    case "scrubVideo": {
      const from = typeof p.from === "number" ? `${p.from}s` : "current";
      const to = typeof p.to === "number" ? p.to : 0;
      const duration = typeof p.duration === "number" ? p.duration : 500;
      return `Scrub ${targetLabel(p.target)} ${from} → ${to}s (${duration}ms)`;
    }
    case "setVolume":
      return `Set volume of ${targetLabel(p.target)} to ${Math.round((typeof p.volume === "number" ? p.volume : 1) * 100)}%`;
    case "setSpeed":
      return `Set speed of ${targetLabel(p.target)} to ${typeof p.rate === "number" ? p.rate : 1}x`;
    case "parallel":
      return `Run ${Array.isArray(p.actions) ? p.actions.length : 0} actions together`;
    default:
      return action.type;
  }
}

/**
 * Shared "+ Add action…" dropdown, used at the top level of an interaction
 * and inside a "Run together" group. Owns the default params for each type.
 */
function AddActionMenu({
  scene,
  project,
  elementId,
  otherElements,
  onAdd,
}: {
  scene: Scene;
  project: Project;
  elementId: string;
  otherElements: ElementShape[];
  onAdd: (type: ActionType, defaults: Record<string, unknown>) => void;
}) {
  return (
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
          : t === "scrubVideo" ? { target: videoElements[0]?.id ?? "", to: 0, duration: 500, easing: "linear" }
          : t === "setVolume" ? { target: videoElements[0]?.id ?? "", volume: 1 }
          : t === "setSpeed" ? { target: videoElements[0]?.id ?? "", rate: 1 }
          : t === "animate" ? { target: otherElements[0]?.id ?? elementId, property: "opacity", to: 0, duration: 300, easing: "linear" }
          : t === "setState" ? { stateName: "default", animated: false, duration: 300 }
          : { target: otherElements[0]?.id ?? elementId };
        onAdd(t, defaults);
      }}
      style={{ ...input, marginTop: 4 }}
    >
      <option value="">+ Add action…</option>
      <option value="goToScene">Go to scene</option>
      <option value="setProp">Set property</option>
      <option value="toggle">Toggle visibility</option>
      <option value="animate">Animate property</option>
      <option value="setState">Change scene state</option>
      <option value="togglePlayPause">Toggle play/pause</option>
      <option value="seekVideo">Seek video to time</option>
      <option value="scrubVideo">Scrub video between times</option>
      <option value="setVolume">Set volume</option>
      <option value="setSpeed">Set playback speed</option>
    </select>
  );
}

/**
 * Row header shared by plain action rows and "Run together" group rows:
 * drag handle + icon + one-line summary + move/remove controls. Clicking
 * anywhere else on the row toggles the expanded field editor.
 */
function RowHeader({
  icon,
  label,
  expanded,
  onToggleExpand,
  onMoveUp,
  onMoveDown,
  onRemove,
  removeTitle,
  showDragHandle = true,
  extra,
}: {
  icon: string;
  label: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
  removeTitle?: string;
  showDragHandle?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div style={rowHeaderStyle} onClick={onToggleExpand}>
      {showDragHandle && <span style={dragHandle} title="Drag to reorder or group">⠿</span>}
      <span style={{ fontSize: 12, flexShrink: 0 }}>{icon}</span>
      <span style={summaryText} title={label}>{expanded ? "▾ " : "▸ "}{label}</span>
      {extra}
      <button
        style={{ ...miniBtn, opacity: onMoveUp ? 1 : 0.25, cursor: onMoveUp ? "pointer" : "default" }}
        disabled={!onMoveUp}
        onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
        title="Move up"
      >
        ▲
      </button>
      <button
        style={{ ...miniBtn, opacity: onMoveDown ? 1 : 0.25, cursor: onMoveDown ? "pointer" : "default" }}
        disabled={!onMoveDown}
        onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
        title="Move down"
      >
        ▼
      </button>
      <button
        style={{ ...miniBtn, color: "#fca5a5" }}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title={removeTitle ?? "Remove action"}
      >
        ✕
      </button>
    </div>
  );
}

/** Draggable row wrapper: applies drop-target/dragging visuals shared by every row shape. */
function DraggableRow({
  isDragging,
  isReorderTarget,
  isGroupTarget,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onMouseDown,
  onMouseUp,
  style,
  children,
}: {
  isDragging: boolean;
  isReorderTarget: boolean;
  isGroupTarget: boolean;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseUp: () => void;
  style: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{
        ...style,
        ...(isReorderTarget ? rowDropTarget : null),
        ...(isGroupTarget ? rowGroupTarget : null),
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {children}
    </div>
  );
}

/**
 * One interaction's action list: renders every top-level action (plain rows
 * and "Run together" groups), owns drag-and-drop reorder/group state for
 * this list, and the trailing "+ Add action…" menu.
 *
 * Drag zones mirror SceneStructure.tsx: top/bottom 25% of a row = reorder,
 * middle 50% = group (only when the dragged action isn't itself a group —
 * UI-created nesting is capped at depth 1).
 */
function ActionsSection({
  elementId,
  interaction,
  scene,
  project,
  targets,
  otherElements,
  expandedIds,
  toggleExpanded,
}: {
  elementId: string;
  interaction: Interaction;
  scene: Scene;
  project: Project;
  targets: ElementShape[];
  otherElements: ElementShape[];
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
}) {
  const addAction = useEditor((s) => s.addAction);
  const updateAction = useEditor((s) => s.updateAction);
  const removeAction = useEditor((s) => s.removeAction);
  const reorderAction = useEditor((s) => s.reorderAction);
  const groupActions = useEditor((s) => s.groupActions);
  const ungroupAction = useEditor((s) => s.ungroupAction);

  const actions = interaction.actions;

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [groupTargetId, setGroupTargetId] = useState<string | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggableRef = useRef(false);

  function resetDrag() {
    setDragId(null);
    setOverId(null);
    setGroupTargetId(null);
  }

  function handleDrop() {
    if (dragId === null) { resetDrag(); return; }
    const dragged = actions.find((a) => a.id === dragId);
    if (!dragged) { resetDrag(); return; }

    if (groupTargetId && groupTargetId !== dragId) {
      const target = actions.find((a) => a.id === groupTargetId);
      if (target && dragged.type !== "parallel") {
        if (target.type === "parallel") {
          // Move the dragged action into the existing group.
          removeAction(elementId, interaction.id, dragId);
          addAction(elementId, interaction.id, { type: dragged.type, params: dragged.params }, groupTargetId);
        } else {
          groupActions(elementId, interaction.id, groupTargetId, dragId);
        }
      }
    } else if (overId !== null && overId !== dragId) {
      const toIndex = actions.findIndex((a) => a.id === overId);
      if (toIndex !== -1) reorderAction(elementId, interaction.id, dragId, toIndex);
    }
    resetDrag();
  }

  function guardedToggle(id: string) {
    // A completed drag shouldn't also toggle expand/collapse.
    if (isDraggableRef.current) {
      isDraggableRef.current = false;
      return;
    }
    toggleExpanded(id);
  }

  function moveNested(group: Action, actionId: string, dir: -1 | 1) {
    const arr = (group.params.actions as Action[]) ?? [];
    const idx = arr.findIndex((a) => a.id === actionId);
    const newIdx = idx + dir;
    if (idx === -1 || newIdx < 0 || newIdx >= arr.length) return;
    const next = [...arr];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    updateAction(elementId, interaction.id, group.id, { params: { actions: next } });
  }

  return (
    <>
      {actions.map((action, idx) => {
        const isExpanded = expandedIds.has(action.id);
        const isDragging = dragId === action.id;
        const isReorderTarget = overId === action.id && dragId !== null && dragId !== action.id;
        const isGroupTarget = groupTargetId === action.id;

        const shared = {
          isDragging,
          isReorderTarget,
          isGroupTarget,
          draggable: isDraggableRef.current,
          onDragStart: () => setDragId(action.id),
          onDragEnd: () => {
            setDragId(null);
            setOverId(null);
            setGroupTargetId(null);
            isDraggableRef.current = false;
          },
          onDragOver: (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            if (dragId === null || dragId === action.id) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const dragged = actions.find((a) => a.id === dragId);
            const canGroup = !!dragged && dragged.type !== "parallel";
            if (canGroup && y > rect.height * 0.25 && y < rect.height * 0.75) {
              setGroupTargetId(action.id);
              setOverId(null);
            } else {
              setGroupTargetId(null);
              setOverId(action.id);
            }
          },
          onDragLeave: () => {
            setGroupTargetId(null);
            setOverId(null);
          },
          onDrop: (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            handleDrop();
          },
          onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            let t = e.target as HTMLElement;
            const row = e.currentTarget;
            while (t && t !== row) {
              if (t.tagName === "BUTTON" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
              t = t.parentElement as HTMLElement;
            }
            holdTimerRef.current = setTimeout(() => {
              isDraggableRef.current = true;
            }, 200);
          },
          onMouseUp: () => {
            if (holdTimerRef.current) {
              clearTimeout(holdTimerRef.current);
              holdTimerRef.current = null;
            }
          },
        };

        if (action.type === "parallel") {
          const nested = (action.params.actions as Action[]) ?? [];
          return (
            <DraggableRow key={action.id} {...shared} style={groupRow}>
              <RowHeader
                icon={ACTION_ICON.parallel}
                label={`Run together (${nested.length})`}
                expanded={isExpanded}
                onToggleExpand={() => guardedToggle(action.id)}
                onMoveUp={idx > 0 ? () => reorderAction(elementId, interaction.id, action.id, idx - 1) : undefined}
                onMoveDown={idx < actions.length - 1 ? () => reorderAction(elementId, interaction.id, action.id, idx + 1) : undefined}
                onRemove={() => removeAction(elementId, interaction.id, action.id)}
                removeTitle="Remove group"
                extra={
                  <button
                    style={miniBtn}
                    onClick={(e) => { e.stopPropagation(); ungroupAction(elementId, interaction.id, action.id); }}
                    title="Split back into separate sequential actions"
                  >
                    Ungroup
                  </button>
                }
              />
              {isExpanded && (
                <div style={section}>
                  {nested.map((na, nIdx) => (
                    <NestedActionRow
                      key={na.id}
                      action={na}
                      scenes={project.scenes}
                      targets={targets}
                      expanded={expandedIds.has(na.id)}
                      onToggleExpand={() => toggleExpanded(na.id)}
                      onChange={(patch) => updateAction(elementId, interaction.id, na.id, patch)}
                      onRemove={() => removeAction(elementId, interaction.id, na.id)}
                      onMoveUp={nIdx > 0 ? () => moveNested(action, na.id, -1) : undefined}
                      onMoveDown={nIdx < nested.length - 1 ? () => moveNested(action, na.id, 1) : undefined}
                    />
                  ))}
                  <AddActionMenu
                    scene={scene}
                    project={project}
                    elementId={elementId}
                    otherElements={otherElements}
                    onAdd={(t, defaults) => addAction(elementId, interaction.id, { type: t, params: defaults }, action.id)}
                  />
                </div>
              )}
            </DraggableRow>
          );
        }

        return (
          <DraggableRow key={action.id} {...shared} style={actionRow}>
            <RowHeader
              icon={ACTION_ICON[action.type] ?? "•"}
              label={summarizeAction(action, targets, project.scenes)}
              expanded={isExpanded}
              onToggleExpand={() => guardedToggle(action.id)}
              onMoveUp={idx > 0 ? () => reorderAction(elementId, interaction.id, action.id, idx - 1) : undefined}
              onMoveDown={idx < actions.length - 1 ? () => reorderAction(elementId, interaction.id, action.id, idx + 1) : undefined}
              onRemove={() => removeAction(elementId, interaction.id, action.id)}
            />
            {isExpanded && (
              <ActionFields
                action={action}
                scenes={project.scenes}
                targets={targets}
                onChange={(patch) => updateAction(elementId, interaction.id, action.id, patch)}
              />
            )}
          </DraggableRow>
        );
      })}

      <AddActionMenu
        scene={scene}
        project={project}
        elementId={elementId}
        otherElements={otherElements}
        onAdd={(t, defaults) => addAction(elementId, interaction.id, { type: t, params: defaults })}
      />
    </>
  );
}

/** A non-draggable action row nested inside a "Run together" group (▲/▼ only — depth is capped at 1). */
function NestedActionRow({
  action,
  scenes,
  targets,
  expanded,
  onToggleExpand,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  action: Action;
  scenes: { id: string; name: string }[];
  targets: ElementShape[];
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (patch: Partial<Action>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <div style={nestedActionRow}>
      <RowHeader
        icon={ACTION_ICON[action.type] ?? "•"}
        label={summarizeAction(action, targets, scenes)}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onRemove={onRemove}
        showDragHandle={false}
      />
      {expanded && <ActionFields action={action} scenes={scenes} targets={targets} onChange={onChange} />}
    </div>
  );
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

/** The full field editor for one action's params, shown when its row is expanded. */
function ActionFields({
  action,
  scenes,
  targets,
  onChange,
}: {
  action: Action;
  scenes: { id: string; name: string }[];
  targets: ElementShape[];
  onChange: (patch: Partial<Action>) => void;
}) {
  const p = action.params as Record<string, any>;
  const setParam = (k: string, v: unknown) => onChange({ params: { ...p, [k]: v } });
  const targetLabel = (t: { id: string; type: string; name?: string }) => t.name || `${t.type} (${t.id.slice(0, 6)})`;
  const videoElements = targets.filter((t) => t.type === "video");
  const audioVideoElements = targets.filter((t) => t.type === "video" || t.type === "audio");

  return (
    <div style={{ marginTop: 6 }}>
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

      {action.type === "scrubVideo" && (
        <>
          <select value={str(p.target)} onChange={(e) => setParam("target", e.target.value)} style={input}>
            <option value="">— choose video —</option>
            {videoElements.map((t) => <option key={t.id} value={t.id}>{targetLabel(t)}</option>)}
          </select>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="From (s, optional)"
              value={typeof p.from === "number" ? p.from : ""}
              onChange={(e) => setParam("from", e.target.value === "" ? undefined : Number(e.target.value))}
              style={{ ...input, flex: 1 }}
            />
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="To (s)"
              value={typeof p.to === "number" ? p.to : ""}
              onChange={(e) => setParam("to", Number(e.target.value))}
              style={{ ...input, flex: 1 }}
            />
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <input
              type="number"
              min={0}
              placeholder="Duration (ms)"
              value={typeof p.duration === "number" ? p.duration : ""}
              onChange={(e) => setParam("duration", Number(e.target.value))}
              style={{ ...input, flex: 1 }}
            />
            <select value={str(p.easing) || "linear"} onChange={(e) => setParam("easing", e.target.value)} style={{ ...input, flex: 1 }}>
              <option value="linear">Linear</option>
              <option value="easeIn">Ease In</option>
              <option value="easeOut">Ease Out</option>
              <option value="easeInOut">Ease In Out</option>
            </select>
          </div>
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

      {action.type === "animate" && (() => {
        const targetEl = targets.find((t) => t.id === str(p.target));
        const property = str(p.property);

        const captureFrom = () => {
          if (!targetEl) return;
          let capturedValue: any;

          if (property === "position") {
            capturedValue = { x: targetEl.x, y: targetEl.y };
          } else if (property === "scale") {
            capturedValue = { width: targetEl.width, height: targetEl.height };
          } else if (property === "opacity") {
            capturedValue = targetEl.opacity ?? 1;
          } else if (property === "rotation") {
            capturedValue = targetEl.rotation ?? 0;
          }

          // Batch update using onChange instead of setParam to avoid race conditions
          onChange({ params: { ...p, from: capturedValue } });
        };

        const captureTo = () => {
          if (!targetEl) return;
          let capturedValue: any;

          if (property === "position") {
            capturedValue = { x: targetEl.x, y: targetEl.y };
          } else if (property === "scale") {
            capturedValue = { width: targetEl.width, height: targetEl.height };
          } else if (property === "opacity") {
            capturedValue = targetEl.opacity ?? 1;
          } else if (property === "rotation") {
            capturedValue = targetEl.rotation ?? 0;
          }

          // Batch update using onChange instead of setParam to avoid race conditions
          onChange({ params: { ...p, to: capturedValue } });
        };

        return (
          <>
            <select value={str(p.target)} onChange={(e) => setParam("target", e.target.value)} style={input}>
              <option value="">— choose element —</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{targetLabel(t)}</option>)}
            </select>
            <select value={property || "opacity"} onChange={(e) => setParam("property", e.target.value)} style={{ ...input, marginTop: 4 }}>
              <option value="opacity">Opacity</option>
              <option value="position">Position (x, y)</option>
              <option value="scale">Scale (width, height)</option>
              <option value="rotation">Rotation</option>
            </select>

            {/* From inputs (optional, per property type) */}
            <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 6, marginBottom: 2 }}>From (optional)</div>
            {property === "position" && (
              <>
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="number" placeholder="X" value={typeof p.from?.x === "number" ? p.from.x : ""} onChange={(e) => setParam("from", { ...(typeof p.from === "object" ? p.from : {}), x: Number(e.target.value) })} style={{ ...input, flex: 1 }} />
                  <input type="number" placeholder="Y" value={typeof p.from?.y === "number" ? p.from.y : ""} onChange={(e) => setParam("from", { ...(typeof p.from === "object" ? p.from : {}), y: Number(e.target.value) })} style={{ ...input, flex: 1 }} />
                </div>
                {targetEl && (
                  <button onClick={captureFrom} style={{ ...captureBtn, marginTop: 4 }}>
                    📍 Capture current position
                  </button>
                )}
              </>
            )}
            {property === "scale" && (
              <>
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="number" placeholder="Width" value={typeof p.from?.width === "number" ? p.from.width : ""} onChange={(e) => setParam("from", { ...(typeof p.from === "object" ? p.from : {}), width: Number(e.target.value) })} style={{ ...input, flex: 1 }} />
                  <input type="number" placeholder="Height" value={typeof p.from?.height === "number" ? p.from.height : ""} onChange={(e) => setParam("from", { ...(typeof p.from === "object" ? p.from : {}), height: Number(e.target.value) })} style={{ ...input, flex: 1 }} />
                </div>
                {targetEl && (
                  <button onClick={captureFrom} style={{ ...captureBtn, marginTop: 4 }}>
                    📍 Capture current scale
                  </button>
                )}
              </>
            )}
            {(property === "opacity" || property === "rotation") && (
              <>
                <input type="number" placeholder={property === "opacity" ? "0-1" : "degrees"} value={typeof p.from === "number" ? p.from : ""} onChange={(e) => setParam("from", Number(e.target.value))} style={input} />
                {targetEl && (
                  <button onClick={captureFrom} style={{ ...captureBtn, marginTop: 4 }}>
                    📍 Capture current {property}
                  </button>
                )}
              </>
            )}

            {/* To inputs (required, per property type) */}
            <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 8, marginBottom: 2 }}>To (required)</div>
            {property === "position" && (
              <>
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="number" placeholder="X" value={typeof p.to?.x === "number" ? p.to.x : ""} onChange={(e) => setParam("to", { ...(typeof p.to === "object" ? p.to : {}), x: Number(e.target.value) })} style={{ ...input, flex: 1 }} />
                  <input type="number" placeholder="Y" value={typeof p.to?.y === "number" ? p.to.y : ""} onChange={(e) => setParam("to", { ...(typeof p.to === "object" ? p.to : {}), y: Number(e.target.value) })} style={{ ...input, flex: 1 }} />
                </div>
                {targetEl && (
                  <button onClick={captureTo} style={{ ...captureBtn, marginTop: 4 }}>
                    📍 Capture current position
                  </button>
                )}
              </>
            )}
            {property === "scale" && (
              <>
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="number" placeholder="Width" value={typeof p.to?.width === "number" ? p.to.width : ""} onChange={(e) => setParam("to", { ...(typeof p.to === "object" ? p.to : {}), width: Number(e.target.value) })} style={{ ...input, flex: 1 }} />
                  <input type="number" placeholder="Height" value={typeof p.to?.height === "number" ? p.to.height : ""} onChange={(e) => setParam("to", { ...(typeof p.to === "object" ? p.to : {}), height: Number(e.target.value) })} style={{ ...input, flex: 1 }} />
                </div>
                {targetEl && (
                  <button onClick={captureTo} style={{ ...captureBtn, marginTop: 4 }}>
                    📍 Capture current scale
                  </button>
                )}
              </>
            )}
            {(property === "opacity" || property === "rotation") && (
              <>
                <input type="number" placeholder={property === "opacity" ? "0-1" : "degrees"} value={typeof p.to === "number" ? p.to : ""} onChange={(e) => setParam("to", Number(e.target.value))} style={input} />
                {targetEl && (
                  <button onClick={captureTo} style={{ ...captureBtn, marginTop: 4 }}>
                    📍 Capture current {property}
                  </button>
                )}
              </>
            )}

            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              <input type="number" placeholder="Duration (ms)" value={typeof p.duration === "number" ? p.duration : ""} onChange={(e) => setParam("duration", Number(e.target.value))} style={{ ...input, flex: 1 }} />
              <select value={str(p.easing) || "linear"} onChange={(e) => setParam("easing", e.target.value)} style={{ ...input, flex: 1 }}>
                <option value="linear">Linear</option>
                <option value="easeIn">Ease In</option>
                <option value="easeOut">Ease Out</option>
                <option value="easeInOut">Ease In Out</option>
              </select>
            </div>
            <input type="number" placeholder="Delay (ms, optional)" value={typeof p.delay === "number" ? p.delay : ""} onChange={(e) => setParam("delay", Number(e.target.value) || 0)} style={{ ...input, marginTop: 4 }} />
          </>
        );
      })()}

      {action.type === "setState" && (() => {
        const scene = useEditor.getState().activeScene();
        const states = scene.states ?? {};
        const stateNames = ["default", ...Object.keys(states)];

        return (
          <>
            <select
              value={str(p.stateName) || "default"}
              onChange={(e) => setParam("stateName", e.target.value)}
              style={input}
            >
              {stateNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <input type="checkbox" checked={!!p.animated} onChange={(e) => setParam("animated", e.target.checked)} />
              <span style={{ fontSize: 12, color: "#e2e8f0" }}>Animated transition</span>
            </div>
            {p.animated && (
              <input type="number" placeholder="Duration (ms)" value={typeof p.duration === "number" ? p.duration : 300} onChange={(e) => setParam("duration", Number(e.target.value))} style={{ ...input, marginTop: 4 }} />
            )}
          </>
        );
      })()}
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
const groupRow: CSSProperties = {
  ...actionRow,
  border: "1px solid #2563eb",
  background: "#0f1420",
};
const nestedActionRow: CSSProperties = {
  ...actionRow,
  marginLeft: 4,
  background: "#0c1017",
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
  flexShrink: 0,
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
const captureBtn: CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  background: "#1a2332",
  border: "1px solid #2563eb",
  borderRadius: 4,
  color: "#93c5fd",
  fontSize: 11,
  cursor: "pointer",
};
const dragHandle: CSSProperties = {
  cursor: "grab",
  color: "#475569",
  fontSize: 12,
  width: 12,
  textAlign: "center",
  flexShrink: 0,
};
const rowHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
};
const summaryText: CSSProperties = {
  flex: 1,
  fontSize: 12,
  color: "#e2e8f0",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const rowDropTarget: CSSProperties = {
  // A line on top indicates where the dragged row will land (reorder mode).
  boxShadow: "inset 0 2px 0 0 #38bdf8",
};
const rowGroupTarget: CSSProperties = {
  // Full-row highlight indicates the dragged action will be grouped with this one.
  background: "#1e3a52",
  border: "1px solid #38bdf8",
  boxShadow: "0 0 0 2px rgba(56, 189, 248, 0.2)",
};
