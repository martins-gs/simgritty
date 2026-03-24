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

Turn detection uses server-side VAD with threshold 0.55, prefix padding 300ms, and silence duration 320ms. Trainee speech is transcribed by `gpt-4o-mini-transcribe`. Echo prevention gates the microphone off when the AI starts speaking (`response.created`) and re-enables it after a 200ms grace period once audio playback completes (`output_audio_buffer.stopped`). Audio playback completion is tracked separately from transcript completion — the `onAiPlaybackComplete` callback fires on `output_audio_buffer.stopped` or `output_audio_buffer.cleared`, while `onAiTranscript` fires on `response.audio_transcript.done`.

The patient's behaviour is governed by a **four-layer system prompt** assembled by the prompt builder:

1. **System layer** — immutable rules: stay in character, use British English, keep responses to 1–2 sentences, respect the escalation ceiling.
2. **State layer** — regenerated after every turn: the full live escalation state (level, trust, anger, frustration, willingness to listen), all active behavioural traits, bias instructions if applicable, and a 10-level behaviour lookup table describing what the character should be doing at the current escalation level (e.g. level 3 = "Irritated", level 7 = "Hostile. Personal attacks possible", level 10 = "Complete loss of control").
3. **Memory layer** — the last 20 transcript turns, providing conversational continuity. If this is turn 0, instructs the patient to open naturally.
4. **Voice layer** — detailed spoken delivery instructions across six dimensions: affect, tone, pacing, emotion, delivery, and variety. This layer is either computed deterministically from traits and escalation state (a multi-dimensional system that derives an emotional profile, then maps it through level-banded sub-functions for each dimension), or replaced by an LLM-generated structured voice profile when available (see section 4).

## 3. Classification and Escalation

The system uses a **dual-mode classifier pipeline** via `/api/classify`:

- **Trainee utterance mode** (default): Every trainee utterance is sent with the last 3 transcript turns for context and the current escalation level to `gpt-4o-mini` (temperature 0.1) with a calibrated prompt containing two reference tables — escalating behaviours (dismissive language -0.5 to -1.0, "calm down" badly -0.3 to -0.7, ignoring emotions -0.3 to -0.7, patronising tone -0.4 to -0.8, perceived blame -0.5 to -0.9, etc.) mapped to negative effectiveness scores, and de-escalating behaviours (acknowledgement +0.3 to +0.7, reflective listening +0.4 to +0.8, naming the emotion +0.4 to +0.7, concrete next steps +0.3 to +0.6, etc.) mapped to positive scores.
- **Patient response mode** (`mode: "patient_response"`): Used during bot clinician turns to classify the patient's reply. Instead of assessing communication technique quality, this mode assesses the patient's state shift — whether they are becoming more escalated and closed-off, more settled and open, or roughly unchanged. It uses the last 4 transcript turns and a separate system prompt focused on indicators like increased hostility/blame/threats (negative) or calmer questions/reduced hostility/signs of trust (positive).

Both modes return a JSON object with technique label, effectiveness score (-1 to +1), tags, confidence, and reasoning.

The effectiveness score is fed into the **Escalation Engine**, a stateful class that tracks level, trust, willingness to listen, anger, frustration, and other dimensions:

- **Escalation** (effectiveness < -0.3): Raw delta = `|effectiveness| * 2`, amplified by a volatility factor `(1 + volatility/10 * 0.5)`, then scaled by escalation tendency `(0.5 + escalation_tendency * 0.5)`. Clamped to 1–3 per turn. Trust drops by `|effectiveness| * 2`; willingness to listen drops by `|effectiveness| * 1.5`.
- **De-escalation** (effectiveness > 0.3): Recovery = `effectiveness * 1.5`, penalised by `(10 - trust) / 20` — a patient who doesn't trust the trainee resists calming down. Level drop clamped to max -2 per turn; if trust < 3, capped at -1. Trust and willingness to listen recover proportionally.
- **Neutral band** (-0.3 to +0.3): No level change, except a 30% chance of +1 drift when `escalation_tendency > 0.6`.

After each classification, a new prompt is built with the updated state. If the AI is currently speaking, the update is queued and flushed once the AI turn finishes, then pushed to the Realtime API via `session.update`. If the escalation level hits the auto-end threshold, the session ends automatically.

## 4. Voice Profile Generation

To produce naturalistic and contextually appropriate speech, the system uses an LLM-generated **structured voice profile**. After every trainee utterance is classified, `/api/voice-profile/patient` sends the full scenario metadata, current escalation state, trait values, voice config, and recent turns to `gpt-4o-mini` (temperature 0.3), which returns a structured JSON profile with seven fields: accent, voice affect, tone, pacing, emotion, delivery, and variety. A request-deduplication mechanism ensures only the latest request wins if multiple fire in quick succession. This profile is injected into the prompt's voice layer, replacing the deterministic computation. The result is speech direction that adapts dynamically — a patient at escalation level 3 might have "clipped, impatient pacing with audible sighs", while the same patient at level 8 might have "rapid, aggressive delivery with voice cracking under strain."

When no LLM-generated profile is available (e.g. at initial connection before the first fetch completes), the voice layer falls back to the deterministic computation, which derives an emotional profile type (grief/fear/entitlement/hostility/frustration/distrust/mixed) from the scenario's emotional driver text and trait values, then maps it through level-banded sub-functions for each of the six voice dimensions.

## 5. The Bot Clinician (Dual Pipeline)

SimGritty includes an automated **bot clinician** that can take over the trainee's role to demonstrate de-escalation technique. When activated, the bot mutes the trainee's microphone, pre-connects the clinician audio renderer, prefetches the first bot turn, and enters a turn-taking loop:

1. **Generate response** — `/api/deescalate` sends scenario context, recent transcript, emotional driver, roles, escalation state, and the current patient voice profile to `gpt-4o-mini` (temperature 0.4) with a strict JSON schema. The model uses all three inputs together — what the patient literally said, the current state values, and the patient's vocal/emotional presentation — to generate a clinician utterance (1–3 sentences of natural British English), a technique label (e.g. "validation", "boundary setting"), and a structured voice profile for the clinician's delivery. Bot turns are **prefetched** — while the patient is responding, the next clinician turn is already being generated.
2. **Persist to transcript** — The response is added to the local transcript and written to `transcript_turns` in Supabase.
3. **Speak via clinician audio** — The bot uses a **dual-path audio system** with automatic fallback:
   - **Primary: Realtime voice renderer** — A second, independent WebRTC connection (`useRealtimeVoiceRenderer`) to the OpenAI Realtime API using the `cedar` voice. The text is injected via `conversation.item.create` with a `<line>` wrapper tag, and the renderer streams audio back via a receive-only transceiver. Voice instructions are built by `buildClinicianRealtimeInstructionsFromProfile` (if a voice profile is available) or `buildClinicianRealtimeInstructions` (deterministic fallback). The renderer connection is warmed up when the bot is first activated.
   - **Fallback: HTTP TTS** — If the realtime renderer fails to connect or speak, the system falls back to `/api/tts` with `style: "clinician"`, which calls `gpt-4o-mini-tts` with the `cedar` voice, returning mp3 audio. Voice instructions are generated by the clinician voice builder via `renderVoiceProfileForTts` or the deterministic path. If the primary TTS model fails, a fallback model is attempted.
   - The clinician voice builder derives a `ClinicianTechniqueStyle` (validation/action/boundary/question/general) from the technique label and builds five voice dimensions calibrated to the current emotional context (e.g. facing hostility = "unflappable and emotionally solid"; facing grief = "deep empathy held in restraint").
4. **Classify the bot's utterance** — The bot's text runs through the trainee-mode classifier pipeline **in parallel with audio playback**, affecting escalation state just as a trainee's words would.
5. **Inject into Realtime session** — The bot's text is injected into the Realtime API conversation as a user message (after cancelling any in-flight patient response), triggering the AI patient to respond.
6. **Classify the patient's response** — When the patient replies, the response is classified using the **patient response mode** classifier. This updates escalation state based on the patient's actual state shift (not the clinician's technique quality), and triggers a prefetch of the next bot turn once the state update completes.
7. **Wait for patient response, then repeat** — The loop waits for the patient to finish speaking and for any pending patient state update to complete, then continues. The loop runs until the trainee presses "Take over", at which point the clinician renderer is disconnected and the trainee's microphone is re-enabled.

## 6. Session Lifecycle and Review

Sessions move through a defined lifecycle: **created** (scenario frozen) → **active** (started, trainee consented) → **completed** or **aborted** (instant exit only). During the session, every utterance is persisted to `transcript_turns` and all state events — including escalation changes, de-escalation changes, and classification results (from trainee utterances, bot utterances, and patient responses) — are written to `simulation_state_events`, both with sequential indices. Sessions can end normally, by educator intervention, by timeout, by auto-ceiling breach (`auto_ceiling`), or by instant trainee exit (`instant_exit`).

After completion, the session data — full transcript, escalation timeline with before/after values for level/trust/willingness to listen, peak escalation level, and exit type — is available for review. Educators can attach notes anchored to specific transcript turns for targeted feedback.

An organisation-level governance layer (`OrgSettings`, admin-only) enforces a maximum escalation ceiling across all scenarios, controls whether discriminatory content is permitted, requires consent gates, and sets maximum session duration.
