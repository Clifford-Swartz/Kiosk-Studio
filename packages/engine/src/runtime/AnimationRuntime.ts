import { ease, type EasingCurve } from "./easings.js";
import type { Element } from "../model/types.js";
import {
  type AnimatableProperty,
  type AnimatableValue,
  getCurrentValue,
  getDefaultValue,
  getFields,
  decomposeValue,
} from "./PropertyRegistry.js";

/**
 * Active tween state.
 */
interface ActiveTween {
  elementId: string;
  property: AnimatableProperty;
  from: AnimatableValue;
  to: AnimatableValue;
  startTime: number;
  duration: number;
  delay: number;
  easing: EasingCurve;
  onComplete?: () => void;
}

/**
 * A media scrub tween. Unlike ActiveTween, the target isn't an element schema
 * field resolved through the override pipeline — it's `HTMLVideoElement.currentTime`,
 * imperative DOM state reached via `applyMediaTime`. Kept as a separate map/type
 * because there's no schema field, no decompose/lerp-into-props step, and no
 * persist-to-overrides on completion (currentTime is itself persistent state).
 */
interface ActiveMediaScrub {
  elementId: string;
  from: number;
  to: number;
  startTime: number;
  duration: number;
  delay: number;
  easing: EasingCurve;
  onComplete?: () => void;
}

/**
 * Animation runtime manages property tweens triggered by interactions.
 * Applies as final layer in rendering pipeline (overrides bindings/states/setProp).
 *
 * Execution model:
 * - Interaction-triggered animations are blocking (await completion)
 * - Passive-triggered animations (enterScene, dataChanged) are non-blocking
 * - New tween on same element+property blocked until current completes
 * - Element visibility=false cancels running animations
 *
 * See ADR 0010.
 */
export class AnimationRuntime {
  private activeTweens: Map<string, ActiveTween> = new Map();
  private activeMediaScrubs: Map<string, ActiveMediaScrub> = new Map();
  private rafId: number | null = null;
  private currentOverrides: Map<string, Partial<Element>> = new Map();
  private elementLookup: ((elementId: string) => Element | null) | null = null;
  private elementResolverFn: ((element: Element) => Element) | null = null;
  private notifyChange: (() => void) | null = null;
  private persistToOverrides: ((elementId: string, property: AnimatableProperty, value: AnimatableValue) => void) | null = null;
  private applyMediaTime: ((elementId: string, time: number, force: boolean) => void) | null = null;

  /**
   * Start a new animation. Returns promise that resolves when animation completes.
   * If a tween on same element+property is already running, logs warning and returns
   * rejected promise (second tween blocked).
   */
  animate(
    elementId: string,
    property: AnimatableProperty,
    from: AnimatableValue | undefined,
    to: AnimatableValue,
    duration: number,
    easing: EasingCurve = "linear",
    delay = 0
  ): Promise<void> {
    const key = `${elementId}:${property}`;

    console.log(`[DEBUG-anim] AnimationRuntime.animate() called:`, {
      elementId,
      property,
      from,
      to,
      duration,
      easing,
      delay,
      key,
    });

    if (this.activeTweens.has(key)) {
      console.warn(`[DEBUG-anim] Tween on ${key} already running, new tween blocked`);
      return Promise.reject(new Error("Animation blocked: tween already running"));
    }

    return new Promise((resolve) => {
      const resolvedFrom = from ?? this.getElementValue(elementId, property);
      console.log(`[DEBUG-anim] Creating tween with resolved from value:`, {
        key,
        resolvedFrom,
        to,
      });

      const tween: ActiveTween = {
        elementId,
        property,
        from: resolvedFrom,
        to,
        startTime: performance.now(),
        duration,
        delay,
        easing,
        onComplete: () => {
          console.log(`[DEBUG-anim] Tween complete:`, { key });

          // Persist final value to interaction override store so it survives after animation clears
          if (this.persistToOverrides) {
            console.log(`[DEBUG-anim] Persisting final value to override store:`, { elementId, property, to });
            this.persistToOverrides(elementId, property, to);
          }

          this.activeTweens.delete(key);

          // Clear this element's animation overrides now that value is persisted
          const overrides = this.currentOverrides.get(elementId);
          if (overrides) {
            for (const field of getFields(property)) {
              delete overrides[field as keyof Element];
            }

            // Remove element entry if no more overrides
            if (Object.keys(overrides).length === 0) {
              this.currentOverrides.delete(elementId);
            }
          }

          this.updateOverrides();
          resolve();
        },
      };

      this.activeTweens.set(key, tween);
      console.log(`[DEBUG-anim] Tween added to activeTweens. Total active tweens:`, this.activeTweens.size);
      this.startLoop();
    });
  }

  /**
   * Scrub an `HTMLVideoElement`'s `currentTime` between two points over `duration`,
   * driven by the same RAF loop as property tweens. Unlike `animate()`, there's no
   * schema field to write and nothing to persist on completion — `currentTime` is
   * itself persistent DOM state on the video element `applyMediaTime` reaches.
   * Also sidesteps Chromium's lack of negative `playbackRate` support: driving
   * `currentTime` frame-by-frame works in either direction with no special-casing.
   */
  scrubMedia(
    elementId: string,
    from: number,
    to: number,
    duration: number,
    easing: EasingCurve = "linear",
    delay = 0
  ): Promise<void> {
    if (this.activeMediaScrubs.has(elementId)) {
      console.warn(`[DEBUG-anim] Media scrub on ${elementId} already running, new scrub blocked`);
      return Promise.reject(new Error("Scrub blocked: media scrub already running"));
    }

    return new Promise((resolve) => {
      const scrub: ActiveMediaScrub = {
        elementId,
        from,
        to,
        startTime: performance.now(),
        duration,
        delay,
        easing,
        onComplete: () => {
          this.activeMediaScrubs.delete(elementId);
          resolve();
        },
      };

      this.activeMediaScrubs.set(elementId, scrub);
      this.startLoop();
    });
  }

  /**
   * Cancel all animations on a specific element (called when visibility=false).
   */
  cancelElement(elementId: string): void {
    const keysToDelete: string[] = [];
    for (const [key, tween] of this.activeTweens.entries()) {
      if (tween.elementId === elementId) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.activeTweens.delete(key);
    }
    this.activeMediaScrubs.delete(elementId);
    if (keysToDelete.length > 0) {
      this.updateOverrides();
    }
  }

  /**
   * Cancel all animations (called on scene change).
   */
  cancelAll(): void {
    this.activeTweens.clear();
    this.activeMediaScrubs.clear();
    this.currentOverrides.clear();
    this.stopLoop();
  }

  /**
   * Get current animation overrides for rendering pipeline.
   */
  getOverrides(): Map<string, Partial<Element>> {
    return this.currentOverrides;
  }

  /**
   * Set element lookup function (called by Player to provide access to scene elements).
   */
  setElementLookup(lookup: ((elementId: string) => Element | null) | null): void {
    this.elementLookup = lookup;
  }

  /**
   * Set the resolver function (called by Player to provide ElementResolver's
   * resolveElement, so `from` values reflect bindings + state + overrides,
   * not just raw schema — see ADR 0010).
   */
  setElementResolver(resolver: ((element: Element) => Element) | null): void {
    this.elementResolverFn = resolver;
  }

  /**
   * Set change notification callback (called by ElementResolver to invalidate cache on animation updates).
   */
  setNotifyChange(callback: (() => void) | null): void {
    this.notifyChange = callback;
  }

  /**
   * Set persist callback (called by Player to write final animation values to interaction override store).
   */
  setPersistToOverrides(callback: ((elementId: string, property: AnimatableProperty, value: AnimatableValue) => void) | null): void {
    this.persistToOverrides = callback;
  }

  /**
   * Set the callback that writes a media scrub's interpolated time onto the
   * actual `HTMLVideoElement` (called by Player; reaches the video via its ref map).
   * `force` is true only for the final write of a scrub — the callback should
   * apply it unconditionally so the video always lands exactly on `to`, even
   * if a previous seek is still in flight (see `tick()`).
   */
  setApplyMediaTime(callback: ((elementId: string, time: number, force: boolean) => void) | null): void {
    this.applyMediaTime = callback;
  }

  /**
   * Get current rendered value for property (used when `from` is omitted).
   * Resolves the base schema element through `elementResolverFn` (bindings +
   * state + interaction overrides) so the animation starts from the value
   * actually on screen, not the raw schema default (ADR 0010).
   */
  private getElementValue(elementId: string, property: AnimatableProperty): AnimatableValue {
    const baseEl = this.elementLookup ? this.elementLookup(elementId) : null;

    if (baseEl) {
      const resolved = this.elementResolverFn ? this.elementResolverFn(baseEl) : baseEl;
      return getCurrentValue(resolved, property);
    }

    const overrides = this.currentOverrides.get(elementId);
    if (overrides) {
      return getCurrentValue(overrides, property);
    }

    return getDefaultValue(property);
  }

  private startLoop(): void {
    if (this.rafId !== null) {
      console.log(`[DEBUG-anim] startLoop(): RAF loop already running (rafId=${this.rafId})`);
      return;
    }
    console.log(`[DEBUG-anim] startLoop(): Starting RAF loop`);
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick = (now: number): void => {
    let hasActiveTweens = false;
    const completedTweens: ActiveTween[] = [];

    console.log(`[DEBUG-anim] tick(): Processing ${this.activeTweens.size} active tweens at t=${now.toFixed(2)}`);

    for (const tween of this.activeTweens.values()) {
      const elapsed = now - tween.startTime;
      const key = `${tween.elementId}:${tween.property}`;

      // Still in delay phase
      if (elapsed < tween.delay) {
        console.log(`[DEBUG-anim] tick(): ${key} still in delay phase (${elapsed.toFixed(2)}ms < ${tween.delay}ms)`);
        hasActiveTweens = true;
        continue;
      }

      const progress = Math.min(1, (elapsed - tween.delay) / tween.duration);
      const easedProgress = ease(tween.easing, progress);

      console.log(`[DEBUG-anim] tick(): ${key} progress=${(progress * 100).toFixed(1)}%, easedProgress=${easedProgress.toFixed(3)}`);

      // Update current value
      this.applyTween(tween, easedProgress);

      if (progress >= 1) {
        console.log(`[DEBUG-anim] tick(): ${key} completed`);
        completedTweens.push(tween);
      } else {
        hasActiveTweens = true;
      }
    }

    // Trigger React re-render with updated animation values
    // This must happen on EVERY tick, not just on completion
    this.updateOverrides();

    // Call completion callbacks
    for (const tween of completedTweens) {
      tween.onComplete?.();
    }

    let hasActiveScrubs = false;
    const completedScrubs: ActiveMediaScrub[] = [];

    for (const scrub of this.activeMediaScrubs.values()) {
      const elapsed = now - scrub.startTime;

      if (elapsed < scrub.delay) {
        hasActiveScrubs = true;
        continue;
      }

      const progress = Math.min(1, (elapsed - scrub.delay) / scrub.duration);
      const easedProgress = ease(scrub.easing, progress);

      // Below 1, let Player drop the write if a seek is still decoding (avoids
      // queuing seeks the decoder can't keep up with — see applyMediaTime doc).
      // At completion, force it so the video always lands exactly on `to`.
      this.applyMediaTime?.(scrub.elementId, lerp(scrub.from, scrub.to, easedProgress), progress >= 1);

      if (progress >= 1) {
        completedScrubs.push(scrub);
      } else {
        hasActiveScrubs = true;
      }
    }

    for (const scrub of completedScrubs) {
      scrub.onComplete?.();
    }

    if (hasActiveTweens || hasActiveScrubs) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      console.log(`[DEBUG-anim] tick(): No more active tweens, stopping loop`);
      this.stopLoop();
    }
  };

  private applyTween(tween: ActiveTween, progress: number): void {
    const { elementId, property, from, to } = tween;

    let overrides = this.currentOverrides.get(elementId);
    if (!overrides) {
      overrides = {};
      this.currentOverrides.set(elementId, overrides);
    }

    const fromDecomposed = decomposeValue(property, from);
    const toDecomposed = decomposeValue(property, to);

    for (const field of getFields(property)) {
      overrides[field as keyof Element] = lerp(
        fromDecomposed[field],
        toDecomposed[field],
        progress
      ) as any;
    }
  }

  private updateOverrides(): void {
    // Trigger React re-render by notifying ElementResolver to invalidate cache
    this.currentOverrides = new Map(this.currentOverrides);
    if (this.notifyChange) {
      this.notifyChange();
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
