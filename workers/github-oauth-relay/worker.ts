export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_ORIGINS?: string;
}

interface ExchangeRequestBody {
  code?: unknown;
  redirect_uri?: unknown;
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter((item) => item.length > 0);
}

function resolveCorsHeaders(request: Request, env: Env): Record<string, string> | null {
  const origin = request.headers.get('Origin')?.replace(/\/+$/, '') ?? '';
  const allowList = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const allowed =
    allowList.length === 0 ||
    allowList.includes('*') ||
    (origin.length > 0 && allowList.includes(origin));

  if (!allowed) {
    return null;
  }

  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(
  payload: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = resolveCorsHeaders(request, env);
    if (!corsHeaders) {
      return new Response(JSON.stringify({ error: 'origin_not_allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'mls-oer-github-oauth-relay' }, 200, corsHeaders);
    }

    if (request.method !== 'POST' || url.pathname !== '/oauth/exchange') {
      return jsonResponse({ error: 'not_found' }, 404, corsHeaders);
    }

    let body: ExchangeRequestBody;
    try {
      body = (await request.json()) as ExchangeRequestBody;
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400, corsHeaders);
    }

    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri.trim() : undefined;
    if (!code) {
      return jsonResponse({ error: 'missing_code' }, 400, corsHeaders);
    }

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return jsonResponse({ error: 'relay_misconfigured' }, 500, corsHeaders);
    }

    const githubPayload: Record<string, string> = {
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    };
    if (redirectUri) {
      githubPayload.redirect_uri = redirectUri;
    }

    const upstream = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(githubPayload),
    });

    const data = await upstream.json();
    return jsonResponse(data, upstream.status, corsHeaders);
  },
};
