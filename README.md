# Ingredient Scanner

Personal tool: upload an ingredient-label photo plus product media, get a 0–100
ingredient report, an AI-voiced 60s vertical video, and post copy. You download
the video and post it manually. No auth (single user).

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. Run `supabase/migrations/0001_init.sql`, `0002_seed_reference_and_allergens.sql` and `0003_lock_down_and_media_bucket.sql` in order in your Supabase SQL editor (0003 enables RLS; files themselves live in Cloudflare R2, see `.env.example`).
4. `npm run dev`, open the app, and upload a label photo.
5. Set `MOCK_AI=true` to try the whole flow for free (silent voice, clips reuse your photos). Turn it off when you add real ElevenLabs and fal.ai keys.
6. `npm test` runs the scoring and parsing unit tests (plain Node, no install needed).

When deploying to Vercel, turn on password protection so nobody else can spend your AI credits.

## Build order

1. Scaffold + database schema (done)
2. Upload screen, label analysis, scoring, report (done; product media upload moves to step 4 because videos exceed Vercel's 4.5 MB request limit and need direct-to-Supabase uploads)
3. Script, AI voice (ElevenLabs), social copy (done)
4. Product photos and animated clips (fal.ai Wan 2.5) (done); video composition with captions (next)
5. Review screen, regenerate, download
6. Later: auto-posting

Spec: see the MVP spec doc in the Claude project.

## Open Food Facts cross-check
After the label is read, the scan is looked up on Open Food Facts (by barcode if one is printed, otherwise by name, accepted only when the ingredient list matches well). Nutri-Score (50%), NOVA (35%) and Green-Score (15%) become an outside score that makes up 40% of the overall score. The report shows both scores, the grades, palm oil, additives and per-100 g nutrients. No key needed. Needs migration `0005_open_food_facts.sql`.

## Voice takes
Every voiceover you generate is kept as a "take" in the R2 videos bucket (`scans/<scan>/voiceovers/`), listed on the Voice tab with a player, Download and Delete. The newest take is selected automatically; press "Use this one" on another to switch (this clears the final video so you can render it again). Generate takes with different voices and Delivery (Natural, Expressive, Steady) to compare. A take is tied to the script it was made for, so after you rewrite the script, older takes are marked "Earlier script" and can't be selected. Needs migration `0006_voiceovers.sql` (also brings existing audio into the list).

## Final video
"Generate video" renders a 1080x1920 (9:16) H.264 MP4 with ffmpeg: clips (or photos with a slow zoom) change with the narration, bold captions are timed to the voice, and a score badge sits at the top. It uses no AI credits. A 60 s video takes about 30 s to render on 2 cores.
- The page shows the stage, a percent bar and elapsed time, with a Cancel button. A render that goes quiet for 3 minutes is marked failed.
- When it finishes, review the video, then press "Generate social copy" for TikTok and Instagram titles, descriptions and hashtags. Edit and save them per platform.
- Runs in the same server via `after()`; the route allows up to 300 s (`maxDuration`). Check your Vercel plan's limit. `npm run dev` on your own machine has no limit.
- ffmpeg is found automatically: `FFMPEG_PATH`, then the `ffmpeg-static` package (installed by `npm install`), then `ffmpeg` on your PATH (macOS: `brew install ffmpeg`). If none is found the Generate video button says so right away. The caption font (DejaVu Sans Bold) lives in `assets/fonts`.
- Source clips are 480p/720p, so the 1080x1920 output is upscaled: text is sharp, footage is not truly 1080p.

## Cost guards

- Clips are 5 seconds each, 480p draft by default ($0.05/s, about $0.25 per clip); 720p final is $0.10/s. 1080p is not offered.
- At most `MAX_CLIPS` (default 4) clips per scan; photos that already have a clip are skipped.
- Voiceover is refused above `MAX_VOICE_CHARS` (default 1800 characters).
- The UI shows the estimated fal.ai cost before you start, and each job's cost is logged in the `jobs` table.
