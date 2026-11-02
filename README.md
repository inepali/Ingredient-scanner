# Ingredient Scanner

Personal tool: upload an ingredient-label photo plus product media, get a 0–100
ingredient report, an AI-voiced 60s vertical video, and post copy. You download
the video and post it manually. No auth (single user).

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. Run `supabase/migrations/0001_init.sql`, `0002_seed_reference_and_allergens.sql` and `0003_lock_down_and_media_bucket.sql` in order in your Supabase SQL editor (0003 enables RLS and creates the private `media` bucket).
4. `npm run dev`, open the app, and upload a label photo.
5. `npm test` runs the scoring and parsing unit tests (plain Node, no install needed).

When deploying to Vercel, turn on password protection so nobody else can spend your AI credits.

## Build order

1. Scaffold + database schema (done)
2. Upload screen, label analysis, scoring, report (done; product media upload moves to step 4 because videos exceed Vercel's 4.5 MB request limit and need direct-to-Supabase uploads)
3. Script, AI voice, social copy
4. Product footage (image-to-video), video composition
5. Review screen, regenerate, download
6. Later: auto-posting

Spec: see the MVP spec doc in the Claude project.
