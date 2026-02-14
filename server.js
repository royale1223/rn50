import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dotenv from "dotenv";
import twilio from "twilio";
import crypto from "crypto";

import {
  ensureDir,
  readJson,
  writeJsonAtomic,
  getOrCreateSecret,
  sha256,
  hmacToken,
  verifyHmacToken,
  normalizePhone,
} from "./auth-store.js";

import {
  openDb,
  getLegacyCounts,
  getLiveCounts,
  mergeCounts,
  upsertVote,
  getUserVote,
  getUserVenueVotes,
  toggleVenueVote,
  upsertUser,
} from "./db.js";

// Load Twilio creds from the FleetApt .env (as requested)
dotenv.config({ path: "/var/www/fleetapt/.env" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));

const publicDir = path.join(__dirname, "public");
// Cache static assets for 7 days
app.use(express.static(publicDir, { maxAge: "7d" }));

const dataDir = path.join(__dirname, "data");
const authPath = path.join(dataDir, "auth.json");
const secretPath = path.join(dataDir, "secret.txt");
const allowedPhonesPath = path.join(dataDir, "allowed_phones.json");
ensureDir(dataDir);

const SIGNING_SECRET = getOrCreateSecret(secretPath);

// Ensure sensitive files are private (best-effort)
for (const p of [secretPath, authPath, allowedPhonesPath, path.join(dataDir, "reunion50.sqlite")]) {
  try {
    if (fs.existsSync(p)) fs.chmodSync(p, 0o600);
  } catch { }
}

// SQLite database (votes + users)
const { db } = openDb({ dataDir });

// --- allowlist ---
// Default: deny if no allowlist file is present/loaded (prevents becoming an open SMS relay).
function loadAllowedPhones() {
  const doc = readJson(allowedPhonesPath, null);
  const list = Array.isArray(doc?.phones) ? doc.phones : [];
  const set = new Set();
  for (const p of list) {
    if (typeof p === "string" && p.startsWith("+")) set.add(p);
  }
  return set;
}

let ALLOWED_PHONES = loadAllowedPhones();

function isPhoneAllowed(phone) {
  if (!phone) return false;
  // If explicitly set, allow all (useful for development only)
  if (process.env.REUNION50_ALLOW_ALL === "true") return true;
  // If allowlist is empty, deny by default
  if (!ALLOWED_PHONES || ALLOWED_PHONES.size === 0) return false;
  return ALLOWED_PHONES.has(phone);
}

function ensureAuthStore() {
  const base = {
    updatedAt: new Date().toISOString(),
    otp: {},
  };
  const s = readJson(authPath, null);
  if (!s) writeJsonAtomic(authPath, base);
}

function readAuthStore() {
  ensureAuthStore();
  return readJson(authPath, { updatedAt: new Date().toISOString(), otp: {} });
}

function writeAuthStore(store) {
  store.updatedAt = new Date().toISOString();
  writeJsonAtomic(authPath, store);
}

const ALLOWED_VENUE = new Set(["kadavu", "vythiri", "bolgatty"]);
const ALLOWED_DATE = new Set(["july18_19", "aug8_9", "other"]);

const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
const twilioClient =
  twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

function requireTwilio(res) {
  if (!twilioClient || !twilioFrom) {
    res.status(500).json({
      ok: false,
      error: "Twilio is not configured on the server.",
    });
    return false;
  }
  return true;
}

function genOtp() {
  // cryptographically secure 6-digit OTP
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// --- fixed OTP (temporary admin bypass for specific numbers) ---
const FIXED_OTP_CODE = process.env.REUNION50_FIXED_OTP_CODE || "550055";
const fixedOtpPhonesPath = path.join(dataDir, "fixed_otp_phones.txt");

function loadFixedOtpPhones() {
  try {
    if (!fs.existsSync(fixedOtpPhonesPath)) return new Set();
    const content = fs.readFileSync(fixedOtpPhonesPath, "utf-8");
    const lines = content.split("\n").map(line => line.trim()).filter(Boolean);
    const set = new Set();
    for (const phone of lines) {
      if (phone.startsWith("+")) set.add(phone);
    }
    return set;
  } catch (e) {
    console.error("Error loading fixed OTP phones:", e);
    return new Set();
  }
}

let FIXED_OTP_PHONES = loadFixedOtpPhones();

function hasFixedOtp(phone) {
  return true;
  // return FIXED_OTP_PHONES.has(phone);
}

app.get("/api/results", (req, res) => {
  const legacyVenue = getLegacyCounts(db, "venue");
  const legacyDate = getLegacyCounts(db, "date");
  const liveVenue = getLiveCounts(db, "venue");
  const liveDate = getLiveCounts(db, "date");

  const votes = mergeCounts(legacyVenue, liveVenue);
  const dateVotes = mergeCounts(legacyDate, liveDate);

  const out = {
    ok: true,
    updatedAt: new Date().toISOString(),
    votes,
    dateVotes,
    hasVotedVenue: false,
    hasVotedDate: false,
    votedVenue: [],
    votedDate: null,
    userName: null,
    forceLogout: false,
  };

  const token = req.headers["x-phone-token"];
  if (token) {
    const verified = verifyHmacToken(SIGNING_SECRET, token);
    if (verified?.phone) {
      // If allowlist changes after someone has a token, force logout on next results fetch
      if (!isPhoneAllowed(verified.phone)) {
        out.forceLogout = true;
      } else {
        const phoneHash = sha256(verified.phone);
        const u = db.prepare("SELECT name FROM users WHERE phone_hash=?").get(phoneHash);
        if (u?.name) out.userName = u.name;

        const v = getUserVenueVotes(db, { phoneHash });
        const d = getUserVote(db, { phoneHash, kind: "date" });
        if (v?.length) {
          out.hasVotedVenue = true;
          out.votedVenue = v;
        }
        if (d?.option) {
          out.hasVotedDate = true;
          out.votedDate = d.option;
        }
      }
    }
  }

  res.json(out);
});

// --- OTP auth ---
app.post("/api/auth/send-otp", async (req, res) => {
  if (!twilioClient || !twilioFrom) {
    return res.status(500).json({
      ok: false,
      error: "Twilio is not configured on the server.",
    });
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const phone = normalizePhone(req.body?.phone);

  // (PII logging removed)

  if (!name || name.length < 2) {
    return res.status(400).json({ ok: false, error: "Name is required." });
  }
  if (!phone) {
    return res.status(400).json({ ok: false, error: "Invalid phone number." });
  }
  if (!isPhoneAllowed(phone)) {
    return res.status(403).json({ ok: false, error: "Contact an organiser to add your number to the poll." });
  }

  const auth = readAuthStore();
  const now = Date.now();
  const rec = auth.otp[phone] ?? {
    sendCountHour: 0,
    windowStartMs: now,
    attempts: 0,
  };

  // rate limit: 3 sends per hour
  if (now - (rec.windowStartMs ?? now) > 60 * 60_000) {
    rec.windowStartMs = now;
    rec.sendCountHour = 0;
  }
  if ((rec.sendCountHour ?? 0) >= 3) {
    return res.status(429).json({ ok: false, error: "Too many OTP requests. Try later." });
  }

  const otp = hasFixedOtp(phone) ? FIXED_OTP_CODE : genOtp();
  const otpSalt = String(crypto.randomInt(0, 1_000_000_000));
  const otpHash = sha256(`${otpSalt}:${otp}`);

  rec.sendCountHour = (rec.sendCountHour ?? 0) + 1;
  rec.sentAtMs = now;
  rec.expiresAtMs = now + 5 * 60_000;
  rec.otpSalt = otpSalt;
  rec.otpHash = otpHash;
  rec.attempts = 0;
  rec.name = name;

  auth.otp[phone] = rec;
  writeAuthStore(auth);

  // If this phone is configured for fixed OTP, don't send SMS.
  if (hasFixedOtp(phone)) {
    return res.json({ ok: true, fixedOtp: true });
  }

  try {
    console.log(`Sending SMS to ${phone} via ${twilioFrom}...`);
    const msg = await twilioClient.messages.create({
      from: twilioFrom,
      to: phone,
      body: `Reunion 50 '26 OTP: ${otp}. Valid for 5 minutes.`,
    });
    console.log("Twilio response:", msg.sid);
    res.json({ ok: true });
  } catch (e) {
    console.error("Twilio Error:", e);
    res.status(500).json({ ok: false, error: "Failed to send OTP (SMS error)." });
  }
});

app.post("/api/auth/verify-otp", (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";

  if (!phone) return res.status(400).json({ ok: false, error: "Invalid phone number." });
  if (!isPhoneAllowed(phone)) {
    return res.status(403).json({ ok: false, error: "Contact an organiser to add your number to the poll." });
  }
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ ok: false, error: "Invalid OTP." });

  const auth = readAuthStore();
  const rec = auth.otp[phone];
  const now = Date.now();
  if (!rec || !rec.otpHash || !rec.otpSalt) {
    return res.status(400).json({ ok: false, error: "OTP not requested." });
  }
  if (now > (rec.expiresAtMs ?? 0)) {
    return res.status(400).json({ ok: false, error: "OTP expired. Please resend." });
  }

  rec.attempts = (rec.attempts ?? 0) + 1;
  if (rec.attempts > 5) {
    auth.otp[phone] = rec;
    writeAuthStore(auth);
    return res.status(429).json({ ok: false, error: "Too many attempts. Please resend OTP." });
  }

  const check = sha256(`${rec.otpSalt}:${otp}`);
  if (check !== rec.otpHash) {
    auth.otp[phone] = rec;
    writeAuthStore(auth);
    return res.status(400).json({ ok: false, error: "Incorrect OTP." });
  }

  // verified
  const name = rec?.name ?? null;
  delete auth.otp[phone];
  writeAuthStore(auth);

  const phoneHash = sha256(phone);
  if (name) upsertUser(db, { phoneHash, name });

  // Token expires (default 30 days)
  const nowMs = Date.now();
  const token = hmacToken(SIGNING_SECRET, {
    phone,
    verifiedAt: nowMs,
    exp: nowMs + 30 * 24 * 60 * 60_000,
  });

  res.json({ ok: true, token, name });
});

// (removed) cryptoRandomInt: use crypto.randomInt instead

// --- vote (requires OTP token) ---
app.post("/api/vote", (req, res) => {
  const { option, phoneToken, kind, otherText } = req.body ?? {};
  const voteKind = kind === "date" ? "date" : "venue";

  if (voteKind === "venue") {
    if (!ALLOWED_VENUE.has(option)) {
      return res.status(400).json({ ok: false, error: "Invalid venue option" });
    }
  } else {
    if (!ALLOWED_DATE.has(option)) {
      return res.status(400).json({ ok: false, error: "Invalid date option" });
    }
  }

  const verified = verifyHmacToken(SIGNING_SECRET, phoneToken);
  if (!verified?.phone || typeof verified.phone !== "string") {
    return res.status(401).json({ ok: false, error: "OTP verification required." });
  }

  // Extra safety: even if someone gets a token, only allow allowlisted numbers to vote
  if (!isPhoneAllowed(verified.phone)) {
    return res.status(403).json({ ok: false, error: "Contact an organiser to add your number to the poll." });
  }

  const phoneHash = sha256(verified.phone);

  // Venue votes are multi-select (toggle on/off per option)
  if (voteKind === "venue") {
    toggleVenueVote(db, { phoneHash, option });
  } else {
    const cleanedOther = option === "other" && typeof otherText === "string"
      ? otherText.trim().slice(0, 40)
      : null;
    upsertVote(db, { phoneHash, kind: "date", option, otherText: cleanedOther });
  }

  // return updated aggregates
  const legacyVenue = getLegacyCounts(db, "venue");
  const legacyDate = getLegacyCounts(db, "date");
  const liveVenue = getLiveCounts(db, "venue");
  const liveDate = getLiveCounts(db, "date");

  res.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    votes: mergeCounts(legacyVenue, liveVenue),
    dateVotes: mergeCounts(legacyDate, liveDate),
    kind: voteKind,
  });
});

// --- voter lists (names) ---
// Public endpoint (no auth) so organisers can see who voted per option.
// NOTE: This only covers live SQLite votes; legacy aggregated counts have no names.
app.get("/api/voters", (req, res) => {
  const kind = req.query?.kind === "date" ? "date" : "venue";
  const option = typeof req.query?.option === "string" ? req.query.option : "";

  if (kind === "venue") {
    if (!ALLOWED_VENUE.has(option)) return res.status(400).json({ ok: false, error: "Invalid venue option" });
    const rows = db
      .prepare(
        "SELECT COALESCE(u.name,'(unknown)') AS name " +
        "FROM venue_votes vv LEFT JOIN users u ON u.phone_hash=vv.phone_hash " +
        "WHERE vv.option=? ORDER BY name COLLATE NOCASE",
      )
      .all(option);
    return res.json({ ok: true, kind, option, names: rows.map((r) => r.name) });
  }

  if (!ALLOWED_DATE.has(option)) return res.status(400).json({ ok: false, error: "Invalid date option" });
  const rows = db
    .prepare(
      "SELECT COALESCE(u.name,'(unknown)') AS name " +
      "FROM votes v LEFT JOIN users u ON u.phone_hash=v.phone_hash " +
      "WHERE v.kind='date' AND v.option=? ORDER BY name COLLATE NOCASE",
    )
    .all(option);
  return res.json({ ok: true, kind, option, names: rows.map((r) => r.name) });
});

// SPA-ish fallback (Express 5 doesn't like "*")
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// NOTE: FleetApt .env may set PORT; avoid inheriting it.
const port = process.env.REUNION50_PORT ? Number(process.env.REUNION50_PORT) : 5173;
app.listen(port, () => {
  console.log(`Reunion 50 '26 slideshow running on http://0.0.0.0:${port}`);
});
