'use strict';

/**
 * /adfs/callback — Netlify Function
 *
 * Handles the redirect back from ADFS: validates state, exchanges the
 * authorization code for tokens, verifies the ID token, and reports the
 * result back to the test console (popup postMessage bridge, or a
 * redirect-with-fragment fallback for the non-popup flow).
 */

const {
  escapeHtml,
  parseCookies,
  serializeCookie,
  buildSteps,
  loadDiscoveryMetadata,
  verifyIdToken,
  OidcError,
  popupBridgeHtml,
  encodeResultForFragment,
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

// Classify an OidcError thrown by verifyIdToken into a human-friendly
// title/message/hints, mirroring the local sandbox's classifyJwtVerifyError.
function classifyOidcError(err, metadata, clientId) {
  switch (err.code) {
    case 'expired':
      return {
        title: 'ID token expired',
        message: 'The ID token failed validation because it is expired.',
        hints: [
          'If the token appears to have just been issued, check for clock skew between Netlify and ADFS.',
          'ADFS and the client should both be synced to a reliable time source (NTP).',
        ],
      };
    case 'issuer_mismatch':
      return {
        title: 'Issuer mismatch',
        message: `The ID token's issuer did not match the expected ADFS issuer (${metadata ? metadata.issuer : 'unknown'}).`,
        hints: [
          'Confirm ADFS_DISCOVERY_URL points at the correct ADFS farm.',
          'Confirm the Relying Party Trust identifier matches what ADFS is issuing.',
        ],
      };
    case 'audience_mismatch':
      return {
        title: 'Audience mismatch',
        message: 'The ID token\'s audience did not match the expected client ID.',
        hints: ['Confirm ADFS_CLIENT_ID matches the client/relying party identifier configured in ADFS.'],
      };
    case 'nonce_mismatch':
      return {
        title: 'Nonce mismatch',
        message: 'The nonce inside the ID token does not match the nonce this app generated.',
        hints: ['This can indicate a replayed or substituted token. Try logging in again.'],
      };
    case 'signature_invalid':
      return {
        title: 'Signature validation failed',
        message: 'The ID token signature could not be verified against the ADFS signing keys.',
        hints: [
          'The JWKS endpoint may be unreachable, or the signing key may have rotated since discovery metadata was fetched (this function fetches fresh JWKS on every call, so a rotation should already be reflected — retry once to be sure).',
          'Confirm the token was actually issued by the ADFS instance configured in ADFS_DISCOVERY_URL.',
        ],
      };
    case 'no_matching_key':
      return {
        title: 'No matching signing key',
        message: 'No key in the ADFS JWKS matched the ID token\'s key ID (kid).',
        hints: [
          'ADFS may have rotated its token-signing certificate. Try logging in again.',
          'Confirm jwks_uri in the discovery document is reachable from the public internet.',
        ],
      };
    case 'malformed_token':
    case 'unsupported_alg':
      return {
        title: 'ID token could not be trusted',
        message: err.message || 'The ID token could not be validated.',
        hints: ['This ID token is not in a form this app will trust. Try logging in again.'],
      };
    case 'jwks_unreachable':
      return {
        title: 'Could not reach ADFS JWKS endpoint',
        message: err.message || 'The ADFS JWKS endpoint could not be reached.',
        hints: ['Confirm the jwks_uri from discovery metadata is reachable from the public internet (Netlify Functions run in the cloud, not on a campus network/VPN).'],
      };
    default:
      return {
        title: 'ID token validation failed',
        message: err.message || 'The ID token could not be validated.',
        hints: [],
      };
  }
}

exports.handler = async (event) => {
  const discoveryUrl = process.env.ADFS_DISCOVERY_URL;
  const clientId = process.env.ADFS_CLIENT_ID;
  const redirectUri = process.env.ADFS_REDIRECT_URI;
  const clientSecret = process.env.ADFS_CLIENT_SECRET;

  // Attached to every response this function returns, regardless of branch
  // (including the missing-env-var branch below), so transient auth-attempt
  // cookies never outlive one attempt.
  const clearCookieOpts = { maxAgeSeconds: 0 };
  const clearingCookies = [
    serializeCookie('adfs_state', '', clearCookieOpts),
    serializeCookie('adfs_nonce', '', clearCookieOpts),
    serializeCookie('adfs_verifier', '', clearCookieOpts),
    serializeCookie('adfs_flow', '', clearCookieOpts),
  ];

  const missing = [];
  if (!discoveryUrl || !String(discoveryUrl).trim()) missing.push('ADFS_DISCOVERY_URL');
  if (!clientId || !String(clientId).trim()) missing.push('ADFS_CLIENT_ID');
  if (!redirectUri || !String(redirectUri).trim()) missing.push('ADFS_REDIRECT_URI');
  if (!clientSecret || !String(clientSecret).trim()) missing.push('ADFS_CLIENT_SECRET');

  if (missing.length > 0) {
    return {
      statusCode: 500,
      multiValueHeaders: { 'set-cookie': clearingCookies },
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: missingEnvErrorPage(missing),
    };
  }

  const cookies = parseCookies(event.headers && event.headers.cookie);
  // Captured up front (mirrors the local sandbox's fix of reading
  // req.session.oidc_flow into a local var before any further branching) so
  // every branch below — success or failure — knows how this flow was
  // started.
  const flow = cookies.adfs_flow;

  function sendFlowResult(result) {
    if (flow === 'popup') {
      return {
        statusCode: 200,
        multiValueHeaders: { 'set-cookie': clearingCookies },
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: popupBridgeHtml(result),
      };
    }
    // Fallback path: undefined/'redirect'/anything else. Mirrors the local
    // sandbox's explicit `popup === '1' ? 'popup' : 'redirect'` fix so a
    // missing cookie never silently misroutes.
    return {
      statusCode: 302,
      multiValueHeaders: { 'set-cookie': clearingCookies },
      headers: { Location: `/adfs#result=${encodeResultForFragment(result)}` },
      body: '',
    };
  }

  const query = event.queryStringParameters || {};

  if (query.error) {
    const errorCode = String(query.error);
    const errorDescription = query.error_description ? String(query.error_description) : '';
    const result = {
      ok: false,
      steps: buildSteps(3),
      title: 'ADFS returned an error',
      message: `ADFS returned "${errorCode}"${errorDescription ? ': ' + errorDescription : ''}`,
      hints: [
        'The user may have cancelled or failed authentication at ADFS.',
        'The requested scope may not be permitted for this client.',
        'The Relying Party Trust may be disabled or misconfigured.',
      ],
    };
    return sendFlowResult(result);
  }

  if (!query.state || query.state !== cookies.adfs_state) {
    const result = {
      ok: false,
      steps: buildSteps(4),
      title: 'State mismatch',
      message: 'The state returned by ADFS does not match the state stored for this login attempt.',
      hints: [
        'This can indicate a CSRF attempt, or a stale/expired login attempt (the state cookie expires after 10 minutes).',
        'Try running the test again from the home page.',
      ],
    };
    return sendFlowResult(result);
  }

  if (!query.code) {
    const result = {
      ok: false,
      steps: buildSteps(4),
      title: 'Missing authorization code',
      message: 'ADFS did not return an authorization code in the callback.',
      hints: ['Check that the client is configured to use the authorization code grant.'],
    };
    return sendFlowResult(result);
  }

  let metadata;
  try {
    metadata = await loadDiscoveryMetadata(discoveryUrl);
  } catch (err) {
    const result = {
      ok: false,
      steps: buildSteps(5),
      title: 'Could not load ADFS discovery metadata',
      message: err.message || 'The ADFS discovery endpoint could not be reached.',
      hints: ['Confirm the ADFS discovery endpoint is reachable from the public internet (Netlify Functions run in the cloud, not on a campus network/VPN).'],
    };
    return sendFlowResult(result);
  }

  const codeVerifier = cookies.adfs_verifier || '';
  const nonce = cookies.adfs_nonce;

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(query.code),
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });

  let tokenResponse;
  try {
    tokenResponse = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });
  } catch (err) {
    const result = {
      ok: false,
      steps: buildSteps(5),
      title: 'Could not reach token endpoint',
      message: 'The request to the ADFS token endpoint failed.',
      hints: [
        'Confirm the token_endpoint from discovery metadata is reachable from the public internet (Netlify Functions run in the cloud, not on a campus network/VPN).',
      ],
    };
    return sendFlowResult(result);
  }

  let tokenBody;
  try {
    tokenBody = await tokenResponse.json();
  } catch (err) {
    const result = {
      ok: false,
      steps: buildSteps(5),
      title: 'Invalid token response',
      message: 'The ADFS token endpoint did not return valid JSON.',
      hints: [],
    };
    return sendFlowResult(result);
  }

  if (!tokenResponse.ok || tokenBody.error) {
    const errorCode = tokenBody.error || `HTTP ${tokenResponse.status}`;
    const errorDescription = tokenBody.error_description || '';
    const result = {
      ok: false,
      steps: buildSteps(5),
      title: 'Token exchange failed',
      message: `ADFS returned "${errorCode}"${errorDescription ? ': ' + errorDescription : ''}`,
      hints: [
        'invalid_client usually means the client ID or client secret is wrong.',
        'invalid_grant can mean the authorization code was already used, expired, or the PKCE verifier did not match.',
        'Confirm ADFS_REDIRECT_URI exactly matches the redirect URI registered on the Relying Party Trust.',
      ],
    };
    return sendFlowResult(result);
  }

  if (!tokenBody.id_token) {
    const result = {
      ok: false,
      steps: buildSteps(6),
      title: 'No ID token returned',
      message: 'The token response did not include an id_token.',
      hints: ['Confirm the "openid" scope was requested and granted.'],
    };
    return sendFlowResult(result);
  }

  let payload;
  try {
    payload = await verifyIdToken(tokenBody.id_token, {
      issuer: metadata.issuer,
      jwksUri: metadata.jwks_uri,
      clientId,
      expectedNonce: nonce,
    });
  } catch (err) {
    if (err instanceof OidcError) {
      const classification = classifyOidcError(err, metadata, clientId);
      const result = {
        ok: false,
        steps: buildSteps(7),
        title: classification.title,
        message: classification.message,
        hints: classification.hints,
      };
      return sendFlowResult(result);
    }
    const result = {
      ok: false,
      steps: buildSteps(7),
      title: 'ID token validation failed',
      message: err.message || 'The ID token could not be validated.',
      hints: [],
    };
    return sendFlowResult(result);
  }

  const result = {
    ok: true,
    steps: buildSteps(null),
    claims: payload,
  };
  return sendFlowResult(result);
};
