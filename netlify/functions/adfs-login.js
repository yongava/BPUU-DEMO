'use strict';

/**
 * /adfs/login — Netlify Function
 *
 * Starts the OIDC Authorization Code + PKCE flow against ADFS: generates
 * state/nonce/PKCE, stashes them in short-lived cookies (Netlify Functions
 * are stateless — there is no server-side session to hold these), and
 * redirects the browser to the ADFS authorization endpoint.
 */

const {
  escapeHtml,
  serializeCookie,
  generatePkce,
  generateRandomHex,
  loadDiscoveryMetadata,
} = require('./_lib/oidc');

function missingEnvErrorPage(missing) {
  const items = missing.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>ADFS OIDC Sandbox &mdash; Configuration error</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #1f2430;">
  <h1>Missing required environment variable(s)</h1>
  <p>The following Netlify environment variable(s) are not set:</p>
  <ul>${items}</ul>
  <p>Set them in <strong>Site settings &gt; Environment variables</strong> in the Netlify dashboard, then redeploy the site (or trigger a new deploy) for the change to take effect.</p>
</body>
</html>`;
}

function discoveryErrorPage(err) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>ADFS OIDC Sandbox &mdash; Discovery error</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #1f2430;">
  <h1>Could not load ADFS discovery metadata</h1>
  <p>The ADFS discovery endpoint could not be reached or did not return a valid discovery document.</p>
  <p><strong>${escapeHtml(err && err.message ? err.message : String(err))}</strong></p>
  <p>Since this is a Netlify-hosted function (not the local sandbox), it runs from Netlify's cloud infrastructure &mdash;
  confirm the ADFS discovery endpoint is reachable from the public internet, not just from a campus network or VPN.
  A discovery URL that only resolves internally will work from the local sandbox but will always fail here.</p>
</body>
</html>`;
}

exports.handler = async (event) => {
  const discoveryUrl = process.env.ADFS_DISCOVERY_URL;
  const clientId = process.env.ADFS_CLIENT_ID;
  const redirectUri = process.env.ADFS_REDIRECT_URI;
  const scope = process.env.ADFS_SCOPE || 'openid profile email';

  const missing = [];
  if (!discoveryUrl || !String(discoveryUrl).trim()) missing.push('ADFS_DISCOVERY_URL');
  if (!clientId || !String(clientId).trim()) missing.push('ADFS_CLIENT_ID');
  if (!redirectUri || !String(redirectUri).trim()) missing.push('ADFS_REDIRECT_URI');

  if (missing.length > 0) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: missingEnvErrorPage(missing),
    };
  }

  let metadata;
  try {
    metadata = await loadDiscoveryMetadata(discoveryUrl);
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: discoveryErrorPage(err),
    };
  }

  const popup = !!(event.queryStringParameters && event.queryStringParameters.popup === '1');

  const state = generateRandomHex();
  const nonce = generateRandomHex();
  const { codeVerifier, codeChallenge } = generatePkce();

  const cookieOpts = { maxAgeSeconds: 600 }; // 10 minutes — plenty for a login attempt, short enough to limit exposure
  const setCookies = [
    serializeCookie('adfs_state', state, cookieOpts),
    serializeCookie('adfs_nonce', nonce, cookieOpts),
    serializeCookie('adfs_verifier', codeVerifier, cookieOpts),
    serializeCookie('adfs_flow', popup ? 'popup' : 'redirect', cookieOpts),
  ];

  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return {
    statusCode: 302,
    multiValueHeaders: { 'set-cookie': setCookies },
    headers: { Location: authUrl.toString() },
    body: '',
  };
};
