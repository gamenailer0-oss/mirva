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
    // Also an entry of its own, so scripts/prepare-refs.mjs can load it in a browser page.
    reference: join(ROOT, "src", "reference.js"),
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

// The model files come from Google's public MediaPipe bucket. Each is fetched once; if a download
// fails the build still succeeds and the feature that needs it switches itself off.
const BUCKET = "https://storage.googleapis.com/mediapipe-models";
const MODELS = [
  { file: "pose_landmarker_lite.task", url: `${BUCKET}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`, min: 1e6, what: "the pose model", off: "framing checks are off" },
  // Hair and skin, so a garment photo can be shown without the catalogue model in it.
  { file: "selfie_multiclass_256x256.tflite", url: `${BUCKET}/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`, min: 1e6, what: "the hair-and-skin model", off: "garment pictures are prepared with a deeper crop instead" },
  { file: "blaze_face_short_range.tflite", url: `${BUCKET}/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite`, min: 5e4, what: "the face detector", off: "garment pictures are not checked for a face" },
];
for (const m of MODELS) {
  const target = join(ROOT, "public", "models", m.file);
  if (existsSync(target) && (await stat(target)).size >= m.min) continue;
  try {
    await mkdir(dirname(target), { recursive: true });
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(String(res.status));
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
    console.log(`  fetched ${m.what}`);
  } catch (e) {
    console.warn(`  could not fetch ${m.what} (${e.message}). MIRVA still runs; ${m.off}.`);
  }
}

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
