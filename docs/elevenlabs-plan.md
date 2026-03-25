# ElevenLabs TTS Integration — Feasibility & Implementation Plan

## Summary

ElevenLabs integration is **technically feasible and recommended** for the clinician voice pipeline. The Eleven v3 model's audio tag system provides rich emotional delivery control that maps well to SimGritty's existing `StructuredVoiceProfile` architecture. Latency is not a blocker. The patient voice pipeline remains on OpenAI Realtime (no viable ElevenLabs equivalent). Structured output generation (voice profiles, clinician turns) also stays on OpenAI.

---

## Current Architecture

SimGritty has two independent voice pipelines:

| Pipeline | Current tech | Key files |
|----------|-------------|-----------|
| **Patient voice** | OpenAI Realtime API via WebRTC (gpt-realtime-1.5, bidirectional speech-to-speech) | `src/hooks/useRealtimeSession.ts` |
| **Clinician voice (primary)** | OpenAI Realtime API via WebRTC (output-only, text→speech rendering) | `src/hooks/useRealtimeVoiceRenderer.ts` |
| **Clinician voice (fallback)** | OpenAI TTS REST API (gpt-4o-mini-tts, returns MP3 buffer) | `src/app/api/tts/route.ts` |

### How clinician voice instructions work today

Each clinician turn generates a `StructuredVoiceProfile` (via OpenAI structured outputs) with seven fields: `accent`, `voiceAffect`, `tone`, `pacing`, `emotion`, `delivery`, `variety`. These are rendered into rich natural-language instructions by `clinicianVoiceBuilder.ts` and passed to OpenAI's `gpt-4o-mini-tts`, which interprets them natively:

> "Warm, grounded, and gentle enough to hold grief without sounding mournful yourself. Add extra grounding and reassurance so the voice actively settles the interaction. Non-defensive, calm, and quietly credible."

The instructions adapt dynamically per-turn based on escalation state, patient emotion type, and clinical technique (validation / boundary / action / question).

**Key files:**
- `src/types/voice.ts` — `StructuredVoiceProfile` and `StructuredClinicianTurn` types
- `src/lib/engine/clinicianVoiceBuilder.ts` — dynamic voice instruction generation
- `src/lib/voice/renderVoiceProfile.ts` — profile formatting for prompts and TTS
- `src/lib/openai/structuredVoice.ts` — voice profile generation via OpenAI structured outputs
- `src/app/api/tts/route.ts` — TTS synthesis endpoint
- `src/components/scenarios/VoiceConfigPanel.tsx` — voice config UI at scenario creation
- `src/components/governance/OrgSettingsForm.tsx` — org-level settings form
- `src/types/governance.ts` — OrgSettings type

---

## Why ElevenLabs v3 Changes the Picture

### Audio tags provide rich per-line emotional control

ElevenLabs v3 supports inline audio tags that direct vocal delivery without being spoken aloud:

```
[professional]  "Thank you for calling. My name is Sarah, how can I help you today?"
[sympathetic]   "I'm really sorry to hear you're having trouble. That sounds frustrating."
[reassuring]    "Based on what you're describing, we can definitely fix that."
```

Available tag categories:
- **Emotional direction**: `[happy]`, `[sad]`, `[excited]`, `[angry]`, `[sympathetic]`, `[thoughtful]`, `[surprised]`
- **Delivery style**: `[whispers]`, `[professional]`, `[reassuring]`, `[questioning]`, `[firm]`, `[calm]`, `[warm]`
- **Non-verbal**: `[sighs]`, `[exhales]`, `[clears throat]`, `[short pause]`, `[long pause]`
- **Accent**: `[strong British accent]`, `[strong French accent]`
- **Emphasis**: CAPITALISATION increases emphasis; ellipses add pauses

### Voice settings (numeric controls, complement the tags)

| Parameter | Range | Effect |
|-----------|-------|--------|
| `stability` | 0–1 | Creative (0) = more emotional range; Robust (1) = composed/consistent |
| `similarity_boost` | 0–1 | Fidelity to the selected voice's character |
| `style` | 0–1 | Amplifies the voice's stylistic qualities |
| `speed` | 0.7–1.2 | Speech rate multiplier |

### How StructuredVoiceProfile maps to v3

| Profile field | Current (OpenAI free-text) | ElevenLabs v3 equivalent |
|---------------|---------------------------|--------------------------|
| `accent` | "Natural British English" | `[strong British accent]` tag |
| `voiceAffect` | "Warm, grounded, gentle" | `[warm]`, `[gentle]`, `[professional]` tags |
| `tone` | "Reassuring, calm, credible" | `[reassuring]`, `[calm]` tags |
| `pacing` | "Slightly slower, deliberate" | `speed` param (0.7–1.2) + ellipses + `[short pause]` |
| `emotion` | "Deep empathy held in restraint" | `[sympathetic]`, `[sad]`, `[thoughtful]` tags |
| `delivery` | "Firmer attack on boundary language" | `[firm]` tag + CAPITALISATION for emphasis |
| `variety` | "Minimal pitch variation" | `stability` slider toward Robust |

### Clinical technique → audio tag mapping

| Technique style | Audio tags |
|----------------|-----------|
| validation | `[sympathetic]`, `[warm]`, `[gentle]` |
| boundary | `[professional]`, `[firm]`, `[calm]` |
| action | `[reassuring]`, `[confident]` |
| question | `[curious]`, `[gentle]`, `[questioning]` |

### Patient emotion context → clinician voice settings

| Patient emotion | Clinician tags | Stability |
|----------------|---------------|-----------|
| grief | `[sympathetic]` `[soft]` | Lower (~0.3) — more emotional range |
| hostility | `[professional]` `[calm]` | Higher (~0.8) — composed authority |
| fear | `[reassuring]` `[warm]` | Moderate (~0.5) |
| frustration | `[patient]` `[professional]` | Moderate (~0.5) |
| distrust | `[calm]` `[professional]` | Higher (~0.7) — steady credibility |

---

## Latency Assessment

### ElevenLabs model options

| Model | TTFB (streaming) | Audio tag support | Best for |
|-------|-------------------|-------------------|----------|
| **Eleven v3** | ~300–500ms (estimated, not documented) | Full audio tags | Maximum expressiveness |
| **Flash v2.5** | **~75ms** | No audio tags (uses SSML) | Real-time / low latency |

v3 does NOT support SSML. Flash v2.5 does NOT support v3 audio tags. They are complementary models.

### Comparison with current paths

| Current path | Latency | ElevenLabs equivalent |
|-------------|---------|----------------------|
| OpenAI Realtime WebRTC (primary clinician) | ~50–150ms | Flash v2.5 streaming: ~75ms (comparable) |
| OpenAI TTS REST (fallback clinician) | ~200–500ms (full MP3 buffer) | v3 streaming: ~300–500ms (comparable, but progressive chunks) |

**Verdict: Latency is not a blocker.** For the TTS fallback path, v3 is comparable. For the primary path, Flash v2.5 at 75ms matches OpenAI Realtime. Offering a model selector (v3 for expressiveness, Flash for speed) gives orgs the choice.

---

## What Stays on OpenAI

| Component | Reason |
|-----------|--------|
| **Patient voice** | Integrated bidirectional speech-to-speech via Realtime API. No ElevenLabs equivalent. Decomposing into STT→LLM→TTS would add 300–800ms+ latency and lose VAD/turn-detection integration. |
| **Structured output generation** | Voice profiles and clinician turns generated via OpenAI structured output API with Zod schemas. No reason to change. |

---

## Implementation Plan

### Phase 1: TTS Fallback Path (Low risk, fast validation)

**Goal:** Add ElevenLabs as an alternative TTS provider for the clinician fallback path (`/api/tts/route.ts`), controlled via org settings.

#### 1.1 Settings UI & persistence

**Modify `src/types/governance.ts`** — add to OrgSettings:
```typescript
tts_provider: "openai" | "elevenlabs";        // default: "openai"
elevenlabs_model: "eleven_v3" | "eleven_flash_v2_5";  // default: "eleven_v3"
elevenlabs_voice_id: string;                   // curated voice ID
```

**Modify `src/components/governance/OrgSettingsForm.tsx`** — add:
- Clinician TTS Provider dropdown (OpenAI / ElevenLabs)
- ElevenLabs Model selector (shown when ElevenLabs selected)
- ElevenLabs Voice selector (curated list of voices tested with clinical tags)

**Modify `src/app/api/org-settings/route.ts`** — persist the new fields.

**Add `ELEVENLABS_API_KEY`** to `.env.local` (server-side only).

#### 1.2 TTS provider abstraction

**Create `src/lib/tts/providers/types.ts`:**
```typescript
interface TtsProvider {
  synthesize(request: {
    text: string;
    voiceProfile?: StructuredVoiceProfile;
    context?: ClinicianVoiceContext;
    voice: string;
  }): Promise<ArrayBuffer>;
}
```

**Create `src/lib/tts/providers/openai.ts`:**
- Extract existing `requestSpeech()` logic from `route.ts`
- Uses `buildClinicianVoiceInstructionsFromProfile()` for voice direction (unchanged)

**Create `src/lib/tts/providers/elevenlabs.ts`:**
- Calls ElevenLabs TTS API (`POST /v1/text-to-speech/{voice_id}`)
- Uses `mapVoiceProfileToElevenLabsTags()` to convert profile → tagged text + voice settings
- Uses `@elevenlabs/elevenlabs-js` SDK

#### 1.3 Voice profile → ElevenLabs mapping

**Create `src/lib/tts/elevenlabs/mapVoiceProfile.ts`:**

```
Input:  StructuredVoiceProfile + ClinicianVoiceContext + speech text
Output: {
  taggedText: string,       // e.g. "[reassuring] [calm] I can see this is really difficult..."
  voiceSettings: {
    stability: number,      // 0–1, derived from escalation level + patient emotion
    similarity_boost: number,
    style: number,
    speed: number           // 0.7–1.2, derived from pacing profile
  }
}
```

The function:
1. Parses affect/tone/emotion fields from the profile to select appropriate audio tags
2. Maps escalation level → stability (higher escalation = higher stability for composed authority)
3. Maps pacing description → speed parameter
4. Prepends audio tags to the speech text

**Reuses:** `ClinicianVoiceContext` type from `clinicianVoiceBuilder.ts`, `StructuredVoiceProfile` from `types/voice.ts`.

#### 1.4 Route modification

**Modify `src/app/api/tts/route.ts`:**
- Fetch org settings to determine provider
- Route to OpenAI or ElevenLabs provider based on `tts_provider` setting
- Keep existing fallback logic for OpenAI path
- Add equivalent fallback for ElevenLabs (v3 → Flash v2.5 if v3 fails)

#### 1.5 Database migration

Add columns to `org_settings` table:
- `tts_provider` (text, default 'openai')
- `elevenlabs_model` (text, default 'eleven_v3')
- `elevenlabs_voice_id` (text, nullable)

### Phase 2: Primary Clinician Renderer (Optional, medium complexity)

**Goal:** Replace the OpenAI Realtime voice renderer with ElevenLabs streaming when provider=elevenlabs.

**Create `src/hooks/useElevenLabsVoiceRenderer.ts`:**
- Uses ElevenLabs streaming TTS endpoint (`POST /v1/text-to-speech/{voice_id}/stream`)
- Progressive audio chunk playback via Web Audio API or MediaSource
- Implements same interface as `useRealtimeVoiceRenderer.ts` (`connect`, `disconnect`, `speakText`)
- Uses Flash v2.5 for low latency, or v3 for expressiveness

**Modify simulation orchestration** to select renderer based on org setting.

### Phase 3: Advanced Features (Optional)

- Voice library browser in `VoiceConfigPanel.tsx` (fetch from ElevenLabs voices API)
- Voice cloning for custom clinician personas
- Voice design from text description (e.g., "calm British NHS nurse, 40s")
- Text-to-Dialogue API for multi-clinician team scenarios

---

## Opportunities

1. **Voice diversity**: 3,000+ voices in ElevenLabs library vs OpenAI's 11 presets. Different accents, ages, genders for clinician personas — valuable for NHS diversity requirements.

2. **Voice cloning**: Create custom clinician voices from audio samples. Organisations train against a consistent, recognisable clinician persona.

3. **Voice design from text**: Generate custom voices from descriptions ("calm, authoritative British female nurse, 40s") — no audio samples needed.

4. **Streaming playback**: Current TTS fallback buffers the entire MP3 before playing. ElevenLabs streaming starts playback within the first audio chunk, improving perceived latency.

5. **Text-to-Dialogue API**: Dedicated multi-speaker endpoint for future multi-clinician or team-based de-escalation training.

6. **LLM-enhanced audio tags**: ElevenLabs has a built-in "Enhance" feature that uses an LLM to add contextually appropriate audio tags. We could build our own clinical-context-aware version for even better tag selection.

7. **A/B testing**: Provider toggle lets you compare trainee outcomes and voice satisfaction across providers.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| v3 latency is undocumented (likely 300–500ms) | Slower than primary realtime path | Acceptable for fallback; offer Flash v2.5 as speed option |
| Audio tags are coarser than free-text instructions | Less granular per-technique delivery overlays | Good enough for broad emotional shifts; iterate tag mapping based on testing |
| Tag effectiveness varies by voice | Some voices respond poorly to certain tags | Curate and test a specific set of voices for clinical use |
| Voice mismatch (patient=OpenAI, clinician=ElevenLabs) | Different vocal character between speakers | Arguably natural (different people); test in practice |
| Two providers / two bills | Operational overhead | Opt-in per org; only pays when enabled |
| Bracket tags spoken aloud vs delivery control | Bad UX if tags are vocalised | v3 bracket-style tags `[sympathetic]` control delivery without being spoken; narrative context ("she said excitedly") IS spoken — use only bracket tags |

---

## Dependencies

- `@elevenlabs/elevenlabs-js` — official TypeScript SDK with auto-retries and streaming support
- `ELEVENLABS_API_KEY` environment variable
- Supabase migration for new org_settings columns

---

## Verification

1. Set `tts_provider` to `elevenlabs` in org settings
2. Run a simulation and trigger clinician TTS (bot loop de-escalation)
3. Verify audio plays back correctly with appropriate emotional delivery
4. Compare side-by-side with OpenAI TTS at matching escalation levels
5. Test across escalation levels (1–3 → 4–6 → 7–10) to verify stability/tag mapping produces appropriate emotional shifts
6. Test with multiple patient emotion types (grief, hostility, fear, frustration)
7. Measure TTFB in console logs — compare v3, Flash v2.5, and current OpenAI paths
8. Toggle back to OpenAI to verify no regressions

---

## Bottom Line

| Dimension | Assessment |
|-----------|-----------|
| **Technically feasible?** | Yes — for clinician voice (both primary and fallback). Not for patient voice. |
| **Good UX?** | **Yes.** v3 audio tags map naturally to clinical technique styles. Voice quality is best-in-class. |
| **Latency?** | **Not a blocker.** Flash v2.5 (~75ms) for real-time. v3 for quality. Both comparable to current paths. |
| **Voice instruction mapping?** | **Strong fit.** v3 tags (`[sympathetic]`, `[reassuring]`, `[firm]`) align with clinical delivery needs. Coarser than free-text but effective. |
| **Complexity** | Low for Phase 1 (TTS fallback). Medium for Phase 2 (streaming renderer). |
| **Biggest risk** | v3 latency in practice. Mitigated by also supporting Flash v2.5. |
| **Biggest opportunity** | 3,000+ voice library, voice cloning, streaming playback, and best-in-class naturalness. |
