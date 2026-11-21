export function getDataBaseUrl(): string {
  const configured = import.meta.env.VITE_DATA_BASE_URL as string | undefined;
  if (configured && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }
  return import.meta.env.DEV ? 'http://localhost:8000' : './data';
}

export function getOAuthRelayUrl(): string | null {
  const configured = import.meta.env.VITE_OAUTH_RELAY_URL as string | undefined;
  if (configured && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }
  return null;
}

export function getAssetUrl(relativePath: string): string {
  const base = getDataBaseUrl();
  const cleanRel = relativePath.replace(/^\/+/, '');
  return `${base}/${cleanRel}`;
}
