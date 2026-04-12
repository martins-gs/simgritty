import type {
  SessionDeliveryAnalysis,
  SimulationStateEvent,
  TranscriptTurn,
} from "@/types/simulation";
import {
  getStoredEventKind,
  parseSessionDeliveryAnalysis,
  parseTraineeDeliveryAnalysis,
} from "@/lib/validation/schemas";

export function mergeTraineeAudioDeliveryFromEvents(
  turns: TranscriptTurn[],
  events: SimulationStateEvent[]
): TranscriptTurn[] {
  const deliveryByTurnIndex = new Map<number, TranscriptTurn["trainee_delivery_analysis"]>();

  for (const event of events) {
    if (event.event_type !== "classification_result") continue;
    const payload = event.payload;
    if (!payload || typeof payload !== "object") continue;

    const record = payload as Record<string, unknown>;
    const eventKind = getStoredEventKind(payload);
    const source = typeof record.source === "string" ? record.source : null;
    if (eventKind !== "trainee_audio_delivery" && source !== "trainee_audio_delivery") {
      continue;
    }

    const turnIndex = typeof record.turn_index === "number" ? record.turn_index : null;
    const deliveryAnalysis = parseTraineeDeliveryAnalysis(record.delivery_analysis);
    if (turnIndex == null || !deliveryAnalysis) continue;

    deliveryByTurnIndex.set(turnIndex, deliveryAnalysis);
  }

  if (deliveryByTurnIndex.size === 0) {
    return turns;
  }

  return turns.map((turn) => {
    if (turn.speaker !== "trainee") return turn;
    if (turn.trainee_delivery_analysis || turn.classifier_result?.trainee_delivery_analysis) {
      return turn;
    }

    const fallbackAnalysis = deliveryByTurnIndex.get(turn.turn_index);
    if (!fallbackAnalysis) return turn;

    return {
      ...turn,
      trainee_delivery_analysis: fallbackAnalysis,
      classifier_result: turn.classifier_result
        ? {
            ...turn.classifier_result,
            trainee_delivery_analysis: turn.classifier_result.trainee_delivery_analysis ?? fallbackAnalysis,
          }
        : null,
    };
  });
}

export function getSessionAudioDeliveryFromEvents(
  events: SimulationStateEvent[]
): SessionDeliveryAnalysis | null {
  const matchingEvents = [...events]
    .filter((event) => event.event_type === "classification_result")
    .sort((a, b) => b.event_index - a.event_index);

  for (const event of matchingEvents) {
    const payload = event.payload;
    if (!payload || typeof payload !== "object") continue;

    const record = payload as Record<string, unknown>;
    const eventKind = getStoredEventKind(payload);
    const source = typeof record.source === "string" ? record.source : null;
    if (eventKind !== "session_audio_delivery" && source !== "session_audio_delivery") {
      continue;
    }

    const deliveryAnalysis = parseSessionDeliveryAnalysis(record.delivery_analysis);
    if (deliveryAnalysis) {
      return deliveryAnalysis;
    }
  }

  return null;
}
