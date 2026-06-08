import type { z } from "zod";
import type {
  ActionSchema,
  ActionTypeSchema,
  BindingSchema,
  DataSourceDefSchema,
  DataSourceKindSchema,
  ElementShape,
  ElementTypeSchema,
  InteractionSchema,
  ProjectSchema,
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
export type DataSourceKind = z.infer<typeof DataSourceKindSchema>;

export type Action = z.infer<typeof ActionSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type Binding = z.infer<typeof BindingSchema>;
export type Element = ElementShape;
export type Scene = z.infer<typeof SceneSchema>;
export type DataSourceDef = z.infer<typeof DataSourceDefSchema>;
export type Project = z.infer<typeof ProjectSchema>;
