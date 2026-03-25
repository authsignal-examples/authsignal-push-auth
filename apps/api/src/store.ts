import type { SupportedAction } from "./actions.js";

type ChallengeContext = {
  userId: string;
  action: SupportedAction;
  numberMatch: string | null;
  createdAt: number;
  context?: {
    merchant?: string;
    amount?: string;
    currency?: string;
    note?: string;
  };
  challengeId?: string;
  status: "pending" | "approved" | "denied";
};

const CONTEXT_TTL_MS = 1000 * 60 * 15;
const challengeContextByIdempotencyKey = new Map<string, ChallengeContext>();

function cleanup() {
  const now = Date.now();

  for (const [idempotencyKey, entry] of challengeContextByIdempotencyKey.entries()) {
    if (entry.createdAt + CONTEXT_TTL_MS < now) {
      challengeContextByIdempotencyKey.delete(idempotencyKey);
    }
  }
}

export function createChallengeContext(params: {
  idempotencyKey: string;
  userId: string;
  action: SupportedAction;
  numberMatch: string | null;
  context?: ChallengeContext["context"];
}) {
  cleanup();
  challengeContextByIdempotencyKey.set(params.idempotencyKey, {
    userId: params.userId,
    action: params.action,
    numberMatch: params.numberMatch,
    context: params.context,
    createdAt: Date.now(),
    status: "pending"
  });
}

export function attachChallengeId(params: { idempotencyKey: string; challengeId: string }) {
  const existing = challengeContextByIdempotencyKey.get(params.idempotencyKey);
  if (!existing) {
    return;
  }

  existing.challengeId = params.challengeId;
}

export function getChallengeContext(idempotencyKey: string) {
  cleanup();
  return challengeContextByIdempotencyKey.get(idempotencyKey);
}

export function consumeChallengeContext(idempotencyKey: string) {
  challengeContextByIdempotencyKey.delete(idempotencyKey);
}

export function getPendingChallengeForUser(userId: string) {
  cleanup();
  for (const [idempotencyKey, entry] of challengeContextByIdempotencyKey.entries()) {
    if (entry.userId === userId && entry.challengeId && entry.status === "pending") {
      return { ...entry, idempotencyKey };
    }
  }
  return null;
}

export function resolveChallengeByIdempotencyKey(idempotencyKey: string, status: "approved" | "denied") {
  const entry = challengeContextByIdempotencyKey.get(idempotencyKey);
  if (entry) {
    entry.status = status;
  }
  return entry;
}

export function getChallengeStatus(idempotencyKey: string) {
  cleanup();
  const entry = challengeContextByIdempotencyKey.get(idempotencyKey);
  return entry?.status ?? null;
}
