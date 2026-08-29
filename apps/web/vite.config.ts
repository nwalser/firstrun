import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { defineConfig } from "vite";
import viteSolid from "vite-plugin-solid";

/**
 * Order matters and is enforced: Start's router plugin has to see the modules
 * before Solid's JSX transform does. Swapping these fails the build with an
 * explicit "plugin order error", which is at least a kind message.
 */
export default defineConfig({
  plugins: [tanstackStart(), viteSolid({ ssr: true })],
  server: { port: 3000 },
  // The workspace packages ship TypeScript source and are imported directly.
  ssr: { noExternal: [/^@firstrun\//] },
});
