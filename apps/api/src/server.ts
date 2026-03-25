import { Authsignal, UserActionState } from "@authsignal/node";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { ACTIONS, isSupportedAction } from "./actions.js";
import { config } from "./config.js";
import {
  attachChallengeId,
  consumeChallengeContext,
  createChallengeContext,
  getChallengeContext,
  getChallengeStatus,
  getPendingChallengeForUser,
  resolveChallengeByIdempotencyKey
} from "./store.js";

const app = express();
const authsignal = new Authsignal({
  apiSecretKey: config.AUTHSIGNAL_SECRET_KEY,
  apiUrl: config.AUTHSIGNAL_API_URL
});
const allowAnyOrigin = config.MOBILE_ORIGIN === "*";
const allowedOrigins = new Set(
  [config.WEB_ORIGIN, config.MOBILE_ORIGIN].filter((origin) => origin !== "*")
);

app.post("/api/webhooks/authsignal", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.header("x-signature-v2");

  if (!signature) {
    return res.status(400).json({ error: "Missing x-signature-v2 header" });
  }

  try {
    const payload = req.body.toString("utf8");
    const event = authsignal.webhook.constructEvent(payload, signature);

    if (event.type === "push.created") {
      const idempotencyKey = event.data.idempotencyKey;
      const challengeId = event.data.challengeId;
      if (idempotencyKey && challengeId) {
        attachChallengeId({ idempotencyKey, challengeId });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid webhook" });
  }
});

app.use(express.json());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowAnyOrigin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: true
  })
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/config", (_req, res) => {
  res.json({
    tenantId: config.AUTHSIGNAL_TENANT_ID,
    baseUrl: config.AUTHSIGNAL_API_URL,
    apiBaseUrl: config.API_BASE_URL ?? `http://localhost:${config.PORT}`
  });
});

app.post("/api/users/upsert", async (req, res) => {
  const schema = z.object({
    userId: z.string().min(1),
    email: z.string().email().optional(),
    username: z.string().optional(),
    displayName: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const attributes = Object.fromEntries(
      Object.entries({
        email: parsed.data.email,
        username: parsed.data.username,
        displayName: parsed.data.displayName
      }).filter(([, value]) => value !== undefined)
    );

    if (Object.keys(attributes).length > 0) {
      await authsignal.updateUser({
        userId: parsed.data.userId,
        attributes: attributes as {
          email?: string;
          username?: string;
          displayName?: string;
        }
      });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to upsert user" });
  }
});

app.post("/api/auth/enroll/start", async (req, res) => {
  const schema = z.object({ userId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const tracked = await authsignal.track({
      userId: parsed.data.userId,
      action: ACTIONS.enrollPushCredential,
      attributes: {
        scope: "add:authenticators"
      }
    });

    return res.json({
      token: tracked.token,
      state: tracked.state,
      isEnrolled: tracked.isEnrolled
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to start enrollment" });
  }
});

app.post("/api/auth/push/start", async (req, res) => {
  const schema = z.object({
    userId: z.string().min(1),
    action: z.string().min(1),
    context: z
      .object({
        merchant: z.string().optional(),
        amount: z.string().optional(),
        currency: z.string().optional(),
        note: z.string().optional()
      })
      .optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  if (!isSupportedAction(parsed.data.action)) {
    return res.status(400).json({ error: "Unsupported action" });
  }

  const requiresNumberMatch = parsed.data.action === "approveTransaction";
  const numberMatch = requiresNumberMatch
    ? String(Math.floor(100 + Math.random() * 900))
    : null;

  try {
    const tracked = await authsignal.track({
      userId: parsed.data.userId,
      action: parsed.data.action,
      attributes: {
        custom: {
          ...parsed.data.context,
          ...(numberMatch ? { numberMatch } : {})
        }
      }
    });

    console.log("[push/start] track response:", JSON.stringify(tracked, null, 2));

    createChallengeContext({
      idempotencyKey: tracked.idempotencyKey,
      userId: parsed.data.userId,
      action: parsed.data.action,
      numberMatch,
      context: parsed.data.context
    });

    return res.json({
      token: tracked.token,
      idempotencyKey: tracked.idempotencyKey,
      numberMatch,
      state: tracked.state,
      isEnrolled: tracked.isEnrolled
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to start push challenge" });
  }
});

app.get("/api/mobile/challenge-context/:idempotencyKey", (req, res) => {
  const challengeContext = getChallengeContext(req.params.idempotencyKey);

  if (!challengeContext) {
    return res.status(404).json({ error: "Challenge context not found or expired" });
  }

  return res.json({
    userId: challengeContext.userId,
    action: challengeContext.action,
    context: challengeContext.context
  });
});

// Debug: receive public key from mobile, log it, and write to file
app.post("/api/debug/pubkey", async (req, res) => {
  const pk = req.body.publicKey;
  console.log("[debug] Device public key:", pk);
  const fs = await import("fs");
  fs.writeFileSync("/tmp/device-pubkey.txt", pk);
  return res.json({ ok: true });
});

// Debug: proxy the mobile SDK's getChallenge call to see raw API response
app.post("/api/debug/get-challenge", async (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey) {
    return res.status(400).json({ error: "publicKey required" });
  }

  const encodedKey = Buffer.from(publicKey, "utf-8").toString("base64url");
  const basicAuth = Buffer.from(`${config.AUTHSIGNAL_TENANT_ID}:`).toString("base64url");
  const url = `${config.AUTHSIGNAL_API_URL}/client/user-authenticators/push/challenge?publicKey=${encodedKey}`;

  console.log("[debug/get-challenge] URL:", url);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${basicAuth}` }
    });
    const body = await response.json();
    console.log("[debug/get-challenge] status:", response.status, "body:", JSON.stringify(body));
    return res.json({ status: response.status, url, body });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

// Web calls this after push.challenge() succeeds to register the challengeId
app.post("/api/auth/push/challenge-created", (req, res) => {
  const schema = z.object({
    idempotencyKey: z.string().min(1),
    challengeId: z.string().min(1)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  attachChallengeId({
    idempotencyKey: parsed.data.idempotencyKey,
    challengeId: parsed.data.challengeId
  });

  return res.json({ ok: true });
});

// Mobile polls this to find pending challenges (replaces Authsignal's push.getChallenge)
app.get("/api/mobile/pending-challenge", (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) {
    return res.status(400).json({ error: "userId query parameter required" });
  }

  const pending = getPendingChallengeForUser(userId);
  if (!pending) {
    return res.json({ challenge: null });
  }

  return res.json({
    challenge: {
      challengeId: pending.challengeId,
      action: pending.action,
      idempotencyKey: pending.idempotencyKey,
      context: pending.context
    }
  });
});

// Mobile calls this to approve/deny. Server validates number match and updates Authsignal.
app.post("/api/mobile/resolve-challenge", async (req, res) => {
  const schema = z.object({
    idempotencyKey: z.string().min(1),
    approved: z.boolean(),
    verificationCode: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const context = getChallengeContext(parsed.data.idempotencyKey);
  if (!context) {
    return res.status(404).json({ error: "Challenge not found or expired" });
  }

  if (!parsed.data.approved) {
    resolveChallengeByIdempotencyKey(parsed.data.idempotencyKey, "denied");

    try {
      await authsignal.updateAction({
        userId: context.userId,
        action: context.action,
        idempotencyKey: parsed.data.idempotencyKey,
        attributes: { state: UserActionState.CHALLENGE_FAILED }
      });
    } catch {}

    return res.json({ ok: true, status: "denied" });
  }

  // Validate number match (only required for transactions)
  if (context.numberMatch && parsed.data.verificationCode !== context.numberMatch) {
    return res.status(400).json({ error: "Incorrect verification code" });
  }

  try {
    await authsignal.updateAction({
      userId: context.userId,
      action: context.action,
      idempotencyKey: parsed.data.idempotencyKey,
      attributes: { state: UserActionState.CHALLENGE_SUCCEEDED }
    });

    resolveChallengeByIdempotencyKey(parsed.data.idempotencyKey, "approved");
    return res.json({ ok: true, status: "approved" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update challenge" });
  }
});

// Web polls this to check if mobile has approved/denied
app.get("/api/auth/push/status/:idempotencyKey", (req, res) => {
  const status = getChallengeStatus(req.params.idempotencyKey);
  return res.json({ status: status ?? "pending" });
});

app.post("/api/auth/push/validate", async (req, res) => {
  const schema = z.object({
    token: z.string().min(1),
    action: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const validation = await authsignal.validateChallenge({
      token: parsed.data.token,
      action: parsed.data.action
    });

    if (validation.idempotencyKey) {
      consumeChallengeContext(validation.idempotencyKey);
    }

    return res.json(validation);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to validate challenge" });
  }
});

const port = config.PORT;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
