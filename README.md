# MRBD Translation (EN → DE)

English → German helper for **Meta Ray-Ban Display** glasses: translate a phrase, see an English-friendly phonetic spelling, hear real German audio when online, and save favorites in `localStorage`.

## Features

- Semantic `<textarea>` so the system composer (type / dictate / handwriting) works
- Free MyMemory translate API (no paid keys)
- English phonetic “sounds like” respelling of the German
- Network German TTS when online; falls back to phonetic + English `speechSynthesis`
- Live translate + hear without saving
- Saved phrase list with re-hear / delete

## Local preview

Serve the folder over HTTP (ES modules):

```bash
npx --yes serve -l 4173 .
```

Open `http://localhost:4173` and set DevTools to **600 × 600**.

## GitHub Pages

Live URL:

**https://steph483.github.io/MRBD-translation/**

Hosting is **Deploy from branch `main` / `/ (root)`** (with `.nojekyll`). An Actions workflow is also present if you switch Pages source to GitHub Actions later.

## Add on Meta Ray-Ban Display

1. Enable Developer Mode in the Meta AI app
2. **App Settings → Apps → Web Apps → Connect Web App**
3. Paste the public HTTPS Pages URL and Save
4. Open the app from the glasses app grid

## MRBD notes

- Meta tags: `mrbd-web-app-capable`, `description`
- Dark / high-contrast UI for additive display
- Layout sizes from the viewport; intentional scroll in the main content area
- No custom global focus manager — browser directional navigation

## Wearables MCP

This build used the public docs when Wearables MCP (`search_webapps_docs`) was unavailable in the agent environment.
