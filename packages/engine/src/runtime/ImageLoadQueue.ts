/**
 * ImageLoadQueue: Limits concurrent image downloads/decodes to prevent main thread blocking.
 *
 * Problem: 20 high-res images loading simultaneously causes 1-2s freeze during decode.
 * Solution: Queue images and load max 3 concurrently. Images show placeholder → swap to real when ready.
 *
 * Usage:
 *   const ready = imageLoadQueue.useImageReady(src);
 *   <img src={ready ? src : PLACEHOLDER} />
 */

import { useEffect, useSyncExternalStore } from "react";

type QueueItem = {
  src: string;
  priority: number; // Lower = higher priority (0 = critical, 1 = normal, 2 = low)
  callbacks: Set<() => void>;
};

class ImageLoadQueue {
  private queue: QueueItem[] = [];
  private loading = new Set<string>(); // Currently loading
  private ready = new Set<string>(); // Successfully loaded
  private failed = new Set<string>(); // Failed to load
  private maxConcurrent = 3; // Max simultaneous loads
  private listeners = new Set<() => void>();

  /**
   * Request an image to load. Returns true if already loaded, false if queued/loading.
   */
  request(src: string, priority: number = 1): boolean {
    if (!src) return true; // Empty src = no image = "ready"
    if (this.ready.has(src)) return true;
    if (this.failed.has(src)) return true; // Don't retry failed images

    // Already in queue or loading
    if (this.loading.has(src) || this.queue.some((item) => item.src === src)) {
      return false;
    }

    // Add to queue
    this.queue.push({ src, priority, callbacks: new Set() });
    this.queue.sort((a, b) => a.priority - b.priority); // Sort by priority
    this.processQueue();
    return false;
  }

  /**
   * Check if an image is ready (loaded or failed).
   */
  isReady(src: string): boolean {
    if (!src) return true;
    return this.ready.has(src) || this.failed.has(src);
  }

  /**
   * Subscribe to load state changes.
   */
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private processQueue() {
    // Load next items up to maxConcurrent
    while (this.loading.size < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.loadImage(item);
    }
  }

  private async loadImage(item: QueueItem) {
    const { src } = item;
    this.loading.add(src);

    try {
      // Use Image() constructor to preload
      const img = new Image();
      img.decoding = "async";

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load ${src}`));
        img.src = src;
      });

      // Mark ready and notify listeners
      this.ready.add(src);
      this.loading.delete(src);
      this.notifyListeners();

      // Process next in queue
      this.processQueue();
    } catch (err) {
      console.warn(`[ImageLoadQueue] Failed to load ${src}:`, err);
      this.failed.add(src);
      this.loading.delete(src);
      this.notifyListeners();
      this.processQueue();
    }
  }

  private notifyListeners() {
    this.listeners.forEach((cb) => cb());
  }

  /**
   * Clear all state (called when scene changes).
   */
  clear() {
    this.queue = [];
    this.loading.clear();
    this.ready.clear();
    this.failed.clear();
    this.notifyListeners();
  }

  /**
   * React hook: Returns true when image is ready to display.
   */
  useImageReady(src: string, priority: number = 1): boolean {
    // Subscribe to queue updates
    const isReady = useSyncExternalStore(
      (callback) => this.subscribe(callback),
      () => this.isReady(src),
      () => this.isReady(src) // Server-side: assume ready
    );

    // Request load on mount
    useEffect(() => {
      if (src) {
        this.request(src, priority);
      }
    }, [src, priority]);

    return isReady;
  }
}

// Singleton instance
export const imageLoadQueue = new ImageLoadQueue();
