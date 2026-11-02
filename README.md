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

## Cost guards

- Clips are 5 seconds each, 480p draft by default ($0.05/s, about $0.25 per clip); 720p final is $0.10/s. 1080p is not offered.
- At most `MAX_CLIPS` (default 4) clips per scan; photos that already have a clip are skipped.
- Voiceover is refused above `MAX_VOICE_CHARS` (default 1800 characters).
- The UI shows the estimated fal.ai cost before you start, and each job's cost is logged in the `jobs` table.
