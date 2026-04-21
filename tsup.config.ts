import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/cli.ts", "src/commands/tui.tsx"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  splitting: false,
  shims: false,
  // Ink/React are only loaded by `codep tui` via dynamic import. Keep them
  // external so the main bundle stays small and the TUI deps are resolved
  // from node_modules at runtime.
  external: ["ink", "ink-spinner", "ink-text-input", "react"],
  define: {
    __CODEP_VERSION__: JSON.stringify(pkg.version),
  },
});
