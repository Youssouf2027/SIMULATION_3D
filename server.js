import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();
const DIR = path.resolve("data");
const SEED = path.resolve("seed");
fs.mkdirSync(DIR, { recursive: true });
const DB = path.join(DIR, "frames.json");
if (!fs.existsSync(DB) && fs.existsSync(SEED))
  for (const f of fs.readdirSync(SEED)) fs.copyFileSync(path.join(SEED, f), path.join(DIR, f));

const ADMIN = process.env.ADMIN_PASSWORD || "admin123";
if (ADMIN === "admin123") console.warn("⚠ Mot de passe admin par défaut : définis ADMIN_PASSWORD");
const tokens = new Set();
const tries = new Map();

const read = () => (fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, "utf8")) : []);
const write = (d) => fs.writeFileSync(DB, JSON.stringify(d, null, 1));
const auth = (req, res, next) =>
  tokens.has(req.get("x-admin")) ? next() : res.status(401).json({ error: "Non autorisé : connecte-toi" });

app.use(express.json({ limit: "8mb" }));
app.use("/uploads", express.static(DIR, { index: false }));

app.post("/api/login", (req, res) => {
  const t = tries.get(req.ip) || { n: 0, at: Date.now() };
  if (Date.now() - t.at > 600000) { t.n = 0; t.at = Date.now(); }
  if (t.n >= 5) return res.status(429).json({ error: "Trop de tentatives, réessaie dans 10 min" });
  if (req.body.password !== ADMIN) { t.n++; tries.set(req.ip, t); return res.status(401).json({ error: "Mot de passe incorrect" }); }
  tries.delete(req.ip);
  const token = crypto.randomBytes(24).toString("hex");
  tokens.add(token);
  res.json({ token });
});

app.get("/api/frames", (_q, r) => r.json(read()));

app.post("/api/frames", auth, (req, res) => {
  const { name, brand = "", price = "", image, anchorY = 0.48, scale = 1 } = req.body;
  const m = /^data:image\/png;base64,(.+)$/.exec(image || "");
  if (!name || !m) return res.status(400).json({ error: "Nom et image PNG requis" });
  const id = Date.now().toString(36);
  fs.writeFileSync(path.join(DIR, id + ".png"), Buffer.from(m[1], "base64"));
  const list = read();
  list.push({ id, name: String(name).slice(0, 40), brand: String(brand).slice(0, 40), price: String(price).slice(0, 20),
    file: `/uploads/${id}.png`, anchorY: +anchorY, scale: +scale });
  write(list);
  res.json(list);
});

app.delete("/api/frames/:id", auth, (req, res) => {
  const list = read();
  const f = list.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "Introuvable" });
  fs.rmSync(path.join(DIR, path.basename(f.file)), { force: true });
  write(list.filter((x) => x.id !== f.id));
  res.json(read());
});

app.use(express.static("dist"));
app.listen(3001, () => console.log("API + site sur http://localhost:3001"));
