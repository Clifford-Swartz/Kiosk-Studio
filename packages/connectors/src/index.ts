import type { ConnectorFactory } from "./types.js";
import { createRestConnector } from "./rest.js";

export * from "./types.js";
export { createRestConnector } from "./rest.js";

/**
 * Registry mapping a data-source `kind` to its connector factory. Add new
 * connectors (mqtt, serial, websocket, ble, file) here as they're built.
 */
export const CONNECTOR_FACTORIES: Record<string, ConnectorFactory> = {
  rest: createRestConnector,
};

export function getConnectorFactory(kind: string): ConnectorFactory | undefined {
  return CONNECTOR_FACTORIES[kind];
}
