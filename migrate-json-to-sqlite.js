import fs from "fs";
import path from "path";
import { openDb, setLegacyCounts, upsertVote } from "./db.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const dataDir = path.join(__dirname, "data");
const votesPath = path.join(dataDir, "votes.json");

if (!fs.existsSync(votesPath)) {
  console.log("No votes.json found; nothing to migrate.");
  process.exit(0);
}

const json = JSON.parse(fs.readFileSync(votesPath, "utf8"));
const { db, dbPath } = openDb({ dataDir });

// Preserve current totals as legacy counts.
setLegacyCounts(db, "venue", json.votes || {});
setLegacyCounts(db, "date", json.dateVotes || {});

// Migrate per-phone selections where we have them.
const votedPhones = json.votedPhones || {};
let migrated = 0;
for (const [phoneHash, rec] of Object.entries(votedPhones)) {
  if (rec?.venue?.option && rec.venue.option !== "unknown") {
    upsertVote(db, { phoneHash, kind: "venue", option: rec.venue.option, otherText: null });
    migrated++;
  }
  if (rec?.date?.option) {
    upsertVote(db, {
      phoneHash,
      kind: "date",
      option: rec.date.option,
      otherText: rec.date.otherText ?? null,
    });
    migrated++;
  }
}

db.close();
console.log(`Migrated legacy counts + ${migrated} vote row(s) into ${dbPath}`);
