# Event-Driven Data Architecture

Kiosk Studio needs bidirectional data flow: external sources stream data IN (sensors, APIs) to update kiosk displays, and user behavior streams OUT (analytics, telemetry) for export. We unified both flows through a central event bus where all system events (data changes, scene navigation, interactions, media playback) flow through one pipeline. Data connectors can now produce events (REST polls → dataChanged), consume events (analytics subscribes → CSV export), or both (REST bidirectional: poll IN + POST OUT).

## Context

**Before:** Two separate systems—
- **Inbound only:** REST connector in main process → IPC → BindingHost.setValue() → element updates
- **Outbound:** Proposed but unimplemented (handoff design existed: AnalyticsStore buffers events, exports CSV)

No shared abstraction. Adding MQTT input meant duplicating IPC plumbing. Adding REST output meant separate infrastructure. No way to react to kiosk events (user taps button → POST to external API).

## Decision

Central **EventBus** in renderer with these properties:

```typescript
type KioskEvent = {
  kind: EventKind           // "dataChanged" | "sceneEnter" | "elementTap" | ...
  timestamp: number         // epoch ms (EventBus adds if missing)
  sessionId: string         // current play session (EventBus injects)
  sceneId: string          // active scene (EventBus tracks, always present)
  payload: Record<string, unknown>  // kind-specific data
}
```

**Unified DataConnector schema** replaces separate DataSource (input) + AnalyticsSink (output):

```typescript
type DataConnectorDef = 
  | RestConnectorDef    // input (poll) + output (POST batches)
  | CsvConnectorDef     // output only (write file)
  | JsonConnectorDef    // output only
  | JsonlConnectorDef   // output only  
  | ConsoleConnectorDef // output only (DevTools logging)
```

Each connector can specify `input?: {...}` and/or `output?: {...}` config. REST connector bidirectional: polls URL for data IN, POSTs event batches OUT. CSV/console output-only.

**Breaking change:** Project schema bumped to `schemaVersion: 2`. Old `dataSources: DataSourceDef[]` field removed, replaced with `dataConnectors: DataConnectorDef[]`. No migration path—pre-0.5 projects must be manually recreated.

## Architecture

**Event flow:**

1. **Producers emit events:**
   - Player → `sessionStart`, `sceneEnter`, `sceneExit`
   - interactions.ts → `elementTap`, `elementHover`, `actionRun`
   - ElementRenderer → `videoPlay`, `videoPause`, `videoComplete`
   - REST connector (main) → IPC → `dataChanged`

2. **EventBus dispatches synchronously** (in-order, no queue)

3. **Consumers subscribe:**
   - BindingContext subscribes to `dataChanged` → updates `values` map → triggers React re-render
   - AnalyticsStore subscribes per sink config → buffers events → flushes to CSV/REST/console
   - Future: Custom interaction actions can emit events that trigger REST POST

**Process boundaries:**

- EventBus lives in **renderer** (singleton, lazy init on first import)
- Input connectors in **main** (need Node APIs for serial/MQTT) → emit via IPC bridge
- Output connectors in **renderer** (AnalyticsStore manages) → CSV writes via IPC, REST via fetch

**BindingContext migration:**

- Removed `BindingHost.setValue()` from public API (was connector-facing)
- BindingContext subscribes to EventBus `dataChanged` events internally
- Tests emit through EventBus instead of calling setValue directly

## Consequences

**Wins:**

- Add new input connector (MQTT) = emit `dataChanged` events, BindingContext works automatically
- Add new output format (S3 upload) = subscribe to event kinds, handle in flush
- Bidirectional connectors = REST polls sensors + POSTs analytics to same backend
- Unified debugging = console sink logs all events in DevTools during Play mode
- Future extensibility = custom actions can emit domain events ("checkoutComplete") that trigger external webhooks

**Costs:**

- **Breaking change** = schemaVersion bump, no backward compat
- IPC overhead = every event crosses process boundary (mitigated: only data events come from main, analytics batched)
- EventBus coupling = every feature now depends on events/ module
- Payload flexibility = TypeScript can't enforce `kind: "sceneEnter"` → `payload: { sceneId, sceneName }` shape (documented in comments, runtime trust)

**Migration required:**

- BindingContext: Subscribe to `dataChanged` instead of exposing setValue
- REST connector: Emit events through IPC `event:emit` channel (not `data:value`)
- liveSession.ts: Bridge IPC to EventBus instead of BindingHost
- Project files: Old v1 projects fail to load (schema validation rejects `dataSources` field)

## Alternatives Considered

**Option: Keep separate systems (BindingHost + AnalyticsStore)**

Would work but:
- Duplicate IPC plumbing for every new input connector
- No way to react to kiosk events from external systems (can't POST analytics to REST API)
- Miss optimization opportunities (e.g., throttle rapid sceneEnter events before export)

**Option: Async EventBus (queueMicrotask)**

Rejected—sync dispatch simpler, event order guaranteed, kiosk scale small (< 1000 events/min). Async adds complexity without measurable benefit.

**Option: Dual EventBus (main + renderer)**

Rejected—single bus in renderer sufficient. Main process connectors emit via IPC (existing pattern). Adding main-side bus means syncing two buses, unclear benefit.

**Option: Type-safe discriminated payloads**

Rejected—would require 20+ event type variants. Payload flexibility chosen (Option B from design session). Trust emitters, document expected shapes. Zod validation skipped (perf cost, no runtime errors observed).
