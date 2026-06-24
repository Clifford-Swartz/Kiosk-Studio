export type TransitionFn = (
  params: {
    containerEl: HTMLElement;
    outgoingEl: HTMLElement;
    incomingEl: HTMLElement;
    direction?: "up" | "down" | "left" | "right";
    duration: number;
    elementsOnly: boolean;
    width: number;
    height: number;
  }
) => Promise<void>;

const registry = new Map<string, TransitionFn>();

export function registerTransition(type: string, fn: TransitionFn): void {
  registry.set(type, fn);
}

export function getTransition(type: string): TransitionFn | undefined {
  return registry.get(type);
}

// ---------------------------------------------------------------------------
// Built-in transitions
// ---------------------------------------------------------------------------

registerTransition("fade", async ({ outgoingEl, incomingEl, duration, elementsOnly }) => {
  if (elementsOnly) {
    // Query for element wrappers
    const outgoingElements = outgoingEl.querySelector<HTMLElement>('.scene-elements');
    const incomingElements = incomingEl.querySelector<HTMLElement>('.scene-elements');

    if (!outgoingElements || !incomingElements) {
      console.warn('[fade] elementsOnly requires .scene-elements wrapper, falling back');
      // Fall through to standard animation below
    } else {
      // ===== INITIAL STATE =====
      // Set incoming wrapper opacity to 0 before any visibility changes
      incomingElements.style.opacity = "0";
      incomingElements.style.transition = "none";
      // Keep incoming container hidden initially so outgoing is visible
      incomingEl.style.display = "none";

      // Force layout
      void incomingElements.offsetHeight;

      // ===== PHASE 1: Fade out outgoing elements =====
      outgoingElements.style.transition = `opacity ${duration}ms ease-in-out`;
      outgoingElements.style.opacity = "0";

      await sleep(duration);

      // ===== MIDPOINT: Swap container visibility =====
      // All elements invisible - swap backgrounds imperceptibly
      outgoingEl.style.display = "none";
      incomingEl.style.display = "block";

      // Force layout after display swap
      void incomingEl.offsetHeight;

      // ===== PHASE 2: Fade in incoming elements =====
      incomingElements.style.transition = `opacity ${duration}ms ease-in-out`;
      incomingElements.style.opacity = "1";

      await sleep(duration);

      // ===== CLEANUP =====
      // Reset styles on wrappers only. Leave outgoingEl.display="none" to prevent
      // flicker between cleanup and React unmount (the Player removes the outgoing
      // scene after transition completes).
      incomingEl.style.transition = "";
      incomingEl.style.opacity = "";
      outgoingElements.style.transition = "";
      outgoingElements.style.opacity = "";
      incomingElements.style.transition = "";
      incomingElements.style.opacity = "";

      return; // Exit early, skip standard animation
    }
  }

  // ===== STANDARD ANIMATION (elementsOnly=false) =====
  // Existing code unchanged - animate entire containers
  incomingEl.style.opacity = "0";
  incomingEl.style.transition = "none";

  // Force layout
  void incomingEl.offsetHeight;

  // Fade out outgoing
  outgoingEl.style.transition = `opacity ${duration}ms ease-in-out`;
  outgoingEl.style.opacity = "0";

  await sleep(duration);

  // Swap visibility
  outgoingEl.style.display = "none";
  incomingEl.style.display = "block";

  // Fade in incoming
  incomingEl.style.transition = `opacity ${duration}ms ease-in-out`;
  incomingEl.style.opacity = "1";

  await sleep(duration);

  // Cleanup (preserve background styles)
  // Leave outgoingEl.display="none" to prevent flicker between cleanup and React
  // unmount (the Player removes the outgoing scene after transition completes).
  outgoingEl.style.transition = "";
  outgoingEl.style.transform = "";
  outgoingEl.style.opacity = "";
  incomingEl.style.transition = "";
  incomingEl.style.transform = "";
  incomingEl.style.opacity = "";
});

registerTransition("slide", async ({ outgoingEl, incomingEl, direction = "left", duration, width, height }) => {
  // Use intrinsic project dimensions (not scaled getBoundingClientRect)
  const axis = direction === "up" || direction === "down" ? "Y" : "X";
  const sign = direction === "left" || direction === "up" ? 1 : -1;
  const distance = axis === "X" ? width : height;

  // Position incoming offscreen
  incomingEl.style.transform = `translate${axis}(${sign * distance}px)`;
  incomingEl.style.transition = "none";
  incomingEl.style.display = "block";

  void incomingEl.offsetHeight;

  // Slide outgoing out, incoming in
  outgoingEl.style.transition = `transform ${duration}ms ease-in-out`;
  incomingEl.style.transition = `transform ${duration}ms ease-in-out`;
  outgoingEl.style.transform = `translate${axis}(${-sign * distance}px)`;
  incomingEl.style.transform = `translate${axis}(0)`;

  await sleep(duration);

  // Cleanup (preserve background styles)
  outgoingEl.style.display = "none";
  outgoingEl.style.transition = "";
  outgoingEl.style.transform = "";
  incomingEl.style.transition = "";
  incomingEl.style.transform = "";
});

registerTransition("push", async ({ outgoingEl, incomingEl, direction = "left", duration, width, height }) => {
  // Use intrinsic project dimensions (not scaled getBoundingClientRect)
  const axis = direction === "up" || direction === "down" ? "Y" : "X";
  const sign = direction === "left" || direction === "up" ? 1 : -1;
  const distance = axis === "X" ? width : height;

  // Position incoming offscreen (use transform only, don't touch position/size)
  incomingEl.style.transform = `translate${axis}(${sign * distance}px)`;
  incomingEl.style.transition = "none";
  incomingEl.style.display = "block";

  void incomingEl.offsetHeight;

  // Push both scenes in the same direction
  outgoingEl.style.transition = `transform ${duration}ms ease-in-out`;
  incomingEl.style.transition = `transform ${duration}ms ease-in-out`;
  outgoingEl.style.transform = `translate${axis}(${-sign * distance}px)`;
  incomingEl.style.transform = `translate${axis}(0)`;

  await sleep(duration);

  // Cleanup (preserve background styles)
  outgoingEl.style.display = "none";
  outgoingEl.style.transition = "";
  outgoingEl.style.transform = "";
  incomingEl.style.transition = "";
  incomingEl.style.transform = "";
});

registerTransition("zoom", async ({ outgoingEl, incomingEl, duration, elementsOnly }) => {
  if (elementsOnly) {
    // Query for element wrappers
    const outgoingElements = outgoingEl.querySelector<HTMLElement>('.scene-elements');
    const incomingElements = incomingEl.querySelector<HTMLElement>('.scene-elements');

    if (!outgoingElements || !incomingElements) {
      console.warn('[zoom] elementsOnly requires .scene-elements wrapper, falling back');
      // Fall through to standard animation
    } else {
      // ===== INITIAL STATE =====
      incomingElements.style.transform = "scale(0.8)";
      incomingElements.style.opacity = "0";
      incomingElements.style.transition = "none";
      // Keep incoming container hidden initially so outgoing is visible
      incomingEl.style.display = "none";

      void incomingElements.offsetHeight;

      // ===== PHASE 1: Zoom out + fade out outgoing elements =====
      outgoingElements.style.transition = `transform ${duration}ms ease-in-out, opacity ${duration}ms ease-in-out`;
      outgoingElements.style.transform = "scale(1.2)";
      outgoingElements.style.opacity = "0";

      await sleep(duration);

      // ===== MIDPOINT: Swap container visibility =====
      outgoingEl.style.display = "none";
      incomingEl.style.display = "block";

      // Force layout after display swap
      void incomingEl.offsetHeight;

      // ===== PHASE 2: Zoom in + fade in incoming elements =====
      incomingElements.style.transition = `transform ${duration}ms ease-in-out, opacity ${duration}ms ease-in-out`;
      incomingElements.style.transform = "scale(1)";
      incomingElements.style.opacity = "1";

      await sleep(duration);

      // ===== CLEANUP =====
      // Reset styles on wrappers only. Leave outgoingEl.display="none" to prevent
      // flicker between cleanup and React unmount (the Player removes the outgoing
      // scene after transition completes).
      incomingEl.style.transition = "";
      incomingEl.style.opacity = "";
      outgoingElements.style.transition = "";
      outgoingElements.style.transform = "";
      outgoingElements.style.opacity = "";
      incomingElements.style.transition = "";
      incomingElements.style.transform = "";
      incomingElements.style.opacity = "";

      return;
    }
  }

  // ===== STANDARD ANIMATION (existing code unchanged) =====
  incomingEl.style.transform = "scale(0.8)";
  incomingEl.style.opacity = "0";
  incomingEl.style.transition = "none";

  void incomingEl.offsetHeight;

  // Zoom out + fade out outgoing
  outgoingEl.style.transition = `transform ${duration}ms ease-in-out, opacity ${duration}ms ease-in-out`;
  outgoingEl.style.transform = "scale(1.2)";
  outgoingEl.style.opacity = "0";

  await sleep(duration);

  // Swap visibility
  outgoingEl.style.display = "none";
  incomingEl.style.display = "block";

  // Zoom in + fade in incoming
  incomingEl.style.transition = `transform ${duration}ms ease-in-out, opacity ${duration}ms ease-in-out`;
  incomingEl.style.transform = "scale(1)";
  incomingEl.style.opacity = "1";

  await sleep(duration);

  // Cleanup (preserve background styles)
  outgoingEl.style.transition = "";
  outgoingEl.style.transform = "";
  outgoingEl.style.opacity = "";
  incomingEl.style.transition = "";
  incomingEl.style.transform = "";
  incomingEl.style.opacity = "";
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
