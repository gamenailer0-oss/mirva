// Bundles the browser app into public/dist and puts the files the engines load at runtime beside it.
import { build, context } from "esbuild";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "dist");
const MODULES = join(ROOT, "node_modules");
const watch = process.argv.includes("--watch");

const options = {
  // One bundle per surface: the mirror, the shopper's site, the store's site, and the two desks.
  entryPoints: {
    app: join(ROOT, "src", "main.js"),
    site: join(ROOT, "src", "web", "site.js"),
    retail: join(ROOT, "src", "web", "retail.js"),
    desk: join(ROOT, "src", "web", "desk.js"),
  },
  outdir: OUT,
  bundle: true,
  // Split so the first paint only loads the interface. The try-on engine, the pose
  // model and the QR code each arrive when they are first needed.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: !watch,
  sourcemap: watch,
  logLevel: "info",
};

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, "chunks"), { recursive: true });
await mkdir(join(OUT, "mp"), { recursive: true });

// The Decart SDK starts a worker from a file that sits beside its own module. A bundler
// does not carry that file along, and without it the SDK swallows every outgoing video
// frame: the session connects, the clock runs, and no picture ever comes back.
const worker = join(MODULES, "@decartai", "sdk", "dist", "realtime", "browser", "frame-metadata-worker.js");
await copyFile(worker, join(OUT, "frame-metadata-worker.js"));
await copyFile(worker, join(OUT, "chunks", "frame-metadata-worker.js")); // the SDK lives in a chunk

// MediaPipe's pose detector runs as WebAssembly, fetched at runtime.
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"])
  await copyFile(join(MODULES, "@mediapipe", "tasks-vision", "wasm", f), join(OUT, "mp", f));

// Its model file comes from Google's public MediaPipe bucket. Fetched once.
const MODEL = join(ROOT, "public", "models", "pose_landmarker_lite.task");
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
if (!existsSync(MODEL) || (await stat(MODEL)).size < 1e6) {
  try {
    await mkdir(dirname(MODEL), { recursive: true });
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(String(res.status));
    await writeFile(MODEL, Buffer.from(await res.arrayBuffer()));
    console.log("  fetched the pose model");
  } catch (e) {
    console.warn(`  could not fetch the pose model (${e.message}). MIRVA still runs; framing checks are off.`);
  }
}

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
