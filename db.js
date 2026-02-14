import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export function openDb({ dataDir }) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "reunion50.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      phone_hash TEXT PRIMARY KEY,
      name TEXT,
      verified_at TEXT
    );

    -- Single-select votes (currently used for date)
    CREATE TABLE IF NOT EXISTS votes (
      phone_hash TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('venue','date')),
      option TEXT NOT NULL,
      other_text TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (phone_hash, kind)
    );

    -- Multi-select venue votes (one user can select multiple venues)
    CREATE TABLE IF NOT EXISTS venue_votes (
      phone_hash TEXT NOT NULL,
      option TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (phone_hash, option)
    );

    CREATE TABLE IF NOT EXISTS legacy_counts (
      kind TEXT NOT NULL,
      option TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (kind, option)
    );
  `);

  return { db, dbPath };
}

export function getLegacyCounts(db, kind) {
  const rows = db.prepare("SELECT option, count FROM legacy_counts WHERE kind=?").all(kind);
  const out = {};
  for (const r of rows) out[r.option] = r.count;
  return out;
}

export function setLegacyCounts(db, kind, counts) {
  const insert = db.prepare(
    "INSERT INTO legacy_counts(kind, option, count) VALUES(?,?,?) ON CONFLICT(kind, option) DO UPDATE SET count=excluded.count",
  );
  const tx = db.transaction(() => {
    for (const [opt, c] of Object.entries(counts)) insert.run(kind, opt, Number(c) || 0);
  });
  tx();
}

export function getLiveCounts(db, kind) {
  // Venue is multi-select in a separate table
  if (kind === "venue") {
    const rows = db.prepare("SELECT option, COUNT(*) as c FROM venue_votes GROUP BY option").all();
    const out = {};
    for (const r of rows) out[r.option] = r.c;
    return out;
  }

  // Date (and any future kinds) remain single-select in votes
  const rows = db
    .prepare("SELECT option, COUNT(*) as c FROM votes WHERE kind=? GROUP BY option")
    .all(kind);
  const out = {};
  for (const r of rows) out[r.option] = r.c;
  return out;
}

export function mergeCounts(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + (v || 0);
  return out;
}

export function upsertVote(db, { phoneHash, kind, option, otherText }) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO votes(phone_hash, kind, option, other_text, updated_at) VALUES(?,?,?,?,?) " +
      "ON CONFLICT(phone_hash, kind) DO UPDATE SET option=excluded.option, other_text=excluded.other_text, updated_at=excluded.updated_at",
  ).run(phoneHash, kind, option, otherText ?? null, now);
}

export function getUserVote(db, { phoneHash, kind }) {
  return db
    .prepare("SELECT option, other_text as otherText, updated_at as updatedAt FROM votes WHERE phone_hash=? AND kind=?")
    .get(phoneHash, kind);
}

export function getUserVenueVotes(db, { phoneHash }) {
  const rows = db
    .prepare("SELECT option FROM venue_votes WHERE phone_hash=? ORDER BY option")
    .all(phoneHash);
  return rows.map((r) => r.option);
}

export function toggleVenueVote(db, { phoneHash, option }) {
  const now = new Date().toISOString();
  const exists = db
    .prepare("SELECT 1 FROM venue_votes WHERE phone_hash=? AND option=?")
    .get(phoneHash, option);
  if (exists) {
    db.prepare("DELETE FROM venue_votes WHERE phone_hash=? AND option=?").run(phoneHash, option);
    return { selected: false, updatedAt: now };
  }
  db.prepare("INSERT INTO venue_votes(phone_hash, option, updated_at) VALUES(?,?,?)").run(
    phoneHash,
    option,
    now,
  );
  return { selected: true, updatedAt: now };
}

export function upsertUser(db, { phoneHash, name }) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users(phone_hash, name, verified_at) VALUES(?,?,?) " +
      "ON CONFLICT(phone_hash) DO UPDATE SET name=excluded.name, verified_at=excluded.verified_at",
  ).run(phoneHash, name ?? null, now);
}
