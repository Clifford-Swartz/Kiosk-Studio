import { useEffect, useRef, useState } from "react";
import { runAgentTurn, type ChatMessage } from "./ai/agentLoop.js";

/**
 * Dedicated AI chat panel (toggled from TopBar, not a sidebar tab — kept
 * separate so the canvas stays visible while the agent live-applies edits).
 * Conversation is ephemeral (renderer-only state): not part of ProjectSchema,
 * cleared on reload/project switch by virtue of just being component state.
 */
export function AiChatPanel({
  pauseCapture,
  resumeCapture,
}: {
  pauseCapture: () => void;
  resumeCapture: () => void;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.kiosk.hasAiKey().then(setHasKey);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  async function saveKey() {
    if (!keyInput.trim()) return;
    await window.kiosk.setAiKey(keyInput.trim());
    setKeyInput("");
    setHasKey(true);
    setEditingKey(false);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const { messages: updated, stoppedOnRoundCap } = await runAgentTurn(
        messages,
        text,
        pauseCapture,
        resumeCapture
      );
      setMessages(
        stoppedOnRoundCap
          ? [...updated, { role: "assistant", content: "(stopped after 15 tool-call rounds)" }]
          : updated
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={panel}>
      <div style={header}>
        <span>AI Assistant</span>
        {hasKey && !editingKey && (
          <button style={changeKeyBtn} onClick={() => setEditingKey(true)}>
            Change key
          </button>
        )}
      </div>

      {(hasKey === false || editingKey) && (
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Enter your API key to enable the assistant.
          </span>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-…"
            style={input_}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={sendBtn} onClick={saveKey}>Save key</button>
            {editingKey && (
              <button style={cancelBtn} onClick={() => { setEditingKey(false); setKeyInput(""); }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {hasKey && !editingKey && (
        <>
          <div ref={scrollRef} style={messageList}>
            {messages
              .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
              .map((m, i) => (
                <div
                  key={i}
                  style={{
                    ...bubble,
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    background: m.role === "user" ? "#3b5da5" : "#1d2430",
                  }}
                >
                  {m.content}
                </div>
              ))}
            {busy && <div style={{ ...bubble, alignSelf: "flex-start", opacity: 0.6 }}>…</div>}
          </div>

          <div style={inputRow}>
            <input
              style={{ ...input_, flex: 1 }}
              value={input}
              disabled={busy}
              placeholder="Describe what to build…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
            />
            <button style={sendBtn} disabled={busy} onClick={() => void send()}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: 320,
  flexShrink: 0,
  background: "#0e1218",
  borderLeft: "1px solid #1f2733",
};
const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 700,
  color: "#e2e8f0",
  borderBottom: "1px solid #1f2733",
  background: "#0b1016",
};
const changeKeyBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 400,
  cursor: "pointer",
  textDecoration: "underline",
};
const cancelBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#94a3b8",
  fontWeight: 600,
  fontSize: 13,
  padding: "6px 12px",
  cursor: "pointer",
};
const messageList: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
};
const bubble: React.CSSProperties = {
  maxWidth: "85%",
  padding: "8px 10px",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 13,
  whiteSpace: "pre-wrap",
};
const inputRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: 12,
  borderTop: "1px solid #1f2733",
};
const input_: React.CSSProperties = {
  background: "#161c26",
  border: "1px solid #232c3a",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "6px 10px",
};
const sendBtn: React.CSSProperties = {
  background: "#3b5da5",
  border: "1px solid #1a274b",
  borderRadius: 6,
  color: "#fff",
  fontWeight: 600,
  fontSize: 13,
  padding: "6px 12px",
  cursor: "pointer",
};
