import type { z } from "zod";
import type {
  ActionSchema,
  ActionTypeSchema,
  BindingSchema,
  CsvConnectorDefSchema,
  ConsoleConnectorDefSchema,
  DataConnectorDefSchema,
  ElementShape,
  ElementTypeSchema,
  EventKindSchema,
  InteractionSchema,
  JsonConnectorDefSchema,
  JsonlConnectorDefSchema,
  LayerMaskSchema,
  ProjectSchema,
  RestConnectorDefSchema,
  SceneSchema,
  TriggerKindSchema,
} from "./schema.js";

/**
 * Compile-time types derived from the Zod schemas. Importing types from here
 * (rather than redeclaring interfaces) guarantees they match what the
 * validator accepts at runtime.
 */

export type ElementType = z.infer<typeof ElementTypeSchema>;
export type TriggerKind = z.infer<typeof TriggerKindSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type EventKind = z.infer<typeof EventKindSchema>;

export type Action = z.infer<typeof ActionSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type Binding = z.infer<typeof BindingSchema>;
export type LayerMask = z.infer<typeof LayerMaskSchema>;
export type Element = ElementShape;
export type Scene = z.infer<typeof SceneSchema>;

// Data connector types (schemaVersion 2)
export type RestConnectorDef = z.infer<typeof RestConnectorDefSchema>;
export type CsvConnectorDef = z.infer<typeof CsvConnectorDefSchema>;
export type JsonConnectorDef = z.infer<typeof JsonConnectorDefSchema>;
export type JsonlConnectorDef = z.infer<typeof JsonlConnectorDefSchema>;
export type ConsoleConnectorDef = z.infer<typeof ConsoleConnectorDefSchema>;
export type DataConnectorDef = z.infer<typeof DataConnectorDefSchema>;

// Type guards for discriminated union narrowing
export function isRestConnector(c: DataConnectorDef): c is RestConnectorDef {
  return c.kind === "rest";
}
export function isCsvConnector(c: DataConnectorDef): c is CsvConnectorDef {
  return c.kind === "csv";
}
export function isJsonConnector(c: DataConnectorDef): c is JsonConnectorDef {
  return c.kind === "json";
}
export function isJsonlConnector(c: DataConnectorDef): c is JsonlConnectorDef {
  return c.kind === "jsonl";
}
export function isConsoleConnector(c: DataConnectorDef): c is ConsoleConnectorDef {
  return c.kind === "console";
}

export type Project = z.infer<typeof ProjectSchema>;
