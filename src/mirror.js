// The mirror: camera in, a clean portrait frame out, and the live try-on session on top.
// Events: awake, state, picture, wearing, tick, idle, presence, link, queue, ended, fault, shape, camera, abandoned
import { framing, warmUp, ready } from "./vision.js";

const SHAPES = { portrait: [720, 1280], landscape: [1280, 720] };
const IDLE_GRACE = 12; // seconds between "still there?" and ending the live look
const AWAY_SECONDS = 8; // a live look ends this long after the shopper leaves the frame
const HIDDEN_SECONDS = 4; // ...and this long after the window goes out of sight
const WATCH_MS = 1200; // how often the mirror checks who is in it
const WATCH_LIVE_MS = 2500; // while a look is live the page is busy enough; this is still well inside AWAY_SECONDS
const STALL_MS = 2000; // a camera that has sent no new frame for this long is frozen
const CONNECT_SECONDS = 20; // how long the engine gets to answer
const QUEUE_SECONDS = 120; // ...or, once it reports a place in line, how long it may take
const PICTURE_SECONDS = 12; // a connected look with no picture by now is not coming
const RECONNECT_SECONDS = 20; // the engine redials a dropped line; if that takes longer the look ends
const LOOK_SIDE = 512; // the pose check looks at a copy this big on its long side

// The try-on engine is the heaviest part of the app. Load it when it is first wanted.
let sdk = null;
const engine = () => (sdk ??= import("@decartai/sdk"));

// A worker's timer keeps its pace when the window is behind another one. The page's own timers
// drop to once a second there, which starved the engine of frames and froze the live look.
// It only stands in while the window is hidden: a worker's timer is coarser than the page's own.
function beat(ms, tick) {
  try {
    const url = URL.createObjectURL(new Blob(["let t;onmessage=(e)=>{clearInterval(t);t=setInterval(()=>postMessage(0),e.data)}"], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = () => tick();
    worker.postMessage(ms);
    return () => (worker.terminate(), URL.revokeObjectURL(url));
  } catch {
    return () => {}; // no worker here: the page's own timer carries on at its slower pace
  }
}

// One value that changes whenever the camera delivers a new frame.
const frameKey = (el) => `${el.currentTime}|${el.getVideoPlaybackQuality?.().totalVideoFrames ?? ""}`;

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
    // "mirva": MIRVA writes the prompt. "server": send the garment alone and let the engine write it.
    // Measured on one garment (see the camera lab notes) the two were not clearly different; localStorage "mirva:prompt" = "server" tries the second.
    this.promptMode = (() => {
      try {
        return localStorage.getItem("mirva:prompt") === "server" ? "server" : "mirva";
      } catch {
        return "mirva";
      }
    })();
    this.cameraSize = [1920, 1080]; // asked of the camera; a portrait frame is cropped out of it, so more pixels help
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
    this.cameraDown = false;
    this.seenAt = performance.now();
    this.#size();
    document.addEventListener("visibilitychange", () => this.#visibility());
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

  async #openCamera(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open a camera here.");
    const [width, height] = this.cameraSize;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: 30 },
      },
    });
    const el = document.createElement("video");
    el.srcObject = stream;
    el.muted = true;
    el.setAttribute("muted", "");
    el.setAttribute("playsinline", "");
    // In the page but out of sight: some phone browsers stop feeding frames to a video that is not in the document.
    el.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    document.body.append(el);
    try {
      await el.play();
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      el.remove();
      throw e;
    }
    const track = stream.getVideoTracks()[0];
    // A camera that is unplugged or taken by another app ends its track: restart it once, then say so.
    track.addEventListener("ended", () => this.source?.stream === stream && this.#recover());
    this.deviceId = track.getSettings().deviceId || deviceId || null;
    return { kind: "camera", el, stream, flip: true };
  }

  async startCamera(deviceId) {
    const source = await this.#openCamera(deviceId);
    // The pose model freezes the page for seconds the first time it runs. Let that happen now,
    // before the camera is on the glass, rather than after it.
    await Promise.race([ready(), new Promise((r) => setTimeout(r, 12000))]);
    this.#useSource(source);
  }

  /** Open the same camera again, in place. A live look carries on from the frames it is given. */
  async restartCamera() {
    this.recovering = true;
    try {
      this.source?.stream?.getTracks().forEach((t) => t.stop()); // some cameras cannot be opened twice
      let source;
      try {
        source = await this.#openCamera(this.deviceId);
      } catch (e) {
        if (!this.deviceId) throw e;
        source = await this.#openCamera(null); // that camera is gone; take whichever one answers
      }
      this.#useSource(source, { quiet: true });
      this.#cameraOk();
    } finally {
      this.recovering = false;
    }
  }

  /** The shopper's own "try again" after the mirror gave up on the camera. */
  async retryCamera() {
    this.restartedAt = performance.now();
    try {
      await this.restartCamera();
    } catch (error) {
      this.#emit("camera", { state: "lost", error });
    }
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

  #useSource(source, { quiet = false } = {}) {
    const old = this.source;
    old?.stream?.getTracks().forEach((t) => t.stop());
    if (old && old.el !== source.el) old.el.remove?.();
    this.source = source;
    this.seenKey = null;
    this.seenAt = performance.now();
    if (!this.out) {
      this.out = this.canvas.captureStream(30);
      this.cam.srcObject = this.out;
      this.cam.play().catch(() => {});
      this.#pump();
      this.#schedule();
      this.healthTimer = setInterval(() => this.#health(), 500);
    }
    this.#draw();
    if (this.state === "asleep") this.#set("awake");
    if (this.cameraDown) this.#cameraOk();
    if (!quiet) this.#emit("awake", { kind: source.kind });
  }

  // ---- is the camera still delivering? ------------------------------------
  #health() {
    const now = performance.now();
    const src = this.source;
    // Nothing to judge for a photo, a hidden window (the browser may park the camera), or a restart under way.
    if (src?.kind !== "camera" || document.hidden || this.recovering) return void (this.seenAt = now);
    const key = frameKey(src.el);
    if (key !== this.seenKey) {
      this.seenKey = key;
      this.seenAt = now;
      if (this.cameraDown) this.#cameraOk(); // it came back by itself
    } else if (now - this.seenAt > STALL_MS && !this.cameraDown) this.#recover();
  }

  async #recover() {
    if (this.recovering || this.cameraDown) return;
    // Restarted a moment ago and frozen again: the camera is not coming back by itself.
    if (performance.now() - (this.restartedAt ?? -Infinity) < 20000) return this.#lose();
    this.restartedAt = performance.now();
    this.#emit("camera", { state: "restarting" });
    try {
      await this.restartCamera();
    } catch (error) {
      this.#lose(error);
    }
  }

  #lose(error) {
    this.cameraDown = true;
    this.#emit("camera", { state: "lost", error });
    // A live look fed by a frozen camera costs money and shows nothing new.
    if (this.isLive) this.stop("camera");
  }

  #cameraOk() {
    this.cameraDown = false;
    this.seenAt = performance.now();
    this.#emit("camera", { state: "ok" });
  }

  #visibility() {
    clearTimeout(this.hiddenTimer);
    if (this.out) this.#beating();
    if (!document.hidden) return void (this.seenAt = performance.now());
    // A look nobody can see still costs by the second.
    if (this.isLive) this.hiddenTimer = setTimeout(() => document.hidden && this.isLive && this.stop("hidden"), HIDDEN_SECONDS * 1000);
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

  // Not requestAnimationFrame, which stops whenever the window is not in front. A timer, and a
  // worker's beat beside it for when the page's own timers drop to once a second.
  #pump() {
    clearInterval(this.pumpTimer);
    const every = 1000 / this.fps;
    let last = performance.now();
    let late = 0;
    let ticks = 0;
    this.pumpTick = () => {
      const now = performance.now();
      const gap = now - last;
      if (gap < every * 0.5) return; // beats that piled up behind a busy page are dropped, not replayed
      last = now;
      this.#draw();
      // A slow laptop cannot keep 30 frames a second. Step down rather than stutter.
      ticks++;
      if (gap > every * 1.6) late++;
      if (ticks >= this.fps * 3) {
        if (late / ticks > 0.3 && this.fps > 18) {
          this.fps = this.fps === 30 ? 24 : 18;
          this.#pump();
        }
        ticks = late = 0;
      }
    };
    this.pumpTimer = setInterval(this.pumpTick, every);
    this.#beating();
  }

  #beating() {
    this.stopBeat?.();
    this.stopBeat = document.hidden ? beat(1000 / this.fps - 2, this.pumpTick) : null;
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
  #schedule() {
    clearTimeout(this.watcher);
    this.watcher = setTimeout(async () => {
      await this.#watch();
      this.#schedule();
    }, this.isLive ? WATCH_LIVE_MS : WATCH_MS);
  }

  async #watch() {
    if (!this.source || document.hidden || this.watching || this.cameraDown) return;
    this.watching = true;
    try {
      const f = await framing(this.#look());
      const now = performance.now();
      if (!f.known || f.present) this.lastSeen = now;
      const changed = f.present !== this.presence.present || f.hint !== this.presence.hint || f.known !== this.presence.known;
      this.presence = f;
      if (changed) this.#emit("presence", f);
      if (this.state === "live" && f.known && !f.present && now - this.lastSeen > AWAY_SECONDS * 1000) this.stop("away");
    } catch {
    } finally {
      this.watching = false;
    }
  }

  // The pose model works at a few hundred pixels; handing it the whole frame only costs more.
  #look() {
    const { width, height } = this.canvas;
    const k = Math.min(1, LOOK_SIDE / Math.max(width, height));
    const w = Math.round(width * k);
    const h = Math.round(height * k);
    this.probe ??= document.createElement("canvas");
    if (this.probe.width !== w || this.probe.height !== h) {
      this.probe.width = w;
      this.probe.height = h;
    }
    this.probe.getContext("2d").drawImage(this.canvas, 0, 0, w, h);
    return this.probe;
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

  /** Put a garment on. Connects on first use, then swaps without reconnecting. `garment` may still be on its way. */
  async wear(product, garment) {
    if (!this.out) throw new Error("The mirror is not on yet.");
    this.touch();
    const state = { prompt: product.prompt, image: garment, enhance: this.enhance };
    const want = { product, state };
    if (this.state === "connecting") {
      // A second tap while the first is still connecting: keep the one connection, wear the latest.
      this.queued = want;
      return this.connecting;
    }
    if (this.rt && this.state === "live") {
      // A tap while a swap is still pending: only the latest is kept, and applied when the first is done.
      if (this.applying) {
        this.queued = want;
        return this.applying;
      }
      return (this.applying = this.#swap(want).finally(() => (this.applying = null)));
    }
    this.connecting = this.#connect(state);
    await this.connecting;
    let worn = want;
    if (this.queued) {
      worn = this.queued;
      this.queued = null;
      await this.#apply(this.rt, worn.state);
    }
    this.#worn(worn.product);
  }

  async #swap(first) {
    let next = first;
    while (next) {
      this.queued = null;
      await this.#apply(this.rt, next.state);
      this.#worn(next.product);
      next = this.rt ? this.queued : null;
    }
  }

  #worn(product) {
    this.wearingNow = product;
    this.#emit("wearing", { product });
  }

  async #apply(rt, { prompt, image, enhance }) {
    const picture = await image;
    if (this.promptMode === "server") return rt.setImage(picture, { timeout: 30000 });
    return rt.set({ prompt, image: picture, enhance });
  }

  async #connect(state) {
    this.#set("connecting");
    const attempt = ++this.attempt;
    const stale = () => attempt !== this.attempt;
    this.pictured = false;
    let feed = null;
    let rt = null;
    let granted = null;
    let place = 0;
    try {
      const [{ createDecartClient, models, createConsoleLogger }, res] = await Promise.all([engine(), fetch("/api/token", { method: "POST", headers: { "content-type": "application/json", ...this.auth() }, body: JSON.stringify({ brand: this.brandId }) })]);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.apiKey) throw new Error(body.error || "Could not start the live look.");
      granted = body.grant ?? null;
      if (stale()) throw new Error("cancelled");
      // The server may grant less than a full session: a member at home has a monthly allowance.
      this.grant = granted;
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
      const image = await state.image; // the garment was fetched while the token was
      if (stale()) throw new Error("cancelled");
      // The engine gets its own copy of the track: the SDK ends the track it is given
      // when a session closes, which would otherwise switch off the mirror itself.
      feed = new MediaStream(this.out.getVideoTracks().map((t) => t.clone()));

      // The engine gets CONNECT_SECONDS to answer, and QUEUE_SECONDS once it says we are in line.
      let timer;
      let giveUp;
      const arm = (seconds) => {
        clearTimeout(timer);
        timer = setTimeout(() => giveUp(Object.assign(new Error("The engine did not answer in time."), { kind: place > 0 ? "busy" : "slow" })), seconds * 1000);
      };
      const clock = new Promise((_, reject) => (giveUp = reject));
      const connecting = client.realtime.connect(feed, {
        model: models.realtime(this.config.model),
        mirror: false, // the frame is already flipped like a mirror
        retries: 2, // the engine's default is five tries over half a minute, with the glass waiting
        ...(this.codec ? { preferredVideoCodec: this.codec } : {}),
        ...(this.fast ? { speed: "fast" } : {}),
        // Passed here, not attached afterwards: places in line are reported while connecting.
        onQueuePosition: (q) => {
          place = q?.position ?? 0;
          if (place > 0) arm(QUEUE_SECONDS);
          this.#emit("queue", q);
        },
        onRemoteStream: (stream) => {
          if (stale()) return;
          this.live.srcObject = stream;
          this.live.play().catch(() => {});
          this.#watchFirstFrame();
        },
        initialState: this.promptMode === "server" ? { image } : { prompt: { text: state.prompt, enhance: state.enhance }, image },
      });
      arm(CONNECT_SECONDS);
      try {
        rt = await Promise.race([connecting, clock]);
      } catch (e) {
        // A session that connects after we gave up must be closed at once, or it runs, and bills, unseen.
        connecting.then((late) => late.disconnect(), () => {});
        throw e;
      } finally {
        clearTimeout(timer);
      }
      // Taken off while it was still connecting: close it at once so it cannot run unseen.
      if (stale()) throw new Error("cancelled");

      this.rt = rt;
      this.feed = feed;
      rt.on("connectionChange", (s) => {
        this.#emit("link", { state: s });
        clearTimeout(this.redial);
        if (s === "disconnected" && this.rt === rt) this.#finish("lost");
        // The engine redials a dropped line by itself. Give it a fair while, then end the look cleanly.
        if (s === "reconnecting") this.redial = setTimeout(() => this.rt === rt && this.#finish("lost"), RECONNECT_SECONDS * 1000);
      });
      rt.on("error", (e) => this.#emit("fault", { message: e?.message || "The live look had a problem." }));
      this.startedAt = performance.now();
      this.lastSeen = this.startedAt;
      this.touch();
      this.clock = setInterval(() => this.#tick(), 250);
      this.#set("live");
      if (document.hidden) this.#visibility();
    } catch (e) {
      this.queued = null;
      try {
        rt?.disconnect();
      } catch {}
      feed?.getTracks().forEach((t) => t.stop());
      // The server set the meter to the whole allowance when it gave the token. Tell it nothing ran.
      if (granted != null) this.#emit("abandoned", { grant: granted });
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
        this.pictured = true;
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
    if (!this.pictured && elapsed > PICTURE_SECONDS) return this.stop("nopicture");
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
    clearTimeout(this.hiddenTimer);
    clearTimeout(this.redial);
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
    this.#schedule();
  }
  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
