#!/usr/bin/env node
/**
 * Export all voters to a PDF.
 *
 * Usage:
 *   node scripts/export_voters_pdf.js [outPath]
 *
 * Default outPath:
 *   data/voters_export.pdf
 */

import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dataDir = path.join(repoRoot, "data");
const dbPath = path.join(dataDir, "reunion50.sqlite");

if (!fs.existsSync(dbPath)) {
  console.error(`DB not found: ${dbPath}`);
  process.exit(1);
}

const outPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(dataDir, "voters_export.pdf");

const db = new Database(dbPath, { readonly: true });

// All voters who have at least one venue vote OR a date vote
const rows = db
  .prepare(
    `
    WITH venue AS (
      SELECT vv.phone_hash,
             GROUP_CONCAT(vv.option, ', ') AS venues
      FROM venue_votes vv
      GROUP BY vv.phone_hash
    ),
    datev AS (
      SELECT v.phone_hash,
             v.option AS date_option,
             v.other_text AS other_text
      FROM votes v
      WHERE v.kind='date'
    )
    SELECT
      COALESCE(u.name,'(unknown)') AS name,
      u.phone_hash AS phone_hash,
      COALESCE(venue.venues,'') AS venues,
      COALESCE(datev.date_option,'') AS date_option,
      COALESCE(datev.other_text,'') AS other_text
    FROM users u
    LEFT JOIN venue ON venue.phone_hash = u.phone_hash
    LEFT JOIN datev ON datev.phone_hash = u.phone_hash
    WHERE venue.phone_hash IS NOT NULL OR datev.phone_hash IS NOT NULL
    ORDER BY LOWER(COALESCE(u.name,'(unknown)')) ASC
    `,
  )
  .all();

const now = new Date();

fs.mkdirSync(path.dirname(outPath), { recursive: true });

const doc = new PDFDocument({
  size: "A4",
  margins: { top: 48, bottom: 48, left: 48, right: 48 },
});

const stream = fs.createWriteStream(outPath);

doc.pipe(stream);

// Header

doc.fontSize(18).font("Helvetica-Bold").text("Reunion 50 ’26 — Voter List", { align: "left" });
doc.moveDown(0.3);
doc
  .fontSize(10)
  .font("Helvetica")
  .fillColor("#444")
  .text(`Generated: ${now.toISOString().replace('T', ' ').slice(0, 19)} UTC`);
doc.moveDown(0.8);

doc.fillColor("#111");

// Table layout
const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
const colName = Math.floor(pageWidth * 0.34);
const colVenue = Math.floor(pageWidth * 0.36);
const colDate = pageWidth - colName - colVenue;

function drawRow(y, { name, venues, date_option, other_text }, isHeader = false) {
  const x = doc.page.margins.left;
  const padY = 6;
  const padX = 6;
  const lineGap = 2;

  const dateText = date_option
    ? (date_option === "other" && other_text ? `other: ${other_text}` : date_option)
    : "";

  const hName = doc.heightOfString(name, { width: colName - padX * 2, lineGap });
  const hVenue = doc.heightOfString(venues || "", { width: colVenue - padX * 2, lineGap });
  const hDate = doc.heightOfString(dateText || "", { width: colDate - padX * 2, lineGap });
  const rowH = Math.max(hName, hVenue, hDate) + padY * 2;

  // New page if needed
  if (y + rowH > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    return { y: doc.page.margins.top, rowH: 0, didPageBreak: true };
  }

  // Background
  if (isHeader) {
    doc.save();
    doc.rect(x, y, pageWidth, rowH).fill("#f2f2f2");
    doc.restore();
  } else {
    doc.save();
    doc.rect(x, y, pageWidth, rowH).stroke("#e6e6e6");
    doc.restore();
  }

  doc.fillColor("#111");
  doc
    .font(isHeader ? "Helvetica-Bold" : "Helvetica")
    .fontSize(isHeader ? 10 : 10)
    .text(name, x + padX, y + padY, { width: colName - padX * 2, lineGap });

  doc
    .font(isHeader ? "Helvetica-Bold" : "Helvetica")
    .text(venues || "", x + colName + padX, y + padY, { width: colVenue - padX * 2, lineGap });

  doc
    .font(isHeader ? "Helvetica-Bold" : "Helvetica")
    .text(dateText || "", x + colName + colVenue + padX, y + padY, { width: colDate - padX * 2, lineGap });

  return { y: y + rowH, rowH, didPageBreak: false };
}

let y = doc.y + 6;

// Column header row
({ y } = drawRow(y, { name: "Name", venues: "Venue votes", date_option: "Date vote", other_text: "" }, true));

// Body rows
for (const r of rows) {
  // If we started a new page, redraw header
  const res = drawRow(y, r, false);
  if (res.didPageBreak) {
    y = res.y;
    ({ y } = drawRow(y, { name: "Name", venues: "Venue votes", date_option: "Date vote", other_text: "" }, true));
    y = drawRow(y, r, false).y;
  } else {
    y = res.y;
  }
}

doc.moveDown(1);
doc
  .fontSize(9)
  .fillColor("#666")
  .text(`Total voters: ${rows.length}`, { align: "left" });

doc.end();

stream.on("finish", () => {
  console.log(`Wrote PDF: ${outPath}`);
});
