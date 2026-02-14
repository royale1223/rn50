import fs from "fs";
import path from "path";
import crypto from "crypto";

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(filePath, obj) {
  const tmp = filePath + ".tmp";
  // Keep files private by default
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {}
}

export function getOrCreateSecret(secretPath) {
  try {
    const s = fs.readFileSync(secretPath, "utf8").trim();
    if (s) {
      try {
        fs.chmodSync(secretPath, 0o600);
      } catch {}
      return s;
    }
  } catch {}
  const s = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, s, { mode: 0o600 });
  try {
    fs.chmodSync(secretPath, 0o600);
  } catch {}
  return s;
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function hmacToken(secret, payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyHmacToken(secret, token) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    // Optional expiry enforcement
    if (obj && typeof obj.exp === "number" && Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

export function normalizePhone(raw) {
  if (typeof raw !== "string") return null;
  let p = raw.trim();

  // Robust cleanup (handles iOS “fancy” hyphens/spaces, etc.):
  // Keep digits, and keep a single leading + if present.
  const hasPlus = p.includes("+");
  p = p.replace(/[^\d+]/g, "");
  if (hasPlus) {
    // remove any + not at the start, then ensure exactly one leading +
    p = p.replace(/\+/g, "");
    p = "+" + p;
  }

  // Handle international prefix written as 00...
  if (p.startsWith("00")) p = "+" + p.slice(2);

  // If it's a 10-digit Indian mobile, assume +91
  if (/^\d{10}$/.test(p)) p = "+91" + p;

  if (!/^\+\d{8,15}$/.test(p)) return null;
  return p;
}
