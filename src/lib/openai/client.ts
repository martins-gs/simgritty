import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  cachedClient ??= new OpenAI({ apiKey });
  return cachedClient;
}

export function shouldFailLoudOnOpenAIError(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function getOpenAIErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unknown OpenAI error";
}
