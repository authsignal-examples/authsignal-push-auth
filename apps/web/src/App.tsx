import { Authsignal } from "@authsignal/browser";
import { useRef, useState } from "react";
import "./App.css";

type PushAction = "signIn" | "approveTransaction";

type ApiConfig = {
  tenantId: string;
  baseUrl: string;
  apiBaseUrl: string;
};

type PushStartResponse = {
  token: string;
  idempotencyKey: string;
  numberMatch: string;
  state: string;
  isEnrolled: boolean;
};

type ChallengeStatus = "idle" | "sending" | "waiting" | "approved" | "denied" | "error" | "timeout";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    ...(init?.body ? { headers: { "Content-Type": "application/json", ...init?.headers } } : {})
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export default function App() {
  const authsignalRef = useRef<Authsignal | null>(null);

  const [userId, setUserId] = useState("user_demo_01");
  const [email, setEmail] = useState("demo@example.com");
  const [displayName, setDisplayName] = useState("Demo User");
  const [merchant, setMerchant] = useState("Modular");
  const [amount, setAmount] = useState("250.00");
  const [currency, setCurrency] = useState("EUR");
  const [note, setNote] = useState("Payroll transfer");
  const [numberMatch, setNumberMatch] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<ChallengeStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready to send push requests.");
  const [loading, setLoading] = useState(false);

  const ensureAuthsignal = async () => {
    if (authsignalRef.current) {
      return authsignalRef.current;
    }

    const config = await apiRequest<ApiConfig>("/api/config");
    authsignalRef.current = new Authsignal({
      tenantId: config.tenantId,
      baseUrl: config.baseUrl
    });

    return authsignalRef.current;
  };

  const upsertUser = async () => {
    setLoading(true);
    setStatusMessage("Saving user profile...");

    try {
      await apiRequest<{ ok: boolean }>("/api/users/upsert", {
        method: "POST",
        body: JSON.stringify({
          userId,
          email,
          displayName,
          username: userId
        })
      });

      setStatusMessage("User profile saved. The mobile app can now enroll this user.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save user profile.");
    } finally {
      setLoading(false);
    }
  };

  const runPushFlow = async (action: PushAction) => {
    setLoading(true);
    setNumberMatch(null);
    setChallengeStatus("sending");
    setStatusMessage("Preparing push request...");

    try {
      const context =
        action === "approveTransaction"
          ? { merchant, amount, currency, note }
          : { note: "Web sign-in confirmation" };

      const startResponse = await apiRequest<PushStartResponse>("/api/auth/push/start", {
        method: "POST",
        body: JSON.stringify({ userId, action, context })
      });

      if (!startResponse.isEnrolled) {
        setChallengeStatus("error");
        setStatusMessage("User is not enrolled for push. Open the mobile app and tap Enroll Device first.");
        return;
      }

      setNumberMatch(startResponse.numberMatch);

      const authsignal = await ensureAuthsignal();
      authsignal.setToken(startResponse.token);

      setStatusMessage("Creating challenge...");
      const challengeResponse = await authsignal.push.challenge({ action });

      if (!challengeResponse.data?.challengeId) {
        throw new Error(challengeResponse.errorDescription ?? "Unable to create challenge.");
      }

      await apiRequest("/api/auth/push/challenge-created", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: startResponse.idempotencyKey,
          challengeId: challengeResponse.data.challengeId
        })
      });

      setChallengeStatus("waiting");
      setStatusMessage("Waiting for approval on mobile device...");

      for (let attempt = 0; attempt < 90; attempt += 1) {
        const statusResponse = await apiRequest<{ status: string }>(
          `/api/auth/push/status/${encodeURIComponent(startResponse.idempotencyKey)}`
        );

        if (statusResponse.status === "approved") {
          setChallengeStatus("approved");
          setStatusMessage("Challenge approved. User identity verified.");
          return;
        }

        if (statusResponse.status === "denied") {
          setChallengeStatus("denied");
          setStatusMessage("Challenge was denied on the mobile device.");
          return;
        }

        await sleep(2000);
      }

      setChallengeStatus("timeout");
      setStatusMessage("Timed out waiting for mobile response.");
    } catch (error) {
      setChallengeStatus("error");
      setStatusMessage(error instanceof Error ? error.message : "Push flow failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Authsignal Push Authentication</p>
        <h1>Push Auth Demo</h1>
        <p className="subtitle">
          Send push approval requests to a mobile device with number matching — for login
          verification and FCA-compliant transaction authorization.
        </p>
      </header>

      <section className="panel">
        <h2>User Setup</h2>
        <p className="hint">
          Create the user in Authsignal first. Then enroll the device on the mobile app.
        </p>
        <div className="grid two">
          <label>
            User ID
            <input value={userId} onChange={(e) => setUserId(e.target.value)} />
          </label>
          <label>
            Display Name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
        <button disabled={loading} onClick={upsertUser}>
          Save User Profile
        </button>
      </section>

      <div className="push-grid">
        <section className="panel push-card">
          <div className="push-card-icon sign-in-icon">ID</div>
          <h2>Sign-In Push</h2>
          <p className="hint">Simple approve/deny — no code required. Low friction login.</p>
          <button disabled={loading} onClick={() => runPushFlow("signIn")}>
            Send Sign-In Push
          </button>
        </section>

        <section className="panel push-card">
          <div className="push-card-icon txn-icon">$</div>
          <h2>Transaction Approval</h2>
          <p className="hint">Number matching + transaction context for SCA compliance.</p>
          <div className="grid two">
            <label>
              Merchant
              <input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </label>
            <label>
              Amount
              <input value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label>
              Currency
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </label>
            <label>
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <button disabled={loading} onClick={() => runPushFlow("approveTransaction")}>
            Send Transaction Push
          </button>
        </section>
      </div>

      {/* Live Status */}
      <section className={`challenge-status status-${challengeStatus}`}>
        {numberMatch ? (
          <div className="number-match-display">
            <span className="number-match-label">Show this code on mobile</span>
            <span className="number-match-code">{numberMatch}</span>
          </div>
        ) : null}

        <div className="status-content">
          <div className="status-indicator">
            {challengeStatus === "waiting" || challengeStatus === "sending" ? (
              <div className="pulse-ring" />
            ) : null}
            <div className={`status-dot dot-${challengeStatus}`} />
          </div>
          <div className="status-text">
            <p className="status-heading">
              {challengeStatus === "idle" && "Ready"}
              {challengeStatus === "sending" && "Sending..."}
              {challengeStatus === "waiting" && "Awaiting Approval"}
              {challengeStatus === "approved" && "Approved"}
              {challengeStatus === "denied" && "Denied"}
              {challengeStatus === "error" && "Error"}
              {challengeStatus === "timeout" && "Timed Out"}
            </p>
            <p className="status-message">{statusMessage}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
