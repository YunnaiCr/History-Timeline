// Build M0 preview with plain tsc (no bundler): the sandbox forbids spawning child processes,
// so esbuild/vite cannot run here. Real development should use `npm run dev` (vite).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const r = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.dev.json"], {
  stdio: "inherit",
});
if (r.status !== 0 && r.status !== null) process.exit(r.status);

mkdirSync("dist-src", { recursive: true });
copyFileSync("src/styles.css", "dist-src/styles.css");

// Browser ESM needs explicit file extensions; tsc leaves them off for bundler-style imports.
function addJsExtension(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) addJsExtension(p);
    else if (entry.name.endsWith(".js")) {
      const src = readFileSync(p, "utf8");
      const out = src.replace(/from "(\.[^"]*?)"/g, 'from "$1.js"');
      if (out !== src) writeFileSync(p, out);
    }
  }
}
addJsExtension("dist-src");

console.log("built -> dist-src/");
