import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/** Writes sw-manifest.json: every built app file, so the service worker can keep the whole app for offline use. */
function swManifest(): Plugin {
  return {
    name: "topout-sw-manifest",
    apply: "build",
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle)
        .filter(f => f.startsWith("assets/") && /\.(js|css|woff2?|svg|png)$/.test(f))
        .map(f => `/${f}`)
        .sort();
      const version = createHash("sha256").update(files.join("|")).digest("hex").slice(0, 16);
      this.emitFile({ type: "asset", fileName: "sw-manifest.json", source: JSON.stringify({ version, files }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), swManifest()],
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: { strict: true, deny: ["**/.*"] },
  },
});
