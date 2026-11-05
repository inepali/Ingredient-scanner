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

## Social tab: connect Instagram, TikTok and YouTube

The Social tab holds the post copy and, once an account is connected, a **Post** button that sends the final video plus your saved title, description and hashtags.

**Before you start**
1. Set `APP_PASSWORD` (the whole app then asks for it) and `TOKEN_ENCRYPTION_KEY` in Vercel. Connecting is refused without a password, because a connected account can post as you.
2. Set `APP_URL` to your deployed https address. Platforms don't accept `http://localhost` redirects for this.
3. Run migration `0007_social_accounts.sql` (already applied to the linked Supabase project).

**TikTok** (developers.tiktok.com)
- Create an app, add the **Login Kit** and **Content Posting API** products (Direct Post on), request scopes `user.info.basic` and `video.publish`.
- Redirect URI: `https://YOUR-APP/api/social/tiktok/callback`. Put the keys in `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
- Until TikTok audits your app, posts can only be **private ("Only me")**; choosing anything else returns `unaudited_client_can_only_post_to_private_accounts`. Add your own TikTok account as a target user while the app is in development.

**Instagram** (developers.facebook.com, "Instagram API with Instagram Login")
- Needs a **Business or Creator** Instagram account. Create a Meta app, add the Instagram product, permissions `instagram_business_basic` and `instagram_business_content_publish`.
- Redirect URI: `https://YOUR-APP/api/social/instagram/callback`. Put the id/secret in `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`. In development mode, add your account as a tester/role.
- Instagram fetches the video from a short-lived signed R2 link, so the videos bucket must be reachable from the internet (signed URLs are).
- The 60-day token renews itself when you post.

Posts show "processing" until the platform finishes, then flip to posted. A video is never posted twice to the same platform unless you click "Post again". None of the platform calls could be run from the build sandbox; the first real post is the test.

## Barcode instead of a label photo

On the new-scan page (and the phone upload page) use **Scan the barcode instead**: the camera reads the code (Chrome/Edge/Android; iPhone Safari can't yet, so type the digits under the bars), the product and its ingredient list come from Open Food Facts, and **Analyze product** scores that list the same way as a photo. If the product isn't on Open Food Facts or has no ingredient list, photograph the label instead. A label photo, if you add one, takes priority over the barcode list.

## Your own product videos (Animation tab)

Upload real footage (MP4, MOV, WebM, up to 150 MB, 6 per scan) on the Animation tab. Videos go straight from your browser to the R2 **videos** bucket, because Vercel can't pass files that large through a function, so the bucket needs a CORS rule. In Cloudflare: R2 → your videos bucket → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-APP.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

When you upload videos, **they are the video**: joined whole, in the order you set (← → arrows under each one), under the voiceover. Nothing is trimmed, and photos and AI clips are left out. Wide or square footage is shown in full over a blurred background instead of being cropped.
- Footage **shorter** than the voiceover is slowed down evenly (never below half speed); if even half speed is too short, the sequence repeats from the first video until the voiceover is covered.
- Footage **longer** than the voiceover plays in full, so the video runs a little past the voice (the audio is padded with silence).
- The videos' own sound is replaced by the voiceover. No AI credits are used.

## Public report page

Public Page tab → **Make public** → Make public. The page `/p/<scan id>` shows the score ring and the full ingredient breakdown, works without the password, and is not indexed by search engines. It's off by default; turning it off makes the link return "not found". When a scan is public, the link is added to the caption when you post from the Social tab.

The video's score is now the same ring as the page header (coloured arc from the top, number in the middle).

## YouTube (Social tab)

1. console.cloud.google.com → new project → **APIs & Services → Library** → enable **YouTube Data API v3**.
2. **OAuth consent screen**: External, add yourself under **Test users**.
3. **Credentials → Create credentials → OAuth client ID → Web application**, redirect URI `https://YOUR-APP/api/social/youtube/callback`.
4. Set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in Vercel and redeploy, then **Connect YouTube** on the Connect & Post tab.

The video is uploaded as a Short (`#Shorts` is added). YouTube has no copy of its own: it uses the Instagram title/description/hashtags (TikTok's if there is no Instagram copy). Until Google audits the project, uploads are forced to **private**; each upload uses about 1,600 of the 10,000 free daily quota units.

When the public page is on, its link is inserted right after the "not medical advice" line of every post description.

## Layout

On a scan, the steps (Ingredients, Script, Voice, Animation, Final Video, Social) are a left sidebar on desktop, with a number or a green check for each step and a pulsing dot while something is running. On a phone the sidebar becomes a scrolling bar across the top. The current step is kept in the URL (`#voice`), so a reload keeps your place.
