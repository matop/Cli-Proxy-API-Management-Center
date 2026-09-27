import type { AuthState } from '@/types';

export function sanitizePersistedAuthState<T extends Record<string, unknown>>(persisted: T): T {
  const state = persisted.state;
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return persisted;
  const safeState = { ...(state as Record<string, unknown>) };
  delete safeState.managementKey;
  delete safeState.rememberPassword;
  return { ...persisted, state: safeState };
}

export function partializeAuthState(state: AuthState): Pick<AuthState, 'apiBase' | 'serverVersion' | 'serverBuildDate'> {
  return {
    apiBase: state.apiBase,
    serverVersion: state.serverVersion,
    serverBuildDate: state.serverBuildDate,
  };
}
