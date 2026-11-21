export interface GitHubConfig {
  repo: `${string}/${string}`;
  clientId: string | null;
  oauthRelayUrl: string | null;
  giscusRepoId: string | null;
  giscusCategory: string;
  giscusCategoryId: string | null;
  isOAuthConfigured: boolean;
  isGiscusConfigured: boolean;
}

function cleanEnv(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

  return {
    repo,
    clientId,
    oauthRelayUrl,
    giscusRepoId,
    giscusCategory,
    giscusCategoryId,
    isOAuthConfigured: Boolean(clientId && oauthRelayUrl),
    isGiscusConfigured: Boolean(giscusRepoId && giscusCategoryId),
  };
}

export function getRepoOwnerAndName(repo: string): { owner: string; name: string } {
  const [owner = 'mls-oer-question-bank', name = 'mls-oer-question-bank'] = repo.split('/');
  return { owner, name };
}
