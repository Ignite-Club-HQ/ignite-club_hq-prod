import { defineConfig } from "vite";
import path from "path";

/**
 * Build config for the isolated iOS OS resume harness (WKWebView).
 *
 * Isolation rules enforced here (and re-checked by `verify-safety.mjs`):
 *  - `@/lib/supabaseAuthRetry` is aliased to a local stub so no Supabase
 *    client, URL or key is ever bundled.
 *  - `VITE_SUPABASE_*` is compiled out as `undefined`, disabling the
 *    adapter's network probe.
 *  - Output goes to `tests/ios-os/workspace/www`, the webDir of the
 *    disposable Capacitor project. It is never used by the real app.
 */
export default defineConfig({
  root: __dirname,
  base: "./",
  envPrefix: "IOSTEST_",
  define: {
    "import.meta.env.VITE_SUPABASE_URL": "undefined",
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": "undefined",
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": "undefined",
  },
  resolve: {
    alias: [
      {
        find: /^@\/lib\/supabaseAuthRetry$/,
        replacement: path.resolve(__dirname, "supabaseAuthRetryStub.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "../../src") },
    ],
  },
  build: {
    outDir: path.resolve(__dirname, "workspace/www"),
    emptyOutDir: true,
    target: "es2019",
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
    },
  },
});
