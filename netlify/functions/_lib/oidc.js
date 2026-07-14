'use strict';

/**
 * adfs-oidc-sandbox (Netlify port) — shared OIDC helpers.
 *
 * Stateless equivalent of the local sandbox's server.js helpers. No
 * npm dependencies — JWT verification is done manually using only Node's
 * built-in "crypto" module (see verifyIdToken below).
 *
 * This module is required via a relative path from the sibling Netlify
 * Function files. Netlify's default esbuild bundler bundles local relative
 * requires with zero extra config, so no package.json is needed here.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Flow steps (must match adfs-oidc-sandbox/server.js's FLOW_STEPS exactly)
// ---------------------------------------------------------------------------

const FLOW_STEPS = [
  'User opens the sandbox app',
  'App builds the authorization request (state, nonce, PKCE)',
  'ADFS authenticates the user against AD',
  'ADFS returns an authorization code',
  'App exchanges the code for tokens',
  'ADFS returns an ID token',
  'App validates the ID token',
  'App grants access',
];

// Maps FLOW_STEPS into a status list for the test console.
//
// failedAt === null/undefined -> full success, every step 'ok'.
// failedAt === N               -> steps before N are 'ok', step N is 'fail',
//                                  steps after N are 'pending'.
function buildSteps(failedAt) {
  return FLOW_STEPS.map((label, idx) => {
    const stepNum = idx + 1;
    let status;
    if (failedAt === null || failedAt === undefined) {
      status = 'ok';
    } else if (stepNum < failedAt) {
      status = 'ok';
    } else if (stepNum === failedAt) {
      status = 'fail';
    } else {
      status = 'pending';
    }
    return { step: stepNum, label, status };
  });
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Cookie helpers (stateless replacement for express-session)
// ---------------------------------------------------------------------------

function parseCookies(cookieHeader) {
  const result = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return result;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const name = pair.slice(0, idx).trim();
    if (!name) return;
    const rawValue = pair.slice(idx + 1).trim();
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch (e) {
      // leave as raw value if it isn't validly percent-encoded
    }
    result[name] = value;
  });
  return result;
}

function serializeCookie(name, value, options = {}) {
  const { maxAgeSeconds, httpOnly = true } = options;
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push('Path=/');
  parts.push('SameSite=Lax');
  parts.push('Secure');
  if (httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (maxAgeSeconds !== undefined && maxAgeSeconds !== null) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// PKCE / state / nonce helpers
// ---------------------------------------------------------------------------

function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function generateRandomHex() {
  return crypto.randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// OIDC discovery metadata (fetched fresh on every call — Netlify Functions
// are stateless per invocation, so module-level caching would not be
// reliable across invocations and is intentionally not used here).
// ---------------------------------------------------------------------------

async function loadDiscoveryMetadata(discoveryUrl) {
  let response;
  try {
    response = await fetch(discoveryUrl);
  } catch (err) {
    throw new Error(
      `Could not reach ADFS discovery endpoint (${discoveryUrl}): ${err.message}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `ADFS discovery endpoint returned HTTP ${response.status} ${response.statusText} (${discoveryUrl}).`
    );
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch (err) {
    throw new Error('ADFS discovery endpoint did not return valid JSON.');
  }

  const required = ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'issuer'];
  const missing = required.filter((key) => !metadata[key]);
  if (missing.length > 0) {
    throw new Error(
      `ADFS discovery document is missing required field(s): ${missing.join(', ')}`
    );
  }

  // Validate the endpoint fields are well-formed absolute URLs here, so a
  // malformed/misconfigured discovery document surfaces as a normal Error
  // caught by callers' existing try/catch, rather than an unhandled
  // `new URL()` TypeError thrown later wherever the field is first used.
  const urlFields = ['authorization_endpoint', 'token_endpoint', 'jwks_uri'];
  for (const key of urlFields) {
    try {
      // eslint-disable-next-line no-new
      new URL(metadata[key]);
    } catch (e) {
      throw new Error(`ADFS discovery document field "${key}" is not a valid absolute URL: ${metadata[key]}`);
    }
  }

  return {
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    jwks_uri: metadata.jwks_uri,
    issuer: metadata.issuer,
    end_session_endpoint: metadata.end_session_endpoint || null,
  };
}

// ---------------------------------------------------------------------------
// Manual RS256 JWT verification (no jsonwebtoken/jose/jwk-to-pem — only
// Node's built-in "crypto" module).
// ---------------------------------------------------------------------------

class OidcError extends Error {
  constructor(code, message, hints = []) {
    super(message);
    this.code = code;
    this.hints = hints;
  }
}

async function fetchJwks(jwksUri) {
  let response;
  try {
    response = await fetch(jwksUri);
  } catch (err) {
    throw new OidcError('jwks_unreachable', `Could not reach the ADFS JWKS endpoint: ${err.message}`);
  }
  if (!response.ok) {
    throw new OidcError(
      'jwks_unreachable',
      `ADFS JWKS endpoint returned HTTP ${response.status} ${response.statusText}.`
    );
  }
  try {
    return await response.json();
  } catch (err) {
    throw new OidcError('jwks_unreachable', 'ADFS JWKS endpoint did not return valid JSON.');
  }
}

async function verifyIdToken(idToken, { issuer, jwksUri, clientId, expectedNonce }) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('malformed_token', 'ID token is not a valid JWT (expected 3 segments).');
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    throw new OidcError('malformed_token', 'ID token header/payload is not valid JSON.');
  }

  // CRITICAL: pin the algorithm to prevent "alg confusion" attacks (e.g. a
  // token crafted with alg:"none" or alg:"HS256" using the RSA public key
  // bytes as an HMAC secret). Only ever trust RS256, and only ever verify
  // using the RSA public key we fetched ourselves from the JWKS endpoint —
  // never branch verification behavior based on the token's own header.
  if (header.alg !== 'RS256') {
    throw new OidcError('unsupported_alg', `Unexpected token signing algorithm "${header.alg}" (only RS256 is trusted).`);
  }

  const jwks = await fetchJwks(jwksUri); // fetch(jwksUri) -> {keys: [...]}, throw OidcError on network/parse failure
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) {
    throw new OidcError('no_matching_key', 'No matching signing key found in the ADFS JWKS for this token (kid did not match any key).');
  }

  const publicKey = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(sigB64, 'base64url');
  const isValid = crypto.verify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature);
  if (!isValid) {
    throw new OidcError('signature_invalid', 'ID token signature could not be verified against ADFS signing keys.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const CLOCK_SKEW = 60;
  if (typeof payload.exp !== 'number' || nowSec > payload.exp + CLOCK_SKEW) {
    throw new OidcError('expired', 'ID token is expired.');
  }
  if (payload.iss !== issuer) {
    throw new OidcError('issuer_mismatch', `Token issuer did not match the expected ADFS issuer.`);
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) {
    throw new OidcError('audience_mismatch', 'Token audience did not match the configured client ID.');
  }
  if (!payload.nonce || payload.nonce !== expectedNonce) {
    throw new OidcError('nonce_mismatch', 'Token nonce did not match the nonce generated for this login attempt.');
  }
  return payload;
}

// Maps an OidcError code thrown by verifyIdToken (or fetchJwks) to the
// buildSteps() failedAt step number. Every OidcError code currently thrown
// by this module occurs during "App validates the ID token" (step 7):
// expired, issuer_mismatch, audience_mismatch, nonce_mismatch,
// signature_invalid, no_matching_key, malformed_token, unsupported_alg,
// and jwks_unreachable (JWKS fetch happens as part of validating the token).
const JWT_ERROR_FAILED_AT_STEP = 7;
function failedAtStepForOidcErrorCode(_code) {
  return JWT_ERROR_FAILED_AT_STEP;
}

// ---------------------------------------------------------------------------
// Popup bridge page / fragment-redirect encoding
// ---------------------------------------------------------------------------

// Standalone bridge page rendered inside the login popup once the callback
// flow has concluded (success or failure). It has no UI of its own — it just
// hands the result back to the opener window via postMessage and closes.
function popupBridgeHtml(result) {
  const payload = Object.assign({}, result, { source: 'adfs-oidc-sandbox' });
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ADFS OIDC Sandbox</title>
</head>
<body>
  <p>Authentication step finished &mdash; you can close this window.</p>
  <script>
    (function () {
      var result = ${json};
      if (window.opener) {
        try {
          window.opener.postMessage(result, window.location.origin);
        } catch (e) {
          // ignore — opener may have navigated away or closed
        }
      }
      window.close();
    })();
  </script>
</body>
</html>`;
}

function encodeResultForFragment(result) {
  return encodeURIComponent(JSON.stringify(result));
}

module.exports = {
  FLOW_STEPS,
  buildSteps,
  escapeHtml,
  parseCookies,
  serializeCookie,
  generatePkce,
  generateRandomHex,
  loadDiscoveryMetadata,
  OidcError,
  fetchJwks,
  verifyIdToken,
  failedAtStepForOidcErrorCode,
  popupBridgeHtml,
  encodeResultForFragment,
};
