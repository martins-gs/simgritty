# PROLOG

Verified against this repository on 2026-04-12.

PROLOG is a Next.js 16 App Router application for NHS clinical communication training. Trainees run real-time voice simulations with an AI patient or relative, educators author scenarios, and completed sessions can be reviewed with transcript, scoring, reflections, notes, and restart-from-turn forking.

## Current State

- Real-time voice simulation using the OpenAI Realtime API over WebRTC
- Scenario authoring with 14 numeric trait dials, a separate bias-category selector, voice settings, escalation rules, milestones, and scoring weights
- AI clinician takeover with its own clinician voice path and HTTP TTS fallback
- LLM-first review workflow with a saved reflection check-in, persisted `review_artifacts`, GPT-5.4 summary and timeline generation, session-level delivery synthesis from the mixed recording, per-scenario progress review, explicit debug states when review generation fails, retry CTA, a bottom-of-page score block or short-session placeholder, audio playback, and session forking
- Supabase-backed auth, session persistence, transcript/event storage, paginated recent sessions, event-backed transcript recovery for legacy trainee audio delivery, session-level delivery events, and mixed session-audio uploads

## Documentation Map

- `README.md` — current-state overview and setup caveats
- `docs/architecture-overview.md` — detailed implementation reference, verified against the codebase
- `docs/prompt-bundle-for-chatgpt-pro.md` — extracted prompt and model map for external LLM review
- `docs/elevenlabs-plan.md` — design proposal only; not implemented in this repo

## Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16.2.1 (App Router) |
| Language | TypeScript 5, React 19 |
| Styling | Tailwind CSS 4, shadcn/ui-style primitives |
| State | Zustand 5 |
| Validation | Zod 4 |
| Auth and data | Supabase Auth, Postgres, Storage |
| AI | OpenAI Realtime API, Responses API, Audio Speech API |

## Local Setup

### Prerequisites

- Node.js 20+
- npm
- A Supabase project with the existing base schema already applied
- An OpenAI API key with Realtime access

### Install

```bash
npm install
cp .env.local.example .env.local
```

### Environment Variables

Required:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin writes for transcript and session persistence |
| `OPENAI_API_KEY` | OpenAI API access |

Optional overrides:

| Variable | Default |
| --- | --- |
| `OPENAI_CLASSIFIER_MODEL` | `gpt-5.4-mini` |
| `OPENAI_VOICE_PROFILE_MODEL` | `gpt-5.4-mini` |
| `OPENAI_REVIEW_MOMENT_SELECTION_MODEL` | `gpt-5.4` |
| `OPENAI_REVIEW_SUMMARY_MODEL` | `gpt-5.4` |
| `OPENAI_REVIEW_TIMELINE_MODEL` | `gpt-5.4` |
| `OPENAI_SCENARIO_HISTORY_MODEL` | `gpt-5.4` |
| `OPENAI_SESSION_AUDIO_ANALYSIS_MODEL` | `gpt-audio` |
| `OPENAI_SESSION_AUDIO_STRUCTURER_MODEL` | `gpt-5.4` |
| `OPENAI_TRAINEE_AUDIO_ANALYSIS_MODEL` | `gpt-audio` |
| `OPENAI_TRAINEE_AUDIO_STRUCTURER_MODEL` | `gpt-5.4-mini` |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-1.5` |
| `OPENAI_REALTIME_DEFAULT_VOICE` | `marin` |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` |
| `OPENAI_TTS_CLINICIAN_MODEL` | `gpt-4o-mini-tts` |
| `OPENAI_TTS_CLINICIAN_FALLBACK_MODEL` | `gpt-4o-mini-tts` |
| `OPENAI_TTS_DEFAULT_VOICE` | `cedar` |
| `OPENAI_TTS_CLINICIAN_VOICE` | `cedar` |

### Run

```bash
npm run dev
npm run build
npm run start
npm run lint
```

The repo currently exposes a lint script, but no automated test script is checked in.

## Database Caveat

This repository does not currently include an initial Supabase bootstrap migration for the core tables such as `organizations`, `org_settings`, `user_profiles`, `scenario_templates`, `simulation_sessions`, and `transcript_turns`.

The checked-in SQL files under `supabase/migrations/` are additive migrations from 2026-03-24 onward. For a fresh Supabase project you need to:

1. Apply the existing base schema from the source project or a separate schema export.
2. Apply the checked-in migrations in timestamp order.

Without that base schema, the repo is not enough on its own to stand up a blank database.

## Application Surface

### Pages

| Route | Purpose |
| --- | --- |
| `/` | Marketing and product overview |
| `/auth/login` | Magic-link sign-in for `@nhs.scot` addresses |
| `/dashboard` | Published scenarios and paginated recent sessions |
| `/scenarios` | Scenario list, duplication, archive, edit entry points |
| `/scenarios/new` | New scenario creation |
| `/scenarios/[id]` | Scenario editor |
| `/scenarios/[id]/briefing` | Content warning and pre-simulation briefing |
| `/simulation/[sessionId]` | Live simulation runtime |
| `/review/[sessionId]` | Review, scoring, notes, and restart-from-turn |
| `/settings` | Organisation settings UI |

### API Groups

- Realtime and voice: `/api/realtime/session`, `/api/classify`, `/api/deescalate`, `/api/voice-profile/patient`, `/api/voice-profile/trainee`, `/api/analysis/trainee-delivery`, `/api/tts`
- Scenarios: `/api/scenarios`, `/api/scenarios/[id]`, `/api/scenarios/[id]/publish`
- Sessions: `/api/sessions`, `/api/sessions/recent`, `/api/sessions/[id]`, `/api/sessions/[id]/start`, `/api/sessions/[id]/end`, `/api/sessions/[id]/delete`, `/api/sessions/[id]/fork`, `/api/sessions/[id]/transcript`, `/api/sessions/[id]/events`, `/api/sessions/[id]/educator-notes`, `/api/sessions/[id]/reflection`, `/api/sessions/[id]/review-summary`, `/api/sessions/[id]/timeline-feedback`, `/api/sessions/[id]/scenario-history`, `/api/sessions/[id]/session-delivery`, `/api/sessions/[id]/review-precompute`, `/api/sessions/[id]/audio`
- Identity and governance: `/api/profile`, `/api/org-settings`

Notes:

- `POST /api/voice-profile/trainee` and `PATCH /api/sessions/[id]/transcript` are internal app endpoints used by the live simulation flow.
- `GET /api/sessions/recent` supports `limit` and `offset`, and the dashboard now loads recent sessions 20 at a time with a `Load older sessions` CTA.
- `POST /api/sessions/[id]/session-delivery` is the current full-session delivery-analysis route used after upload of the mixed recording.
- `POST /api/sessions/[id]/review-precompute` prebuilds summary and timeline artifacts immediately after session end.
- `GET /api/sessions/[id]/transcript` now backfills missing `trainee_delivery_analysis` from saved `classification_result` fallback events before returning transcript rows.
- `src/proxy.ts` runs on app routes and API routes so Supabase auth is refreshed before long-lived simulations hit protected handlers.

## Current Implementation Notes

- The live simulation currently uses two realtime voice paths: the primary patient conversation path and a separate clinician renderer path.
- Session audio is recorded as one mixed file and uploaded to the `simulation-audio` Supabase Storage bucket at session end.
- After the recording upload, `/api/sessions/[id]/session-delivery` analyses the full mixed session audio and persists supported session-level delivery evidence as a `classification_result` event with `__event_kind: "session_audio_delivery"`.
- The live classifier still consumes an inferred trainee voice profile derived from text and context, not direct live audio. The audio-aware delivery path is currently the post-session session-level analysis rather than the live turn loop.
- Patient voice-profile generation now consumes the latest inferred speaker delivery profile, so live patient tone can react to how the trainee or clinician seemed to sound, not just to the words themselves.
- `POST /api/sessions/[id]/review-precompute` builds the top-half review surfaces into `simulation_sessions.review_artifacts`. On the portal this can legitimately take 1-2 minutes after `End scenario`.
- The Session Summary and Conversation Timeline are now LLM-first surfaces over a persisted review evidence ledger plus explicit debug metadata. Learner-facing deterministic fallback prose has been removed.
- The Session Summary can add an `Overall Delivery` note when the session-level delivery aggregate shows a noticeable overall pattern or shift under pressure.
- Timeline cards are generated through GPT-5.4 moment selection plus GPT-5.4 timeline rendering over the stored evidence ledger, not directly from score-ranked canned review moments.
- `Review your progress` is now stored per learner+scenario and reused across that learner's review pages for the same scenario. It refreshes when scenario history changes, and older review pages can therefore show a panel that includes later runs.
- Scoring still powers the bottom-of-page score block and evidence ledger, but the top-half review surfaces are no longer organised around direct score-picked coaching text.
- Scenario milestones directly affect clinical-task scoring and review coaching. Free-text learning objectives do not change the numeric score directly, but they are still fed into the review summary as narrative objective guidance.
- Sessions of 3-6 trainee turns still score as preliminary sessions, but extreme dimension scores are now softened to avoid hard zeros or hundreds from sparse evidence.
- Sessions with fewer than 3 trainee turns still suppress the numeric score, but the top-half review surfaces can still render if there is enough evidence. The short-session score placeholder remains at the very bottom of the page where the full score would normally appear.
- `max_escalation_ceiling` and `max_session_duration_minutes` are actively enforced at runtime.
- `allow_discriminatory_content` and `require_consent_gate` are stored in `org_settings`, but they are not yet used to disable discriminatory scenarios or bypass the consent gate. The briefing flow currently always shows the consent gate.
- Access is limited to `@nhs.scot` email addresses through Supabase magic-link auth.
- Read access to scenarios, sessions, transcript data, and review data is intentionally broad for authenticated users in the current phase. Full RBAC is not yet implemented.

## Project Layout

```text
src/
  app/                 Next.js pages and route handlers
  components/          Landing, layout, scenario, simulation, review, and UI components
  hooks/               WebRTC, recording, and live-session hooks
  lib/                 Engine logic, OpenAI integration, validation, Supabase helpers
  store/               Zustand stores
  types/               Shared domain types
supabase/migrations/   Additive SQL migrations checked into the repo
docs/                  Living technical documentation
```

For the detailed runtime breakdown, see `docs/architecture-overview.md`.
