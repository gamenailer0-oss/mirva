// The mirror: camera in, a clean portrait frame out, and the live try-on session on top.
// Events: awake, state, picture, wearing, tick, idle, presence, link, queue, ended, fault, shape
import { framing, warmUp } from "./vision.js";

const SHAPES = { portrait: [720, 1280], landscape: [1280, 720] };
const IDLE_GRACE = 12; // seconds between "still there?" and ending the live look
const AWAY_SECONDS = 8; // a live look ends this long after the shopper leaves the frame
const WATCH_MS = 900; // how often the mirror checks who is in it

// The try-on engine is the heaviest part of the app. Load it when it is first wanted.
let sdk = null;
const engine = () => (sdk ??= import("@decartai/sdk"));

export class Mirror extends EventTarget {
  constructor({ cam, live, config }) {
    super();
    this.cam = cam;
    this.live = live;
    this.config = config;
    this.shape = "portrait";
    this.state = "asleep"; // asleep | awake | connecting | live
    this.enhance = false;
    this.fast = false;
    this.codec = null; // null = the engine's default (H.264); "vp8" or "vp9" to override
    this.rt = null;
    this.source = null;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.fps = 30;
    this.totalSeconds = 0;
    this.attempt = 0;
    this.queued = null;
    this.lastTouch = performance.now();
    this.lastSeen = performance.now();
    this.presence = { known: false, present: true };
    this.#size();
  }

  get awake() {
    return this.state !== "asleep";
  }
  get isLive() {
    return this.state === "live" || this.state === "connecting";
  }
  /** Start loading the engine before it is needed, so the first tap is quicker. */
  preload() {
    engine().catch(() => {});
    warmUp();
  }

  // ---- where the picture comes from -------------------------------------
  async cameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  async startCamera(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open a camera here.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
    });
    const el = document.createElement("video");
    el.srcObject = stream;
    el.muted = true;
    el.playsInline = true;
    await el.play();
    const track = stream.getVideoTracks()[0];
    // A camera that is unplugged or taken by another app ends its track; say so instead of freezing.
    track.addEventListener("ended", () => this.source?.stream === stream && this.#emit("fault", { message: "The camera stopped. Check it is still connected." }));
    this.deviceId = track.getSettings().deviceId || deviceId || null;
    this.#useSource({ kind: "camera", el, stream, flip: true });
  }

  async usePhoto(blob) {
    const el = await createImageBitmap(blob);
    this.#useSource({ kind: "photo", el, flip: false });
  }

  sourceInfo() {
    const s = this.source;
    if (!s) return null;
    return { kind: s.kind, width: s.el.videoWidth || s.el.width, height: s.el.videoHeight || s.el.height };
  }

  #useSource(source) {
    this.source?.stream?.getTracks().forEach((t) => t.stop());
    this.source = source;
    if (!this.out) {
      this.out = this.canvas.captureStream(30);
      this.cam.srcObject = this.out;
      this.cam.play().catch(() => {});
      this.#pump();
      this.watcher = setInterval(() => this.#watch(), WATCH_MS);
    }
    this.#draw();
    if (this.state === "asleep") this.#set("awake");
    this.#emit("awake", { kind: source.kind });
  }

  #size() {
    const [w, h] = SHAPES[this.shape];
    this.canvas.width = w;
    this.canvas.height = h;
  }

  // Tall like a mirror, or wide for a laptop on a desk. A live look has to restart to change shape.
  async setShape(shape) {
    if (!SHAPES[shape] || shape === this.shape) return;
    const wearing = this.wearingNow;
    if (this.isLive) this.stop("reshape");
    this.shape = shape;
    this.#size();
    this.#draw();
    this.#emit("shape", { shape, wearing });
  }

  // A timer, not requestAnimationFrame: animation frames slow to a crawl whenever the
  // window is not in front, and the try-on engine needs a steady feed.
  #pump() {
    clearInterval(this.pumpTimer);
    let last = performance.now();
    let late = 0;
    let ticks = 0;
    this.pumpTimer = setInterval(() => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      this.#draw();
      // A slow laptop cannot keep 30 frames a second. Step down rather than stutter.
      ticks++;
      if (gap > (1000 / this.fps) * 1.6) late++;
      if (ticks >= this.fps * 3) {
        if (late / ticks > 0.3 && this.fps > 18) {
          this.fps = this.fps === 30 ? 24 : 18;
          this.#pump();
        }
        ticks = late = 0;
      }
    }, 1000 / this.fps);
  }

  #draw = () => {
    const src = this.source;
    if (!src) return;
    const sw = src.el.videoWidth || src.el.width;
    const sh = src.el.videoHeight || src.el.height;
    const { width: W, height: H } = this.canvas;
    if (!sw || !sh) return;
    // Cover-crop the source into the frame, keeping the top of a photo (the face) in view.
    const scale = Math.max(W / sw, H / sh);
    const cw = W / scale;
    const ch = H / scale;
    const sx = (sw - cw) / 2;
    const sy = src.kind === "photo" ? Math.min((sh - ch) / 2, sh * 0.04) : (sh - ch) / 2;
    this.ctx.save();
    if (src.flip) {
      this.ctx.translate(W, 0);
      this.ctx.scale(-1, 1);
    }
    this.ctx.drawImage(src.el, sx, Math.max(0, sy), cw, ch, 0, 0, W, H);
    this.ctx.restore();
  };

  // Who is in the mirror. Costs nothing and runs on this device.
  async #watch() {
    if (!this.source || document.hidden || this.watching) return;
    this.watching = true;
    try {
      const f = await framing(this.canvas);
      const now = performance.now();
      if (!f.known || f.present) this.lastSeen = now;
      const changed = f.present !== this.presence.present || f.hint !== this.presence.hint || f.known !== this.presence.known;
      this.presence = f;
      if (changed) this.#emit("presence", f);
      if (this.state === "live" && f.known && !f.present && now - this.lastSeen > AWAY_SECONDS * 1000) this.stop("away");
    } finally {
      this.watching = false;
    }
  }

  /** The current frame as a JPEG, for the Model shot. */
  frameBlob(maxSide = 1024, quality = 0.92) {
    const { width, height } = this.canvas;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const c = document.createElement("canvas");
    c.width = Math.round(width * scale);
    c.height = Math.round(height * scale);
    c.getContext("2d").drawImage(this.canvas, 0, 0, c.width, c.height);
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("I couldn't take that picture."))), "image/jpeg", quality));
  }

  // ---- the live look ------------------------------------------------------
  touch() {
    this.lastTouch = performance.now();
    this.warned = false;
  }

  /** Put a garment on. Connects on first use, then swaps without reconnecting. */
  async wear(product, garment) {
    if (!this.out) throw new Error("The mirror is not on yet.");
    this.touch();
    const state = { prompt: product.prompt, image: garment, enhance: this.enhance };
    if (this.state === "connecting") {
      // A second tap while the first is still connecting: keep the one connection, wear the latest.
      this.queued = { product, state };
      return this.connecting;
    }
    if (this.rt && this.state === "live") {
      await this.rt.set(state);
    } else {
      this.connecting = this.#connect(state);
      await this.connecting;
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        await this.rt.set(q.state);
        product = q.product;
      }
    }
    this.wearingNow = product;
    this.#emit("wearing", { product });
  }

  async #connect(state) {
    this.#set("connecting");
    const attempt = ++this.attempt;
    const stale = () => attempt !== this.attempt;
    let feed = null;
    let rt = null;
    try {
      const [{ createDecartClient, models, createConsoleLogger }, res] = await Promise.all([engine(), fetch("/api/token", { method: "POST", headers: { "content-type": "application/json", ...this.auth() }, body: JSON.stringify({ brand: this.brandId }) })]);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.apiKey) throw new Error(body.error || "Could not start the live look.");
      if (stale()) throw new Error("cancelled");
      // The server may grant less than a full session: a member at home has a monthly allowance.
      this.grant = body.grant ?? null;
      this.cap = Math.min(this.config.sessionSeconds, Number(body.seconds) || this.config.sessionSeconds);

      // localStorage "mirva:debug" = "1" turns on the engine's own connection log.
      const debug = (() => {
        try {
          return localStorage.getItem("mirva:debug") === "1";
        } catch {
          return false;
        }
      })();
      const client = createDecartClient({ apiKey: body.apiKey, ...(debug ? { logger: createConsoleLogger("debug") } : {}) });
      // The engine gets its own copy of the track: the SDK ends the track it is given
      // when a session closes, which would otherwise switch off the mirror itself.
      feed = new MediaStream(this.out.getVideoTracks().map((t) => t.clone()));
      rt = await client.realtime.connect(feed, {
        model: models.realtime(this.config.model),
        mirror: false, // the frame is already flipped like a mirror
        ...(this.codec ? { preferredVideoCodec: this.codec } : {}),
        ...(this.fast ? { speed: "fast" } : {}),
        onRemoteStream: (stream) => {
          if (stale()) return;
          this.live.srcObject = stream;
          this.live.play().catch(() => {});
          this.#watchFirstFrame();
        },
        initialState: { prompt: { text: state.prompt, enhance: state.enhance }, image: state.image },
      });
      // Taken off while it was still connecting: close it at once so it cannot run unseen.
      if (stale()) throw new Error("cancelled");

      this.rt = rt;
      this.feed = feed;
      rt.on("connectionChange", (s) => {
        this.#emit("link", { state: s });
        if (s === "disconnected" && this.rt === rt) this.#finish("lost");
      });
      rt.on("error", (e) => this.#emit("fault", { message: e?.message || "The live look had a problem." }));
      rt.on("queuePosition", (q) => this.#emit("queue", q));
      this.startedAt = performance.now();
      this.lastSeen = this.startedAt;
      this.touch();
      this.clock = setInterval(() => this.#tick(), 250);
      this.#set("live");
    } catch (e) {
      try {
        rt?.disconnect();
      } catch {}
      feed?.getTracks().forEach((t) => t.stop());
      if (!stale()) this.#set(this.out ? "awake" : "asleep");
      throw e;
    }
  }

  // "playing" fires before the engine has drawn anything. Wait for a real frame.
  #watchFirstFrame() {
    // Polled on a timer: frame callbacks only run while the video is being painted, and the
    // "being made" sequence sits on top of it until this very signal arrives.
    const live = this.live;
    clearInterval(this.firstFrame);
    this.firstFrame = setInterval(() => {
      if (!this.rt && this.state !== "connecting") return clearInterval(this.firstFrame);
      if (live.videoWidth > 0 && live.readyState >= 2) {
        clearInterval(this.firstFrame);
        this.#emit("picture");
      }
    }, 120);
  }

  #tick() {
    const now = performance.now();
    const elapsed = (now - this.startedAt) / 1000;
    const cap = this.cap || this.config.sessionSeconds;
    const rate = this.config.ratePerSecond * (this.fast ? 2 : 1);
    this.#emit("tick", { elapsed, remaining: Math.max(0, cap - elapsed), cap, cost: elapsed * rate });
    if (elapsed >= cap - 0.4) return this.stop("cap");
    const idle = (now - this.lastTouch) / 1000;
    if (idle >= this.config.idleSeconds + IDLE_GRACE) return this.stop("idle");
    if (idle >= this.config.idleSeconds && !this.warned) {
      this.warned = true;
      this.#emit("idle", { grace: IDLE_GRACE });
    }
  }

  stop(reason = "user") {
    if (!this.rt && this.state !== "connecting") return;
    this.#finish(reason);
  }

  #finish(reason) {
    this.attempt++; // anything still connecting is now stale
    this.queued = null;
    clearInterval(this.clock);
    clearInterval(this.firstFrame);
    const rt = this.rt;
    this.rt = null;
    try {
      rt?.disconnect();
    } catch {}
    this.feed?.getTracks().forEach((t) => t.stop());
    this.feed = null;
    const elapsed = this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
    this.totalSeconds += elapsed;
    this.startedAt = 0;
    this.live.pause();
    this.live.srcObject = null;
    this.wearingNow = null;
    this.#set(this.out ? "awake" : "asleep");
    this.#emit("ended", { reason, elapsed, grant: this.grant, cost: elapsed * this.config.ratePerSecond * (this.fast ? 2 : 1) });
    this.grant = null;
  }

  /** A still of what is in the glass right now. */
  snapshot(width = 360) {
    const fromLive = this.state === "live" && this.live.videoWidth;
    const src = fromLive ? this.live : this.canvas;
    const sw = fromLive ? this.live.videoWidth : this.canvas.width;
    const sh = fromLive ? this.live.videoHeight : this.canvas.height;
    const c = document.createElement("canvas");
    c.width = width;
    c.height = Math.round((width * sh) / sw);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.78);
  }

  #set(state) {
    if (state === this.state) return;
    this.state = state;
    this.#emit("state", { state });
  }
  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
