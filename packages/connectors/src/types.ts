/**
 * Connector framework. A connector turns an external data source (REST, MQTT,
 * serial, …) into a stream of values, emitted to the host. Connectors run in
 * the Electron main process (Node), where serial/MQTT/etc. are available.
 *
 * This package is intentionally dependency-free and Node-agnostic at the type
 * level so the same shape works for every connector kind.
 */

/** A value produced by a connector for a given data source. */
export interface ConnectorValue {
  sourceId: string;
  value: unknown;
  at: number; // epoch ms
}

/** Callback the host passes in; the connector calls it whenever it has a value. */
export type EmitFn = (value: ConnectorValue) => void;

/** A live connector instance for one data source. */
export interface Connector {
  /** Begin producing values. Called once. */
  start(): void | Promise<void>;
  /** Stop and release resources. Called once; must be idempotent. */
  stop(): void | Promise<void>;
}

/** Per-source definition the host hands to a factory (mirrors the model's DataSourceDef). */
export interface SourceSpec {
  id: string;
  kind: string;
  config: Record<string, unknown>;
}

/** Builds a Connector for a source, wired to emit into `emit`. */
export type ConnectorFactory = (spec: SourceSpec, emit: EmitFn) => Connector;
