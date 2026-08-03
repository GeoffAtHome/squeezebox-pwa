import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.squeezebox.pwa",
  appName: "Squeezebox PWA",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
