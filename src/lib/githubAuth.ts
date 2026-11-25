import { getGitHubConfig } from '@/config/github';
import { db } from './db';

export interface GitHubSession {
  accessToken: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  authMethod: 'oauth' | 'pat';
  scopes: string[];
  verifiedEmails?: string[];
  connectedAt: string;
}

const SESSION_KEY = 'githubSession';
const OAUTH_STATE_STORAGE_KEY = 'mls_oer_github_oauth_state';

function generateOAuthState(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchVerifiedGitHubEmails(token: string): Promise<string[]> {
  try {
    const response = await fetch('https://api.github.com/user/emails', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as Array<{
      email?: unknown;
      verified?: unknown;
    }>;
    if (!Array.isArray(data)) {
      return [];
    }
    const verified = new Set<string>();
    for (const entry of data) {
      if (entry?.verified === true && typeof entry.email === 'string') {
        const normalized = entry.email.trim().toLowerCase();
        if (normalized.includes('@')) {
          verified.add(normalized);
        }
      }
    }
    return Array.from(verified);
  } catch {
    return [];
  }
}

async function fetchGitHubViewer(token: string): Promise<{
  login: string;
  name: string | null;
  avatar_url: string | null;
  scopes: string[];
  verifiedEmails: string[];
}> {
  const [response, verifiedEmails] = await Promise.all([
    fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }),
    fetchVerifiedGitHubEmails(token),
  ]);

  if (!response.ok) {
    let message = `GitHub authentication failed (${response.status}).`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) {
        message = `GitHub authentication failed (${response.status}): ${payload.message}`;
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(message);
  }

  const rawScopes = response.headers?.get?.('x-oauth-scopes') ?? '';
  const scopes = rawScopes
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const data = (await response.json()) as {
    login?: string;
    name?: string | null;
    avatar_url?: string | null;
  };

  if (!data.login) {
    throw new Error('GitHub user response did not include a login username.');
  }

  return {
    login: data.login,
    name: data.name ?? null,
    avatar_url: data.avatar_url ?? null,
    scopes,
    verifiedEmails,
  };
}

export function isEmailAllowed(email: string, allowlist: string[]): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes('@')) return false;

  for (const rawRule of allowlist) {
    const rule = rawRule.trim().toLowerCase();
    if (!rule) continue;
    if (rule.startsWith('@')) {
      if (normalizedEmail.endsWith(rule)) return true;
    } else if (rule.includes('@')) {
      if (normalizedEmail === rule) return true;
    } else if (normalizedEmail.endsWith(`@${rule}`)) {
      return true;
    }
  }
  return false;
}

export function isEducatorContributor(
  session: GitHubSession | null | undefined,
  allowlist: string[] = getGitHubConfig().educatorEmailAllowlist,
): boolean {
  if (!session || !Array.isArray(session.verifiedEmails) || session.verifiedEmails.length === 0) {
    return false;
  }
  return session.verifiedEmails.some((email) => isEmailAllowed(email, allowlist));
}

export async function getGitHubSession(): Promise<GitHubSession | null> {
  const record = await db.appState.get(SESSION_KEY);
  if (!record || typeof record.value !== 'object' || record.value === null) {
    return null;
  }
  const session = record.value as Partial<GitHubSession>;
  if (!session.accessToken || !session.username) {
    return null;
  }
  return {
    accessToken: session.accessToken,
    username: session.username,
    name: session.name ?? null,
    avatarUrl: session.avatarUrl ?? null,
    authMethod: session.authMethod === 'oauth' ? 'oauth' : 'pat',
    scopes: Array.isArray(session.scopes) ? session.scopes : [],
    verifiedEmails: Array.isArray(session.verifiedEmails)
      ? session.verifiedEmails.filter((e): e is string => typeof e === 'string')
      : [],
    connectedAt: session.connectedAt ?? new Date().toISOString(),
  };
}

export async function saveGitHubSession(session: GitHubSession): Promise<void> {
  await db.appState.put({
    key: SESSION_KEY,
    value: session,
  });
}

export async function signOutGitHub(): Promise<void> {
  await db.appState.delete(SESSION_KEY);
}

export async function signInWithPersonalToken(rawToken: string): Promise<GitHubSession> {
  const token = rawToken.trim();
  if (!token) {
    throw new Error('Please paste a GitHub Personal Access Token.');
  }
  const viewer = await fetchGitHubViewer(token);
  const session: GitHubSession = {
    accessToken: token,
    username: viewer.login,
    name: viewer.name,
    avatarUrl: viewer.avatar_url,
    authMethod: 'pat',
    scopes: viewer.scopes,
    verifiedEmails: viewer.verifiedEmails,
    connectedAt: new Date().toISOString(),
  };
  await saveGitHubSession(session);
  return session;
}

export function buildGitHubAuthorizeUrl(): { url: string; state: string; redirectUri: string } {
  const cfg = getGitHubConfig();
  if (!cfg.clientId || !cfg.oauthRelayUrl) {
    throw new Error(
      'GitHub OAuth relay is not configured in this environment. Use a Personal Access Token or deploy the Cloudflare Worker relay.',
    );
  }
  const state = generateOAuthState();
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  try {
    window.sessionStorage.setItem(OAUTH_STATE_STORAGE_KEY, state);
  } catch {
    // ignore storage restriction errors
  }

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: 'gist public_repo user:email',
    state,
  });
  return {
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
    state,
    redirectUri,
  };
}

export function startGitHubOAuthFlow(): void {
  const { url } = buildGitHubAuthorizeUrl();
  window.location.assign(url);
}

export interface OAuthCallbackResult {
  handled: boolean;
  session?: GitHubSession;
  error?: string;
}

let pendingOAuthCallback: { search: string; promise: Promise<OAuthCallbackResult> } | null = null;

export async function completeGitHubOAuthCallback(
  searchString?: string,
): Promise<OAuthCallbackResult> {
  if (typeof window === 'undefined') {
    return { handled: false };
  }

  const rawSearch = searchString ?? window.location.search;
  if (!rawSearch) {
    return { handled: false };
  }

  const params = new URLSearchParams(rawSearch);
  const oauthError = params.get('error')?.trim();
  const oauthErrorDesc = params.get('error_description')?.trim();
  const code = params.get('code')?.trim();
  const state = params.get('state')?.trim();

  if (!code && !oauthError) {
    return { handled: false };
  }

  // Deduplicate concurrent calls (e.g. React StrictMode double-mount) for the same callback query.
  if (pendingOAuthCallback && pendingOAuthCallback.search === rawSearch) {
    return pendingOAuthCallback.promise;
  }

  const run = async (): Promise<OAuthCallbackResult> => {
    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    const clearQueryParams = () => {
      try {
        window.history.replaceState(null, '', cleanUrl || '/');
      } catch {
        // ignore history errors in test runners
      }
    };

    if (oauthError) {
      try {
        window.sessionStorage.removeItem(OAUTH_STATE_STORAGE_KEY);
      } catch {
        // ignore storage errors
      }
      clearQueryParams();
      return {
        handled: true,
        error: oauthErrorDesc || `GitHub sign-in failed (${oauthError}).`,
      };
    }

    if (!code) {
      return { handled: false };
    }

    let expectedState: string | null = null;
    try {
      expectedState = window.sessionStorage.getItem(OAUTH_STATE_STORAGE_KEY);
      window.sessionStorage.removeItem(OAUTH_STATE_STORAGE_KEY);
    } catch {
      expectedState = null;
    }

    if (expectedState && state !== expectedState) {
      clearQueryParams();
      return {
        handled: true,
        error: 'GitHub OAuth state mismatch. Please try signing in again.',
      };
    }

    const cfg = getGitHubConfig();
    if (!cfg.oauthRelayUrl) {
      clearQueryParams();
      return {
        handled: true,
        error: 'OAuth relay URL is not configured; cannot exchange GitHub authorization code.',
      };
    }

    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    try {
      const relayRes = await fetch(`${cfg.oauthRelayUrl}/oauth/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          redirect_uri: redirectUri,
        }),
      });

      const tokenPayload = (await relayRes.json()) as {
        access_token?: string;
        scope?: string;
        error?: string;
        error_description?: string;
      };

      if (!relayRes.ok || !tokenPayload.access_token) {
        clearQueryParams();
        return {
          handled: true,
          error:
            tokenPayload.error_description ||
            tokenPayload.error ||
            `OAuth token exchange failed (${relayRes.status}).`,
        };
      }

      const viewer = await fetchGitHubViewer(tokenPayload.access_token);
      const parsedScopes = tokenPayload.scope
        ? tokenPayload.scope.split(/[,\s]+/).filter(Boolean)
        : viewer.scopes;

      const session: GitHubSession = {
        accessToken: tokenPayload.access_token,
        username: viewer.login,
        name: viewer.name,
        avatarUrl: viewer.avatar_url,
        authMethod: 'oauth',
        scopes: parsedScopes,
        verifiedEmails: viewer.verifiedEmails,
        connectedAt: new Date().toISOString(),
      };
      await saveGitHubSession(session);
      clearQueryParams();
      return { handled: true, session };
    } catch (err) {
      clearQueryParams();
      return {
        handled: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const promise = run();
  pendingOAuthCallback = { search: rawSearch, promise };
  try {
    return await promise;
  } finally {
    if (pendingOAuthCallback?.promise === promise) {
      pendingOAuthCallback = null;
    }
  }
}
