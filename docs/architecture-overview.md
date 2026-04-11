# PROLOG Architecture Overview

Last verified against the codebase on 2026-04-11.

This document reflects the architecture currently implemented in the repository. It is an implementation reference, not a roadmap. The separate `docs/elevenlabs-plan.md` file is proposal-only.

## System Diagram

```mermaid
flowchart LR
  Trainee["Trainee on /simulation/[sessionId]"] --> Sim["simulation page\norchestration + transcript + bot loop"]

  Sim --> PatientHook["useRealtimeSession\npatient WebRTC session\nmic gating + session.update"]
  PatientHook --> RTToken["/api/realtime/session"]
  RTToken --> Realtime["OpenAI Realtime API\npatient conversation model: gpt-realtime-1.5\ninput transcription: gpt-4o-mini-transcribe"]

  Sim --> ClinicianHook["useRealtimeVoiceRenderer\nseparate clinician WebRTC renderer"]
  ClinicianHook --> RTToken

  Sim --> Classify["/api/classify\nResponses API + structured output\nmodel: gpt-5.4-mini"]
  Sim --> VoiceProfile["/api/voice-profile/patient\nResponses API + structured output\nmodel: gpt-5.4-mini"]
  Sim --> Deescalate["/api/deescalate\nResponses API + structured output\nmodel: gpt-5.4-mini"]
  Sim --> TraineeAudio["/api/analysis/trainee-delivery\nbackground audio analysis\nmodel: gpt-audio (+ gpt-5.4-mini structurer fallback)"]
  Sim --> TTS["/api/tts\nAudio Speech API fallback\nmodel: gpt-4o-mini-tts"]

  Sim --> Domain["promptBuilder\nescalationEngine\nclassifierPipeline\nstructuredVoice\nclinicianVoiceBuilder"]

  Sim --> Recorder["useSessionRecorder\nMediaRecorder on merged\nmic + remote streams"]

  Sim --> SessionAPI["/api/sessions/*\n/api/scenarios/*"]
  SessionAPI --> Supabase["Supabase Auth + Postgres\nscenario tables\nsession/transcript/events/notes"]

  Recorder --> AudioAPI["/api/sessions/:id/audio\nupload + signed URL"]
  AudioAPI --> Storage["Supabase Storage\nsimulation-audio bucket"]
```

## 1. Core Runtime

The live simulation is orchestrated from `src/app/simulation/[sessionId]/page.tsx`, with two distinct realtime paths:

- **Patient conversation path** via `src/hooks/useRealtimeSession.ts`: handles the primary WebRTC session, trainee microphone input, patient audio playback, input transcription events, mic gating, and `session.update` prompt refreshes.
- **Clinician voice path** via `src/hooks/useRealtimeVoiceRenderer.ts`: a second, separate WebRTC connection used only when the bot clinician speaks.
- **Session audio recording** via `src/hooks/useSessionRecorder.ts`: merges the trainee's local mic stream and the AI's remote audio stream into a single mixed recording using `AudioContext` + `MediaStreamDestination` and records continuously with `MediaRecorder`. The recording runs passively alongside the simulation with zero per-turn overhead. On session end, the blob is uploaded to Supabase Storage and the path is persisted on the session record.

The server route `src/app/api/realtime/session/route.ts` creates ephemeral Realtime sessions. The default realtime model is `gpt-realtime-1.5`, and patient-session input transcription is configured with `gpt-4o-mini-transcribe`.

For clinician speech, the realtime renderer now distinguishes three execution outcomes:

- **completed**: realtime playback reached a clean stop and bot handoff proceeds normally
- **partial**: realtime playback started, but the control path did not close cleanly; the system does not replay the line via TTS, and instead applies a conservative tail guard before allowing the patient to respond
- **failed**: realtime speech never got going cleanly, so the system falls back to the HTTP TTS route

## 2. Prompting And Patient Behaviour

The patient is driven by a four-layer prompt built in `src/lib/engine/promptBuilder.ts`:

1. **System layer**: immutable roleplay and safety rules.
2. **State layer**: current escalation state, traits, whether configured prejudice is currently active, explicit language guidance for the current patient state, and escalation ceiling.
3. **Memory layer**: recent conversation turns.
4. **Voice layer**: either a deterministic voice description or a structured voice profile rendered into prompt text.

The prompt now explicitly tells the model that the actual wording must match the current patient state. At higher states, that means swearing, insulting, or threatening language is expected in the words themselves rather than only in tone. When bias is configured, the prompt restricts discriminatory behaviour to the authored bias categories instead of letting it drift into unrelated prejudice.

Scenarios are authored through the App Router scenario pages and stored across:

- `scenario_templates` (includes `scoring_weights`, `support_threshold`, `critical_threshold`, `clinical_task_enabled`)
- `scenario_traits`
- `scenario_voice_config`
- `escalation_rules`
- `scenario_milestones` (optional, 0-10 per scenario — each has a description and classifier hint)

When a session is created, the scenario is frozen into `simulation_sessions.scenario_snapshot`, so session playback and forking are based on the original session state rather than the latest template edits.

## 3. Structured Generation And Classification

There are three GPT-5.4-mini structured-output routes, all using the Responses API with `responses.parse(...)` and Zod schemas:

- `src/app/api/classify/route.ts` via `src/lib/engine/classifierPipeline.ts`
- `src/app/api/voice-profile/patient/route.ts` via `src/lib/openai/structuredVoice.ts`
- `src/app/api/deescalate/route.ts` via `src/lib/openai/structuredVoice.ts`

The classifier pipeline has **three modes**:

- `trainee_utterance` — uses an extended Zod schema (`TRAINEE_SCORING_SCHEMA`) that adds scoring fields: `composure_markers` (array of negative indicators), `de_escalation_attempt` (boolean), `de_escalation_technique` (technique label), and `clinical_milestone_completed` (milestone ID or null). When milestones are defined for the scenario, only **uncompleted** milestones are passed in the classifier context — the simulation page tracks completed milestone IDs in a ref and filters them out before each classifier call, so the model focuses on detecting new completions rather than re-flagging the same one. On session resume or fork, completed milestone state is recovered from persisted transcript turns.
- `patient_response`
- `clinician_utterance`

Patient and clinician modes use the base schema (`CLASSIFIER_OUTPUT_SCHEMA`). The trainee mode uses a higher token limit (400 vs 220) to accommodate the additional fields.

Classification also takes the latest structured delivery profile as context, so it is based on both the words spoken and how the utterance was delivered.

Patient voice-profile generation returns a seven-field structured profile:

- accent
- voice affect
- tone
- pacing
- emotion
- delivery
- variety

The patient voice-profile request also consumes the authored `bias_intensity`, `bias_category`, and live `discrimination_active` flag alongside the numeric escalation/trust/anger state. That keeps generated delivery guidance aligned with scenarios that are meant to become discriminatory, hostile, or overtly abusive at higher patient states.

Clinician turn generation returns:

- the next clinician line
- a technique label
- a structured clinician voice profile

## 4. Trainee Audio Delivery Analysis

Phase 1 trainee audio delivery is implemented as an asynchronous, post-utterance pipeline. It is intended for review and scoring, not for changing the patient's next live reply.

Current flow:

1. `useRealtimeSession` captures trainee-only mic segments from the Realtime speech-boundary events.
2. The simulation page matches each segment to the corresponding Realtime transcript `itemId`.
3. `/api/analysis/trainee-delivery` sends the audio clip, transcript, scenario context, escalation level, and recent turns to the audio-analysis pipeline.
4. The audio model returns a structured `TraineeDeliveryAnalysis` object when it can, or a raw text analysis that is then re-structured through `gpt-5.4-mini`.
5. The simulation page tries to persist the result directly onto `transcript_turns.trainee_delivery_analysis`.
6. It also writes a fallback `classification_result` event with `__event_kind: "trainee_audio_delivery"` into `simulation_state_events`.
7. If the direct transcript write cannot be confirmed immediately, the transcript patch route accepts the matching fallback event as a valid confirmation source.
8. `GET /api/sessions/[id]/transcript` now backfills missing trainee audio delivery from those fallback events before returning rows.
9. The review page still performs the same merge defensively before rendering and scoring.

The payload supports multiple markers per utterance. Allowed markers are:

- `calm_measured`
- `warm_empathic`
- `tense_hurried`
- `flat_detached`
- `defensive_tone`
- `sarcastic_tone`
- `irritated_tone`
- `hostile_tone`
- `anxious_unsteady`

`confidence` is confidence in the system's reading of the audio, not a measure of how confident the trainee sounded.

Per-utterance analysis is the intended behaviour, but it is not guaranteed on every turn. Missing analyses can still happen when:

- the browser fails to produce a clean trainee-only segment
- the audio model returns no usable structured result
- neither direct transcript persistence nor the fallback event path succeeds

## 5. Escalation Engine

`src/lib/engine/escalationEngine.ts` holds the live state:

- escalation level (1–10)
- trust (0–10)
- willingness to listen (0–10)
- anger (0–10)
- frustration (0–10)
- boundary respect (0–10)
- discrimination active (boolean flag, derived dynamically from authored bias intensity/category plus the current patient state)
- behaviour counters: interruptions, validations, unanswered questions

Important current behaviour from the code:

- **Trainee** and **clinician** utterances can move escalation state.
- **Patient-response** classifications do **not** change the escalation level directly; they currently act as state-tracking and behavioural bookkeeping.
- Clinician-generated recovery is intentionally damped (0.5× multiplier) relative to trainee turns, so the bot does not calm the patient unrealistically fast.
- **Asymmetric reactivity**: already-escalated patients are more reactive to rudeness (anger multiplier 1.0–1.5×, impatience boost 1.0–1.3×).
- **Narrow deadzone**: near-neutral effectiveness values (−0.1 to −0.15 depending on state) are treated as no change, preventing drift from borderline classifications.
- **Trust penalty**: low trust slows recovery, so a patient who has lost trust does not de-escalate as easily.
- **Anger resistance**: high anger (≥ 4) adds friction to de-escalation.
- **Per-turn caps**: escalation can rise by at most +3 and fall by at most −2 in a single turn.
- **Dynamic discrimination flag**: `discrimination_active` is recalculated as the conversation evolves. High-intensity bias can surface early; milder configured bias stays latent until the patient state is more escalated.

## 6. Bot Clinician Flow

Bot mode is not just “generate text and play audio”. The current flow is:

1. Disable patient turn detection and force the trainee mic off.
2. Interrupt any in-flight patient response and clear patient playback.
3. Prefetch the next clinician turn through `src/app/api/deescalate/route.ts`.
4. Render clinician audio through the dedicated realtime renderer when available.
5. Fall back to `src/app/api/tts/route.ts` if realtime clinician speech is unavailable.
6. Classify the clinician turn with `clinician_utterance` mode.
7. Let the patient respond on the main realtime session.
8. Run a **critical patient-state update**: classify the patient reply, update escalation state, rebuild the patient prompt immediately using the cached voice profile, persist that turn snapshot, and prefetch the next clinician turn.
9. Run a **background refinement**: regenerate the patient voice profile, patch the saved transcript turn with the refined prompt/profile, and refresh the prefetched clinician turn if the refined voice state arrived in time.

The clinician audio system is dual-path:

- **Primary**: separate Realtime renderer (`useRealtimeVoiceRenderer`)
- **Fallback**: HTTP speech route using `gpt-4o-mini-tts`

The clinician voice instructions are built in `src/lib/engine/clinicianVoiceBuilder.ts`. If a structured clinician voice profile is available, it is used directly; otherwise the builder falls back to deterministic technique- and state-aware instructions.

Two extra protections were added to keep bot-mode speech reliable:

- **Length-aware realtime timeout**: clinician realtime playback timeout scales with utterance length (base 5 s + 500 ms per word, clamped between 15 s and 30 s) to avoid timing out normal longer clinician turns.
- **No replay after partial realtime playback**: if realtime audio already started and then degraded, the system avoids replaying the same clinician line through TTS from the beginning, because that caused obvious duplicate speech and voice switching.

### Clinician Audio Telemetry

Every bot clinician turn emits a `clinician_audio` state event recording:

- `path`: `"realtime"`, `"tts"`, or `"none"` (aborted before any audio)
- `realtime_outcome`: `"completed"`, `"partial"`, or `"failed"` (null if realtime was never attempted)
- `fallback_reason` and `renderer_error`: diagnostic strings when the primary path did not succeed
- `elapsed_ms`: wall-clock time from audio request to completion

These events are persisted via `POST /api/sessions/:id/events`. Because the `clinician_audio` event type requires a DB migration, the events route includes a graceful fallback: if the insert fails with a constraint error (migration not yet applied), the event is re-inserted as `classification_result` with an `__event_kind: "clinician_audio"` marker in the payload. The EventLog and review page detect both storage forms transparently.

### Persistence Infrastructure

All persistence calls from the simulation page (`persistTranscriptTurn`, `updatePersistedTurnSnapshot`, `persistSessionEvent`, session end) are tracked through a central `pendingPersistenceRef` set. Requests use `keepalive: true` for reliability during page transitions. Before navigating to the review page on session end, `flushPendingPersistence()` awaits all in-flight persistence calls (with a 2.5 s timeout), ensuring the review page loads with complete data.

### Abandoned Session Handling

Sessions that are not explicitly ended by the trainee (tab close, hard refresh, or SPA navigation to another page) are automatically closed via two mechanisms:

- **Tab close / hard refresh**: a `beforeunload` event listener fires `navigator.sendBeacon` to `POST /api/sessions/:id/end` with `exit_type: "instant_exit"`. `sendBeacon` is guaranteed to be dispatched by the browser even as the page tears down, with no risk of blocking navigation.
- **SPA navigation** (component unmount): the simulation page's main `useEffect` cleanup fires a `fetch` with `keepalive: true` to the same endpoint if `endingRef.current` is false (i.e. `handleEndSession` was not already called).

Both paths are no-ops if `endingRef.current` is already true, preventing double-end when the trainee uses the normal End Session button or when max-duration auto-end fires.

## 7. Scoring

`src/lib/engine/scoring.ts` computes a post-session performance breakdown across four dimensions, each scored 0–100:

- **Composure**: starts at 100 and subtracts weighted penalties when composure markers are detected. Dismissive or hostile responses cost more than lighter markers, repeated markers compound across the session, and poor composure is penalised more heavily when the patient/relative is already highly escalated.
- **De-escalation**: measures the rate and effectiveness of de-escalation attempts. Score = attempt_rate × 0.4 + success_rate × 0.6, then turns that further inflame an already-escalated interaction subtract from that result. Effectiveness is measured by whether escalation level dropped on the next patient/relative reply, provided the AI clinician did not intervene first. Only turns where the patient/relative is actively escalated count.
- **Clinical Task Maintenance** (optional): ratio of completed milestones to total milestones defined for the scenario. Excluded entirely if no milestones are defined. Milestones are tracked silently during the session (not shown to the trainee) and appear on the review page as natural clinical evidence rather than checklist items.
- **Support Seeking**: starts from 100. Appropriate clinician takeover episodes receive a small credit, premature requests are penalised, and each trainee turn taken at or above the support threshold without asking for help counts as a missed opportunity. If the unsupported situation then worsens into the critical range or reaches level 10, additional penalties apply. Legacy scenarios without an explicit support threshold fall back to the critical threshold or level 6 so the dimension still reflects real missed intervention opportunities.

The overall score is a weighted average using scenario-defined weights (or equal defaults). When clinical task is excluded, weights are renormalized across the remaining three dimensions.

When `trainee_delivery_analysis` is present, composure and de-escalation also receive small, confidence-gated adjustments from the audio-derived markers. For example, `warm_empathic` can help slightly, while `defensive_tone`, `flat_detached`, or `tense_hurried` can subtract from the score. Low-confidence audio readings are deliberately damped.

**Qualitative labels**: Strong (80–100), Developing (60–79), Needs practice (0–59).

**Session validity gate**: sessions under 3 trainee turns show no score. Sessions of 3–6 trainee turns display scores with a "preliminary" caveat, and their dimension scores are moderated toward the midpoint so sparse evidence does not produce hard zero or hundred scores too easily.

**Evidence tracking**: every scoring event (marker detected, attempt made, milestone completed, support invoked) is recorded with its turn index and score impact. The review page shows the 2–3 highest-impact moments and a technique suggestion based on the weakest dimension when the session is long enough to score.

The current review flow computes score and evidence on demand from transcript turns, events, and scenario snapshot data. `session_scores` and `session_score_evidence` may exist in the schema as legacy or future-use tables, but the current app flow does not write them.

## 8. Scenario Authoring: Traits And Archetypes

`src/lib/engine/traitDials.ts` defines **14 numeric trait dials** across three categories, plus a separate bias-category selector:

- **Emotional**: hostility, frustration, impatience, trust
- **Behavioural**: willingness_to_listen, sarcasm, volatility, boundary_respect, interruption_likelihood
- **Cognitive / contextual**: coherence, repetition, entitlement, bias_intensity, escalation_tendency

Each numeric trait has a 0–10 range with human-readable low/high labels. Bias category is configured separately (`none`, `gender`, `racial`, `age`, `accent`, `class_status`, `role_status`, `mixed`).

`src/lib/engine/archetypePresets.ts` provides five ready-made scenario configurations:

1. **De-escalation Fundamentals** (moderate) — frustrated relative
2. **Professional Boundary Setting** (moderate) — entitled patient
3. **Responding to Discriminatory Language** (high) — hostile with active bias
4. **Breaking Difficult News** (high) — grief-focused
5. **High-Pressure Confrontation** (extreme) — volatile and accusatory

Each preset bundles scenario defaults, a full trait profile, voice configuration, and escalation rules.

## 9. Persistence, Review, And Forking

Supabase stores:

- authored scenarios (`scenario_templates`, `scenario_traits`, `scenario_voice_config`, `escalation_rules`, `scenario_milestones`)
- live and completed sessions (`simulation_sessions` with frozen `scenario_snapshot`, `recording_path`, `recording_started_at`, `review_summary`)
- session audio recordings (Supabase Storage bucket `simulation-audio`, private, one `.webm` file per session)
- transcript turns (`transcript_turns` with per-turn snapshots: `classifier_result`, `trainee_delivery_analysis`, `trigger_type`, `state_after`, `patient_voice_profile_after`, `patient_prompt_after`)
- simulation state events (`simulation_state_events` — event types: `session_started`, `session_ended`, `escalation_change`, `de_escalation_change`, `ceiling_reached`, `trainee_exit`, `classification_result`, `clinician_audio`, `prompt_update`, `error`; trainee audio delivery fallback events are stored as `classification_result` with `__event_kind: "trainee_audio_delivery"`)
- optional legacy scoring tables (`session_scores`, `session_score_evidence`) that are not used by the current review flow
- trainee reflections (`session_reflections`)
- educator notes

The session APIs persist transcript turns and state events during the live run, then the review pages reconstruct transcript, escalation history, scoring, and educator annotations from that stored data.

### Review Page

The review page (`src/app/review/[sessionId]/page.tsx`) loads session, transcript, events, and educator notes in parallel. It includes a retry mechanism (up to 8 attempts at 750 ms intervals) that re-fetches if the session data appears incomplete — specifically if `exit_type`, `peak_escalation_level`, or `ended_at` are missing, if clinician turns are present but no `clinician_audio` events have arrived yet, or if trainee turns exist but audio-delivery results have not arrived yet. This handles the race between the simulation page's final persistence flush and the review page load.

The schema supports `exit_type` values `normal`, `instant_exit`, `educator_ended`, `timeout`, `auto_ceiling`, and `max_duration`. The current UI/runtime paths actively emit `normal`, `instant_exit`, `auto_ceiling`, and `max_duration`.

`POST /api/sessions/[id]/review-summary` now behaves as a populate-if-missing route rather than a pure regeneration endpoint. It verifies session ownership, returns the saved `simulation_sessions.review_summary` when present, and otherwise generates one educator-style summary, persists the JSON, and reuses that stored version on later visits. `ReviewSummaryCard` prefers the stored summary immediately and only falls back to generation for sessions that do not have one yet.

`GET /api/sessions/[id]/scenario-history` is a deterministic history endpoint for the `Review your progress` card. It loads the current user's non-deleted sessions for the same scenario, recomputes score from persisted transcript/events, reuses stored review summaries when present, falls back to local summary generation when they are missing, and produces a coach-style progress block plus an explicit non-deleted session count for that scenario.

### Responsive Layout

Both the simulation page and the review page are designed to work on mobile phones as well as desktops:

- **AppShell**: the sidebar nav (`w-56`) is hidden below the `md` breakpoint. The TopBar renders compact icon-based navigation links and a sign-out button on mobile instead.
- **Simulation page**: uses a tab bar (Simulation / Transcript / Scenario) below `lg`, switching to the three-panel layout on larger screens.
- **Review page**: the reflection check-in and the Session Summary both sit in a full-width vertical stack. The Session Summary uses a single narrative header, a 3-card coaching grid, and an embedded learning-objectives block. Below the timeline, the `Review your progress` card and the `Ready to try again?` retry CTA both sit above the score breakdown. The escalation timeline chart height reduces from `h-72` to `h-56` on mobile. Transcript/Event Log/Notes use `60vh` height on mobile instead of a fixed 500px. The Transcript / Event Log / Educator Notes section switcher is rendered as an explicit three-button segmented control, and mobile places the "Restart From Turn" action in its own full-width action area below the transcript list.

The review page displays:

- **Top review section**: the `ReflectionPrompt` appears first and is always full width. Below it, the page shows either the persisted `ReviewSummaryCard` or the short-session placeholder when the session is too short to score.
- **Reflection prompt**: unscored trainee self-reflection with emotion tags and free text, persisted separately from performance data and kept at the top of the review page even for short sessions. The prompt text now asks, "How do you think that conversation went?" If saved reflection data cannot be loaded, the component stays visible and shows an inline error state rather than disappearing.
- **Session summary**: one overview sentence block plus `What Helped`, `Why It Mattered`, and `Try This Move`. The summary also contains the scenario's learning objectives so the broader goals sit alongside the coach summary rather than in a separate panel. The summary is generated with structured output, but once persisted it is reused rather than regenerated on each visit. Coaching now emphasises response function, timing, and structure over stock exemplar phrases.
- **Conversation timeline**: always visible on the main screen (no longer in a tab), showing the conversation-intensity path with event markers, optional session-audio playback, a hover/playback cursor, and a persistent detail panel for the selected key moment.
- **Timeline coaching cards**: up to 8 ranked scoring moments rendered as numbered tabs beneath the chart. The active card shows the headline, likely impact, one-turn-before/one-turn-after transcript context, what happened next, why it mattered here, and a suggested communication move when relevant.
- **Review your progress**: a deterministic, coach-style scenario-history panel built from the current user's non-deleted sessions in the same scenario. Its count is session-based, not utterance-based.
- **Ready to try again?**: a scenario-level retry CTA that creates a fresh session from the same scenario so the learner can immediately practise the coached move again.
- **ScoreCard**: qualitative label badge (Strong / Developing / Needs practice), an overall score badge, and four dimension bars (0–100) with weight percentages. Sessions under 3 trainee turns show the short-session placeholder instead of the score card. The score block now sits below the progress/retry coaching content with more vertical spacing.
- **Section switcher**: Transcript, Event Log, and Educator Notes are shown one panel at a time using a segmented control rather than the previous tabs primitive.
- **Audio delivery badges**: trainee turns can show a separate `Audio delivery` row with 0-3 markers and an assessment-confidence label. The confidence label refers to confidence in the audio reading itself, not the trainee's self-confidence.
- **Fallback merge**: if `trainee_delivery_analysis` is missing on the transcript row but present in fallback events, the transcript API backfills it before returning rows, and the review page also merges the fallback payload defensively before rendering and scoring.

### Live Simulation Copy

The simulation page intentionally exposes trainee-facing copy rather than engine terminology:

- the live meter is labelled **Patient/relative status** rather than "Escalation"
- the support action is **Ask AI clinician for help**
- the return action is **Resume conversation**
- while bot mode is active, status text explains that the AI clinician is speaking on the trainee's behalf or that the patient/relative is responding to the AI clinician
- the live classifier summary is hidden from the trainee; technique labels and effectiveness remain part of scoring/review, not the in-session UI

The `TranscriptViewer` displays per-turn audio delivery badges, including multiple markers when present, and the `EventLog` renders clinician audio events with path, timing, and error details. When a session has a recording, each trainee and patient turn shows a play button that seeks to the correct offset in the full session recording and plays the audio for that utterance.

### Session Audio Recording And Playback

Each simulation session is continuously recorded as a single mixed audio file (trainee mic + AI remote audio). The recording is uploaded to Supabase Storage (`simulation-audio` bucket) at session end via `POST /api/sessions/:id/audio`, which also persists `recording_path` and `recording_started_at` on the session record. The route verifies that the authenticated user owns the session, then performs the Storage write via the admin Supabase client so bucket RLS does not block uploads for valid sessions.

On the review page, `GET /api/sessions/:id/audio` returns a time-limited signed URL. The `TranscriptViewer` calculates per-turn seek offsets relative to `recording_started_at` (the exact timestamp when `MediaRecorder.start()` was called, not `session.started_at` which is set earlier during session init). Offset calculation accounts for the fact that transcript `started_at` timestamps represent speech *end* rather than speech *start*:

- **Trainee turns**: seek to the previous AI turn's `started_at` (AI speech end ≈ trainee speech start).
- **Patient/AI turns**: seek to the previous trainee turn's `started_at` minus a 3-second buffer, because the AI begins responding before the trainee's transcript event arrives.

Forking is session-based rather than template-based: a new session can be created from an earlier session and turn index, reusing the frozen scenario snapshot and the saved turn/state history. Fork metadata tracks `parent_session_id`, `forked_from_session_id`, `forked_from_turn_index`, `fork_label`, and `branch_depth`.

## 10. Access Control

### Authentication

PROLOG uses **email OTP (magic link)** via Supabase Auth. Access is restricted to `@nhs.scot` email addresses — the login page validates the domain client-side before calling Supabase, so non-NHS.scot addresses never reach the auth service. The OTP flow:

1. `POST supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '/auth/confirm' } })`
2. Supabase emails a magic link via Resend; the user clicks it
3. The browser loads `/auth/confirm` — a **client-side page** that renders a green "Complete sign-in" button
4. The user clicks the button; the browser Supabase client calls `verifyOtp({ token_hash, type })` (or `exchangeCodeForSession(code)` for the PKCE code flow) and redirects to `/dashboard`

The confirm page is intentionally client-side rather than a server-side route handler. Email clients (including Outlook's reading pane) make background GET requests to links in emails; a server-side handler would consume the one-time token before the user ever clicked. With a client-side page the token is only consumed when JavaScript runs in a real browser and the user explicitly clicks the button.

There is no self-service password-based signup. Supabase creates a new user record automatically on first OTP sign-in for any valid `@nhs.scot` address.

### Authorisation

Three user roles exist: **admin**, **educator**, and **trainee**, stored on `user_profiles.role`.

Current enforcement:

- **Scenario creation** (`POST /api/scenarios`): restricted to admin and educator roles.
- **Org settings modification** (`PUT /api/org-settings`): restricted to admin role.
- **Session deletion** (`DELETE /api/sessions/:id/delete`): restricted to the session's `trainee_id` (owner only).
- **Scenario deletion** (`DELETE /api/scenarios/:id`): restricted to the scenario's `created_by` (owner only).
- **Session start** (`POST /api/sessions/:id/start`): restricted to the session's `trainee_id`.

The dashboard hides delete buttons for items the current user does not own. The scenario edit page and settings page display a notice that full RBAC will be implemented in the next version.

Read access to sessions, transcripts, events, educator notes, audio, and scenarios is currently open to all authenticated users. This is intentional for the current phase to allow management visibility across the platform. Row-level security policies are planned for a future release.

### Organisation Settings

`org_settings` currently stores four governance fields:

- `max_escalation_ceiling`
- `max_session_duration_minutes`
- `allow_discriminatory_content`
- `require_consent_gate`

Runtime enforcement is mixed:

- `max_escalation_ceiling` is enforced in scenario editing and live simulation.
- `max_session_duration_minutes` is enforced in live simulation via auto-end.
- `allow_discriminatory_content` is persisted and editable, but is not yet wired to block discriminatory scenario authoring or runtime behaviour.
- `require_consent_gate` is persisted and editable, but the briefing flow currently always shows the consent gate.

### User Identity

`user_profiles` stores `display_name` and `email` (added via migration, backfilled from `auth.users`, and kept in sync by the `handle_new_user` trigger). The dashboard displays the user's name as a greeting, session lists show the trainee's full identity as "Display Name (email)", and the scenario edit page shows the creator's name. A lightweight profile API (`GET /api/profile`) returns the current user's profile for client-side identity checks.

## 11. Dashboard

The dashboard (`src/app/dashboard/page.tsx`) currently has a welcome header plus two main content sections:

- **Scenarios available to you**: a tinted panel (`bg-muted/40`) containing compact fixed-width cards (220px) for published scenarios, each linking directly to the briefing page. Cards show difficulty, title, and setting.
- **Recent sessions**: the 6 most recent sessions across all users, showing scenario title, trainee identity, session date/time (preferring `started_at`, then `ended_at`, then `created_at`), peak escalation level, exit status, and an owner-only delete button.

## 12. Landing Page

The landing page (`src/app/page.tsx`) is a marketing-style overview rather than a redirect. It uses real session screenshots (`/public/screenshots/`) for the escalation timeline and transcript demos, an `IsometricDiagramV3` component for the system architecture section, and inline "prolog" text rendered in the Host Grotesk Bold logo font in dark teal (`#0d2d3a`) via a `<P />` helper component, with a lighter variant (`#7ec8c8`) for use on dark backgrounds. The page includes feature, outputs, configuration, workflow, audience, architecture, privacy, roadmap, and CTA sections; the configuration demo still uses interactive mock sliders.

### Footer and Privacy Statement

The footer contains the PROLOG wordmark, a "Built for NHS Scotland and HSCP staff" tag, and a `PrivacyStatement` client component (`src/components/landing/PrivacyStatement.tsx`). The component renders as a collapsed trigger — a `ShieldCheck` icon, "Privacy Statement" label, and a `ChevronDown` that rotates on open — and expands in-place to show the full 13-section UK GDPR privacy statement covering data collection, third-party providers (Supabase, OpenAI, Vercel), international transfers, retention, and individual rights. The test-service warning ("PROLOG is currently a test application…") is rendered at the top of the expanded content inside a distinct orange bordered box (`border-2 border-orange-400 bg-orange-50`) to visually separate it from the numbered privacy sections.

### Test-Purposes Banner

A sticky orange banner (`bg-orange-500`, `text-zinc-900`, `z-50`) is rendered at the top of every page via the root layout (`src/app/layout.tsx`), above all other content. It reads: "⚠ This site is for test purposes only — do not enter real patient data or sensitive clinical information." Because the banner occupies 36 px of vertical space, all full-height containers that previously used `h-screen` have been updated to `h-[calc(100vh-36px)]`: the `AppShell` wrapper, the `Sidebar`, and the loading/main views in the simulation page.

### Branding

The logo uses Host Grotesk Bold (700) in lowercase "prolog" with dark teal colouring (`#0d2d3a`). The speech bubble icon uses the same dark teal with a white medical cross. The wordmark is rendered without a subtitle across the app (header, sidebar, footer). Nunito Sans is the base UI font. Dashboard status badges use semantic colours (teal for published, emerald for completed, red for aborted) distinct from the primary blue used for CTA buttons.

### Sign-In Flow

The sign-in flow is intentionally two-step:

1. The login page (`/auth/login`) accepts only `@nhs.scot` email addresses and sends a magic link.
2. The emailed link opens `/auth/confirm`, which renders a final green **Complete sign-in** button.
3. The user clicks that button to verify the OTP client-side and proceed into the app.

This avoids background email-client link prefetches consuming the one-time token before the user reaches a real browser.
