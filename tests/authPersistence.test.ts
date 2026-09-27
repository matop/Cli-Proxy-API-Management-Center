import { describe, expect, test } from 'bun:test';
import { partializeAuthState, sanitizePersistedAuthState } from '../src/stores/authPersistence';

describe('auth persistence', () => {
  test('drops credentials from previously persisted auth state while keeping server settings', () => {
    const oldState = {
      state: {
        apiBase: 'https://proxy.example',
        managementKey: 'legacy-secret',
        rememberPassword: true,
        serverVersion: '1.2.3',
        serverBuildDate: 'today',
        unrelatedSetting: 'kept',
      },
      version: 0,
    };

    expect(sanitizePersistedAuthState(oldState)).toEqual({
      state: {
        apiBase: 'https://proxy.example',
        serverVersion: '1.2.3',
        serverBuildDate: 'today',
        unrelatedSetting: 'kept',
      },
      version: 0,
    });
  });

  test('writes no management key or login flag to persisted state', () => {
    const persisted = partializeAuthState({
      isAuthenticated: true,
      apiBase: 'https://proxy.example',
      managementKey: 'session-secret',
      serverVersion: '1.2.3',
      serverBuildDate: null,
      supportsPlugin: true,
    });

    expect(persisted).toEqual({
      apiBase: 'https://proxy.example',
      serverVersion: '1.2.3',
      serverBuildDate: null,
    });
    expect(JSON.stringify(persisted)).not.toContain('session-secret');
  });
});
