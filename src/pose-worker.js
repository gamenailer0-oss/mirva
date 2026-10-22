// The pose model in a thread of its own (src/vision.js starts it). Getting the model ready for the graphics chip held
// the whole page still for seconds: measured 22 Oct 2026 at 6.9 s, thirteen seconds after the mirror opened, on a
// mid-range phone, while she was choosing a piece. Here the page never waits for it. Built as a classic script
// (scripts/build.mjs), since MediaPipe loads its WebAssembly with importScripts.
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

let detector = null;
const ready = (async () => {
  const files = await FilesetResolver.forVisionTasks("/dist/mp");
  const make = (delegate) =>
    PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: "/models/pose_landmarker_lite.task", delegate },
      runningMode: "IMAGE",
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
    });
  // The processor, not the graphics chip: from this thread the processor never holds the page, while the chip's warm-up
  // stalled the screen itself (panel moves lost up to 1.1 s in the first seconds, measured 23 Oct 2026). A look takes
  // well under a second here, and only a few are needed.
  try {
    detector = await make("CPU");
  } catch {
    detector = await make("GPU");
  }
  try {
    detector.detect(new ImageData(256, 256)); // the first look compiles the model: on a blank picture, once
  } catch {}
})();

ready.then(
  () => postMessage({ ready: true }),
  (e) => postMessage({ broken: String(e?.message || e) }),
);

onmessage = async ({ data: { id, image } }) => {
  try {
    await ready;
    const lm = detector.detect(image).landmarks?.[0];
    postMessage({ id, landmarks: lm ? lm.map(({ x, y, z, visibility }) => ({ x, y, z, visibility })) : null });
  } catch (e) {
    postMessage({ id, failed: String(e?.message || e) });
  } finally {
    image?.close?.();
  }
};
