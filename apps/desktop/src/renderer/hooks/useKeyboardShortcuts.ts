import { useEffect, useRef } from "react";

export interface ShortcutConfig {
  action: (e: KeyboardEvent) => void;
  description?: string;
  enabled?: () => boolean;
  preventDefault?: boolean;
  log?: boolean;
}

type ShortcutsMap = Record<string, ShortcutConfig>;

interface ParsedShortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

/**
 * Parse a shortcut string like "Mod+P" or "Delete" into its components.
 * "Mod" is a cross-platform alias for Ctrl (Windows/Linux) or Cmd (Mac).
 */
function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split("+").map((p) => p.trim().toLowerCase());
  const parsed: ParsedShortcut = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: "",
  };

  for (const part of parts) {
    if (part === "mod" || part === "ctrl" || part === "control") {
      parsed.ctrl = true;
    } else if (part === "alt" || part === "option") {
      parsed.alt = true;
    } else if (part === "shift") {
      parsed.shift = true;
    } else if (part === "meta" || part === "cmd" || part === "command") {
      parsed.meta = true;
    } else {
      parsed.key = part;
    }
  }

  return parsed;
}

/**
 * Check if a keyboard event matches a parsed shortcut.
 * Handles cross-platform: "Mod" matches Ctrl on Windows/Linux, Cmd on Mac.
 */
function matchesShortcut(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const key = e.key.toLowerCase();

  // Handle "Mod" alias: on Mac it's metaKey (Cmd), on Windows/Linux it's ctrlKey
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modPressed = isMac ? e.metaKey : e.ctrlKey;

  // For shortcuts with "Mod" (parsed.ctrl = true from "Mod"), check the platform-specific modifier
  const ctrlMatch = parsed.ctrl ? modPressed : !e.ctrlKey && !e.metaKey;
  const altMatch = parsed.alt ? e.altKey : !e.altKey;
  const shiftMatch = parsed.shift ? e.shiftKey : !e.shiftKey;

  return ctrlMatch && altMatch && shiftMatch && key === parsed.key;
}

/**
 * Check if the event target is a text input where typing is expected.
 * Don't trigger shortcuts when the user is typing in these elements.
 */
function isTypingInInput(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement;
  if (!target) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea") return true;
  if (target.contentEditable === "true") return true;

  return false;
}

/**
 * Unified keyboard shortcut hook.
 * Handles cross-platform shortcuts, key repeat prevention, input safety, and logging.
 *
 * Example:
 * ```ts
 * useKeyboardShortcuts({
 *   "Mod+P": {
 *     action: () => console.log("Preview"),
 *     description: "Preview mode",
 *     preventDefault: true,
 *     log: true
 *   },
 *   "Delete": {
 *     action: () => deleteItem(),
 *     enabled: () => !!selectedItem,
 *     description: "Delete selected",
 *     preventDefault: true,
 *     log: true
 *   }
 * });
 * ```
 */
export function useKeyboardShortcuts(shortcuts: ShortcutsMap): void {
  // Parse all shortcuts once
  const parsedShortcuts = useRef<Map<string, { parsed: ParsedShortcut; config: ShortcutConfig }>>(
    new Map()
  );

  // Update parsed shortcuts when the shortcuts object changes
  useEffect(() => {
    parsedShortcuts.current.clear();
    for (const [key, config] of Object.entries(shortcuts)) {
      parsedShortcuts.current.set(key, {
        parsed: parseShortcut(key),
        config,
      });
    }
  }, [shortcuts]);

  // Store shortcuts in refs to avoid stale closures
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    const pressedKeys = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // Prevent repeat events
      if (pressedKeys.has(key)) return;

      // Don't trigger shortcuts when typing in inputs
      if (isTypingInInput(e)) return;

      // Check each registered shortcut
      for (const [shortcutKey, { parsed, config }] of parsedShortcuts.current.entries()) {
        if (matchesShortcut(e, parsed)) {
          // Check if shortcut is enabled (if enabled callback provided)
          if (config.enabled && !config.enabled()) {
            continue;
          }

          // Prevent default browser behavior if requested
          if (config.preventDefault) {
            e.preventDefault();
          }

          // Log if requested
          if (config.log) {
            const desc = config.description || "Shortcut";
            console.log(`[Shortcut] ${desc} (${shortcutKey})`);
          }

          // Mark key as pressed (for repeat prevention)
          pressedKeys.add(key);

          // Execute the action
          config.action(e);

          // Only match one shortcut per keydown
          break;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      pressedKeys.delete(e.key.toLowerCase());
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);
}
