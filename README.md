# Reunion 50 ’26 – Slideshow + Poll

Mobile-first slideshow web app ending with a live poll.

## Run locally (VPS)

```bash
cd reunion50-26
npm i
PORT=5173 npm run dev
```

Open: `http://<server-ip>:5173`

## What’s included

- 5 slides:
  1. Title (placeholder background video)
  2. Kadavu, Calicut
  3. Vythiri Village, Wayanad
  4. KTDC Bolgatty
  5. Poll (3 options)

- Backend:
  - `GET /api/results`
  - `POST /api/vote` with body `{ option: "kadavu"|"vythiri"|"bolgatty", token: "..." }`

Votes are stored in `data/votes.json`.

## Replace placeholder video

Put your files here:
- `public/assets/hero-placeholder.mp4`
- `public/assets/hero-poster.jpg`

Keep video muted/autoplay-friendly (mobile browsers).
