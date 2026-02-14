#!/usr/bin/env node
/**
 * Export current poll votes to an .xlsx file.
 *
 * Output sheets:
 *  - Users: phone_hash, name, verified_at
 *  - DateVotes: phone_hash, option, other_text, updated_at
 *  - VenueVotes: phone_hash, option, updated_at
 *
 * Usage:
 *   node scripts/export_votes_xlsx.js --out /tmp/votes.xlsx
 */

import fs from "fs";
import path from "path";
import process from "process";
import XLSX from "xlsx";
import { openDb } from "../db.js";

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

const outPath = argValue("--out") || path.resolve("./backups/votes_export.xlsx");
const dataDir = path.resolve("./data");

const { db } = openDb({ dataDir });

const users = db
  .prepare("SELECT phone_hash, name, verified_at FROM users ORDER BY verified_at DESC")
  .all();

const dateVotes = db
  .prepare(
    "SELECT phone_hash, option, other_text, updated_at FROM votes WHERE kind='date' ORDER BY updated_at DESC",
  )
  .all();

const venueVotes = db
  .prepare("SELECT phone_hash, option, updated_at FROM venue_votes ORDER BY updated_at DESC")
  .all();

function sheetFromRows(rows) {
  // Deterministic: ensure stable column order based on first row keys.
  if (!rows.length) return XLSX.utils.aoa_to_sheet([[]]);
  const headers = Object.keys(rows[0]);
  const aoa = [headers, ...rows.map((r) => headers.map((h) => (r[h] ?? "")))];
  return XLSX.utils.aoa_to_sheet(aoa);
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheetFromRows(users), "Users");
XLSX.utils.book_append_sheet(wb, sheetFromRows(dateVotes), "DateVotes");
XLSX.utils.book_append_sheet(wb, sheetFromRows(venueVotes), "VenueVotes");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
XLSX.writeFile(wb, outPath);

console.log(`Wrote: ${outPath}`);
console.log(`Users: ${users.length}`);
console.log(`Date votes: ${dateVotes.length}`);
console.log(`Venue votes: ${venueVotes.length}`);
