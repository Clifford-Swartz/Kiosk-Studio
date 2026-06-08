import { z } from "zod";

/**
 * The Scene Model — THE contract of Kiosk Studio.
 *
 * A Project contains Scenes; a Scene contains Elements; Elements carry
 * type-specific props, optional data Bindings, and Interactions
 * (trigger -> actions). The Player reads this, the Editor writes it, and
 * connectors feed values into it.
 *
 * Types are derived from these Zod schemas (see ./types.ts) so the
 * validated runtime shape and the compile-time types stay in lockstep.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const ElementTypeSchema = z.enum([
  "rectangle",
  "text",
  "image",
  "video",
  "button",
  "group",
  "collection",
]);

export const TriggerKindSchema = z.enum([
  "tap",
  "press",
  "release",
  "enterScene",
  "dataChanged",
]);

export const ActionTypeSchema = z.enum([
  "goToScene",
  "setProp",
  "toggle",
  "playMedia",
  "sendData",
  "animate",
]);

export const DataSourceKindSchema = z.enum([
  "file",
  "rest",
  "mqtt",
  "websocket",
  "serial",
  "ble",
]);

// ---------------------------------------------------------------------------
// Interactions & bindings
// ---------------------------------------------------------------------------

export const ActionSchema = z.object({
  type: ActionTypeSchema,
  /** Free-form per-action parameters (validated per-type in the runtime). */
  params: z.record(z.unknown()).default({}),
});

export const InteractionSchema = z.object({
  id: z.string(),
  trigger: TriggerKindSchema,
  actions: z.array(ActionSchema).default([]),
});

export const BindingSchema = z.object({
  /** Element prop this binding writes to, e.g. "text" or "props.fill". */
  targetProp: z.string(),
  /** Data source id this binding reads from. */
  source: z.string(),
  /** Optional path into the source value, e.g. "sensor1.temp". */
  path: z.string().optional(),
  /** Optional transform expression (reserved; applied by binding store). */
  transform: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Element (recursive via `children` for groups)
// ---------------------------------------------------------------------------

/** The parsed (output) shape: defaults are applied, so fields are required. */
export interface ElementShape {
  id: string;
  type: z.infer<typeof ElementTypeSchema>;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  props: Record<string, unknown>;
  bindings: z.infer<typeof BindingSchema>[];
  interactions: z.infer<typeof InteractionSchema>[];
  children?: ElementShape[];
}

/**
 * The accepted (input) shape: defaulted fields may be omitted. Needed to type
 * the recursive `z.lazy` schema, whose input and output types differ because
 * of `.default()`.
 */
export interface ElementInput {
  id: string;
  type: z.infer<typeof ElementTypeSchema>;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  props?: Record<string, unknown>;
  bindings?: z.input<typeof BindingSchema>[];
  interactions?: z.input<typeof InteractionSchema>[];
  children?: ElementInput[];
}

export const ElementSchema: z.ZodType<ElementShape, z.ZodTypeDef, ElementInput> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: ElementTypeSchema,
    name: z.string().optional(),
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().default(100),
    height: z.number().default(100),
    rotation: z.number().default(0),
    opacity: z.number().min(0).max(1).default(1),
    zIndex: z.number().default(0),
    props: z.record(z.unknown()).default({}),
    bindings: z.array(BindingSchema).default([]),
    interactions: z.array(InteractionSchema).default([]),
    children: z.array(ElementSchema).optional(),
  })
);

// ---------------------------------------------------------------------------
// Scene, data sources, project
// ---------------------------------------------------------------------------

export const SceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Size is project-wide (see ProjectSchema.width/height). These remain optional
  // for back-compat with older project files; they are not used for rendering.
  width: z.number().optional(),
  height: z.number().optional(),
  background: z.string().default("#000000"),
  elements: z.array(ElementSchema).default([]),
});

export const DataSourceDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: DataSourceKindSchema,
  /** Connector-specific config (url, topic, port, baud, etc.). */
  config: z.record(z.unknown()).default({}),
});

export const ProjectSchema = z.object({
  /** Schema version, so we can migrate project files later. */
  schemaVersion: z.literal(1).default(1),
  id: z.string(),
  name: z.string(),
  /** Canvas size for the whole project (one size for all scenes — a kiosk has one screen). */
  width: z.number().default(1920),
  height: z.number().default(1080),
  /** Id of the scene the Player opens first. Defaults to the first scene. */
  startSceneId: z.string().optional(),
  scenes: z.array(SceneSchema).min(1),
  dataSources: z.array(DataSourceDefSchema).default([]),
});

/**
 * Parse and validate an unknown value as a Project, applying defaults. Migrates
 * older files where size lived on the scene: if the project has no width/height,
 * adopt the first scene's size before validating.
 */
export function parseProject(input: unknown) {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (o.width === undefined || o.height === undefined) {
      const scenes = o.scenes as Array<Record<string, unknown>> | undefined;
      const first = scenes?.[0];
      if (first) {
        if (o.width === undefined && typeof first.width === "number") o.width = first.width;
        if (o.height === undefined && typeof first.height === "number") o.height = first.height;
      }
    }
  }
  return ProjectSchema.parse(input);
}
