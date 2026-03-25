import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { AppChallenge, AppCredential, Authsignal } from "react-native-authsignal";

type ApiConfig = {
  tenantId: string;
  baseUrl: string;
};

type EnrollmentResponse = {
  token: string;
  state: string;
  isEnrolled: boolean;
};

type ChallengeContext = {
  userId: string;
  action: string;
  context?: {
    merchant?: string;
    amount?: string;
    currency?: string;
    note?: string;
  };
};

type PendingChallengeResponse = {
  challenge: {
    challengeId: string;
    action: string;
    idempotencyKey: string;
    context?: ChallengeContext["context"];
  } | null;
};

type ResolveResponse = { ok: boolean; status: string; error?: string };

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

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

function actionLabel(action: string) {
  switch (action) {
    case "signIn":
      return "Sign-In Approval";
    case "approveTransaction":
      return "Transaction Approval";
    default:
      return action;
  }
}

// ----- Approval Overlay -----
function ApprovalScreen({
  challenge,
  challengeContext,
  onResolve,
  loading
}: {
  challenge: AppChallenge;
  challengeContext: ChallengeContext;
  onResolve: (approved: boolean, code?: string) => void;
  loading: boolean;
}) {
  const [code, setCode] = useState("");
  const isTransaction = challenge.actionCode === "approveTransaction";
  const ctx = challengeContext.context;

  return (
    <SafeAreaView style={a.root}>
      <StatusBar style="light" />
      <View style={a.container}>
        {/* Header */}
        <View style={a.header}>
          <View style={a.iconCircle}>
            <Text style={a.iconText}>{isTransaction ? "$" : "ID"}</Text>
          </View>
          <Text style={a.title}>{actionLabel(challenge.actionCode ?? "")}</Text>
          <Text style={a.subtitle}>
            {isTransaction
              ? "A transaction requires your approval"
              : "A sign-in attempt requires your approval"}
          </Text>
        </View>

        {/* Transaction Details Card */}
        {isTransaction && ctx ? (
          <View style={a.detailsCard}>
            <View style={a.detailRow}>
              <Text style={a.detailLabel}>Merchant</Text>
              <Text style={a.detailValue}>{ctx.merchant ?? "-"}</Text>
            </View>
            <View style={a.divider} />
            <View style={a.detailRow}>
              <Text style={a.detailLabel}>Amount</Text>
              <Text style={a.amountValue}>
                {ctx.amount ?? "0.00"} {ctx.currency ?? ""}
              </Text>
            </View>
            {ctx.note ? (
              <>
                <View style={a.divider} />
                <View style={a.detailRow}>
                  <Text style={a.detailLabel}>Note</Text>
                  <Text style={a.detailValue}>{ctx.note}</Text>
                </View>
              </>
            ) : null}
          </View>
        ) : (
          <View style={a.detailsCard}>
            <View style={a.detailRow}>
              <Text style={a.detailLabel}>Action</Text>
              <Text style={a.detailValue}>Sign in to web app</Text>
            </View>
            {ctx?.note ? (
              <>
                <View style={a.divider} />
                <View style={a.detailRow}>
                  <Text style={a.detailLabel}>Note</Text>
                  <Text style={a.detailValue}>{ctx.note}</Text>
                </View>
              </>
            ) : null}
          </View>
        )}

        {/* Number Match Input (transactions only) */}
        {isTransaction ? (
          <View style={a.matchSection}>
            <Text style={a.matchTitle}>Enter the code shown on your screen</Text>
            <TextInput
              style={a.codeInput}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              placeholder="- - -"
              placeholderTextColor="#64748b"
              maxLength={3}
              textAlign="center"
              autoFocus
            />
          </View>
        ) : null}

        {/* Action Buttons */}
        <View style={a.actions}>
          {loading ? (
            <ActivityIndicator color="#ffffff" size="large" />
          ) : (
            <>
              <Pressable
                style={[a.approveBtn, isTransaction && !code.trim() && a.btnDisabled]}
                disabled={(isTransaction && !code.trim()) || loading}
                onPress={() => onResolve(true, isTransaction ? code.trim() : undefined)}
              >
                <Text style={a.approveBtnText}>Approve</Text>
              </Pressable>
              <Pressable
                style={a.denyBtn}
                disabled={loading}
                onPress={() => onResolve(false)}
              >
                <Text style={a.denyBtnText}>Deny</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const a = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f172a"
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "space-between"
  },
  header: {
    alignItems: "center",
    gap: 10,
    paddingTop: 20
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#1e3a5f",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4
  },
  iconText: {
    color: "#38bdf8",
    fontSize: 22,
    fontWeight: "800"
  },
  title: {
    color: "#f8fafc",
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center"
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 15,
    textAlign: "center"
  },
  detailsCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 20,
    gap: 0
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12
  },
  detailLabel: {
    color: "#94a3b8",
    fontSize: 14
  },
  detailValue: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "right",
    flexShrink: 1,
    marginLeft: 16
  },
  amountValue: {
    color: "#fbbf24",
    fontSize: 20,
    fontWeight: "700"
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#334155"
  },
  matchSection: {
    alignItems: "center",
    gap: 14
  },
  matchTitle: {
    color: "#94a3b8",
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 1
  },
  codeInput: {
    backgroundColor: "#1e293b",
    borderWidth: 2,
    borderColor: "#334155",
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 40,
    fontSize: 36,
    fontWeight: "700",
    color: "#f8fafc",
    letterSpacing: 16,
    minWidth: 200
  },
  actions: {
    gap: 12,
    paddingBottom: 10
  },
  approveBtn: {
    backgroundColor: "#16a34a",
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center"
  },
  btnDisabled: {
    opacity: 0.4
  },
  approveBtnText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700"
  },
  denyBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#475569",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center"
  },
  denyBtnText: {
    color: "#ef4444",
    fontSize: 16,
    fontWeight: "600"
  }
});

// ----- Main App -----
export default function App() {
  const authsignalRef = useRef<Authsignal | null>(null);

  const [userId, setUserId] = useState("user_demo_01");
  const [status, setStatus] = useState("Idle");
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [credential, setCredential] = useState<AppCredential | undefined>();
  const [challenge, setChallenge] = useState<AppChallenge | undefined>();
  const [challengeContext, setChallengeContext] = useState<ChallengeContext | undefined>();

  const ensureAuthsignal = async () => {
    if (authsignalRef.current) {
      return authsignalRef.current;
    }

    const config = await apiRequest<ApiConfig>("/api/config");
    const client = new Authsignal({
      tenantID: config.tenantId,
      baseURL: config.baseUrl,
      enableLogging: true
    });

    authsignalRef.current = client;
    return client;
  };

  const refreshCredential = async () => {
    setLoading(true);
    setStatus("Loading credential...");

    try {
      const authsignal = await ensureAuthsignal();
      const response = await authsignal.push.getCredential();

      if (response.error) {
        throw new Error(response.error);
      }

      setCredential(response.data);
      setStatus(response.data ? "Device enrolled." : "Not enrolled yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to read credential.");
    } finally {
      setLoading(false);
    }
  };

  const enrollDevice = async () => {
    setLoading(true);
    setStatus("Enrolling device...");

    try {
      const authsignal = await ensureAuthsignal();
      const enrollment = await apiRequest<EnrollmentResponse>("/api/auth/enroll/start", {
        method: "POST",
        body: JSON.stringify({ userId })
      });

      await authsignal.setToken(enrollment.token);
      const response = await authsignal.push.addCredential({
        token: enrollment.token,
        requireUserAuthentication: false
      });

      if (response.error || !response.data) {
        throw new Error(response.error ?? "No credential returned.");
      }

      setCredential(response.data);
      setStatus("Device enrolled. Listening for challenges...");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Enrollment failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (approved: boolean, code?: string) => {
    if (!challenge?.idempotencyKey) return;

    setLoading(true);

    try {
      const response = await apiRequest<ResolveResponse>("/api/mobile/resolve-challenge", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: challenge.idempotencyKey,
          approved,
          verificationCode: approved ? code : undefined
        })
      });

      if (!response.ok) {
        throw new Error(response.error ?? "Challenge update failed.");
      }

      setStatus(approved ? "Challenge approved." : "Challenge denied.");
      setChallenge(undefined);
      setChallengeContext(undefined);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update challenge.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-poll for pending challenges every 3 seconds when enrolled and no active challenge
  useEffect(() => {
    if (!polling || !credential || challenge) return;

    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const pending = await apiRequest<PendingChallengeResponse>(
            `/api/mobile/pending-challenge?userId=${encodeURIComponent(userId)}`
          );

          if (cancelled) break;

          if (pending.challenge) {
            setChallenge({
              challengeId: pending.challenge.challengeId,
              actionCode: pending.challenge.action,
              idempotencyKey: pending.challenge.idempotencyKey
            } as AppChallenge);
            setChallengeContext({
              userId,
              action: pending.challenge.action,
              context: pending.challenge.context
            });
            setStatus("Incoming challenge!");
            break;
          }
        } catch {}

        await new Promise((r) => setTimeout(r, 3000));
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [polling, credential, challenge, userId]);

  // Pause polling when app goes to background, resume when foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setPolling(state === "active");
    });
    setPolling(AppState.currentState === "active");
    return () => sub.remove();
  }, []);

  // Show the full-screen approval overlay when a challenge is active
  if (challenge && challengeContext) {
    return (
      <ApprovalScreen
        challenge={challenge}
        challengeContext={challengeContext}
        onResolve={handleResolve}
        loading={loading}
      />
    );
  }

  return (
    <SafeAreaView style={s.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={s.container}>
        <View style={s.heroSection}>
          <Text style={s.eyebrow}>Authsignal Push</Text>
          <Text style={s.title}>Mobile Approver</Text>
          <Text style={s.subtitle}>
            Enroll your device, then approve login and transaction requests from the web.
          </Text>
        </View>

        {/* Setup Card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Device Setup</Text>
          <Text style={s.label}>User ID</Text>
          <TextInput
            style={s.input}
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="none"
            placeholder="Enter your user ID"
            placeholderTextColor="#94a3b8"
          />

          <View style={s.buttonRow}>
            <Pressable
              style={[s.primaryBtn, loading && s.btnDisabled]}
              disabled={loading}
              onPress={enrollDevice}
            >
              <Text style={s.primaryBtnText}>Enroll Device</Text>
            </Pressable>
            <Pressable
              style={[s.secondaryBtn, loading && s.btnDisabled]}
              disabled={loading}
              onPress={refreshCredential}
            >
              <Text style={s.secondaryBtnText}>Check Status</Text>
            </Pressable>
          </View>
        </View>

        {/* Status Card */}
        <View style={s.statusCard}>
          <View style={s.statusRow}>
            <View
              style={[s.statusDot, credential ? s.statusDotActive : s.statusDotInactive]}
            />
            <Text style={s.statusLabel}>
              {credential ? "Enrolled & Listening" : "Not Enrolled"}
            </Text>
          </View>

          {loading ? <ActivityIndicator color="#38bdf8" style={{ marginTop: 8 }} /> : null}

          <Text style={s.statusMessage}>{status}</Text>

          {credential ? (
            <Text style={s.credentialId}>
              Credential: {credential.credentialId.slice(0, 16)}...
            </Text>
          ) : null}

          {polling && credential && !challenge ? (
            <View style={s.listeningRow}>
              <View style={s.pulsingDot} />
              <Text style={s.listeningText}>Listening for challenges...</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f8fafc"
  },
  container: {
    padding: 20,
    gap: 16
  },
  heroSection: {
    gap: 6,
    paddingBottom: 4
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 2,
    color: "#0d9488",
    textTransform: "uppercase",
    fontWeight: "600"
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "#0f172a"
  },
  subtitle: {
    color: "#64748b",
    fontSize: 15,
    lineHeight: 22
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 18,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a"
  },
  label: {
    fontSize: 12,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "500"
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    fontSize: 15
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: "#0f172a",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center"
  },
  primaryBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0"
  },
  secondaryBtnText: {
    color: "#334155",
    fontWeight: "600",
    fontSize: 15
  },
  btnDisabled: {
    opacity: 0.5
  },
  statusCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 18,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  statusDotActive: {
    backgroundColor: "#22c55e"
  },
  statusDotInactive: {
    backgroundColor: "#cbd5e1"
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a"
  },
  statusMessage: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20
  },
  credentialId: {
    color: "#94a3b8",
    fontSize: 12,
    fontFamily: "Courier"
  },
  listeningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 4
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0d9488"
  },
  listeningText: {
    color: "#0d9488",
    fontSize: 13,
    fontWeight: "600"
  }
});
