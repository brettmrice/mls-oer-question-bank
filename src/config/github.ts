export interface GitHubConfig {
  repo: `${string}/${string}`;
  clientId: string | null;
  oauthRelayUrl: string | null;
  giscusRepoId: string | null;
  giscusCategory: string;
  giscusCategoryId: string | null;
  educatorEmailAllowlist: string[];
  isOAuthConfigured: boolean;
  isGiscusConfigured: boolean;
}

const DEFAULT_EDUCATOR_ALLOWLIST = ['brrice@augusta.edu'];

function cleanEnv(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseEducatorEmailAllowlist(raw: unknown): string[] {
  const cleaned = cleanEnv(raw);
  if (!cleaned) return [...DEFAULT_EDUCATOR_ALLOWLIST];
  const entries = cleaned
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  return entries.length > 0 ? entries : [...DEFAULT_EDUCATOR_ALLOWLIST];
}

export function getGitHubConfig(): GitHubConfig {
  const rawRepo = cleanEnv(import.meta.env.VITE_GITHUB_REPO) ?? 'mls-oer-question-bank/mls-oer-question-bank';
  const repo = (rawRepo.includes('/') ? rawRepo : 'mls-oer-question-bank/mls-oer-question-bank') as `${string}/${string}`;
  const clientId = cleanEnv(import.meta.env.VITE_GITHUB_CLIENT_ID);
  const rawRelay = cleanEnv(import.meta.env.VITE_OAUTH_RELAY_URL);
  const oauthRelayUrl = rawRelay ? rawRelay.replace(/\/+$/, '') : null;
  const giscusRepoId = cleanEnv(import.meta.env.VITE_GISCUS_REPO_ID);
  const giscusCategory = cleanEnv(import.meta.env.VITE_GISCUS_CATEGORY) ?? 'Question Discussions';
  const giscusCategoryId = cleanEnv(import.meta.env.VITE_GISCUS_CATEGORY_ID);
  const educatorEmailAllowlist = parseEducatorEmailAllowlist(import.meta.env.VITE_EDUCATOR_EMAIL_ALLOWLIST);

  return {
    repo,
    clientId,
    oauthRelayUrl,
    giscusRepoId,
    giscusCategory,
    giscusCategoryId,
    educatorEmailAllowlist,
    isOAuthConfigured: Boolean(clientId && oauthRelayUrl),
    isGiscusConfigured: Boolean(giscusRepoId && giscusCategoryId),
  };
}

export function getRepoOwnerAndName(repo: string): { owner: string; name: string } {
  const [owner = 'mls-oer-question-bank', name = 'mls-oer-question-bank'] = repo.split('/');
  return { owner, name };
}
