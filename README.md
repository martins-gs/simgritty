# PROLOG

Verified against this repository on 2026-04-11.

PROLOG is a Next.js 16 App Router application for NHS clinical communication training. Trainees run real-time voice simulations with an AI patient or relative, educators author scenarios, and completed sessions can be reviewed with transcript, scoring, reflections, notes, and restart-from-turn forking.

## Current State

- Real-time voice simulation using the OpenAI Realtime API over WebRTC
- Scenario authoring with 14 numeric trait dials, a separate bias-category selector, voice settings, escalation rules, milestones, and scoring weights
- AI clinician takeover with its own clinician voice path and HTTP TTS fallback
- Review workflow with a saved reflection check-in, persisted educator-style session summaries, a coaching timeline, per-scenario progress review, retry CTA, score cards or short-session placeholders, audio playback, and session forking
- Supabase-backed auth, session persistence, transcript/event storage, and mixed session-audio uploads

## Documentation Map

- `README.md` — current-state overview and setup caveats
- `docs/architecture-overview.md` — detailed implementation reference, verified against the codebase
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
| `/dashboard` | Published scenarios and recent sessions |
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
- Sessions: `/api/sessions`, `/api/sessions/recent`, `/api/sessions/[id]`, `/api/sessions/[id]/start`, `/api/sessions/[id]/end`, `/api/sessions/[id]/delete`, `/api/sessions/[id]/fork`, `/api/sessions/[id]/transcript`, `/api/sessions/[id]/events`, `/api/sessions/[id]/educator-notes`, `/api/sessions/[id]/reflection`, `/api/sessions/[id]/review-summary`, `/api/sessions/[id]/scenario-history`, `/api/sessions/[id]/audio`
- Identity and governance: `/api/profile`, `/api/org-settings`

Notes:

- `POST /api/voice-profile/trainee` and `PATCH /api/sessions/[id]/transcript` are internal app endpoints used by the live simulation flow.
- Middleware runs on app routes and API routes so Supabase auth is refreshed before long-lived simulations hit protected handlers.

## Current Implementation Notes

- The live simulation currently uses two realtime voice paths: the primary patient conversation path and a separate clinician renderer path.
- Session audio is recorded as one mixed file and uploaded to the `simulation-audio` Supabase Storage bucket at session end.
- The review page stores the Session Summary JSON on `simulation_sessions.review_summary` after first generation, so the learner sees the same summary on later visits instead of a fresh variant each time.
- The review page also builds a deterministic `Review your progress` panel from the current user's non-deleted sessions in the same scenario, so the session count reflects historical sessions rather than utterances.
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
