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
  "audio",
  "button",
  "layer",
  "collection",
]);

export const TriggerKindSchema = z.enum([
  "tap",
  "press",
  "release",
  "enterScene",
  "dataChanged",
  "hover",
  "hoverEnd",
]);

export const ActionTypeSchema = z.enum([
  "goToScene",
  "goBack",
  "setProp",
  "toggle",
  "playMedia",
  "sendData",
  "animate",
  "setState",
  "togglePlayPause",
  "seekVideo",
  "setVolume",
  "setSpeed",
]);

// ---------------------------------------------------------------------------
// Data Connectors (bidirectional: input sources + output sinks)
// ---------------------------------------------------------------------------

/** Event kinds for analytics sink event filtering */
export const EventKindSchema = z.enum([
  "dataChanged",
  "dataError",
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
]);

/** REST connector (bidirectional: poll IN + POST OUT) */
export const RestConnectorDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("rest"),
  input: z
    .object({
      enabled: z.boolean().default(true),
      url: z.string(),
      intervalMs: z.number().min(250).default(5000),
    })
    .optional(),
  output: z
    .object({
      enabled: z.boolean().default(true),
      url: z.string(),
      events: z.array(EventKindSchema).default([]),
      batchSize: z.number().min(1).default(100),
    })
    .optional(),
});

/** CSV export connector (output only) */
export const CsvConnectorDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("csv"),
  output: z.object({
    enabled: z.boolean().default(true),
    path: z.string(),
    events: z.array(EventKindSchema).default([]),
    flushIntervalMs: z.number().min(1000).default(30000),
    maxBufferSize: z.number().min(1).default(1000),
    appendMode: z.boolean().default(true),
  }),
});

/** JSON export connector (output only) */
export const JsonConnectorDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("json"),
  output: z.object({
    enabled: z.boolean().default(true),
    path: z.string(),
    events: z.array(EventKindSchema).default([]),
    flushIntervalMs: z.number().min(1000).default(30000),
    maxBufferSize: z.number().min(1).default(1000),
  }),
});

/** JSONL export connector (output only) */
export const JsonlConnectorDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("jsonl"),
  output: z.object({
    enabled: z.boolean().default(true),
    path: z.string(),
    events: z.array(EventKindSchema).default([]),
    flushIntervalMs: z.number().min(1000).default(30000),
    maxBufferSize: z.number().min(1).default(1000),
    appendMode: z.boolean().default(true),
  }),
});

/** Console logging connector (output only, DevTools) */
export const ConsoleConnectorDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.literal("console"),
  output: z.object({
    enabled: z.boolean().default(true),
    events: z.array(EventKindSchema).default([]),
    format: z.enum(["table", "json", "compact"]).default("compact"),
    maxEvents: z.number().min(1).default(100),
  }),
});

/** Unified data connector (discriminated union) */
export const DataConnectorDefSchema = z.discriminatedUnion("kind", [
  RestConnectorDefSchema,
  CsvConnectorDefSchema,
  JsonConnectorDefSchema,
  JsonlConnectorDefSchema,
  ConsoleConnectorDefSchema,
]);

export const LayerTintSchema = z.object({
  color: z.string(),
  opacity: z.number().min(0).max(1),
});

export const LayerMaskSchema = z.object({
  type: z.enum(["rect", "polygon"]),
  points: z.array(z.tuple([z.number(), z.number()])),
});

export const TransitionTypeSchema = z.enum([
  "none",
  "fade",
  "slide",
  "push",
  "zoom",
]);

export const TransitionDirectionSchema = z.enum([
  "up",
  "down",
  "left",
  "right",
]);

export const TransitionSchema = z.object({
  type: TransitionTypeSchema.default("none"),
  direction: TransitionDirectionSchema.optional(),
  duration: z.number().min(0).max(5000).default(300),
  elementsOnly: z.boolean().default(false),
});

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
  tint?: z.infer<typeof LayerTintSchema>;
  mask?: z.infer<typeof LayerMaskSchema>;
  locked?: boolean;
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
  tint?: z.input<typeof LayerTintSchema>;
  mask?: z.input<typeof LayerMaskSchema>;
  locked?: boolean;
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
    tint: LayerTintSchema.optional(),
    mask: LayerMaskSchema.optional(),
    locked: z.boolean().default(false),
    children: z.array(ElementSchema).optional(),
  })
);

// ---------------------------------------------------------------------------
// Scene, data sources, project
// ---------------------------------------------------------------------------

/** Element overrides for a scene state */
export const StateElementOverrideSchema = z.object({
  visible: z.boolean().optional(),
  props: z.record(z.unknown()).optional(),
});

/** Named scene state (visibility + property overrides per element) */
export const SceneStateSchema = z.object({
  elements: z.record(StateElementOverrideSchema).default({}),
});

export const SceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Size is project-wide (see ProjectSchema.width/height). These remain optional
  // for back-compat with older project files; they are not used for rendering.
  width: z.number().optional(),
  height: z.number().optional(),
  background: z.string().default("#000000"),
  backgroundSize: z.enum(["cover", "contain", "fill"]).optional(),
  backgroundPosition: z.string().optional(),
  transition: TransitionSchema.optional(),
  elements: z.array(ElementSchema).default([]),
  /** Named scene states (visibility + property overrides). See ADR 0011. */
  states: z.record(SceneStateSchema).refine(
    (states) => !states || !("default" in states),
    { message: "State name 'default' is reserved" }
  ).optional(),
});

export const ProjectSchema = z.object({
  /** Schema version 3: layer system (replaces group, adds tint/mask/locked). */
  schemaVersion: z.literal(3).default(3),
  id: z.string(),
  name: z.string(),
  /** Canvas size for the whole project (one size for all scenes — a kiosk has one screen). */
  width: z.number().default(1920),
  height: z.number().default(1080),
  /** Id of the scene the Player opens first. Defaults to the first scene. */
  startSceneId: z.string().optional(),
  scenes: z.array(SceneSchema).min(1),
  /** Bidirectional data connectors (input sources + output sinks). */
  dataConnectors: z.array(DataConnectorDefSchema).default([]),
  /** Enable back button in Play/Kiosk mode (project-level navigation UI). */
  enableBackButton: z.boolean().default(false),
  /** Enable home button in Play/Kiosk mode (project-level navigation UI). */
  enableHomeButton: z.boolean().default(false),
  /** Export marker: true = bundled with assets in project assets/, false/undefined = working project referencing shared user-content/. */
  exported: z.boolean().optional(),
});

/**
 * Parse and validate an unknown value as a Project, applying defaults. Migrates
 * older files where size lived on the scene: if the project has no width/height,
 * adopt the first scene's size before validating.
 *
 * V1 → V2 migration: if schemaVersion is 1 or missing, upgrade to 2 and convert
 * dataSources → dataConnectors.
 *
 * V2 → V3 migration: upgrade to 3 and convert group → layer elements.
 */
export function parseProject(input: unknown) {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;

    // Migrate schemaVersion 1 → 2
    const version = o.schemaVersion as number | undefined;
    if (version === undefined || version === 1) {
      o.schemaVersion = 2;

      // V1 had dataSources (REST polling only), V2 has dataConnectors (bidirectional)
      // If old dataSources exist, convert to REST input connectors
      const oldSources = o.dataSources as Array<{ id: string; name: string; url: string; intervalMs: number }> | undefined;
      if (oldSources) {
        o.dataConnectors = oldSources.map((src) => ({
          id: src.id,
          name: src.name,
          kind: "rest",
          input: {
            enabled: true,
            url: src.url,
            intervalMs: src.intervalMs,
          },
        }));
        delete o.dataSources;
      }
    }

    // Migrate schemaVersion 2 → 3
    if (o.schemaVersion === 2) {
      o.schemaVersion = 3;

      // Convert group elements to layer elements recursively
      const scenes = o.scenes as Array<{ elements?: unknown[] }> | undefined;
      if (scenes) {
        for (const scene of scenes) {
          if (scene.elements) {
            scene.elements = migrateGroupsToLayers(scene.elements);
          }
        }
      }
    }

    // Adopt scene size if project has no width/height
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

/**
 * Recursively convert all type="group" elements to type="layer" with default
 * layer properties.
 */
function migrateGroupsToLayers(elements: unknown[]): unknown[] {
  return elements.map((el) => {
    if (el && typeof el === "object") {
      const element = el as Record<string, unknown>;

      // Convert group → layer
      if (element.type === "group") {
        element.type = "layer";
        // Add default layer properties if not present
        if (element.tint === undefined) element.tint = undefined;
        if (element.mask === undefined) element.mask = undefined;
        if (element.locked === undefined) element.locked = false;
      }

      // Recurse into children
      if (Array.isArray(element.children)) {
        element.children = migrateGroupsToLayers(element.children);
      }
    }
    return el;
  });
}
