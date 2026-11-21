# MLS OER GitHub OAuth Token Relay (Stateless Cloudflare Worker)

GitHub's OAuth Web Application Flow requires exchanging the short-lived `code` parameter for an `access_token` using the OAuth App's `client_secret`, which cannot be embedded in a static SPA.

This stateless Cloudflare Worker runs at **$0/month on Cloudflare's free tier**, stores **zero user data**, and only forwards `POST /oauth/exchange` to `https://github.com/login/oauth/access_token`.

## Setup

1. Create a GitHub OAuth App (`Settings -> Developer settings -> OAuth Apps`):
   - **Homepage URL:** your GitHub Pages SPA URL
   - **Authorization callback URL:** your GitHub Pages SPA URL
2. Set Worker secrets:
   ```bash
   cd workers/github-oauth-relay
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```
3. Update `ALLOWED_ORIGINS` in `wrangler.toml` with your GitHub Pages URL.
4. Deploy:
   ```bash
   npx wrangler deploy
   ```
5. Set `VITE_GITHUB_CLIENT_ID` and `VITE_OAUTH_RELAY_URL` in your SPA GitHub Actions variables or `.env`.
