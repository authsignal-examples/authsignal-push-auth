export const ACTIONS = {
  enrollPushCredential: "addAuthenticator",
  signIn: "signIn",
  approveTransaction: "approveTransaction"
} as const;

export type SupportedAction = typeof ACTIONS.signIn | typeof ACTIONS.approveTransaction;

export function isSupportedAction(action: string): action is SupportedAction {
  return action === ACTIONS.signIn || action === ACTIONS.approveTransaction;
}
