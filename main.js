import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
const menu = document.getElementById("menu");
const sizeInput = document.getElementById("size");

const hl = document.createElement("label");
hl.style.marginTop = "8px";
hl.innerHTML = 'Hauteur : <input type="range" min="-0.3" max="0.3" step="0.01" value="0.02" />';
sizeInput.parentElement.after(hl);
const heightInput = hl.querySelector("input");

const snap = document.createElement("button");
snap.textContent = "📸 Photo";
snap.style.marginTop = "12px";
snap.onclick = () => {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 480;
  const x = c.getContext("2d");
  x.translate(640, 0); x.scale(-1, 1);
  x.drawImage(video, 0, 0, 640, 480);
  x.drawImage(canvas, 0, 0);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png"); a.download = "essayage.png"; a.click();
};
hl.after(snap);

// Les montures viennent de l'API (postées depuis /admin.html)
const ready = {};
let current = null;
const loadImage = (src) =>
  new Promise((ok, ko) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => ko(new Error("Image invalide"));
    i.src = src;
  });

async function loadFrames() {
  const list = await (await fetch("/api/frames")).json();
  for (const f of list) {
    ready[f.name] = { img: await loadImage(f.file), anchorY: f.anchorY, scale: f.scale };
    current = current || f.name;
    const b = document.createElement("button");
    b.textContent = f.name + (f.price ? " · " + f.price : "");
    b.title = f.brand || "";
    if (f.name === current) b.classList.add("actif");
    b.onclick = () => {
      current = f.name;
      [...menu.children].forEach((x) => x.classList.remove("actif"));
      b.classList.add("actif");
    };
    menu.appendChild(b);
  }
  return list.length;
}

// Lissage One Euro : stable à l'arrêt, réactif en mouvement
class OneEuro {
  constructor(minCutoff, beta) { this.m = minCutoff; this.b = beta; this.reset(); }
  reset() { this.t = null; this.x = 0; this.d = 0; }
  a(c, dt) { return 1 / (1 + 1 / (2 * Math.PI * c) / dt); }
  filter(x, t) {
    if (this.t === null) { this.t = t; this.x = x; return x; }
    const dt = Math.max(t - this.t, 1e-3);
    const ad = this.a(1, dt);
    this.d = ad * ((x - this.x) / dt) + (1 - ad) * this.d;
    const a = this.a(this.m + this.b * Math.abs(this.d), dt);
    this.x = a * x + (1 - a) * this.x;
    this.t = t;
    return this.x;
  }
}
const fx = new OneEuro(0.6, 0.02), fy = new OneEuro(0.6, 0.02);
const fw = new OneEuro(0.4, 0.01), fa = new OneEuro(0.6, 1.5);
const fyaw = new OneEuro(0.7, 1.5), fpitch = new OneEuro(0.7, 1.5);
const resetFilters = () => [fx, fy, fw, fa, fyaw, fpitch].forEach((f) => f.reset());

const makeLandmarker = (vision, delegate) =>
  FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate,
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
  });

async function init() {
  const count = await loadFrames();
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  let lm;
  try { lm = await makeLandmarker(vision, "GPU"); } catch { lm = await makeLandmarker(vision, "CPU"); }
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  await video.play();
  status.textContent = count ? "Prêt : regarde la caméra" : "Aucune monture : ajoute-en sur /admin.html";
  loop(lm);
}

// ---------- ROTATION DE LA TÊTE (fausse 3D) ----------
const off = document.createElement("canvas");
const offCtx = off.getContext("2d");
const N = 40;
const D = 2.6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function headPose(res, l, eye, mid) {
  const noseOff = (l[1].x * canvas.width - mid.x) / eye;
  const sign = noseOff >= 0 ? 1 : -1;
  let yaw = Math.asin(clamp(Math.abs(noseOff) * 3, 0, 1));
  let pitch = 0;
  const m = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
  if (m) {
    const d = m.data;
    const yawM = Math.atan2(Math.abs(d[8]), Math.abs(d[10]));
    if (Math.abs(yawM - yaw) < 0.45) yaw = yawM;
    pitch = Math.atan2(Math.abs(d[9]), Math.hypot(d[8], d[10]));
  }
  return { yaw: yaw * sign, pitch };
}

function drawFrame(f, cx, cy, w, angle, yaw, pitch) {
  const iw = f.img.width, ih = f.img.height;
  const offW = Math.round(iw * 1.5), offH = Math.round(ih * 2.2);
  if (off.width !== offW || off.height !== offH) { off.width = offW; off.height = offH; }
  offCtx.clearRect(0, 0, offW, offH);
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const sv = Math.max(Math.cos(pitch), 0.7);
  const s = (u) => D / (D + u * sin);
  for (let i = 0; i < N; i++) {
    const u0 = i / N - 0.5, u1 = (i + 1) / N - 0.5, um = (u0 + u1) / 2;
    const x0 = u0 * cos * s(u0) * iw, x1 = u1 * cos * s(u1) * iw;
    const dh = ih * s(um) * sv;
    offCtx.drawImage(f.img, (i * iw) / N, 0, iw / N, ih, offW / 2 + x0, offH / 2 - f.anchorY * dh, x1 - x0 + 0.8, dh);
  }
  const k = w / iw;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.globalAlpha = clamp(1 - (Math.abs(yaw) * 57.3 - 50) / 25, 0, 1);
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 3;
  ctx.drawImage(off, (-offW / 2) * k, (-offH / 2) * k, offW * k, offH * k);
  ctx.restore();
}

let last = -1;
function loop(landmarker) {
  if (video.currentTime !== last) {
    last = video.currentTime;
    const res = landmarker.detectForVideo(video, performance.now());
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const f = ready[current];
    if (res.faceLandmarks.length && f) {
      const l = res.faceLandmarks[0];
      const pt = (i) => ({ x: l[i].x * canvas.width, y: l[i].y * canvas.height });
      const oR = pt(33), oL = pt(263), iR = pt(133), iL = pt(362);
      const mid = { x: (oR.x + oL.x + iR.x + iL.x) / 4, y: (oR.y + oL.y + iR.y + iL.y) / 4 };
      const eye2d = Math.hypot(oL.x - oR.x, oL.y - oR.y);
      const t = performance.now() / 1000;

      const pose = headPose(res, l, eye2d, mid);
      const yaw = fyaw.filter(pose.yaw, t);
      const pitch = fpitch.filter(pose.pitch, t);
      const eye = eye2d / Math.max(Math.cos(yaw), 0.5);

      const angle = (Math.atan2(oL.y - oR.y, oL.x - oR.x) + Math.atan2(iL.y - iR.y, iL.x - iR.x)) / 2;
      const cx = fx.filter(mid.x + eye * 0.25 * Math.sin(yaw), t);
      const cy = fy.filter(mid.y + eye * parseFloat(heightInput.value), t);
      const w = fw.filter(eye * parseFloat(sizeInput.value) * f.scale, t);
      const a = fa.filter(angle, t);
      drawFrame(f, cx, cy, w, a, yaw, pitch);
    } else if (!res.faceLandmarks.length) {
      resetFilters();
    }
  }
  requestAnimationFrame(() => loop(landmarker));
}

init().catch((e) => (status.textContent = "Erreur : " + e.message));
