'use strict';

/**
 * bpuudemo server
 *
 * Serves the KMUTT internal workflow form site (static index.html + css/js)
 * behind a real ADFS OpenID Connect login gate. Nothing in the page loads
 * until the user has authenticated against KMUTT ADFS.
 *
 * The OIDC mechanics here (discovery fetch, PKCE, state/nonce, HTTPS-via-
 * local-cert, session-fixation-safe login, jose-based ID token verification)
 * are ported from the proven, security-reviewed adfs-oidc-sandbox project —
 * see /Users/pengu/Documents/GitHub/adfs-oidc-sandbox/server.js. Do not
 * re-derive this logic; keep it in sync with that reference if it changes.
 */

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { createRemoteJWKSet, jwtVerify } = require('jose');

// ---------------------------------------------------------------------------
// Startup: validate required environment variables
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = [
  'ADFS_DISCOVERY_URL',
  'ADFS_CLIENT_ID',
  'ADFS_CLIENT_SECRET',
  'REDIRECT_URI',
];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name] || !String(process.env[name]).trim());
  if (missing.length > 0) {
    console.error('\n[bpuudemo] Missing required environment variable(s):');
    for (const name of missing) {
      console.error(`  - ${name}`);
    }
    console.error(
      '\nCreate a .env file (copy .env.example -> .env) and fill these in before starting the app.\n'
    );
    process.exit(1);
  }
}

validateEnv();

const config = {
  port: parseInt(process.env.PORT, 10) || 9999,
  discoveryUrl: process.env.ADFS_DISCOVERY_URL,
  clientId: process.env.ADFS_CLIENT_ID,
  clientSecret: process.env.ADFS_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI,
  postLogoutRedirectUri: process.env.POST_LOGOUT_REDIRECT_URI || 'https://localhost:9999/',
  scope: process.env.SCOPE || 'openid profile email',
  sessionSecret: process.env.SESSION_SECRET,
  tlsCertPath: process.env.TLS_CERT_PATH || path.join(__dirname, 'certs', 'cert.pem'),
  tlsKeyPath: process.env.TLS_KEY_PATH || path.join(__dirname, 'certs', 'key.pem'),

  // ThaID (Thailand national digital ID, DOPA) config — powers the /external
  // (บุคคลภายนอก) login flow. Deliberately NOT in REQUIRED_ENV_VARS: unlike
  // ADFS, this app must still boot and serve the KMUTT flow fine even if
  // ThaID is unconfigured or unreachable. See isThaidConfigured() below.
  thaidBaseUrl: process.env.THAID_BASE_URL || 'https://imauth.bora.dopa.go.th',
  thaidClientId: process.env.THAID_CLIENT_ID,
  thaidClientSecret: process.env.THAID_CLIENT_SECRET,
  thaidRedirectUri: process.env.THAID_REDIRECT_URI,
  thaidScope: process.env.THAID_SCOPE || 'pid name openid',

  // KMUTT Master Data (server-to-server client-credentials API) config —
  // used after a successful ADFS login to look up whether the user is staff
  // or a student, so the client can show the right menu items. Deliberately
  // NOT in REQUIRED_ENV_VARS: unlike ADFS, this app must still boot and let
  // KMUTT users log in fine even if Master Data is unconfigured or
  // unreachable — see isMasterDataConfigured() below.
  masterdataBaseUrl: process.env.MASTERDATA_BASE_URL || 'https://master-data.kmutt.ac.th',
  masterdataClientId: process.env.MASTERDATA_CLIENT_ID,
  masterdataClientSecret: process.env.MASTERDATA_CLIENT_SECRET,
};

if (!config.sessionSecret) {
  console.warn(
    '[bpuudemo] SESSION_SECRET is not set. Generating a random in-memory secret for this run only ' +
      '(sessions will not survive a restart). Set SESSION_SECRET in .env for stable sessions.'
  );
  config.sessionSecret = crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// OIDC discovery metadata (fetched once at boot, no caching/refresh)
// ---------------------------------------------------------------------------

let oidcMetadata = null;
let remoteJwks = null;

async function loadDiscoveryMetadata() {
  let response;
  try {
    response = await fetch(config.discoveryUrl);
  } catch (err) {
    console.error(
      `\n[bpuudemo] Could not reach ADFS_DISCOVERY_URL (${config.discoveryUrl}).\n` +
        'This app needs network access to the ADFS discovery endpoint — if ADFS is not ' +
        'internet-facing, make sure you are connected to the required VPN or campus network.\n'
    );
    console.error(`[bpuudemo] Underlying error: ${err.message}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(
      `\n[bpuudemo] ADFS discovery endpoint returned HTTP ${response.status} ${response.statusText}.\n` +
        `URL: ${config.discoveryUrl}\n`
    );
    process.exit(1);
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch (err) {
    console.error('\n[bpuudemo] ADFS discovery endpoint did not return valid JSON.\n');
    process.exit(1);
  }

  const required = ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'issuer'];
  const missing = required.filter((key) => !metadata[key]);
  if (missing.length > 0) {
    console.error(
      `\n[bpuudemo] ADFS discovery document is missing required field(s): ${missing.join(', ')}\n`
    );
    process.exit(1);
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
// ThaID discovery metadata (separate identity provider, powers /external).
//
// Only issuer + jwks_uri are actually taken from this document — ThaID's
// authorization/token endpoints are fixed paths under THAID_BASE_URL per
// DOPA's RP integration docs (see getThaidAuthorizationEndpoint() /
// getThaidTokenEndpoint() below), not values discovered dynamically.
//
// Unlike loadDiscoveryMetadata() above, failure here must NOT crash the
// process — the core KMUTT/ADFS flow has to keep working even if ThaID is
// unreachable or not yet configured. Any failure just leaves thaidMetadata
// as null; the /external routes check for that and show a friendly error
// page instead of redirecting into a broken flow.
// ---------------------------------------------------------------------------

let thaidMetadata = null;
let thaidRemoteJwks = null;

function getThaidAuthorizationEndpoint() {
  return `${config.thaidBaseUrl}/api/v2/oauth2/auth/`;
}

function getThaidTokenEndpoint() {
  return `${config.thaidBaseUrl}/api/v2/oauth2/token/`;
}

async function loadThaidDiscoveryMetadata() {
  const discoveryUrl = `${config.thaidBaseUrl}/.well-known/openid-configuration`;

  let response;
  try {
    response = await fetch(discoveryUrl);
  } catch (err) {
    console.warn(
      `[bpuudemo] Could not reach ThaID discovery endpoint (${discoveryUrl}). ` +
        `ThaID login (/external) will show an "unavailable" page until this is reachable. ` +
        `Underlying error: ${err.message}`
    );
    return null;
  }

  if (!response.ok) {
    console.warn(
      `[bpuudemo] ThaID discovery endpoint returned HTTP ${response.status} ${response.statusText}. ` +
        `ThaID login (/external) will show an "unavailable" page. URL: ${discoveryUrl}`
    );
    return null;
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch (err) {
    console.warn('[bpuudemo] ThaID discovery endpoint did not return valid JSON. ThaID login (/external) will show an "unavailable" page.');
    return null;
  }

  const required = ['issuer', 'jwks_uri'];
  const missing = required.filter((key) => !metadata[key]);
  if (missing.length > 0) {
    console.warn(
      `[bpuudemo] ThaID discovery document is missing required field(s): ${missing.join(', ')}. ` +
        'ThaID login (/external) will show an "unavailable" page.'
    );
    return null;
  }

  return {
    issuer: metadata.issuer,
    jwks_uri: metadata.jwks_uri,
  };
}

// True only when both the required ThaID env vars are present AND discovery
// metadata was loaded successfully at boot — used to gate /external and
// /external/callback behind a friendly error page instead of crashing or
// redirecting into a broken flow.
function isThaidConfigured() {
  return Boolean(
    config.thaidClientId &&
      config.thaidClientSecret &&
      config.thaidRedirectUri &&
      thaidMetadata
  );
}

// ---------------------------------------------------------------------------
// KMUTT Master Data client (server-to-server client-credentials API).
//
// Used only after a successful ADFS login, to classify the user as staff or
// student for menu visibility on the client. This is a plain client-
// credentials API (POST login -> bearer token -> GET data endpoints with
// query-string filters) — no user interaction, no redirect_uri, unrelated to
// the OIDC/PKCE flows above.
//
// Like ThaID above, this must NEVER block or break the core KMUTT/ADFS login
// if unconfigured or unreachable — failures here are logged with
// console.warn and simply result in no staff/student classification (the
// client falls back to its existing generic 'kmutt' behavior).
// ---------------------------------------------------------------------------

// True only when both required Master Data env vars are present. Does not
// depend on any token/network check — that happens lazily in
// getMasterDataToken(), matching how isThaidConfigured() only gates on
// config + discovery, not a live probe.
function isMasterDataConfigured() {
  return Boolean(config.masterdataClientId && config.masterdataClientSecret);
}

// Module-level cached token state. A fresh token is requested only when
// there is no cached one or it is at (or past) its expiry minus a small
// buffer — everything else reuses the cached token.
let masterdataToken = null;
let masterdataTokenExpiresAt = 0; // unix seconds

const MASTERDATA_TOKEN_EXPIRY_BUFFER_SECONDS = 60;

// A hanging (not just erroring) Master Data endpoint must still fail fast —
// otherwise a KMUTT ADFS login stalls for minutes waiting on Node's default
// fetch timeout instead of degrading to "no classification" within seconds.
const MASTERDATA_FETCH_TIMEOUT_MS = 5000;

async function getMasterDataToken() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (masterdataToken && nowSeconds < masterdataTokenExpiresAt - MASTERDATA_TOKEN_EXPIRY_BUFFER_SECONDS) {
    return masterdataToken;
  }

  const loginUrl = `${config.masterdataBaseUrl}/backend/api/Clients/Login`;

  let response;
  try {
    response = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'secret',
        client_id: config.masterdataClientId,
        client_secret: config.masterdataClientSecret,
      }),
      signal: AbortSignal.timeout(MASTERDATA_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Master Data login request failed: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`Master Data login endpoint returned HTTP ${response.status} ${response.statusText}`);
  }

  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw new Error('Master Data login endpoint did not return valid JSON');
  }

  if (!body || !body.token) {
    throw new Error('Master Data login response did not include a token');
  }

  masterdataToken = body.token;
  masterdataTokenExpiresAt = typeof body.expires === 'number' ? body.expires : nowSeconds + (body.expires_in || 0);

  return masterdataToken;
}

// Builds a display name from Thai given/family name fields, falling back to
// the English equivalents if the Thai ones are empty/null/whitespace.
function buildMasterDataDisplayName(thFirst, thLast, enFirst, enLast) {
  const th = `${thFirst || ''} ${thLast || ''}`.trim();
  if (th) return th;
  const en = `${enFirst || ''} ${enLast || ''}`.trim();
  return en || null;
}

// Looks up whether `email` belongs to KMUTT staff or a student via the
// Master Data API. Only ever returns the specific fields listed in the
// return type below — nothing else from the API response (e.g. IDCARD,
// passport numbers, personal phone/email, gender, nationality) is ever
// extracted, stored, or returned. Must NEVER throw — any failure (Master
// Data unconfigured, network error, unexpected response shape, token fetch
// failure) results in the "no match" shape below plus a console.warn.
async function lookupKmuttUserType(email) {
  const notFound = { type: null, displayName: null, department: null, statusName: null };

  if (!isMasterDataConfigured()) {
    return notFound;
  }

  try {
    const token = await getMasterDataToken();

    const staffUrl = new URL(`${config.masterdataBaseUrl}/backend/api/data/DH0002_HR_EmployeeProfile`);
    staffUrl.searchParams.set('internalemail', email);
    staffUrl.searchParams.set('page', '1');
    staffUrl.searchParams.set('pageSize', '1');

    const staffResponse = await fetch(staffUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(MASTERDATA_FETCH_TIMEOUT_MS),
    });

    if (!staffResponse.ok) {
      throw new Error(`Master Data staff lookup returned HTTP ${staffResponse.status}`);
    }

    const staffResults = await staffResponse.json();

    if (Array.isArray(staffResults) && staffResults.length > 0) {
      const staff = staffResults[0];
      return {
        type: 'staff',
        displayName: buildMasterDataDisplayName(
          staff.firstnameth,
          staff.lastnameth,
          staff.firstnameen,
          staff.lastnameen
        ),
        department: staff.departmentlevelth2 || null,
        statusName: staff.statusnameth || null,
      };
    }

    const studentUrl = new URL(`${config.masterdataBaseUrl}/backend/api/data/DH0001_STD_MemberProfile`);
    studentUrl.searchParams.set('KMUTT_EMAIL', email);
    studentUrl.searchParams.set('page', '1');
    studentUrl.searchParams.set('pageSize', '1');

    const studentResponse = await fetch(studentUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(MASTERDATA_FETCH_TIMEOUT_MS),
    });

    if (!studentResponse.ok) {
      throw new Error(`Master Data student lookup returned HTTP ${studentResponse.status}`);
    }

    const studentResults = await studentResponse.json();

    if (Array.isArray(studentResults) && studentResults.length > 0) {
      const student = studentResults[0];
      return {
        type: 'student',
        displayName: buildMasterDataDisplayName(
          student.FNAME_TH,
          student.LNAME_TH,
          student.FNAME_EN,
          student.LNAME_EN
        ),
        department: student.FACULTY_NAME_TH || null,
        statusName: student.STUDENT_STATUS_NAME_TH || null,
      };
    }

    return notFound;
  } catch (err) {
    console.warn(`[bpuudemo] Master Data lookup failed for user (non-fatal, falling back to no classification): ${err.message}`);
    return notFound;
  }
}

// Resolves the immediate approver for a given department code, per KMUTT's
// HR org-structure hierarchy. Given DH0003_HR_ORG_Structure's
// ADMINPOS02..ADMINPOS06 escalating levels (02 = lowest, 06 = highest, e.g.
// university president), finds the LOWEST-numbered level whose _NAME is a
// non-empty string (many levels are blank for a given department) — that is
// the department's immediate approver level. The _EMP field at that level is
// an employeeid, not a name/email, so it's resolved to a real person via
// DH0002_HR_EmployeeProfile. Returns { name, position, email } or null when
// no approver can be resolved (no org-structure row, no non-empty level, or
// the resolved employeeid doesn't exist in DH0002 — a half-resolved approver
// is never returned). Does not catch its own errors — network/HTTP failures
// intentionally propagate to the caller (lookupKmuttRequesterProfile), which
// wraps the whole lookup in a single try/catch, matching the same
// all-or-nothing defensive pattern as lookupKmuttUserType above.
async function resolveKmuttApprover(departmentCode) {
  if (!departmentCode) return null;

  const token = await getMasterDataToken();

  const orgUrl = new URL(`${config.masterdataBaseUrl}/backend/api/data/DH0003_HR_ORG_Structure`);
  orgUrl.searchParams.set('DEPARTMENTCODE', departmentCode);
  orgUrl.searchParams.set('page', '1');
  orgUrl.searchParams.set('pageSize', '1');

  const orgResponse = await fetch(orgUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(MASTERDATA_FETCH_TIMEOUT_MS),
  });

  if (!orgResponse.ok) {
    throw new Error(`Master Data org structure lookup returned HTTP ${orgResponse.status}`);
  }

  const orgResults = await orgResponse.json();
  if (!Array.isArray(orgResults) || orgResults.length === 0) {
    return null;
  }

  const org = orgResults[0];

  let matchedLevel = null;
  for (const level of [2, 3, 4, 5, 6]) {
    const levelName = org[`ADMINPOS0${level}_NAME`];
    if (typeof levelName === 'string' && levelName.trim()) {
      matchedLevel = level;
      break;
    }
  }

  if (matchedLevel === null) {
    return null;
  }

  const positionTitle = org[`ADMINPOS0${matchedLevel}_NAME`];
  const empId = org[`ADMINPOS0${matchedLevel}_EMP`];

  if (!empId) {
    return null;
  }

  const empUrl = new URL(`${config.masterdataBaseUrl}/backend/api/data/DH0002_HR_EmployeeProfile`);
  empUrl.searchParams.set('employeeid', empId);
  empUrl.searchParams.set('page', '1');
  empUrl.searchParams.set('pageSize', '1');

  const empResponse = await fetch(empUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(MASTERDATA_FETCH_TIMEOUT_MS),
  });

  if (!empResponse.ok) {
    throw new Error(`Master Data approver employee lookup returned HTTP ${empResponse.status}`);
  }

  const empResults = await empResponse.json();
  if (!Array.isArray(empResults) || empResults.length === 0) {
    return null;
  }

  const emp = empResults[0];

  const resolvedName = buildMasterDataDisplayName(
    `${emp.titleshortth1 || ''}${emp.firstnameth || ''}`,
    emp.lastnameth,
    emp.firstnameen,
    emp.lastnameen
  );

  // A half-resolved approver (missing name or email) must not be reported as
  // a successful match — the client can only distinguish "found" vs
  // "not found" (see setApprover's isErr check), so returning an incomplete
  // object here would render as a valid-looking approver with blank fields
  // instead of the intended "no approver found" fallback.
  if (!resolvedName || !emp.internalemail) {
    return null;
  }

  return {
    name: resolvedName,
    position: positionTitle,
    email: emp.internalemail,
  };
}

// Looks up the requester-info (ส่วนที่ 1) and approver-info (ส่วนที่ 2) fields
// for a KMUTT ADFS SSO user, so the request form can auto-fill them the same
// way the old CSV-ID-entry flow does via globalUserData. Performs its own
// staff-then-student existence check (same internalemail/KMUTT_EMAIL pattern
// as lookupKmuttUserType — intentionally duplicated rather than threaded
// through that function, which stays untouched). Only ever extracts the
// specific fields listed in the return shape below — nothing else from the
// API response (IDCARD, passport numbers, personal phone/email, gender,
// nationality, etc.) is ever extracted, stored, or returned, for either the
// requester or the resolved approver. Must NEVER throw — any failure (Master
// Data unconfigured, network error, unexpected response shape, token fetch
// failure, or a failure inside resolveKmuttApprover) results in the "no
// match" shape below plus a console.warn.
async function lookupKmuttRequesterProfile(email) {
  const notFound = { type: null, requester: null, approver: null };

  if (!isMasterDataConfigured()) {
    return notFound;
  }

  try {
    const token = await getMasterDataToken();

    const staffUrl = new URL(`${config.masterdataBaseUrl}/backend/api/data/DH0002_HR_EmployeeProfile`);
    staffUrl.searchParams.set('internalemail', email);
    staffUrl.searchParams.set('page', '1');
    staffUrl.searchParams.set('pageSize', '1');

    const staffResponse = await fetch(staffUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(MASTERDATA_FETCH_TIMEOUT_MS),
    });

    if (!staffResponse.ok) {
      throw new Error(`Master Data staff lookup returned HTTP ${staffResponse.status}`);
    }

    const staffResults = await staffResponse.json();

    if (Array.isArray(staffResults) && staffResults.length > 0) {
      const staff = staffResults[0];

      const name = buildMasterDataDisplayName(
        `${staff.titleshortth1 || ''}${staff.firstnameth || ''}`,
        staff.lastnameth,
        staff.firstnameen,
        staff.lastnameen
      );

      const departmentNames = [staff.departmentlevelth4, staff.departmentlevelth3, staff.departmentlevelth2].filter(
        Boolean
      );

      const requester = {
        employeeId: staff.employeeid,
        name: name || '',
        position: staff.positionnameth || staff.positionnameen || '-',
        department: departmentNames.length > 0 ? departmentNames.join('\n') : '-',
        internalPhone: staff.internaltelephoneno || '-',
        email: staff.internalemail || email,
      };

      const approver = await resolveKmuttApprover(staff.departmentcode);

      return { type: 'staff', requester, approver };
    }

    const studentUrl = new URL(`${config.masterdataBaseUrl}/backend/api/data/DH0001_STD_MemberProfile`);
    studentUrl.searchParams.set('KMUTT_EMAIL', email);
    studentUrl.searchParams.set('page', '1');
    studentUrl.searchParams.set('pageSize', '1');

    const studentResponse = await fetch(studentUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(MASTERDATA_FETCH_TIMEOUT_MS),
    });

    if (!studentResponse.ok) {
      throw new Error(`Master Data student lookup returned HTTP ${studentResponse.status}`);
    }

    const studentResults = await studentResponse.json();

    if (Array.isArray(studentResults) && studentResults.length > 0) {
      const student = studentResults[0];

      const name = buildMasterDataDisplayName(
        `${student.PRIFIXNAME_TH || ''}${student.FNAME_TH || ''}`,
        student.LNAME_TH,
        student.FNAME_EN,
        student.LNAME_EN
      );

      const requester = {
        studentCode: student.STUDENT_CODE,
        name: name || '',
        status: student.STUDENT_STATUS_NAME_TH || '-',
        faculty: student.FACULTY_NAME_TH || '-',
        major: student.FOS_NAME_TH || '-',
        email: student.KMUTT_EMAIL || email,
      };

      const approver = await resolveKmuttApprover(student.DEPARTMENT_CODE);

      return { type: 'student', requester, approver };
    }

    return notFound;
  } catch (err) {
    console.warn(
      `[bpuudemo] Master Data requester profile lookup failed for user (non-fatal, falling back to no profile): ${err.message}`
    );
    return notFound;
  }
}

// Keeps only the last 4 characters of a Thai national ID (pid) visible,
// replacing the rest with '•' — e.g. a 13-digit pid becomes 9 '•' characters
// followed by the last 4 digits. Used so /api/me never sends the full
// unmasked pid to the client.
function maskPid(pid) {
  if (pid === undefined || pid === null) return '';
  const str = String(pid);
  // Mask fully rather than returning it raw — a malformed/unexpectedly short
  // pid must never reach the client unmasked, even as an edge case.
  if (str.length <= 4) return '•'.repeat(str.length);
  return '•'.repeat(str.length - 4) + str.slice(-4);
}

// ---------------------------------------------------------------------------
// Small HTML error page helper (user-facing — kept generic, no raw technical
// detail dumped to the client; the real error always goes to console.error).
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

function renderErrorPage({ title, message, retryHref = '/login' }) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Sarabun", Roboto, Helvetica, Arial, sans-serif;
      background: #f2f4f7; color: #1f2430; margin: 0; padding: 48px 16px; line-height: 1.6; }
    .card { max-width: 480px; margin: 0 auto; background: #fff; border: 1px solid #dde1e7; border-radius: 10px; padding: 28px; text-align: center; }
    h1 { font-size: 1.2rem; margin: 0 0 12px; color: #b3261e; }
    p { margin: 8px 0; color: #444; }
    a.button { display: inline-block; margin-top: 16px; background: #ea580c; color: #fff; text-decoration: none;
      padding: 10px 20px; border-radius: 6px; font-weight: 600; }
    @media (prefers-color-scheme: dark) {
      body { background: #14161a; color: #e7e9ee; }
      .card { background: #1d2026; border-color: #2c313a; }
      p { color: #b7bfcc; }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a class="button" href="${escapeHtml(retryHref)}">ลองเข้าสู่ระบบใหม่ / Try again</a>
  </div>
</body>
</html>`;
}

// Shown at '/' and '/index.html' when there is no session yet, instead of an
// immediate silent redirect to ADFS — gives the user context before bouncing
// them to an external login domain. Loads the same CSS design tokens
// (--ci-orange etc.) as the gated app itself, via the already-public
// /css/styles.css route, so it looks native rather than bolted-on.
function renderLoginLandingPage() {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>เข้าสู่ระบบ — ระบบกระบวนงาน BPUU</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css">
  <link rel="stylesheet" href="/css/styles.css">
  <style>
    body {
      min-height: 100vh;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: linear-gradient(135deg, var(--ci-orange), var(--ci-yellow));
    }
    .login-card {
      max-width: 440px;
      width: 100%;
      background: #fff;
      border-radius: 16px;
      padding: 40px 32px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
    }
    .login-icon {
      width: 76px;
      height: 76px;
      border-radius: 50%;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.2rem;
      color: #fff;
      background: linear-gradient(135deg, var(--ci-orange), #ff734d);
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="login-icon"><i class="bi bi-building"></i></div>
    <h4 class="fw-bold text-ci-orange mb-2">ระบบกระบวนงาน (Workflow)</h4>
    <p class="text-ci-bluegrey mb-4">
      การให้บริการของกลุ่มงานจัดการผลประโยชน์และทรัพย์สิน<br>
      กรุณาเลือกประเภทผู้ใช้งานเพื่อเริ่มยื่นคำขอ
    </p>
    <a href="/login" class="btn btn-ci-orange btn-lg w-100 fw-bold mb-2">
      <i class="bi bi-box-arrow-in-right me-2"></i>บุคลากร / นักศึกษา
    </a>
    <a href="/external" class="btn btn-ci-bluegrey btn-lg w-100 fw-bold">
      <i class="bi bi-people-fill me-2"></i>บุคคลภายนอก (ThaiD)
    </a>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// PKCE / state / nonce helpers (same approach as adfs-oidc-sandbox)
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
// Express app
// ---------------------------------------------------------------------------

const app = express();

// Computed once at module load so it's available both for the session
// cookie's `secure` flag and for the HTTPS/HTTP boot choice below.
const hasTlsCert = fs.existsSync(config.tlsCertPath) && fs.existsSync(config.tlsKeyPath);

app.use(
  session({
    name: 'bpuudemo_sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: hasTlsCert, // cookie is only sent over HTTPS once we're actually serving HTTPS
    },
    // NOTE: this is the default in-memory session store. It is acceptable
    // for this dev phase, but it does not survive a process restart and
    // will not scale across multiple instances — swap in a persistent
    // store (e.g. connect-redis) before this carries real production traffic.
  })
);

// JSON body parsing — only needed by the small set of POST API routes below
// (currently just /api/kmutt-dev-preview). Every other route in this file is
// a GET, so this has no effect on them; a small size limit keeps it from
// being usable to send oversized payloads at any route that does read a body.
app.use(express.json({ limit: '10kb' }));

// Wrap async route handlers so rejected promises / thrown errors render a
// generic error page instead of crashing the process or leaking a stack trace.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
}

// ---------------------------------------------------------------------------
// Auth gate for the actual page. Registered BEFORE express.static so a
// request for '/' or '/index.html' always hits this check first — static
// serving below has { index: false } so it never auto-serves index.html.
// ---------------------------------------------------------------------------

const INDEX_HTML_PATH = path.join(__dirname, 'index.html');

function requireLogin(req, res, next) {
  if (!req.session.user) {
    // Stash the originally-requested path now, before showing the landing
    // page, so clicking through to /login still returns here afterward.
    req.session.redirectAfterLogin = req.originalUrl;
    noStore(res);
    res.status(200).send(renderLoginLandingPage());
    return;
  }
  next();
}

app.get(
  ['/', '/index.html'],
  requireLogin,
  asyncHandler(async (req, res) => {
    noStore(res);
    res.sendFile(INDEX_HTML_PATH);
  })
);

// Entry point for people without a KMUTT account ("บุคคลภายนอก") — gated on a
// ThaID (Thailand national digital ID, DOPA) session instead of the ADFS
// session that gates '/'. Mirrors requireLogin's shape: no ThaID session yet
// -> kick off the ThaID authorization redirect; ThaID session already
// present -> serve the exact same index.html as '/'. Independent identity
// provider, independent session key (req.session.externalUser) — none of
// this touches req.session.user or the ADFS routes below.
app.get(
  '/external',
  asyncHandler(async (req, res) => {
    if (!isThaidConfigured()) {
      noStore(res);
      res.status(503).send(
        renderErrorPage({
          title: 'ThaID ยังไม่พร้อมใช้งาน',
          message:
            'ระบบเข้าสู่ระบบด้วย ThaID สำหรับบุคคลภายนอกยังไม่ได้ตั้งค่าในขณะนี้ กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแลระบบ',
          retryHref: '/external',
        })
      );
      return;
    }

    if (!req.session.externalUser) {
      const state = generateRandomHex();
      const nonce = generateRandomHex();
      req.session.thaid_state = state;
      req.session.thaid_nonce = nonce;

      const authUrl = new URL(getThaidAuthorizationEndpoint());
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', config.thaidClientId);
      authUrl.searchParams.set('redirect_uri', config.thaidRedirectUri);
      authUrl.searchParams.set('scope', config.thaidScope);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('nonce', nonce);

      console.log('[bpuudemo] redirecting to ThaID authorization endpoint');
      res.redirect(authUrl.toString());
      return;
    }

    noStore(res);
    res.sendFile(INDEX_HTML_PATH);
  })
);

// ThaID callback — matches THAID_REDIRECT_URI's path. The authorization code
// ThaID issues is valid for only 30 seconds and is single-use, so this
// handler exchanges it for a token immediately; no other slow work happens
// before that POST.
app.get(
  '/external/callback',
  asyncHandler(async (req, res) => {
    console.log('[bpuudemo] ThaID callback received');

    if (!isThaidConfigured()) {
      noStore(res);
      res.status(503).send(
        renderErrorPage({
          title: 'ThaID ยังไม่พร้อมใช้งาน',
          message:
            'ระบบเข้าสู่ระบบด้วย ThaID สำหรับบุคคลภายนอกยังไม่ได้ตั้งค่าในขณะนี้ กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแลระบบ',
          retryHref: '/external',
        })
      );
      return;
    }

    if (req.query.error) {
      const errorCode = String(req.query.error);
      const errorDescription = req.query.error_description ? String(req.query.error_description) : '';
      console.error(`[bpuudemo] ThaID returned an error: ${errorCode} ${errorDescription}`);
      res.status(400).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: `ThaID returned "${errorCode}"${errorDescription ? ': ' + errorDescription : ''}`,
          retryHref: '/external',
        })
      );
      return;
    }

    if (!req.query.state || req.query.state !== req.session.thaid_state) {
      res.status(400).send(
        renderErrorPage({
          title: 'เซสชันหมดอายุ',
          message: 'state mismatch, please try again.',
          retryHref: '/external',
        })
      );
      return;
    }

    if (!req.query.code) {
      res.status(400).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: 'ThaID did not return an authorization code. Please try again.',
          retryHref: '/external',
        })
      );
      return;
    }

    // ThaID sends client credentials ONLY via the HTTP Basic auth header on
    // the token request — never in the form body (different from the ADFS
    // integration above, which sends client_id/client_secret as body fields).
    const basicAuth = Buffer.from(`${config.thaidClientId}:${config.thaidClientSecret}`).toString('base64');
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(req.query.code),
      redirect_uri: config.thaidRedirectUri,
    });

    let tokenResponse;
    try {
      tokenResponse = await fetch(getThaidTokenEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
        },
        body: tokenParams.toString(),
      });
    } catch (err) {
      console.error('[bpuudemo] ThaID token endpoint request failed:', err.message);
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: 'Could not reach the ThaID token endpoint. Please try again.',
          retryHref: '/external',
        })
      );
      return;
    }

    let tokenBody;
    try {
      tokenBody = await tokenResponse.json();
    } catch (err) {
      console.error('[bpuudemo] ThaID token endpoint returned invalid JSON');
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: 'The ThaID token endpoint returned an invalid response. Please try again.',
          retryHref: '/external',
        })
      );
      return;
    }

    if (!tokenResponse.ok || tokenBody.error) {
      const errorCode = tokenBody.error || `HTTP ${tokenResponse.status}`;
      const errorDescription = tokenBody.error_description || '';
      console.error(`[bpuudemo] ThaID token exchange failed: ${errorCode} ${errorDescription}`);
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: `ThaID returned "${errorCode}"${errorDescription ? ': ' + errorDescription : ''}`,
          retryHref: '/external',
        })
      );
      return;
    }

    if (!tokenBody.id_token) {
      console.error('[bpuudemo] ThaID token response did not include an id_token');
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: 'The token response did not include an ID token. Please try again.',
          retryHref: '/external',
        })
      );
      return;
    }

    console.log('[bpuudemo] ThaID token exchange ok');

    let payload;
    try {
      const verifyResult = await jwtVerify(tokenBody.id_token, thaidRemoteJwks, {
        issuer: thaidMetadata.issuer,
        audience: config.thaidClientId,
      });
      payload = verifyResult.payload;
    } catch (err) {
      console.error('[bpuudemo] ThaID id_token validation failed:', err.message);
      res.status(400).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: "we couldn't verify your login, please try again.",
          retryHref: '/external',
        })
      );
      return;
    }

    // ThaID's documented authorization request params don't list 'nonce' and
    // its documented id_token claims don't list 'nonce' either, so this
    // check is only enforced if a nonce claim actually shows up — if ThaID
    // never returns one, we don't fail every real login over a claim they
    // don't support; if they ever do return one (undocumented or a future
    // change), this still catches a token-replay mismatch.
    if (payload.nonce && payload.nonce !== req.session.thaid_nonce) {
      console.error('[bpuudemo] ThaID id_token nonce mismatch');
      res.status(400).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: "we couldn't verify your login, please try again.",
          retryHref: '/external',
        })
      );
      return;
    }

    console.log('[bpuudemo] ThaID verification ok');

    // Regenerate the session ID on successful login so a session ID observed
    // or fixed before authentication cannot be reused as an authenticated
    // session afterward (session fixation) — same pattern as the ADFS
    // callback above.
    req.session.regenerate((err) => {
      if (err) {
        console.error('[bpuudemo] session regenerate error:', err.message);
        res.status(500).send(
          renderErrorPage({
            title: 'เข้าสู่ระบบไม่สำเร็จ',
            message: 'Could not establish a session after login. Please try again.',
            retryHref: '/external',
          })
        );
        return;
      }

      // Store ONLY these three fields — never the access/refresh tokens,
      // which nothing downstream needs. Never log pid/name (matching the
      // existing discipline of never logging the ADFS client secret).
      req.session.externalUser = {
        pid: payload.pid,
        name: payload.name,
        verifiedAt: new Date().toISOString(),
      };

      delete req.session.thaid_state;
      delete req.session.thaid_nonce;

      console.log('[bpuudemo] ThaID login successful');
      res.redirect('/external');
    });
  })
);

// ---------------------------------------------------------------------------
// OIDC routes
// ---------------------------------------------------------------------------

app.get(
  '/login',
  asyncHandler(async (req, res) => {
    const state = generateRandomHex();
    const nonce = generateRandomHex();
    const { codeVerifier, codeChallenge } = generatePkce();

    req.session.oidc_state = state;
    req.session.oidc_nonce = nonce;
    req.session.oidc_code_verifier = codeVerifier;

    const authUrl = new URL(oidcMetadata.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', config.redirectUri);
    authUrl.searchParams.set('scope', config.scope);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    console.log('[bpuudemo] redirecting to ADFS authorization endpoint');
    res.redirect(authUrl.toString());
  })
);

app.get(
  '/redirect',
  asyncHandler(async (req, res) => {
    console.log('[bpuudemo] callback received');

    if (req.query.error) {
      const errorCode = String(req.query.error);
      const errorDescription = req.query.error_description ? String(req.query.error_description) : '';
      console.error(`[bpuudemo] ADFS returned an error: ${errorCode} ${errorDescription}`);
      res.status(400).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: `ADFS returned "${errorCode}"${errorDescription ? ': ' + errorDescription : ''}`,
        })
      );
      return;
    }

    if (!req.query.state || req.query.state !== req.session.oidc_state) {
      res.status(400).send(
        renderErrorPage({
          title: 'เซสชันหมดอายุ',
          message: 'session expired or possible CSRF, please try again.',
        })
      );
      return;
    }

    if (!req.query.code) {
      res.status(400).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: 'ADFS did not return an authorization code. Please try again.',
        })
      );
      return;
    }

    const codeVerifier = req.session.oidc_code_verifier;
    const nonce = req.session.oidc_nonce;

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(req.query.code),
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier || '',
    });

    let tokenResponse;
    try {
      tokenResponse = await fetch(oidcMetadata.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
      });
    } catch (err) {
      console.error('[bpuudemo] token endpoint request failed:', err.message);
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: 'Could not reach the ADFS token endpoint. Please try again.',
        })
      );
      return;
    }

    let tokenBody;
    try {
      tokenBody = await tokenResponse.json();
    } catch (err) {
      console.error('[bpuudemo] token endpoint returned invalid JSON');
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: 'The ADFS token endpoint returned an invalid response. Please try again.',
        })
      );
      return;
    }

    if (!tokenResponse.ok || tokenBody.error) {
      const errorCode = tokenBody.error || `HTTP ${tokenResponse.status}`;
      const errorDescription = tokenBody.error_description || '';
      console.error(`[bpuudemo] token exchange failed: ${errorCode} ${errorDescription}`);
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: `ADFS returned "${errorCode}"${errorDescription ? ': ' + errorDescription : ''}`,
        })
      );
      return;
    }

    if (!tokenBody.id_token) {
      console.error('[bpuudemo] token response did not include an id_token');
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: 'The token response did not include an ID token. Please try again.',
        })
      );
      return;
    }

    console.log('[bpuudemo] token exchange ok');

    let payload;
    try {
      const verifyResult = await jwtVerify(tokenBody.id_token, remoteJwks, {
        issuer: oidcMetadata.issuer,
        audience: config.clientId,
      });
      payload = verifyResult.payload;
    } catch (err) {
      console.error('[bpuudemo] id_token validation failed:', err.message);
      res.status(400).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: "we couldn't verify your login, please try again.",
        })
      );
      return;
    }

    if (!payload.nonce || payload.nonce !== nonce) {
      console.error('[bpuudemo] nonce mismatch on id_token');
      res.status(400).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: "we couldn't verify your login, please try again.",
        })
      );
      return;
    }

    // Look up staff/student classification via KMUTT Master Data BEFORE
    // regenerating the session below — lookupKmuttUserType() never throws
    // (see its own try/catch), so this can't turn into a login failure; it
    // just resolves to a "no classification" shape if Master Data is
    // unconfigured, unreachable, or has no matching record. Done here,
    // ahead of regenerate(), rather than inside its callback, so the
    // callback itself stays synchronous.
    const kmuttUserType = await lookupKmuttUserType(payload.upn);
    // Requester/approver info for auto-filling ส่วนที่ 1 / ส่วนที่ 2 on the
    // request form — separate call, same non-throwing guarantee as above
    // (see lookupKmuttRequesterProfile's own try/catch). Deliberately kept
    // as its own lookup rather than merged into lookupKmuttUserType, which
    // stays untouched.
    const kmuttRequesterProfile = await lookupKmuttRequesterProfile(payload.upn);

    // Regenerate the session ID on successful login so a session ID observed
    // or fixed before authentication cannot be reused as an authenticated
    // session afterward (session fixation).
    req.session.regenerate((err) => {
      if (err) {
        console.error('[bpuudemo] session regenerate error:', err.message);
        res.status(500).send(
          renderErrorPage({
            title: 'เข้าสู่ระบบไม่สำเร็จ',
            message: 'Could not establish a session after login. Please try again.',
          })
        );
        return;
      }

      req.session.user = {
        claims: payload,
        loggedInAt: new Date().toISOString(),
        // Kept only so /logout can pass it back as id_token_hint — ADFS's
        // OAuth2 logout endpoint needs this to know which client's
        // post_logout_redirect_uri to honor; without it, ADFS just shows
        // its own generic "signed out" confirmation page instead of
        // redirecting back here, regardless of what post_logout_redirect_uri
        // is set to.
        idToken: tokenBody.id_token,
        // Staff/student classification from KMUTT Master Data (see
        // lookupKmuttUserType above) — only the fields it returns
        // (type/displayName/department/statusName) ever end up here, never
        // the raw Master Data record.
        kmuttUserType,
      };
      // Requester/approver profile for ส่วนที่ 1 / ส่วนที่ 2 auto-fill (see
      // lookupKmuttRequesterProfile above) — only the allowlisted fields it
      // returns ever end up here, never the raw Master Data record.
      req.session.user.kmuttRequesterProfile = kmuttRequesterProfile;

      let redirectTo = '/';
      const stashed = req.session.redirectAfterLogin;
      if (typeof stashed === 'string' && stashed.startsWith('/') && !stashed.startsWith('//')) {
        redirectTo = stashed;
      }
      delete req.session.redirectAfterLogin;

      console.log(`[bpuudemo] login successful for sub=${payload.sub}`);
      res.redirect(redirectTo);
    });
  })
);

app.get(
  '/logout',
  asyncHandler(async (req, res) => {
    // Must read these before destroy() wipes the session — which identity
    // type (if any) was active decides the branch below.
    const wasKmutt = Boolean(req.session.user);
    const idToken = wasKmutt ? req.session.user.idToken : null;

    req.session.destroy((err) => {
      if (err) {
        console.error('[bpuudemo] session destroy error:', err.message);
      }

      if (wasKmutt) {
        // KMUTT/ADFS session — EXACT existing behavior, unchanged.
        if (oidcMetadata.end_session_endpoint) {
          const logoutUrl = new URL(oidcMetadata.end_session_endpoint);
          logoutUrl.searchParams.set('post_logout_redirect_uri', config.postLogoutRedirectUri);
          if (idToken) {
            logoutUrl.searchParams.set('id_token_hint', idToken);
          }
          res.redirect(logoutUrl.toString());
        } else {
          res.redirect(config.postLogoutRedirectUri || '/');
        }
        return;
      }

      // ThaID (externalUser) session, or no session at all — ThaID has no
      // end-session/logout endpoint in its docs, so there is no external IdP
      // session to terminate; just go back to the landing page.
      res.redirect('/');
    });
  })
);

app.get(
  '/api/me',
  asyncHandler(async (req, res) => {
    noStore(res);
    if (req.session.user) {
      // Dev preview override (see /api/kmutt-dev-preview below): only ever
      // set when this real session's OWN kmuttUserType/kmuttRequesterProfile
      // are null (see that route's 403 gate), so this never masks a real
      // staff/student classification — it only fills the gap when there
      // wasn't one. req.session.user.kmuttUserType/kmuttRequesterProfile
      // themselves are never touched/overwritten by the preview feature;
      // this is purely a response-shaping read here.
      const devPreview = req.session.user.kmuttDevPreview || null;
      res.status(200).json({
        type: 'kmutt',
        claims: req.session.user.claims,
        userType: devPreview
          ? devPreview.userType
          : req.session.user.kmuttUserType || { type: null, displayName: null, department: null, statusName: null },
        requesterProfile: devPreview
          ? devPreview.requesterProfile
          : req.session.user.kmuttRequesterProfile || { type: null, requester: null, approver: null },
        // So the client can always tell a real classification apart from a
        // dev-preview override and label it accordingly (see index.html).
        devPreviewActive: Boolean(devPreview),
        devPreviewEmail: devPreview ? devPreview.previewEmail : null,
      });
    } else if (req.session.externalUser) {
      res.status(200).json({
        type: 'external',
        claims: {
          name: req.session.externalUser.name,
          pid: maskPid(req.session.externalUser.pid),
          verifiedAt: req.session.externalUser.verifiedAt,
        },
      });
    } else {
      res.status(401).json({ error: 'unauthenticated' });
    }
  })
);

// ---------------------------------------------------------------------------
// KMUTT dev preview (developer/test convenience — NOT a general
// "impersonate anyone" feature).
//
// Real ADFS-authenticated KMUTT users whose OWN Master Data classification
// comes back null (kmuttUserType.type === null — e.g. a developer's own test
// account, which has no real Master Data record) have no way to see how
// ส่วนที่ 1 (requester) / ส่วนที่ 2 (approver) auto-fill looks for a real
// staff/student account. This lets such a user type in another real KMUTT
// member's email so the app can preview that auto-fill as if that other
// member were logged in.
//
// Security gating (this is the whole point of the feature):
//   1. 401 if there is no real ADFS session at all — completely unreachable
//      without having actually authenticated via ADFS first.
//   2. 403 if the REAL logged-in session's own kmuttUserType is already
//      'staff' or 'student' — an already-classified real user can never use
//      this to switch to previewing as someone else.
//   3. The real session's own kmuttUserType/kmuttRequesterProfile fields are
//      NEVER overwritten — the preview result lives only in the separate
//      req.session.user.kmuttDevPreview field, so "this session's real
//      identity" (always null/unclassified here) and "what we're previewing
//      as" can never be confused.
//   4. Every use is logged server-side with both the real upn and the
//      previewed email, as an audit trail — this does let one authenticated
//      real person view another real person's name/position/department/
//      phone/approver info.
// ---------------------------------------------------------------------------

const DEV_PREVIEW_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post(
  '/api/kmutt-dev-preview',
  asyncHandler(async (req, res) => {
    noStore(res);

    // Gating rule 1: unreachable without a real prior ADFS login.
    if (!req.session.user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    // Gating rule 2: only usable when the REAL logged-in session's own
    // Master Data classification came back null — never lets an
    // already-classified real staff/student user preview as someone else.
    const realUserType = req.session.user.kmuttUserType && req.session.user.kmuttUserType.type;
    if (realUserType === 'staff' || realUserType === 'student') {
      res.status(403).json({
        error: 'dev preview is only available to accounts with no Master Data classification of their own',
      });
      return;
    }

    const email = req.body ? req.body.email : undefined;
    if (typeof email !== 'string' || !DEV_PREVIEW_EMAIL_RE.test(email.trim())) {
      res.status(400).json({ error: 'a valid email is required' });
      return;
    }
    const previewEmail = email.trim();

    try {
      // Same functions the real ADFS login path uses (see /redirect above) —
      // called here, not duplicated.
      const userType = await lookupKmuttUserType(previewEmail);

      if (userType.type !== 'staff' && userType.type !== 'student') {
        // Unclassified target email — nothing to preview, and nothing is
        // written to the session in this case.
        res.status(200).json({ found: false });
        return;
      }

      const requesterProfile = await lookupKmuttRequesterProfile(previewEmail);

      // Gating rule 3: a new, separate session field — never
      // kmuttUserType/kmuttRequesterProfile themselves.
      req.session.user.kmuttDevPreview = {
        previewEmail,
        userType,
        requesterProfile,
      };

      // Gating rule 4: audit log with both the real logged-in upn and the
      // email being previewed as.
      const realUpn = (req.session.user.claims && req.session.user.claims.upn) || '(unknown upn)';
      console.log(
        `[bpuudemo] KMUTT dev preview used: real upn=${realUpn} now previewing as email=${previewEmail}`
      );

      res.status(200).json({ found: true, userType, requesterProfile });
    } catch (err) {
      console.error(
        `[bpuudemo] KMUTT dev preview lookup failed (non-fatal): ${err && err.message ? err.message : err}`
      );
      res.status(500).json({ error: 'an unexpected error occurred while looking up that account' });
    }
  })
);

// POST, not GET — this mutates session state (clears the dev preview), so it
// must not be triggerable by a bare top-level navigation/link. SameSite=Lax
// still attaches cookies to top-level GET requests, so a state-changing GET
// here would let a crafted link silently clear a victim's preview mid-test.
app.post(
  '/api/kmutt-dev-preview/clear',
  asyncHandler(async (req, res) => {
    noStore(res);

    if (!req.session.user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    delete req.session.user.kmuttDevPreview;
    res.status(200).json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Static assets — an explicit allowlist, NOT express.static(__dirname).
//
// Serving the whole project directory would also serve server.js,
// package.json, node_modules, this repo's other subfolders, and (in a real
// deployment) certs/key.pem — the TLS private key — to any anonymous
// visitor. It would also let path-variant requests (extra slashes,
// percent-encoding, dot-segments) resolve to index.html's bytes through the
// static handler, bypassing the requireLogin gate above entirely. Scoping
// static serving to only the specific files the page actually needs makes
// both of those structurally impossible: there is no route, however
// encoded, that can ever return index.html's content except the explicit
// gated handler above.
// ---------------------------------------------------------------------------

app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.get('/AW_MODlink_pro_vertical.jpg', (req, res) =>
  res.sendFile(path.join(__dirname, 'AW_MODlink_pro_vertical.jpg'))
);
app.get('/AW_MODlink_student_vertical.jpg', (req, res) =>
  res.sendFile(path.join(__dirname, 'AW_MODlink_student_vertical.jpg'))
);

// A general-public ThaID user has no KMUTT account, so an error page's
// default "Try again" link (/login, into the ADFS gate) would be a dead end
// for them — route based on which flow the request was actually in.
function retryHrefFor(req) {
  return req.path && req.path.startsWith('/external') ? '/external' : '/login';
}

// Fallback error handler: never leak stack traces to the client.
app.use((err, req, res, next) => {
  console.error('[bpuudemo] unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).send(
    renderErrorPage({
      title: 'เกิดข้อผิดพลาด',
      message: 'An unexpected error occurred while handling your request. Please try again.',
      retryHref: retryHrefFor(req),
    })
  );
});

// 404 handler
app.use((req, res) => {
  res.status(404).send(
    renderErrorPage({
      title: 'ไม่พบหน้านี้',
      message: 'This page does not exist.',
      retryHref: retryHrefFor(req),
    })
  );
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[bpuudemo] fetching discovery metadata from ${config.discoveryUrl}`);
  oidcMetadata = await loadDiscoveryMetadata();
  console.log(`[bpuudemo] discovery metadata loaded. issuer=${oidcMetadata.issuer}`);

  remoteJwks = createRemoteJWKSet(new URL(oidcMetadata.jwks_uri));

  // ThaID discovery — best-effort, non-fatal (see loadThaidDiscoveryMetadata).
  console.log(
    `[bpuudemo] fetching ThaID discovery metadata from ${config.thaidBaseUrl}/.well-known/openid-configuration`
  );
  thaidMetadata = await loadThaidDiscoveryMetadata();
  if (thaidMetadata) {
    console.log(`[bpuudemo] ThaID discovery metadata loaded. issuer=${thaidMetadata.issuer}`);
    thaidRemoteJwks = createRemoteJWKSet(new URL(thaidMetadata.jwks_uri));
  } else {
    console.warn(
      '[bpuudemo] ThaID metadata unavailable — /external will show a friendly "unavailable" page ' +
        'until this is fixed. The KMUTT/ADFS flow above is unaffected.'
    );
  }

  if (hasTlsCert) {
    const tlsOptions = {
      cert: fs.readFileSync(config.tlsCertPath),
      key: fs.readFileSync(config.tlsKeyPath),
    };
    https.createServer(tlsOptions, app).listen(config.port, () => {
      console.log(`[bpuudemo] listening on https://localhost:${config.port}`);
      console.log(
        '[bpuudemo] using certs/cert.pem + certs/key.pem — if these were generated with plain ' +
          'openssl (not mkcert), the browser will warn the certificate is untrusted; that is expected, ' +
          'proceed past the warning. If generated with `mkcert` after `mkcert -install`, the browser ' +
          'should trust it with no warning.'
      );
    });
  } else {
    console.warn(
      `\n[bpuudemo] No TLS cert found at ${config.tlsCertPath} — falling back to plain HTTP.\n` +
        'ADFS requires an HTTPS redirect_uri (confirmed by KMUTT IT), so a REDIRECT_URI pointing at ' +
        'http://localhost will be rejected. Generate a local cert (e.g. via mkcert) or set TLS_CERT_PATH / ' +
        'TLS_KEY_PATH to use HTTPS.\n'
    );
    app.listen(config.port, () => {
      console.log(`[bpuudemo] listening on http://localhost:${config.port}`);
    });
  }
}

main().catch((err) => {
  console.error('[bpuudemo] fatal startup error:', err.message);
  process.exit(1);
});
