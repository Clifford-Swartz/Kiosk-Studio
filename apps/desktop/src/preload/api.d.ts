import type { KioskApi } from "./index.js";

declare global {
  interface Window {
    kiosk: KioskApi;
  }
}

export {};
