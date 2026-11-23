/// <reference types="vite/client" />

interface Window {
  __swRegistration?: ServiceWorkerRegistration;
  __lovableEvents?: {
    track?: (event: string, properties?: Record<string, unknown>) => string | null;
  };
}
