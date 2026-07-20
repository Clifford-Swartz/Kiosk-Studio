/**
 * Type declaration for window.kiosk API when engine is used in Electron context.
 * The actual implementation is provided by the Electron preload script.
 */
declare global {
  interface Window {
    kiosk?: {
      writeAnalytics?: (path: string, data: string, append: boolean) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

export {};
