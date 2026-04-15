# web-book-reader-tts

Cloudflare Worker that proxies [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech) for the [web-book-reader](https://github.com/SebastianBarros/web-book-reader) audiobook mode. Keeps the Google API key server-side, gates access to known origins, and streams MP3 back to the browser.

**Deployed:** `https://web-book-reader-tts.sebastianbarros1995.workers.dev`

## Why this exists

The reader's cloud audiobook mode uses Google Cloud TTS for high-quality neural voices (Chirp-HD / Neural2 / Studio). Google's API requires an auth token. Embedding it in the public reader client would leak it immediately. This Worker is the minimum viable shim: the browser posts plain text, the Worker signs the Google request with its secret key, returns the MP3.

The reader defaults to the Cloud provider (this Worker) and falls back to the OS's built-in `speechSynthesis` when the user toggles Browser mode. Full architecture + design rationale: [cloudflare-google-tts.md](https://github.com/SebastianBarros/web-book-reader/blob/master/cloudflare-google-tts.md) in the reader repo.

## Endpoints

- `POST /tts` — body `{ text, voice?, lang?, rate?, pitch? }`. Returns `audio/mpeg` (MP3). Max 5000 chars per call.
- `GET /voices?languageCode=es-ES` — returns `{ voices: [...] }` from Google. `languageCode` is optional; omit to get all.
- `GET /` — plain-text "is alive" for manual checking.

## Local development

```bash
npm install
# create a local secret file (NOT committed):
echo "GOOGLE_API_KEY=AIza..." > .dev.vars
npm run dev   # serves on http://localhost:8787
```

Test:

```bash
curl -X POST http://localhost:8787/tts \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:5173' \
  -d '{"text":"Hola, esto es una prueba.","voice":"es-ES-Neural2-F","rate":1.0}' \
  --output out.mp3
```

## Deploy

First time:

```bash
wrangler login                         # OAuth in your browser, one-time
wrangler secret put GOOGLE_API_KEY     # paste the key, it gets encrypted
wrangler deploy
```

The output includes the worker URL, like `https://web-book-reader-tts.<your-subdomain>.workers.dev`. Update the Google API key's HTTP-referrer restriction in the Cloud Console to match that URL, and add the same URL to `ALLOWED_ORIGINS` in `wrangler.toml` if the frontend ever calls it cross-origin (usually not needed — the frontend is the client, not the worker).

Subsequent deploys: `npm run deploy`.

## Configuration

Open `wrangler.toml` and update `ALLOWED_ORIGINS` (comma-separated, no spaces) to match the frontend's origins:

- `http://localhost:5173` for dev.
- `https://sebastianbarros.github.io` for the GitHub Pages deploy.

Any `Origin` not in this list gets a 403.

## Cost

- Cloudflare Workers free tier: 100k req/day.
- Google Cloud TTS free tier: 1M chars/month for Neural2 voices (~2.5 novels). Overshoot is $16 per extra million.

Keep a $1 budget alert on the Google project to be safe.

## Rollback

```bash
wrangler delete
```

Removes the Worker. Also disable the Google API key in the Cloud Console if you're decommissioning.
