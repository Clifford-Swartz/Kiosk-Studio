import { useEffect, useState } from "react";
import { Player, parseProject } from "@kiosk/engine";
import { EditorShell } from "./editor/EditorShell.js";
import { useEditor } from "./editor/store.js";
import { projectAssetBase } from "./editor/assets.js";
import { useLiveSession } from "./editor/liveSession.js";
import { KioskRuntime } from "./kiosk/KioskRuntime.js";
import { buildProjectFromDeck, type ParsedDeck } from "./editor/pptxImport.js";

type Mode = "editor" | "player" | "kiosk";

/**
 * App shell: owns the Editor⇄Player mode switch. The editor edits the project
 * in the Zustand store; Play previews that exact project via the real Player.
 * Save/Open round-trip through the engine's parseProject so the editor can only
 * ever write valid project files.
 */
export function App() {
  const [mode, setMode] = useState<Mode>("editor");
  const [launchedKiosk, setLaunchedKiosk] = useState(false); // started via --kiosk
  useLiveSession(); // start/stop connectors for the project's data sources
  const [loadError, setLoadError] = useState<string | null>(null);

  const project = useEditor((s) => s.project);
  const filePath = useEditor((s) => s.filePath);
  const loadProject = useEditor((s) => s.loadProject);
  const markSaved = useEditor((s) => s.markSaved);

  // Test hooks: expose live project + load/addImage actions for the Playwright
  // scripts (drive flows without native dialogs). Harmless in prod.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__kioskProject = project;
    w.__kioskState = () => useEditor.getState();
    w.__kioskTestLoad = (p: unknown, path: string) =>
      useEditor.getState().loadProject(p as never, path);
    w.__kioskTestAddImage = (src: string) => useEditor.getState().addImageElement(src);
    w.__kioskTestMarkSaved = (path: string) => useEditor.getState().markSaved(path);
    w.__kioskParse = (raw: unknown) => parseProject(raw);
    w.__kioskBuildDeck = async (deck: unknown) => {
      const built = await buildProjectFromDeck(deck as ParsedDeck);
      if (built) loadProject(parseProject(JSON.parse(JSON.stringify(built.project))), built.projectPath);
      return !!built;
    };
  }, [project, loadProject]);

  // On first run: if launched with --kiosk, load that project and go straight to
  // the fullscreen kiosk runtime. Otherwise load the bundled example into the
  // editor store.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await window.kiosk.getKioskInfo();
        const path = info.kiosk ? info.projectPath ?? undefined : undefined;
        const text = await window.kiosk.loadProject(path);
        const parsed = parseProject(JSON.parse(text));
        if (cancelled) return;

        // Restore placeholders for empty image sources
        for (const scene of parsed.scenes) {
          for (const element of scene.elements) {
            if (element.type === "image" && (!element.props.src || element.props.src === "")) {
              element.props.src = "__placeholder__";
            }
          }
        }

        loadProject(parsed, info.kiosk ? path ?? null : null);
        if (info.kiosk) {
          setLaunchedKiosk(true);
          setMode("kiosk");
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProject]);

  async function handleSave() {
    try {
      // Clone project and strip sentinel values before saving
      const normalized = JSON.parse(JSON.stringify(project));

      for (const scene of normalized.scenes) {
        for (const element of scene.elements) {
          if (element.type === "image" && element.props.src === "__placeholder__") {
            element.props.src = ""; // Save as empty, not sentinel
          }
        }
      }

      const text = JSON.stringify(normalized, null, 2);
      const path = await window.kiosk.saveProject(text, filePath ?? undefined);
      if (path) markSaved(path);
    } catch (err) {
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleOpen() {
    try {
      const path = await window.kiosk.pickProject();
      if (!path) return;
      const text = await window.kiosk.loadProject(path);
      const parsed = parseProject(JSON.parse(text));

      // After parseProject, restore placeholders for empty image sources
      for (const scene of parsed.scenes) {
        for (const element of scene.elements) {
          if (element.type === "image" && (!element.props.src || element.props.src === "")) {
            element.props.src = "__placeholder__";
          }
        }
      }

      loadProject(parsed, path);
    } catch (err) {
      window.alert(`Open failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleImportPptx() {
    try {
      const deck = await window.kiosk.importPptx();
      if (!deck) return;
      const built = await buildProjectFromDeck(deck as ParsedDeck);
      if (!built) return; // user canceled the save-location prompt
      loadProject(parseProject(JSON.parse(JSON.stringify(built.project))), built.projectPath);
    } catch (err) {
      window.alert(`PowerPoint import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleKiosk() {
    await window.kiosk.setFullscreen(true);
    setMode("kiosk");
  }

  async function exitKiosk() {
    // Stop all audio elements before exiting kiosk mode
    const audios = document.querySelectorAll("audio");
    audios.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });

    if (launchedKiosk) {
      // Launched via --kiosk: actually quit the kiosk.
      void window.kiosk.exitKiosk();
      return;
    }
    await window.kiosk.setFullscreen(false);
    setMode("editor");
  }

  if (loadError) return <Centered text={`Failed to load project:\n${loadError}`} error />;

  if (mode === "kiosk") {
    let validated;
    try {
      validated = parseProject(JSON.parse(JSON.stringify(project)));
    } catch (err) {
      return <Centered text={`Invalid project:\n${String(err)}`} error />;
    }
    return <KioskRuntime project={validated} filePath={filePath} onExit={exitKiosk} />;
  }

  if (mode === "player") {
    // Validate the in-memory project before handing it to the Player; this is
    // exactly the round-trip a saved file would go through.
    let validated;
    try {
      validated = parseProject(JSON.parse(JSON.stringify(project)));
    } catch (err) {
      return <Centered text={`Invalid project:\n${String(err)}`} error />;
    }

    const handleExitPlayer = () => {
      // Stop all audio elements before switching back to editor
      const audios = document.querySelectorAll("audio");
      audios.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
      setMode("editor");
    };

    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <Player project={validated} assetBaseUrl={projectAssetBase(filePath)} />
        <button onClick={handleExitPlayer} style={backToEditor}>
          ✕ Exit preview
        </button>
      </div>
    );
  }

  return (
    <EditorShell
      onPlay={() => setMode("player")}
      onKiosk={handleKiosk}
      onSave={handleSave}
      onOpen={handleOpen}
      onImportPptx={handleImportPptx}
    />
  );
}

const backToEditor: React.CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  zIndex: 9999,
  background: "rgba(15,23,42,0.85)",
  border: "1px solid #334155",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "8px 12px",
  cursor: "pointer",
};

function Centered({ text, error }: { text: string; error?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        whiteSpace: "pre-wrap",
        padding: 32,
        color: error ? "#f87171" : "#9ca3af",
        fontFamily: "system-ui, sans-serif",
        fontSize: 20,
        background: "#000",
      }}
    >
      {text}
    </div>
  );
}
