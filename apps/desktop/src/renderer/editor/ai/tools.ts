import { useEditor } from "../store.js";
import { getEditableProps } from "../elementProps.js";
import type { ElementType } from "@kiosk/engine";

/**
 * OpenAI function-calling tool defs, 1:1 with existing store actions. Kept as
 * a static list (not derived from EditorState) so each tool's JSON schema can
 * describe exactly the args the AI should pass, independent of the store's
 * internal signatures.
 */
const ELEMENT_TYPES: ElementType[] = [
  "rectangle",
  "text",
  "image",
  "video",
  "audio",
  "button",
  "layer",
  "collection",
  "html",
];

export interface AiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const AI_TOOLS: AiTool[] = [
  {
    type: "function",
    function: {
      name: "add_scene",
      description: "Add a new empty scene to the project and make it the active scene.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_scene",
      description: "Rename a scene by ID.",
      parameters: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          name: { type: "string" },
        },
        required: ["sceneId", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_scene",
      description: "Delete a scene by ID. Fails if it's the only scene.",
      parameters: {
        type: "object",
        properties: { sceneId: { type: "string" } },
        required: ["sceneId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_active_scene",
      description: "Switch the active scene (new elements are added to whichever scene is active).",
      parameters: {
        type: "object",
        properties: { sceneId: { type: "string" } },
        required: ["sceneId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_scene_background",
      description: "Set the active scene's background color (e.g. \"#112233\") or image/video path.",
      parameters: {
        type: "object",
        properties: { background: { type: "string" } },
        required: ["background"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_element",
      description: "Add a new element of the given type to the active scene.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ELEMENT_TYPES },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_element",
      description: "Remove an element by ID from the active scene.",
      parameters: {
        type: "object",
        properties: { elementId: { type: "string" } },
        required: ["elementId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_element",
      description: "Move an element to an absolute x,y position within the active scene.",
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["elementId", "x", "y"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resize_element",
      description: "Resize/reposition an element's bounding box.",
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["elementId", "x", "y", "width", "height"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_element_props",
      description:
        "Set type-specific properties on an element (e.g. fill color, text, font size). " +
        "Only properties valid for that element's type are accepted — check the project " +
        "dump for the element's type before calling.",
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string" },
          props: {
            type: "object",
            description: "Key/value pairs of prop name to new value.",
            additionalProperties: true,
          },
        },
        required: ["elementId", "props"],
        additionalProperties: false,
      },
    },
  },
];

/** Find an element (recursively through children) by ID in the active scene. */
function findElementInActiveScene(elementId: string) {
  const scene = useEditor.getState().activeScene();
  const search = (elements: typeof scene.elements): (typeof scene.elements)[number] | null => {
    for (const el of elements) {
      if (el.id === elementId) return el;
      if (el.children) {
        const found = search(el.children);
        if (found) return found;
      }
    }
    return null;
  };
  return search(scene.elements);
}

/**
 * Execute one AI tool call against the editor store. Returns a string result
 * (success message or error) to feed back as the tool_result content — never
 * throws, so the agent loop can keep going and let the model self-correct.
 */
export function executeTool(name: string, args: Record<string, unknown>): string {
  const store = useEditor.getState();

  try {
    switch (name) {
      case "add_scene": {
        store.addScene();
        return `OK: added scene, id=${useEditor.getState().activeSceneId}`;
      }
      case "rename_scene": {
        store.renameScene(String(args.sceneId), String(args.name));
        return "OK";
      }
      case "remove_scene": {
        store.removeScene(String(args.sceneId));
        return "OK";
      }
      case "set_active_scene": {
        store.setActiveScene(String(args.sceneId));
        return "OK";
      }
      case "set_scene_background": {
        store.updateActiveScene({ background: String(args.background) });
        return "OK";
      }
      case "add_element": {
        const type = String(args.type) as ElementType;
        if (!ELEMENT_TYPES.includes(type)) {
          return `Error: unknown element type "${type}". Valid types: ${ELEMENT_TYPES.join(", ")}`;
        }
        store.addElement(type);
        return `OK: added ${type}, id=${useEditor.getState().selectedId}`;
      }
      case "remove_element": {
        store.removeElement(String(args.elementId));
        return "OK";
      }
      case "move_element": {
        store.moveElement(String(args.elementId), Number(args.x), Number(args.y));
        return "OK";
      }
      case "resize_element": {
        store.resizeElement(String(args.elementId), {
          x: Number(args.x),
          y: Number(args.y),
          width: Number(args.width),
          height: Number(args.height),
        });
        return "OK";
      }
      case "set_element_props": {
        const elementId = String(args.elementId);
        const el = findElementInActiveScene(elementId);
        if (!el) return `Error: no element with id "${elementId}" in the active scene.`;

        const whitelist = new Set(getEditableProps(el.type).map((p) => p.key));
        const allProps = (args.props ?? {}) as Record<string, unknown>;
        const invalidKeys = Object.keys(allProps).filter((k) => !whitelist.has(k));
        if (invalidKeys.length > 0) {
          return `Error: invalid prop key(s) for element type "${el.type}": ${invalidKeys.join(", ")}. ` +
            `Valid keys: ${[...whitelist].join(", ") || "(none)"}`;
        }

        // "opacity" and "visible" live on the element root, not element.props —
        // route them through updateElement so they actually take effect.
        const { opacity, visible, ...props } = allProps;
        const rootPatch: Record<string, unknown> = {};
        if (opacity !== undefined) rootPatch.opacity = Number(opacity);
        if (visible !== undefined) rootPatch.visible = Boolean(visible);
        if (Object.keys(rootPatch).length > 0) {
          store.updateElement(elementId, rootPatch);
        }
        if (Object.keys(props).length > 0) {
          store.updateElementProps(elementId, props);
        }
        return "OK";
      }
      default:
        return `Error: unknown tool "${name}"`;
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
