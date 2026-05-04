/**
 * Main entry point for Squeezebox PWA
 */
import { AppShell } from "./components/app-shell";

// Register service worker for PWA support (production only — dev mode cannot
// execute a TypeScript source file directly as a service worker script)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./service-worker.js", { type: "module" })
    .catch((error) => {
      console.warn("Service Worker registration failed:", error);
    });
}

// Mount app shell
const app = document.getElementById("app");
if (app) {
  const appShell = new AppShell();
  app.appendChild(appShell);
}
