# MRBD Translation (EN → DE)

English → German helper for **Meta Ray-Ban Display**, built with Vite + React + TypeScript and Meta’s `@wearables-ui-toolkit/mrbd`.

## Features

- Three pages via toolkit `SubNavigationPager`: **Saved** (left) | **Translate** (center/home) | **Settings** (right)
- **Saved:** rows show source (primary) over translation (secondary); empty “No saved phrases”; select loads Translate; swipe **left** reveals Delete (swipe right returns to Translate)
- **Translate:** pair label + `InputTextView` Search; Hear / Sounds like / Save docked at bottom
- **Settings:** source/target language pickers + reading-speed slider (Hear + Sounds like); persisted in `localStorage` (only EN→DE translates today)
- Free MyMemory translate API (no paid keys)
- English phonetic “sounds like” respelling of the German
- **Hear:** German device voice (`de-*`) when available, else CORS-friendly Lingva network TTS (cached in memory). Never English phonetic on Hear.
- **Sounds-like:** English `speechSynthesis` reading the phonetic respelling
- Status uses smaller toolkit typography (`META2`)

## Develop

```bash
npm install
npm run dev
```

Open the app and validate at **600 × 600** in DevTools.

```bash
npm run build
npm run preview
```

## GitHub Pages

Live URL:

**https://steph483.github.io/MRBD-translation/**

Vite `base` is `/MRBD-translation/`. Pages deploys the Vite `dist` output via GitHub Actions.

## Add on Meta Ray-Ban Display

1. Enable Developer Mode in the Meta AI app
2. **App Settings → Apps → Web Apps → Connect Web App**
3. Paste `https://steph483.github.io/MRBD-translation/`
4. Save → open from the glasses app grid

## MRBD notes

- Meta tags: `mrbd-web-app-capable`, `description`
- Root sized with `html, body, #root { height: 100% }` and `var(--uit-color-background-window)`
- Toolkit `App` loads styles — do not import the package `styles.css` manually
- Directional focus via toolkit / browser — no custom global focus manager

## Wearables MCP

This build used the public docs when Wearables MCP (`search_webapps_docs`) was unavailable in the agent environment.
