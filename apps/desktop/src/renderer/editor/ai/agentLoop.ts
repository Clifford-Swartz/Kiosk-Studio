import { useEditor } from "../store.js";
import { AI_TOOLS, executeTool } from "./tools.js";

const MAX_ROUNDS = 15;
const SYSTEM_PROMPT =
  "You are an assistant embedded in Kiosk Studio, a visual editor for building " +
  "interactive kiosk experiences. You can inspect the current project (provided " +
  "below as JSON) and call tools to add/edit scenes and elements on the user's " +
  "behalf. A 'Project' has 'scenes'; each scene has 'elements' (rectangle, text, " +
  "image, video, audio, button, layer, collection). Element geometry is x/y/width/" +
  "height/rotation/opacity/zIndex; type-specific look (fill color, text, font size, " +
  "etc.) lives in 'props' and is edited via set_element_props. Always check an " +
  "element's type in the project JSON before setting props on it. Be concise in " +
  "your replies to the user.";

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

export interface AgentTurnResult {
  messages: ChatMessage[];
  stoppedOnRoundCap: boolean;
}

/**
 * Run one user turn through the agentic tool-call loop. The renderer (here)
 * drives the loop and executes tools against the Zustand store; the main
 * process is a dumb proxy that only forwards the raw chat-completions request
 * (see ai:chat in main/index.ts) so the API key never has to leave main.
 *
 * All of a turn's store mutations are captured as a single undo step: capture
 * is paused before the first tool call and resumed (forcing one snapshot)
 * after the loop ends, mirroring how Canvas already brackets drag operations.
 */
export async function runAgentTurn(
  history: ChatMessage[],
  userMessage: string,
  pauseCapture: () => void,
  resumeCapture: () => void
): Promise<AgentTurnResult> {
  const projectDump = JSON.stringify(useEditor.getState().project);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Current project JSON:\n${projectDump}` },
    ...history,
    { role: "user", content: userMessage },
  ];

  let pausedCapture = false;
  let stoppedOnRoundCap = false;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = (await window.kiosk.sendChat(messages, AI_TOOLS)) as {
        error?: string;
        choices?: Array<{ message: ChatMessage }>;
      };

      if (response.error) {
        messages.push({ role: "assistant", content: `(agent error: ${response.error})` });
        break;
      }

      const choice = response.choices?.[0]?.message;
      if (!choice) {
        messages.push({ role: "assistant", content: "(agent error: empty response)" });
        break;
      }

      messages.push(choice);

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // Plain assistant reply — turn is done.
        break;
      }

      if (!pausedCapture) {
        pauseCapture();
        pausedCapture = true;
      }

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // Malformed args from the model — let executeTool's caller (below)
          // see this as a tool error so it can retry with valid JSON.
        }
        const result = executeTool(call.function.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }

      if (round === MAX_ROUNDS - 1) {
        stoppedOnRoundCap = true;
      }
    }
  } finally {
    if (pausedCapture) resumeCapture();
  }

  // Drop the two leading system messages (project dump is re-sent fresh next
  // turn) — only the user/assistant/tool exchange is kept as visible history.
  return { messages: messages.slice(2), stoppedOnRoundCap };
}
