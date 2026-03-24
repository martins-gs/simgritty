# SimGritty: Scenario & Response Generation Architecture

## 1. Scenario Design and Storage

Scenarios are the foundation of every simulation. Each scenario is stored across four normalised Supabase tables:

- **`scenario_templates`** — the narrative core: title, setting, trainee role (e.g. "junior doctor"), AI role (e.g. "angry relative"), backstory, emotional driver, difficulty tier (low/moderate/high/extreme), learning objectives, content warnings, and post-simulation reflection prompts.
- **`scenario_traits`** — 16 numeric dials (0–10) that define the patient's personality: emotional intensity, hostility, frustration, impatience, trust, willingness to listen, sarcasm, bias intensity/category, volatility, boundary respect, coherence, repetition, entitlement, interruption likelihood, and escalation tendency.
- **`scenario_voice_config`** — audio delivery parameters: OpenAI voice ID, speaking rate, expressiveness, anger/sarcasm expression levels, pause style, and interruption style.
- **`escalation_rules`** — the escalation framework: initial level, maximum ceiling, optional auto-end threshold, and arrays of named escalation/de-escalation triggers with their delta values.

Educators create scenarios through a form-based UI. Five built-in archetype presets (e.g. "Responding to Discriminatory Language", "High-Pressure Confrontation") provide starting templates that can be customised. When a simulation session is created, the entire scenario — including all child records — is frozen into a `scenario_snapshot` JSON column on the session, so later edits to the scenario template never affect in-progress or historical sessions.

## 2. The Simulation Loop

When a trainee starts a session, the system establishes a **WebRTC connection to the OpenAI Realtime API**. The server exchanges credentials for an ephemeral token (`/api/realtime/session`), then the browser negotiates a peer connection directly with OpenAI. The trainee's microphone audio streams to OpenAI; the AI patient's speech streams back. A data channel carries structured JSON events for transcription, turn management, and session updates.

The patient's behaviour is governed by a **four-layer system prompt** assembled by the prompt builder:

1. **System layer** — immutable rules: stay in character, use British English, keep responses to 1–2 sentences, respect the escalation ceiling.
2. **State layer** — regenerated after every turn: the full live escalation state (level, trust, anger, frustration, willingness to listen), all active behavioural traits, bias instructions if applicable, and a 10-level behaviour lookup table describing what the character should be doing at the current escalation level.
3. **Memory layer** — the last 20 transcript turns, providing conversational continuity.
4. **Voice layer** — detailed spoken delivery instructions covering affect, tone, pacing, emotion, and delivery. This layer is either computed deterministically from traits and escalation state, or replaced by an LLM-generated structured voice profile (see below).

## 3. Classification and Escalation

Every trainee utterance flows through a **classifier pipeline**. The `/api/classify` endpoint sends the utterance, recent context, and current escalation level to `gpt-4o-mini` with a calibrated prompt containing two reference tables: escalating behaviours (dismissive language, "calm down", ignoring emotions, patronising tone, etc.) mapped to negative effectiveness scores, and de-escalating behaviours (acknowledgement, reflective listening, naming the emotion, concrete next steps, etc.) mapped to positive scores. The model returns a JSON object with technique label, effectiveness score (-1 to +1), tags, confidence, and reasoning.

The effectiveness score is fed into the **Escalation Engine**, a stateful class that tracks level, trust, willingness to listen, anger, frustration, and other dimensions. On escalation (effectiveness < -0.3), the raw delta is amplified by the scenario's volatility and escalation tendency traits, clamped to 1–3 per turn. On de-escalation (effectiveness > 0.3), recovery is penalised by low trust — a patient who doesn't trust the trainee resists calming down, and recovery is capped at -1 per turn if trust is below 3. A neutral band (-0.3 to +0.3) produces no change, except for occasional random drift in volatile patients. After each classification, a new prompt is built with the updated state and pushed to the Realtime API via `session.update`, so the patient's next response reflects the changed emotional landscape. If the escalation level hits the auto-end threshold, the session ends automatically.

## 4. Voice Profile Generation

To produce naturalistic and contextually appropriate speech, the system uses an LLM-generated **structured voice profile**. At session start and after every escalation state change, `/api/voice-profile/patient` sends the full scenario metadata, current escalation state, trait values, and recent turns to `gpt-4o-mini`, which returns a structured JSON profile with seven fields: accent, voice affect, tone, pacing, emotion, delivery, and variety. This profile is injected into the prompt's voice layer, replacing the deterministic computation. The result is speech direction that adapts dynamically — a patient at escalation level 3 might have "clipped, impatient pacing with audible sighs", while the same patient at level 8 might have "rapid, aggressive delivery with voice cracking under strain."

## 5. The Bot Clinician (Dual Pipeline)

SimGritty includes an automated **bot clinician** that can take over the trainee's role to demonstrate de-escalation technique. When activated, the bot mutes the trainee's microphone and enters a turn-taking loop:

1. **Generate response** — `/api/deescalate` sends scenario context, recent transcript, and escalation state to `gpt-4o-mini` with a strict JSON schema. The model returns a clinician utterance (1–3 sentences of natural British English), a technique label (e.g. "validation", "boundary setting"), and a structured voice profile for the clinician's delivery.
2. **Speak via TTS** — The response is sent to `/api/tts` with `style: "clinician"`, which calls OpenAI's TTS model with voice instructions generated by the clinician voice builder. These instructions are the mirror image of the patient voice system: composed, grounding, and calibrated to the current emotional context (e.g. facing hostility = "unflappable and emotionally solid"; facing grief = "deep empathy held in restraint").
3. **Inject into Realtime session** — After the audio plays, the bot's text is injected into the Realtime API conversation as a user message, triggering the AI patient to respond.
4. **Classify the bot's utterance** — The bot's text runs through the same classifier pipeline, affecting escalation state just as a trainee's words would.
5. **Wait for patient response, then repeat** — The loop continues until the trainee presses "Take over", at which point their microphone is re-enabled.

## 6. Session Lifecycle and Review

Sessions move through a defined lifecycle: **created** (scenario frozen) → **active** (started, trainee consented) → **completed** or **aborted**. During the session, every utterance is persisted to `transcript_turns` and every escalation change to `simulation_state_events`, both with sequential indices. Sessions can end normally, by educator intervention, by timeout, by auto-ceiling breach, or by instant trainee exit.

After completion, the session data — full transcript, escalation timeline with before/after values, peak escalation level, and exit type — is available for review. Educators can attach notes anchored to specific transcript turns for targeted feedback.

An organisation-level governance layer (`OrgSettings`) enforces a maximum escalation ceiling across all scenarios, controls whether discriminatory content is permitted, requires consent gates, and sets maximum session duration.
