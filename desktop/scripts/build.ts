/**
 * Bundle the React UI into desktop/dist with Bun's bundler (no Vite/webpack).
 *   bun run scripts/build.ts            one-shot production build
 *   bun run scripts/build.ts --watch    rebuild on change (used by `tauri dev`)
 *   bun run scripts/build.ts --serve    also serve dist/ on http://localhost:1420 with the mock backend
 */
import { copyFile, mkdir, rm, watch } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");
const watchMode = process.argv.includes("--watch");
const serve = process.argv.includes("--serve");

async function build(): Promise<boolean> {
  const t0 = performance.now();
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(root, "ui/main.tsx")],
    outdir: dist,
    naming: "app.[ext]",
    target: "browser",
    format: "esm",
    minify: !watchMode,
    sourcemap: watchMode ? "inline" : "none",
    define: { "process.env.NODE_ENV": JSON.stringify(watchMode ? "development" : "production") },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return false;
  }
  await copyFile(resolve(root, "ui/index.html"), resolve(dist, "index.html"));
  await copyFile(resolve(root, "ui/app.css"), resolve(dist, "app.css"));
  console.log(`ui built in ${Math.round(performance.now() - t0)}ms → ${dist}`);
  return true;
}

if (!(await build()) && !watchMode) process.exit(1);

if (serve) {
  Bun.serve({
    port: 1420,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const file = Bun.file(resolve(dist, path === "/" ? "index.html" : `.${path}`));
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    },
  });
  console.log("preview with mock data: http://localhost:1420");
}

if (watchMode) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dirs = [resolve(root, "ui"), resolve(root, "../src")];
  for (const dir of dirs) {
    void (async () => {
      for await (const _ of watch(dir, { recursive: true })) {
        clearTimeout(timer);
        timer = setTimeout(() => void build(), 150);
      }
    })();
  }
  console.log("watching ui/ and ../src/ …");
}
