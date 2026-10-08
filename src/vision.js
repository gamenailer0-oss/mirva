// Seeing people: where a body is in a picture. Used for three things:
//  1. cutting the catalogue model's face out of a garment reference, so a Model shot keeps the shopper's own face;
//  2. checking someone is actually in the mirror before any paid call;
//  3. pausing a live look when the shopper walks away.
// Everything runs in the browser. No picture leaves the device for this.

let detector = null;
let loading = null;
let broken = false;

async function load() {
  if (detector || broken) return detector;
  loading ??= (async () => {
    try {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const files = await FilesetResolver.forVisionTasks("/dist/mp");
      const make = (delegate) =>
        PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: "/models/pose_landmarker_lite.task", delegate },
          runningMode: "IMAGE",
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
        });
      try {
        detector = await make("GPU");
      } catch {
        detector = await make("CPU");
      }
      prime(detector);
    } catch (e) {
      console.warn("Pose detection is unavailable; MIRVA carries on without it.", e);
      broken = true;
    }
    return detector;
  })();
  return loading;
}

// The very first look compiles the model for the graphics chip, and the page cannot do anything
// else while it does: measured at 4 to 7 seconds. Take that on a blank picture, once, up front,
// so it never lands on a live camera.
function prime(d) {
  try {
    const blank = document.createElement("canvas");
    blank.width = blank.height = 256;
    d.detect(blank);
  } catch {}
}

export const warmUp = () => void load();

/** Resolves when the detector has loaded and taken its first look, or has given up. Never rejects. */
export const ready = () => load().then(() => undefined, () => undefined);

// Landmark numbers from MediaPipe's pose model.
const NOSE = 0, MOUTH_L = 9, MOUTH_R = 10, SHOULDER_L = 11, SHOULDER_R = 12, HIP_L = 23, HIP_R = 24;

/** Body landmarks for one image, video frame or canvas. Null when nobody is found. */
export async function body(source) {
  const d = await load();
  if (!d) return undefined; // undefined = cannot tell; null = looked and found nobody
  try {
    const out = d.detect(source);
    const lm = out.landmarks?.[0];
    if (!lm) return null;
    const seen = (i) => (lm[i].visibility ?? 1) > 0.5;
    return {
      noseY: lm[NOSE].y,
      mouthY: (lm[MOUTH_L].y + lm[MOUTH_R].y) / 2,
      shoulderY: (lm[SHOULDER_L].y + lm[SHOULDER_R].y) / 2,
      shoulderWidth: Math.abs(lm[SHOULDER_L].x - lm[SHOULDER_R].x),
      shoulders: seen(SHOULDER_L) && seen(SHOULDER_R),
      hips: seen(HIP_L) && seen(HIP_R),
    };
  } catch {
    return undefined;
  }
}

/**
 * A garment reference with no face in it: the store's photo cropped just under the chin.
 * The still-image engine copies a face it can see in the reference, so the face must go.
 */
export async function facelessReference(blob, { fallback = 0.2, maxSide = 900 } = {}) {
  const bmp = await createImageBitmap(blob);
  const b = await body(bmp);
  let cut = fallback;
  if (b && b.shoulderY > b.mouthY) cut = b.mouthY + (b.shoulderY - b.mouthY) * 0.55; // between chin and collarbone
  else if (b === null) cut = 0; // no person in it: a flat product shot, use it whole
  cut = Math.min(0.45, Math.max(0, cut));
  const sy = Math.round(bmp.height * cut);
  const sh = bmp.height - sy;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, sy, bmp.width, sh, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("Could not prepare the garment picture."))), "image/jpeg", 0.9),
  );
}

/** How the shopper is standing in the mirror, in words the glass can show. */
export async function framing(source) {
  const b = await body(source);
  if (b === undefined) return { known: false, present: true };
  if (b === null) return { known: true, present: false, hint: "Step into the mirror so I can see you." };
  if (!b.shoulders) return { known: true, present: true, ok: false, hint: "A little further back, so I can see your shoulders." };
  if (b.shoulderWidth > 0.62) return { known: true, present: true, ok: false, hint: "A step back and I'll see more of the outfit." };
  if (b.noseY < 0.04) return { known: true, present: true, ok: false, hint: "Tilt the camera up a touch. Your head is at the edge." };
  return { known: true, present: true, ok: true, fullBody: b.hips };
}
