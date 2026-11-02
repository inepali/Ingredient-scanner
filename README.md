# Ingredient Scanner

Personal tool: upload an ingredient-label photo plus product media, get a 0–100
ingredient report, an AI-voiced 60s vertical video, and post copy. You download
the video and post it manually. No auth (single user).

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. Run `supabase/migrations/0001_init.sql` in your Supabase project, then create a private storage bucket named `media`.
4. `npm run dev`

When deploying to Vercel, turn on password protection so nobody else can spend your AI credits.

## Build order

1. Scaffold + database schema (this commit)
2. Upload screen, label analysis, scoring, report
3. Script, AI voice, social copy
4. Product footage (image-to-video), video composition
5. Review screen, regenerate, download
6. Later: auto-posting

Spec: see the MVP spec doc in the Claude project.
