# AGENTS.md

Instructions for AI coding agents working on this codebase.

## Project Overview

**Reunion 50 '26** — A mobile-first slideshow web app with a live poll for a school reunion event. Built with vanilla HTML/JS frontend served by an Express backend with SQLite storage.

## Tech Stack

- **Runtime**: Node.js (ESM modules, `"type": "module"`)
- **Server**: Express 5
- **Database**: SQLite via `better-sqlite3`
- **Auth**: SMS OTP via Twilio, HMAC-signed tokens
- **PDF**: PDFKit for voter exports
- **Frontend**: Vanilla HTML/CSS/JS (no framework, no bundler)

## Project Structure

```
server.js          # Express server — API routes, OTP auth, voting
auth-store.js      # Auth utilities (hashing, HMAC tokens, phone normalization)
db.js              # SQLite schema, queries (votes, users, venue votes)
public/            # Static frontend (served by Express)
  index.html       # SPA — slideshow + poll UI
  app.js           # Client-side logic
  style.css        # Styles
  assets/          # Media files (videos, images)
data/              # Runtime data (gitignored, contains PII)
  reunion50.sqlite # SQLite database
  auth.json        # OTP state store
  allowed_phones.json  # Phone allowlist
  fixed_otp_phones.txt # Fixed OTP bypass list
scripts/           # CLI utilities
  add-allowed-phone.js     # Add phone to allowed list
  add-fixed-otp-phone.js   # Add phone to fixed OTP list
  export_voters_pdf.js     # Export voter list as PDF
```

## Running Locally

```bash
npm install
npm run dev        # starts on port 5173
```

Requires a `.env` with Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`).

## Key Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `REUNION50_PORT` | Server port | `5173` |
| `REUNION50_FIXED_OTP_CODE` | Fixed OTP bypass code | `550055` |
| `REUNION50_ALLOW_ALL` | Skip phone allowlist (`"true"` to allow all) | unset |

## Coding Conventions

- **ESM only** — use `import`/`export`, not `require`
- **No TypeScript** — plain JavaScript
- **No build step** — frontend is served as-is from `public/`
- All phone numbers use **E.164 format** (`+[country][number]`)
- `data/` directory is **gitignored** — never commit PII or runtime state
- Database operations use **synchronous** `better-sqlite3` API
- Auth tokens are **HMAC-signed** (not JWTs)

## Deployment

- VPS at `~/.openclaw/workspace/reunion50-26/`
- Runs as plain `node server.js` process (no PM2)
- Restart via `bash run.sh` (kills old process, starts new one)
- Nginx reverse proxies to port 5173

## Testing

No automated test suite. Manual testing via browser and API calls.

## Important Gotchas

- `data/` is gitignored — must be created manually on new deployments
- `fixed_otp_phones.txt` is loaded at server startup — restart required after changes
- `allowed_phones.json` is read on each request — no restart needed
- Twilio credentials are loaded from `/var/www/fleetapt/.env` (shared with another app)
- The `isPhoneAllowed()` function can be toggled to allow all users
