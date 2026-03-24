# SimGritty: Scenario & Response Generation Architecture

## 1. Scenario Design and Storage

Scenarios are the foundation of every simulation. Each scenario is stored across four normalised Supabase tables:

- **`scenario_templates`** — the narrative core: title, setting, trainee role (e.g. "junior doctor"), AI role (e.g. "angry relative"), backstory, emotional driver, difficulty tier (low/moderate/high/extreme), learning objectives, content warnings, and post-simulation reflection prompts.
- **`scenario_traits`** — 16 numeric dials (0–10) that define the patient's personality: emotional intensity, hostility, frustration, impatience, trust, willingness to listen, sarcasm, bias intensity/category, volatility, boundary respect, coherence, repetition, entitlement, interruption likelihood, and escalation tendency.
- **`scenario_voice_config`** — audio delivery parameters: OpenAI voice ID, speaking rate, expressiveness, anger/sarcasm expression levels, pause style (natural/short_clipped/long_dramatic/minimal), and interruption style (none/occasional/frequent/aggressive).
- **`escalation_rules`** — the escalation framework: initial level, maximum ceiling, optional auto-end threshold, and arrays of named escalation/de-escalation triggers with their delta values.

Educators create scenarios through a form-based UI. Five built-in archetype presets (e.g. "Responding to Discriminatory Language", "High-Pressure Confrontation") provide starting templates that can be customised. When a simulation session is created, the entire scenario — including all child records — is frozen into a `scenario_snapshot` JSON column on the session, so later edits to the scenario template never affect in-progress or historical sessions.

## 2. The Simulation Loop

When a trainee starts a session, the system establishes a **WebRTC connection to the OpenAI Realtime API** (`gpt-realtime-1.5`). The server exchanges credentials for an ephemeral token (`/api/realtime/session`), then the browser negotiates a peer connection directly with OpenAI. The trainee's microphone audio (with echoCancellation, noiseSuppression, autoGainControl) streams to OpenAI; the AI patient's speech streams back via an `<audio autoplay>` element. A data channel (`oai-events`) carries structured JSON events for transcription, turn management, and session updates.

Turn detection uses server-side VAD with threshold 0.55, prefix padding 300ms, and silence duration 450ms. Trainee speech is transcribed by `gpt-4o-mini-transcribe`. Echo prevention gates the microphone off while the AI speaks and re-enables it after a 200ms grace period once the AI finishes.

The patient's behaviour is governed by a **four-layer system prompt** assembled by the prompt builder:

1. **System layer** — immutable rules: stay in character, use British English, keep responses to 1–2 sentences, respect the escalation ceiling.
2. **State layer** — regenerated after every turn: the full live escalation state (level, trust, anger, frustration, willingness to listen), all active behavioural traits, bias instructions if applicable, and a 10-level behaviour lookup table describing what the character should be doing at the current escalation level (e.g. level 3 = "Irritated", level 7 = "Hostile. Personal attacks possible", level 10 = "Complete loss of control").
3. **Memory layer** — the last 20 transcript turns, providing conversational continuity. If this is turn 0, instructs the patient to open naturally.
4. **Voice layer** — detailed spoken delivery instructions across six dimensions: affect, tone, pacing, emotion, delivery, and variety. This layer is either computed deterministically from traits and escalation state (a multi-dimensional system that derives an emotional profile, then maps it through level-banded sub-functions for each dimension), or replaced by an LLM-generated structured voice profile when available (see section 4).

## 3. Classification and Escalation

Every trainee utterance flows through a **classifier pipeline**. The `/api/classify` endpoint sends the utterance, the last 3 transcript turns for context, and the current escalation level to `gpt-4o-mini` (temperature 0.1) with a calibrated prompt containing two reference tables: escalating behaviours (dismissive language -0.5 to -1.0, "calm down" badly -0.3 to -0.7, ignoring emotions -0.3 to -0.7, patronising tone -0.4 to -0.8, perceived blame -0.5 to -0.9, etc.) mapped to negative effectiveness scores, and de-escalating behaviours (acknowledgement +0.3 to +0.7, reflective listening +0.4 to +0.8, naming the emotion +0.4 to +0.7, concrete next steps +0.3 to +0.6, etc.) mapped to positive scores. The model returns a JSON object with technique label, effectiveness score (-1 to +1), tags, confidence, and reasoning.

The effectiveness score is fed into the **Escalation Engine**, a stateful class that tracks level, trust, willingness to listen, anger, frustration, and other dimensions:

- **Escalation** (effectiveness < -0.3): Raw delta = `|effectiveness| * 2`, amplified by a volatility factor `(1 + volatility/10 * 0.5)`, then scaled by escalation tendency `(0.5 + escalation_tendency * 0.5)`. Clamped to 1–3 per turn. Trust drops by `|effectiveness| * 2`; willingness to listen drops by `|effectiveness| * 1.5`.
- **De-escalation** (effectiveness > 0.3): Recovery = `effectiveness * 1.5`, penalised by `(10 - trust) / 20` — a patient who doesn't trust the trainee resists calming down. Level drop clamped to max -2 per turn; if trust < 3, capped at -1. Trust and willingness to listen recover proportionally.
- **Neutral band** (-0.3 to +0.3): No level change, except a 30% chance of +1 drift when `escalation_tendency > 0.6`.

After each classification, a new prompt is built with the updated state. If the AI is currently speaking, the update is queued and flushed once the AI turn finishes, then pushed to the Realtime API via `session.update`. If the escalation level hits the auto-end threshold, the session ends automatically.

## 4. Voice Profile Generation

To produce naturalistic and contextually appropriate speech, the system uses an LLM-generated **structured voice profile**. After every trainee utterance is classified, `/api/voice-profile/patient` sends the full scenario metadata, current escalation state, trait values, voice config, and recent turns to `gpt-4o-mini` (temperature 0.3), which returns a structured JSON profile with seven fields: accent, voice affect, tone, pacing, emotion, delivery, and variety. A request-deduplication mechanism ensures only the latest request wins if multiple fire in quick succession. This profile is injected into the prompt's voice layer, replacing the deterministic computation. The result is speech direction that adapts dynamically — a patient at escalation level 3 might have "clipped, impatient pacing with audible sighs", while the same patient at level 8 might have "rapid, aggressive delivery with voice cracking under strain."

When no LLM-generated profile is available (e.g. at initial connection before the first fetch completes), the voice layer falls back to the deterministic computation, which derives an emotional profile type (grief/fear/entitlement/hostility/frustration/distrust/mixed) from the scenario's emotional driver text and trait values, then maps it through level-banded sub-functions for each of the six voice dimensions.

## 5. The Bot Clinician (Dual Pipeline)

SimGritty includes an automated **bot clinician** that can take over the trainee's role to demonstrate de-escalation technique. When activated, the bot mutes the trainee's microphone and enters a turn-taking loop:

1. **Generate response** — `/api/deescalate` sends scenario context, recent transcript, emotional driver, roles, and escalation state to `gpt-4o-mini` (temperature 0.4) with a strict JSON schema. The model returns a clinician utterance (1–3 sentences of natural British English), a technique label (e.g. "validation", "boundary setting"), and a structured voice profile for the clinician's delivery.
2. **Persist to transcript** — The response is added to the local transcript and written to `transcript_turns` in Supabase.
3. **Speak via TTS** — The response is sent to `/api/tts` with `style: "clinician"`, which calls `gpt-4o-mini-tts` with the `cedar` voice (configurable via env vars), returning mp3 audio. Voice instructions are generated by the **clinician voice builder** — either from the structured voice profile returned by `/api/deescalate` (via `renderVoiceProfileForTts`), or deterministically from context. The deterministic path derives a `ClinicianTechniqueStyle` (validation/action/boundary/question/general) from the technique label and builds five voice dimensions calibrated to the current emotional context (e.g. facing hostility = "unflappable and emotionally solid"; facing grief = "deep empathy held in restraint"). If the primary TTS model fails, a fallback model is attempted.
4. **Classify the bot's utterance** — The bot's text runs through the same classifier pipeline, affecting escalation state just as a trainee's words would.
5. **Inject into Realtime session** — The bot's text is injected into the Realtime API conversation as a user message (after cancelling any in-flight patient response), triggering the AI patient to respond.
6. **Wait for patient response, then repeat** — The loop continues until the trainee presses "Take over", at which point their microphone is re-enabled.

A scaffolded **Realtime voice renderer** (`useRealtimeVoiceRenderer`) also exists as an alternative rendering path that establishes a second, independent WebRTC connection for bot clinician speech — using receive-only audio and text injection rather than HTTP TTS. This is not yet wired into the main simulation flow.

## 6. Session Lifecycle and Review

Sessions move through a defined lifecycle: **created** (scenario frozen) → **active** (started, trainee consented) → **completed** or **aborted** (instant exit only). During the session, every utterance is persisted to `transcript_turns` and all state events — including escalation changes, de-escalation changes, and classification results — are written to `simulation_state_events`, both with sequential indices. Sessions can end normally, by educator intervention, by timeout, by auto-ceiling breach (`auto_ceiling`), or by instant trainee exit (`instant_exit`).

After completion, the session data — full transcript, escalation timeline with before/after values for level/trust/willingness to listen, peak escalation level, and exit type — is available for review. Educators can attach notes anchored to specific transcript turns for targeted feedback.

An organisation-level governance layer (`OrgSettings`, admin-only) enforces a maximum escalation ceiling across all scenarios, controls whether discriminatory content is permitted, requires consent gates, and sets maximum session duration.
