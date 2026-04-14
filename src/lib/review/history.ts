import { z } from "zod";
import { reviewDebugSchema } from "@/lib/review/feedback";

export const SCENARIO_HISTORY_ARTIFACTS_VERSION = 1;

export interface ScenarioHistorySessionInput {
  id: string;
  createdAt: string;
  caseNeed: string | null;
  deliverySummary: string | null;
  sessionOutcome: string | null;
  achievedObjectives: string[];
  outstandingObjectives: string[];
  transcriptExcerpt: string | null;
  keyMoments: Array<{
    id: string;
    positive: boolean;
    turnIndex: number;
    before: string | null;
    youSaid: string | null;
    after: string | null;
    evidenceLabel: string | null;
  }>;
}

export const scenarioHistoryCoachResponseSchema = z.object({
  totalSessions: z.number().int().min(1),
  sessionLabel: z.string(),
  headline: z.string(),
  progress: z.string(),
  primaryTarget: z.string(),
  secondaryPatterns: z.array(z.string()).max(2).default([]),
  practiceTarget: z.string(),
});

export const scenarioHistoryApiResponseSchema = z.object({
  summary: scenarioHistoryCoachResponseSchema.nullable().default(null),
  debug: reviewDebugSchema,
});

export const storedScenarioHistoryArtifactSchema = z.object({
  version: z.number().int().min(1),
  evidence_hash: z.string(),
  generated_at: z.string(),
  latest_session_id: z.string().nullable().default(null),
  total_session_count: z.number().int().min(0),
  summary: scenarioHistoryCoachResponseSchema.nullable().default(null),
  debug: reviewDebugSchema,
});

export type ScenarioHistoryCoachResponse = z.infer<typeof scenarioHistoryCoachResponseSchema>;
export type ScenarioHistoryApiResponse = z.infer<typeof scenarioHistoryApiResponseSchema>;
export type StoredScenarioHistoryArtifact = z.infer<typeof storedScenarioHistoryArtifactSchema>;
