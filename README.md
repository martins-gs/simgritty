# PROLOG

Real-time voice simulation platform for NHS clinical communication training. Trainees practice managing difficult conversations with AI-driven simulated patients or relatives that respond dynamically to tone, technique, and emotional delivery. Educators author scenarios, governance admins set org-wide guardrails, and a review engine scores completed sessions across composure, de-escalation effectiveness, clinical task maintenance, and appropriate support-seeking.

Built with Next.js 16, OpenAI Realtime API (WebRTC), and Supabase.

## Features

- **Live voice simulation** — speak to an AI counterpart (patient, relative, or staff member) via your laptop or mobile microphone and speakers; the simulated person responds in real time with emotionally adaptive voice, stronger abusive language at high patient state, and authored bias behaviour when configured
- **Escalation engine** — 10-level state machine tracks trust, anger, frustration, and willingness to listen across every turn
- **Dual classifier pipeline** — assesses trainee communication technique (effectiveness -1.0 to +1.0) and patient state shifts independently
- **Trainee audio delivery analysis** — each trainee utterance can be analysed asynchronously from the actual microphone audio for delivery markers such as `warm_empathic`, `flat_detached`, `tense_hurried`, or `defensive_tone`
- **AI clinician support** — press "Ask AI clinician for help" to hand off temporarily to an expert bot that models best practice, then "Resume conversation" when ready
- **Session forking** — restart from any turn in a completed session to try a different approach
- **Performance scoring** — 0-100 score across four dimensions (composure, de-escalation, clinical task maintenance, support seeking) with scenario-defined weights and qualitative labels (Strong / Developing / Needs practice)
- **Scenario builder** — 15 personality trait dials, explicit bias categories + intensity, voice configuration, escalation rules, archetype presets, clinical milestones, and scoring weights
- **Review & reflection** — score card or short-session placeholder, trainee reflection, escalation timeline, annotated transcript, key moments, technique suggestions, event log, and educator notes
- **Organisation governance** — ceiling caps, consent gates, content warnings, session duration limits

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                             Next.js App Router                               │
│                                                                              │
│  /simulation/[sessionId]      /review/[sessionId]      /dashboard /scenarios │
│  - live orchestration         - transcript + scoring   - authoring + history │
├──────────────────────────────────────────────────────────────────────────────┤
│                         Client Runtime On /simulation                        │
│                                                                              │
│  useRealtimeSession          useRealtimeVoiceRenderer      page.tsx          │
│  - patient WebRTC            - clinician WebRTC voice     - bot loop         │
│  - mic gating                - playback completion        - transcript sync   │
│  - prompt/session updates    - response lifecycle wait    - state updates     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                API Routes                                    │
│                                                                              │
│  /api/realtime/session        /api/classify          /api/voice-profile/patient │
│  /api/analysis/trainee-delivery                                         │
│  /api/deescalate              /api/tts               /api/sessions/* /api/scenarios/* │
├──────────────────────────────────────────────────────────────────────────────┤
│                         Domain / Orchestration Layer                         │
│                                                                              │
│  promptBuilder      escalationEngine      classifierPipeline                 │
│  structuredVoice    clinicianVoiceBuilder renderVoiceProfile                 │
├──────────────────────────────┬──────────────────────────────┬────────────────┤
│ OpenAI Realtime API          │ OpenAI Responses / Audio API │ Supabase       │
│ - patient conversation       │ - gpt-5.4-mini classify      │ - auth         │
│ - clinician voice renderer   │ - gpt-5.4-mini voice profile │ - scenarios    │
│ - gpt-4o-mini-transcribe     │ - gpt-5.4-mini clinician turn│ - sessions     │
│                              │ - gpt-audio trainee delivery │ - transcript   │
│                              │ - gpt-4o-mini-tts fallback   │ - events       │
└──────────────────────────────┴──────────────────────────────┴────────────────┘
```

More detail: [docs/architecture-overview.md](docs/architecture-overview.md)

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project with the schema applied (see [Database Setup](#database-setup))
- An [OpenAI](https://platform.openai.com) API key with access to Realtime API

### Installation

```bash
git clone https://github.com/martins-gs/simgritty.git
cd simgritty
npm install
```

### Environment Variables

Copy the example and fill in your keys:

```bash
cp .env.local.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only) |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `OPENAI_CLASSIFIER_MODEL` | No | Classification model (default: `gpt-5.4-mini`) |
| `OPENAI_VOICE_PROFILE_MODEL` | No | Voice profile generation model (default: `gpt-5.4-mini`) |
| `OPENAI_TRAINEE_AUDIO_ANALYSIS_MODEL` | No | Background audio-analysis model for trainee delivery (default: `gpt-audio`) |
| `OPENAI_TRAINEE_AUDIO_STRUCTURER_MODEL` | No | Text model used to re-structure weak audio-model JSON when needed (default: `gpt-5.4-mini`) |
| `OPENAI_REALTIME_MODEL` | No | Realtime voice model (default: `gpt-realtime-1.5`) |
| `OPENAI_REALTIME_DEFAULT_VOICE` | No | Default patient voice (default: `marin`) |

For Vercel deployments, the server-side Supabase variables must be present in **Preview** as well as **Production**. In particular, `SUPABASE_SERVICE_ROLE_KEY` is required for the direct transcript-row persistence path.

### Running

```bash
npm run dev       # development (Turbopack)
npm run build     # production build
npm run start     # production server
```

Open [http://localhost:3000](http://localhost:3000).

## Database Setup

PROLOG uses Supabase Postgres. Apply migrations from `supabase/migrations/` or create the following tables:

### Tables

| Table | Purpose |
|-------|---------|
| `organizations` | Multi-tenant org entity |
| `org_settings` | Governance: ceiling caps, consent gates, session duration limits |
| `user_profiles` | User accounts linked to org + role (admin/educator/trainee) |
| `scenario_templates` | Scenario metadata: title, setting, roles, backstory, difficulty, scoring weights, support/critical thresholds |
| `scenario_traits` | 15 personality dials per scenario (0-10 each) plus `bias_category` |
| `scenario_voice_config` | Voice parameters: voice name, speaking rate, expressiveness, pause/interruption styles |
| `escalation_rules` | Initial level, ceiling, auto-end threshold, custom triggers |
| `scenario_milestones` | Optional clinical milestones per scenario (description + classifier hint, max 10) |
| `simulation_sessions` | Individual runs with scenario snapshot, escalation tracking, fork lineage |
| `transcript_turns` | Each utterance with classifier result, state snapshot, voice profile, and optional trainee audio-delivery analysis |
| `simulation_state_events` | All state changes: escalation, de-escalation, ceiling, session lifecycle, plus fallback per-turn delivery events when direct transcript persistence is unavailable |
| `session_scores` | Legacy/optional table for persisted scoring snapshots; current review UI computes scores on demand |
| `session_score_evidence` | Legacy/optional table for persisted score evidence; current review UI derives evidence from transcript turns and events |
| `session_reflections` | Trainee self-reflection (tags + free text, separate from performance record) |
| `educator_notes` | Post-session feedback anchored to specific turns |

### Key Schema Details

**`scenario_traits`** — 15 numeric dials (0-10):
hostility, frustration, impatience, trust, willingness_to_listen, sarcasm, bias_intensity, volatility, boundary_respect, coherence, repetition, entitlement, interruption_likelihood, escalation_tendency, plus bias_category (string).

**`simulation_sessions`** supports forking:
- `forked_from_session_id` / `forked_from_turn_index` — restart from a specific turn
- `scenario_snapshot` (JSONB) — entire scenario frozen at session creation
- `peak_escalation_level` / `final_escalation_level` — tracked for scoring
- `exit_type` — how the session ended: `normal` (end button), `instant_exit` (early exit or abandoned), `educator_ended`, `timeout`, `auto_ceiling` (escalation ceiling reached), `max_duration` (org time limit reached)

**`transcript_turns`** stores per-turn snapshots:
- `classifier_result` (JSONB) — `{technique, effectiveness, tags, confidence, reasoning}` plus scoring fields for trainee turns: `composure_markers`, `de_escalation_attempt`, `de_escalation_technique`, `clinical_milestone_completed`
- `trainee_delivery_analysis` (JSONB) — optional audio-derived delivery assessment for trainee turns: `{source, confidence, summary, markers[], acousticEvidence[], duration_ms, voiceProfile}`
- `state_after` (JSONB) — full `EscalationState` after this turn
- `patient_voice_profile_after` (JSONB) — voice delivery profile for the next patient response
- `patient_prompt_after` — the regenerated 4-layer system prompt

The trainee audio-delivery payload supports multiple markers per utterance. `confidence` means confidence in the system's audio reading, not how "confident" the trainee sounded.

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Marketing landing page with Start Here / Sign In CTAs
│   ├── auth/
│   │   ├── login/page.tsx        # Email OTP login (NHS.scot addresses only)
│   │   ├── signup/page.tsx       # Redirects to login (no separate signup)
│   │   ├── confirm/page.tsx      # Magic-link landing page with final confirmation step
│   │   ├── confirm/confirm-client.tsx # Client-side OTP verification + dashboard redirect
│   │   └── callback/route.ts     # PKCE code exchange
│   ├── dashboard/page.tsx        # Scenarios + recent sessions
│   ├── scenarios/
│   │   ├── page.tsx              # Scenario list with search/filter
│   │   ├── new/page.tsx          # Create scenario
│   │   └── [id]/
│   │       ├── page.tsx          # Edit scenario (traits, voice, rules)
│   │       └── briefing/page.tsx # Pre-simulation consent + briefing
│   ├── simulation/
│   │   └── [sessionId]/page.tsx  # Live simulation (WebRTC + controls)
│   ├── review/
│   │   └── [sessionId]/page.tsx  # Post-session review + scoring
│   ├── settings/page.tsx         # Organisation governance
│   └── api/                      # API routes (see below)
│
├── components/
│   ├── landing/                  # HeroTextRotator, PrivacyStatement, IsometricDiagramV3
│   ├── layout/                   # AppShell, Sidebar (hidden on mobile), TopBar (includes mobile nav)
│   ├── simulation/               # Waveform, LiveTranscript, EscalationMeter, ConsentGate
│   ├── scenarios/                # ScenarioForm, TraitDialPanel, VoiceConfigPanel, ArchetypeSelector, ScoringConfigPanel, MilestonesEditor
│   ├── review/                   # TranscriptViewer, EscalationTimeline, EventLog, ScoreCard, KeyMoments, ReflectionPrompt, EducatorNotes
│   ├── governance/               # OrgSettingsForm
│   └── ui/                       # shadcn/ui v4 primitives
│
├── hooks/
│   ├── useRealtimeSession.ts     # WebRTC peer connection, VAD, mic gating, transcripts
│   ├── useRealtimeVoiceRenderer.ts # Independent WebRTC for clinician bot voice
│   └── useSessionRecorder.ts     # MediaRecorder on merged mic + remote streams
│
├── lib/
│   ├── engine/
│   │   ├── biasBehaviour.ts     # Shared bias-category formatting + activation logic
│   │   ├── escalationEngine.ts   # 10-level state machine with trust/anger/frustration dynamics
│   │   ├── classifierPipeline.ts # Dual classifier: trainee technique + patient state assessment
│   │   ├── promptBuilder.ts      # 4-layer system prompt (immutable, state, memory, voice)
│   │   ├── clinicianVoiceBuilder.ts # Bot clinician voice instructions
│   │   ├── scoring.ts            # Performance scoring algorithm (0-100)
│   │   └── archetypePresets.ts   # Pre-built scenario templates
│   ├── openai/
│   │   ├── client.ts             # OpenAI SDK singleton
│   │   └── structuredVoice.ts    # LLM-generated voice profiles + clinician turns
│   ├── voice/
│   │   └── renderVoiceProfile.ts # Voice profile → prompt text formatters
│   ├── validation/
│   │   ├── schemas.ts            # Zod schemas for all API input/output + DB row parsing
│   │   └── http.ts               # parseRequestJson() — validate request.json() against a Zod schema
│   ├── supabase/
│   │   ├── server.ts             # Server-side Supabase client
│   │   ├── client.ts             # Browser-side Supabase client
│   │   └── middleware.ts         # Auth session refresh middleware
│   └── utils.ts                  # cn() utility
│
├── store/
│   ├── simulationStore.ts        # Live simulation state (Zustand)
│   ├── scenarioStore.ts          # Scenario form state
│   └── appStore.ts               # User profile, navigation
│
├── types/
│   ├── scenario.ts               # ScenarioTraits, VoiceConfig, EscalationRules, Difficulty
│   ├── escalation.ts             # EscalationState, EscalationDelta, ESCALATION_LABELS
│   ├── simulation.ts             # Session, TranscriptTurn, ClassifierResult, StateEvent
│   ├── voice.ts                  # StructuredVoiceProfile, StructuredClinicianTurn
│   └── governance.ts             # OrgSettings, UserRole, UserProfile
│
└── middleware.ts                  # Route protection + session refresh
```

## API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/realtime/session` | Create ephemeral OpenAI Realtime token (WebRTC) |
| POST | `/api/classify` | Classify utterance → effectiveness score (-1.0 to +1.0) |
| POST | `/api/analysis/trainee-delivery` | Analyse trainee microphone audio into structured delivery markers |
| POST | `/api/deescalate` | Generate bot clinician turn + voice profile |
| POST | `/api/voice-profile/patient` | Generate structured patient voice profile |
| POST | `/api/tts` | Text-to-speech fallback (clinician audio) |
| GET/POST | `/api/scenarios` | List / create scenarios |
| GET/PUT/DELETE | `/api/scenarios/[id]` | Read / update / delete scenario (cascade) |
| POST | `/api/scenarios/[id]/publish` | Publish scenario (draft → published) |
| POST | `/api/sessions` | Create session from scenario |
| GET | `/api/sessions/[id]` | Get session details |
| POST | `/api/sessions/[id]/start` | Mark session active, record consent |
| POST | `/api/sessions/[id]/end` | End session, record final/peak escalation |
| DELETE | `/api/sessions/[id]/delete` | Permanently delete session + child records |
| GET/POST | `/api/sessions/[id]/transcript` | Get / append transcript turns |
| GET/POST | `/api/sessions/[id]/events` | Get / append state events |
| POST | `/api/sessions/[id]/fork` | Fork session from a specific turn |
| GET/POST | `/api/sessions/[id]/educator-notes` | Get / create educator notes |
| GET/POST | `/api/sessions/[id]/reflection` | Load / save trainee self-reflection (tags + free text) |
| GET/POST | `/api/sessions/[id]/audio` | Get signed playback URL / upload session recording |
| GET | `/api/sessions/recent` | User's recent sessions |
| GET | `/api/profile` | Current user's profile (`id`, `display_name`, `role`, `org_id`) |
| GET/PUT | `/api/org-settings` | Read / update organisation governance |

## Error Handling & Validation

### Runtime Validation

All API route inputs are validated at the boundary using Zod schemas via `parseRequestJson()` (`src/lib/validation/http.ts`). If the request body fails validation, a 400 response is returned with structured error details before any business logic runs.

Database query results consumed on the client (review page, simulation page) are parsed through typed Zod schemas (`src/lib/validation/schemas.ts`) rather than raw `as Type` casts. Malformed or missing fields fall back to safe defaults instead of crashing.

### User Feedback

All user-facing operations surface errors via `sonner` toasts:
- Scenario creation, duplication, archival, and deletion
- Session creation, forking, and deletion
- Transcript reflection and educator note submission
- Dashboard and scenario list loading
- Settings save

API routes that perform cascade deletes (scenario deletion, session deletion) check each child-record delete and return 500 on partial failure rather than silently continuing. OpenAI API errors always return structured 502 responses.

### Escalation Ceiling Enforcement

The org-level `max_escalation_ceiling` (Settings page) acts as a hard cap across the organisation. The per-scenario `max_ceiling` (Escalation Rules) is the scenario author's intended limit. At runtime, the effective ceiling is `Math.min(scenario, org)`. The scenario editor slider is capped to the org ceiling, and the simulation page fetches the org setting at init rather than using a hardcoded fallback.

### Authentication

PROLOG uses **email OTP (magic link)** via Supabase Auth — no passwords. Access is restricted to `@nhs.scot` email addresses. The login page enforces this domain check client-side before sending the OTP request; non-NHS.scot addresses are rejected immediately without hitting Supabase.

Flow:
1. User enters their `@nhs.scot` email at `/auth/login`
2. Supabase sends a magic link to that address
3. Clicking the link opens `/auth/confirm`, which shows a final green **Complete sign-in** button
4. Clicking that button verifies the OTP client-side (or exchanges the PKCE code) and redirects to `/dashboard`

There is no self-service signup page — the login page handles both new and returning users.

### Auth Token Refresh

The Next.js middleware runs Supabase `updateSession` on **all routes** including `/api/*`, so auth tokens are refreshed before every request. This prevents 401 errors during long-lived simulations where access tokens expire.

## Escalation Engine

The escalation engine is a 10-level state machine that tracks multiple dimensions simultaneously:

### State

| Metric | Range | Description |
|--------|-------|-------------|
| `level` | 1-10 | Current escalation (1 = calm, 10 = crisis) |
| `trust` | 0-10 | Patient's trust in the clinician |
| `willingness_to_listen` | 0-10 | Openness to hearing the clinician |
| `anger` | 0-10 | Current anger intensity |
| `frustration` | 0-10 | Accumulated frustration |
| `boundary_respect` | 0-10 | Respect for stated limits |

### Labels

| Level | Label |
|-------|-------|
| 1 | Calm but concerned |
| 2 | Guarded |
| 3 | Irritated |
| 4 | Frustrated |
| 5 | Confrontational |
| 6 | Accusatory |
| 7 | Hostile |
| 8 | Verbally abusive |
| 9 | Threatening |
| 10 | Severe loss of control |

### Classification

Each trainee utterance is classified for effectiveness:

**Escalating behaviours** (negative effectiveness):
- Dismissive language (-0.5 to -1.0)
- Telling someone to "calm down" badly (-0.3 to -0.7)
- Patronising tone (-0.4 to -0.8)
- Perceived blame (-0.5 to -0.9)
- Ignoring emotions (-0.3 to -0.7)

**De-escalating behaviours** (positive effectiveness):
- Reflective listening (+0.4 to +0.8)
- Naming the emotion (+0.4 to +0.7)
- Acknowledgement of distress (+0.3 to +0.7)
- Concrete next step (+0.3 to +0.6)
- Calm boundary setting (+0.3 to +0.6)

The trainee utterance classifier also returns scoring fields: `composure_markers` (defensive language, dismissiveness, hostility mirroring, sarcasm, interruption), `de_escalation_attempt` with technique label, and `clinical_milestone_completed` when milestones are defined.

Separately, the app can analyse the **actual trainee audio** after each utterance and return an audio-derived `trainee_delivery_analysis` object. That payload can carry **multiple** delivery markers per utterance, for example:

- `calm_measured` + `warm_empathic`
- `defensive_tone` + `tense_hurried`
- `flat_detached`

### Level Change Rules

- **Escalation**: effectiveness < -0.15 → +1 to +3 level jump, amplified by volatility, anger reactivity, and impatience
- **De-escalation**: effectiveness > +0.15 → -1 to -2 level drop, dampened by low trust and high anger
- **Clinician dampening**: bot clinician effectiveness is dampened (×0.5) so it can't instantly solve things
- **Minimum recovery threshold**: any recovery ≥ 0.2 produces at least -1 level change (prevents round-to-zero deadlocks)
- **Auto-end**: if level reaches the auto-end threshold, the simulation ends automatically

## Scoring System

Post-session performance is scored 0-100 across four dimensions, each scored 0-100:

| Dimension | Measures | How |
|-----------|----------|-----|
| Composure | Measures ability to remain calm, respectful, and non-defensive under pressure | Start at 100, subtract weighted penalties for composure markers. Dismissiveness and hostility mirroring cost more than minor interruption, repeated markers compound, and poor composure during higher patient/relative state is penalised more heavily |
| De-escalation | Measures ability to reduce the patient or relative's emotional intensity without worsening the interaction | 40% attempt rate + 60% success rate, measured against patient/relative state change without AI clinician takeover intervening first. Turns that further inflame an already-escalated interaction subtract from the score |
| Clinical Task | Continued to address the clinical need (optional) | Ratio of completed milestones to total defined milestones |
| Support Seeking | Appropriately used or declined the AI clinician | Starts from 100. Appropriate takeover requests receive a small credit, premature requests are penalised, and each trainee turn taken at or above the support threshold without asking for help counts as a missed support opportunity. Unsupported deterioration into critical or crisis states reduces the score further. Legacy scenarios with no explicit support threshold fall back to the critical threshold or level 6 |

**Overall score** is a weighted average. Weights are defined per scenario (default: equal across active dimensions). When clinical milestones are not defined, that dimension is excluded and weights are renormalized.

**Qualitative labels**: Strong (80-100), Developing (60-79), Needs practice (0-59)

**Session validity gate**: sessions under 3 trainee turns are not scored. Sessions of 3-6 trainee turns show scores with a "preliminary" caveat.

**Score evidence**: every point earned or lost links to a specific transcript turn and classifier output. The review page shows either a score card or a short-session placeholder at the top, keeps the reflection panel visible near the top of the page, and shows "key moments" (2-3 highest-impact events) plus a technique suggestion when scoring is available.

When trainee audio delivery is available, composure and de-escalation scoring also apply small, confidence-gated adjustments from the audio-derived markers. Low-confidence audio readings are deliberately down-weighted.

## Prompt Architecture

The patient's system prompt is built in four layers:

1. **Immutable system rules** — stay in character, British English, 1-2 sentences max, respect escalation ceiling, never break character
2. **State layer** — scenario metadata, current escalation state values, dynamic bias/discrimination state, and explicit guidance for what the patient says at each escalation level
3. **Memory layer** — last 20 transcript turns (or "start conversation naturally" for the first turn)
4. **Voice layer** — structured 7-field delivery profile (accent, tone, pacing, emotion, delivery, variety, voice affect) generated by LLM or derived from scenario config

The prompt is regenerated after every trainee turn to reflect the new escalation state and voice profile. At higher patient states it now explicitly instructs the model to let swearing, insults, or threatening language appear in the wording itself rather than just the delivery, and any configured prejudice is constrained to the authored bias categories.

## AI Clinician Bot

When the trainee presses "Ask AI clinician for help", an expert AI clinician takes over:

1. Trainee mic is muted, VAD turn detection disabled
2. Bot generates a response via `/api/deescalate` (LLM-structured output: text + technique + voice profile)
3. Clinician speaks via an independent WebRTC Realtime connection (cedar voice) or TTS fallback
4. Patient responds naturally; bot classifies the patient's response and prepares the next turn
5. Bot loops until the trainee clicks "Resume conversation"

On the live screen, trainee-facing controls and status text are deliberately plain language:

- the stress meter is labelled **Patient/relative status**
- the support action is **Ask AI clinician for help**
- while support is active the UI explains that the AI clinician is speaking on the trainee's behalf
- the live screen does **not** show the internal classifier's "last assessment" or effectiveness score

The clinician prompt includes **conversation progression rules** to prevent repetitive responses:
- Never repeat a commitment already given
- If a check was promised, deliver concrete results on the next turn
- Progress through stages: validate → deliver info → address follow-ups → agree plan
- May synthesise plausible clinical details (ward names, timelines, blockers) for realism

## Voice System

### Patient Voice

The patient's voice is configured per-scenario:
- **Voice name**: OpenAI Realtime voices (marin, alloy, onyx, shimmer, nova, echo, fable, juniper, sage)
- **Speaking rate**: 0.5-2.0
- **Expressiveness, anger expression, sarcasm expression**: 0-10
- **Pause style**: natural / short_clipped / long_dramatic / minimal
- **Interruption style**: none / occasional / frequent / aggressive

A **structured voice profile** is regenerated by LLM after each turn to reflect the patient's evolving emotional state. This 7-field profile (accent, voiceAffect, tone, pacing, emotion, delivery, variety) is injected into the Realtime session instructions and now also consumes the live discrimination flag plus authored bias categories/intensity so delivery matches both the scenario setup and the current patient state.

### Clinician Voice

The bot clinician uses the `cedar` voice via an independent WebRTC connection. Each turn generates a voice profile describing how the clinician should sound (calm, firm, warm, etc.) based on the patient's current state.

### Trainee Audio Delivery

Trainee delivery analysis is intentionally **off the live critical path**. After a trainee utterance finishes, the app captures the trainee-only mic segment, posts it to `/api/analysis/trainee-delivery`, and stores the structured result for review and scoring.

Important current behaviour:

- analysis is attempted **per trainee utterance**, not once per session
- a single utterance can produce **multiple** markers
- the result is audio-derived and uses the transcript/context only to interpret the sound correctly
- `confidence` is the system's confidence in its audio reading, not a personality score for the trainee
- if direct persistence to `transcript_turns` fails, the result is also written to `simulation_state_events` as a fallback and merged back onto the review transcript

Not every utterance is guaranteed to show audio delivery. Missing entries usually mean either audio capture failed for that turn or the model did not return a usable structured result.

## WebRTC & Microphone Management

The simulation uses two independent WebRTC connections:

1. **Patient session** (`useRealtimeSession`) — bidirectional audio; trainee speaks, patient responds
2. **Clinician renderer** (`useRealtimeVoiceRenderer`) — one-way; bot clinician text → speech

### Echo Prevention

- Mic track is **disabled** while the patient is speaking (prevents audio feedback loop)
- Mic is **ungated** 200ms after playback completes (grace period for echo tail)
- On bot takeover, the patient's in-flight response is cancelled and audio buffer cleared so the gate releases immediately

### Turn Detection

Server-side VAD (voice activity detection):
- Threshold: 0.55
- Prefix padding: 300ms
- Silence duration: 320ms
- Interrupt response: disabled (patient finishes speaking before trainee can interrupt)

## Session Forking

From the review page, select any turn and click "Restart From Turn" to create a forked session:

- The new session inherits the conversation history up to the selected turn
- Engine state, voice profile, and patient prompt are restored from the turn's snapshot
- Fork lineage is tracked via `forked_from_session_id` and `branch_depth`
- Inherited turns appear in the transcript but are read-only

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.1 (App Router, Turbopack) |
| Language | TypeScript 5, React 19 |
| Styling | Tailwind CSS 4, shadcn/ui v4 |
| State | Zustand 5 |
| Validation | Zod 4 |
| Charts | Recharts 3 |
| Auth & DB | Supabase (Auth + Postgres + SSR) |
| AI | OpenAI Realtime API (WebRTC), gpt-5.4-mini, gpt-4o-mini-tts |
| Voice | OpenAI Realtime voices + structured voice profiles |
| Notifications | Sonner |
| Icons | Lucide React |
