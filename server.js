'use strict';

/**
 * bpuu-workflow server
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
    console.error('\n[bpuu-workflow] Missing required environment variable(s):');
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
  thaidScope: process.env.THAID_SCOPE || 'pid name',

  // KMUTT Master Data (server-to-server client-credentials API) config —
  // used after a successful ADFS login to look up whether the user is staff
  // or a student, so the client can show the right menu items. Deliberately
  // NOT in REQUIRED_ENV_VARS: unlike ADFS, this app must still boot and let
  // KMUTT users log in fine even if Master Data is unconfigured or
  // unreachable — see isMasterDataConfigured() below.
  masterdataBaseUrl: process.env.MASTERDATA_BASE_URL || 'https://master-data.kmutt.ac.th',
  masterdataClientId: process.env.MASTERDATA_CLIENT_ID,
  masterdataClientSecret: process.env.MASTERDATA_CLIENT_SECRET,

  // JotForm API (read-only) config — used ONLY by the /admin page to list
  // request submissions and their workflow status (form field q68). The
  // form data itself lives entirely in JotForm, not here, so without an API
  // key there is no request list to show. Deliberately NOT in
  // REQUIRED_ENV_VARS: the rest of the app (login, the request form, the
  // approval gate) works fine without it; only the admin request list needs
  // it — see isJotformConfigured() below. The form id defaults to the one
  // hardcoded in js/app.js so admins don't have to set it just to try this.
  jotformApiBaseUrl: process.env.JOTFORM_API_BASE_URL || 'https://api.jotform.com',
  jotformApiKey: process.env.JOTFORM_API_KEY,
  jotformFormId: process.env.JOTFORM_FORM_ID || '261200763585052',

  // Admin allowlist seed — the FIRST admin email, used only to create
  // admin-allowlist.json on first boot if that file doesn't exist yet.
  // After that, the file is the source of truth and is edited through the
  // /admin settings zone (or by hand). Changing this env var does NOT
  // retroactively rewrite an existing file. See loadAdminAllowlist() below.
  adminSeedEmail: process.env.ADMIN_SEED_EMAIL || 'chotthanin.neti@kmutt.ac.th',
};

if (!config.sessionSecret) {
  console.warn(
    '[bpuu-workflow] SESSION_SECRET is not set. Generating a random in-memory secret for this run only ' +
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
      `\n[bpuu-workflow] Could not reach ADFS_DISCOVERY_URL (${config.discoveryUrl}).\n` +
        'This app needs network access to the ADFS discovery endpoint — if ADFS is not ' +
        'internet-facing, make sure you are connected to the required VPN or campus network.\n'
    );
    console.error(`[bpuu-workflow] Underlying error: ${err.message}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(
      `\n[bpuu-workflow] ADFS discovery endpoint returned HTTP ${response.status} ${response.statusText}.\n` +
        `URL: ${config.discoveryUrl}\n`
    );
    process.exit(1);
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch (err) {
    console.error('\n[bpuu-workflow] ADFS discovery endpoint did not return valid JSON.\n');
    process.exit(1);
  }

  const required = ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'issuer'];
  const missing = required.filter((key) => !metadata[key]);
  if (missing.length > 0) {
    console.error(
      `\n[bpuu-workflow] ADFS discovery document is missing required field(s): ${missing.join(', ')}\n`
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
      `[bpuu-workflow] Could not reach ThaID discovery endpoint (${discoveryUrl}). ` +
        `ThaID login (/external) will show an "unavailable" page until this is reachable. ` +
        `Underlying error: ${err.message}`
    );
    return null;
  }

  if (!response.ok) {
    console.warn(
      `[bpuu-workflow] ThaID discovery endpoint returned HTTP ${response.status} ${response.statusText}. ` +
        `ThaID login (/external) will show an "unavailable" page. URL: ${discoveryUrl}`
    );
    return null;
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch (err) {
    console.warn('[bpuu-workflow] ThaID discovery endpoint did not return valid JSON. ThaID login (/external) will show an "unavailable" page.');
    return null;
  }

  const required = ['issuer', 'jwks_uri'];
  const missing = required.filter((key) => !metadata[key]);
  if (missing.length > 0) {
    console.warn(
      `[bpuu-workflow] ThaID discovery document is missing required field(s): ${missing.join(', ')}. ` +
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
// /callback behind a friendly error page instead of crashing or
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

// True only when a JotForm API key is present. Gates the /admin request
// list: with no key, /api/admin/requests reports { configured: false } and
// the admin page shows a "not configured" notice instead of an empty table
// that would look like "there are no requests".
function isJotformConfigured() {
  return Boolean(config.jotformApiKey);
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

// ---------------------------------------------------------------------------
// CRITICAL: the Master Data list API matches every query-string filter as a
// SUBSTRING (contains), NOT exact equality. Verified against the live API
// (2026-07-22): internalemail=neti returns EVERY person whose email merely
// contains "neti" (2 different people), employeeid=256 returns every id
// containing "256" (5 people), and KMUTT_EMAIL behaves the same. Taking
// results[0] under pageSize=1 (the previous approach) therefore returned the
// WRONG person whenever the queried value is a substring of another row's
// value — e.g. a user "chai.x@kmutt.ac.th" is a substring of a different
// user "nichai.x@kmutt.ac.th", so the query matched both and pageSize=1
// returned whichever had the lower employeeid. That is the "auth as one
// person, Master Data shows a different person" bug.
//
// Every lookup MUST therefore fetch the candidate substring matches and keep
// only the row whose field EXACTLY equals the queried value (case- and
// whitespace-insensitively for emails). A full email/id almost never
// substring-collides with more than a handful of rows, so a modest page size
// is plenty to contain the exact match.
const MASTERDATA_EXACT_MATCH_PAGE_SIZE = 100;

function normalizeMasterdataValue(value, caseInsensitive) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  return caseInsensitive ? s.toLowerCase() : s;
}

// Fetches DH00xx rows filtered by `field=value` and returns the single row
// whose `field` EXACTLY matches `value` (after normalization), or null if no
// exact match exists among the substring candidates. Throws on HTTP error
// (callers wrap in try/catch, matching the existing all-or-nothing pattern).
async function masterdataFindExact(token, table, field, value, { caseInsensitive = false } = {}) {
  const want = normalizeMasterdataValue(value, caseInsensitive);
  if (!want) return null;

  const url = new URL(`${config.masterdataBaseUrl}/backend/api/data/${table}`);
  url.searchParams.set(field, value);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', String(MASTERDATA_EXACT_MATCH_PAGE_SIZE));

  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(MASTERDATA_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Master Data ${table} lookup (${field}) returned HTTP ${response.status}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) return null;

  return rows.find((row) => normalizeMasterdataValue(row[field], caseInsensitive) === want) || null;
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

    // Exact-match on internalemail — the API filter is substring-based, so
    // fetching + filtering to the exact email is required (see
    // masterdataFindExact above). Emails compared case-insensitively.
    const staff = await masterdataFindExact(token, 'DH0002_HR_EmployeeProfile', 'internalemail', email, {
      caseInsensitive: true,
    });

    if (staff) {
      return {
        type: 'staff',
        displayName: buildMasterDataDisplayName(
          `${staff.titleshortth2 || ''}${staff.firstnameth || ''}`,
          staff.lastnameth,
          staff.firstnameen,
          staff.lastnameen
        ),
        department: staff.departmentlevelth2 || null,
        statusName: staff.statusnameth || null,
      };
    }

    const student = await masterdataFindExact(token, 'DH0001_STD_MemberProfile', 'KMUTT_EMAIL', email, {
      caseInsensitive: true,
    });

    if (student) {
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
    console.warn(`[bpuu-workflow] Master Data lookup failed for user (non-fatal, falling back to no classification): ${err.message}`);
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
async function resolveKmuttApprover(departmentCode, requesterEmployeeId) {
  if (!departmentCode) return null;

  const token = await getMasterDataToken();

  // Exact-match on DEPARTMENTCODE — the API filter is substring-based, so a
  // department code that is a substring of another code would otherwise pick
  // the wrong org row (and thus the wrong approver). See masterdataFindExact.
  const org = await masterdataFindExact(token, 'DH0003_HR_ORG_Structure', 'DEPARTMENTCODE', departmentCode);
  if (!org) {
    return null;
  }

  // Walk from the most immediate management level (2) up to the most senior
  // (6), picking the first level that both has a named position AND is held
  // by someone other than the requester themselves. A department head who is
  // also its own requester cannot be their own approver — skip that level
  // (one hop up to the next, larger org unit) and keep looking, rather than
  // stopping at the first non-empty level regardless of who holds it.
  let matchedLevel = null;
  for (const level of [2, 3, 4, 5, 6]) {
    const levelName = org[`ADMINPOS0${level}_NAME`];
    const levelEmp = org[`ADMINPOS0${level}_EMP`];
    if (typeof levelName !== 'string' || !levelName.trim() || !levelEmp) {
      continue;
    }
    if (requesterEmployeeId && String(levelEmp).trim() === String(requesterEmployeeId).trim()) {
      continue;
    }
    matchedLevel = level;
    break;
  }

  if (matchedLevel === null) {
    return null;
  }

  const positionTitle = org[`ADMINPOS0${matchedLevel}_NAME`];
  const empId = org[`ADMINPOS0${matchedLevel}_EMP`];

  // Exact-match on employeeid (substring-filter API — a shorter id that is a
  // substring of a longer one would otherwise resolve to the wrong person).
  const emp = await masterdataFindExact(token, 'DH0002_HR_EmployeeProfile', 'employeeid', empId);
  if (!emp) {
    return null;
  }

  const resolvedName = buildMasterDataDisplayName(
    `${emp.titleshortth2 || ''}${emp.firstnameth || ''}`,
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

    // Exact-match on internalemail (substring-filter API — see
    // masterdataFindExact). This is the lookup that previously returned a
    // different person's profile than the one who logged in.
    const staff = await masterdataFindExact(token, 'DH0002_HR_EmployeeProfile', 'internalemail', email, {
      caseInsensitive: true,
    });

    if (staff) {
      const name = buildMasterDataDisplayName(
        `${staff.titleshortth2 || ''}${staff.firstnameth || ''}`,
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

      // Pass the requester's own employeeid so a department head who would
      // otherwise be resolved as their own approver gets escalated one hop
      // up to the next (larger) org unit instead (see resolveKmuttApprover).
      const approver = await resolveKmuttApprover(staff.departmentcode, staff.employeeid);

      return { type: 'staff', requester, approver };
    }

    const student = await masterdataFindExact(token, 'DH0001_STD_MemberProfile', 'KMUTT_EMAIL', email, {
      caseInsensitive: true,
    });

    if (student) {
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
      `[bpuu-workflow] Master Data requester profile lookup failed for user (non-fatal, falling back to no profile): ${err.message}`
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
function renderLoginLandingPage({ expired = false } = {}) {
  const expiredNotice = expired
    ? `<div class="alert alert-warning py-2 mb-3" role="alert" style="font-size:.95rem;">
      <i class="bi bi-clock-history me-1"></i>เซสชันหมดอายุ (ครบ 60 นาที) กรุณาเข้าสู่ระบบใหม่
    </div>`
    : '';
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
    ${expiredNotice}
    <div class="login-icon"><i class="bi bi-building"></i></div>
    <h4 class="fw-bold text-ci-orange mb-2">ระบบกระบวนงาน (Workflow)</h4>
    <p class="text-ci-bluegrey mb-4">
      การให้บริการของ<br>กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน<br>
      กรุณาเลือกประเภทผู้ใช้งานเพื่อเริ่มยื่นคำขอ
    </p>
    <a href="/login" class="btn btn-ci-orange btn-lg w-100 fw-bold mb-2">
      <i class="bi bi-box-arrow-in-right me-2"></i>Login with KMUTT Account<br>(บุคลากร / นักศึกษา)
    </a>
    <a href="/external" class="btn btn-ci-bluegrey btn-lg w-100 fw-bold">
      <i class="bi bi-people-fill me-2"></i>Login with ThaiD<br>(เฉพาะบุคคลภายนอกเท่านั้น)
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

// Absolute session lifetime: 60 minutes from login, regardless of activity.
// This is an ABSOLUTE cap, not an idle timeout — a user is logged out 60
// minutes after they authenticate even if they were active the whole time.
// Enforced in two layers: (1) the cookie's maxAge below, so the browser stops
// sending the cookie after 60 min (and `rolling` is left at its default false
// so this window is NOT extended on each request); (2) a server-side
// `absoluteExpiry` timestamp stamped on the session at login and checked in
// requireLogin/requireAnyLogin, so an expired session is rejected even if a
// client ignores the cookie expiry.
const SESSION_MAX_AGE_MS = 60 * 60 * 1000;

app.use(
  session({
    name: 'bpuu_workflow_sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: hasTlsCert, // cookie is only sent over HTTPS once we're actually serving HTTPS
      maxAge: SESSION_MAX_AGE_MS,
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

// Enforce the absolute 60-minute session cap (see SESSION_MAX_AGE_MS). If the
// session is past its absoluteExpiry, drop the authenticated identity so the
// caller is treated as logged out — the gates below then render the login
// page. Returns true if it just expired the session (so the caller can show
// the "session expired" notice). A session with no absoluteExpiry (shouldn't
// happen for a real login, but be safe) is never treated as expired here.
function expireSessionIfNeeded(req) {
  const exp = req.session.absoluteExpiry;
  if (typeof exp === 'number' && Date.now() >= exp && (req.session.user || req.session.externalUser)) {
    delete req.session.user;
    delete req.session.externalUser;
    delete req.session.absoluteExpiry;
    return true;
  }
  return false;
}

function requireLogin(req, res, next) {
  const justExpired = expireSessionIfNeeded(req);
  if (!req.session.user) {
    // Stash the originally-requested path now, before showing the landing
    // page, so clicking through to /login still returns here afterward.
    req.session.redirectAfterLogin = req.originalUrl;
    noStore(res);
    res.status(200).send(renderLoginLandingPage({ expired: justExpired }));
    return;
  }
  next();
}

// Like requireLogin, but accepts EITHER identity (KMUTT/ADFS or ThaID) —
// used by /approve-gate. Unlike '/', which is deliberately KMUTT-only,
// approving here just needs *some* identified login for the audit trail;
// the university's requirement was "must authenticate before approving,"
// not "must be KMUTT staff" — ThaID still ties the click to a real person.
function requireAnyLogin(req, res, next) {
  const justExpired = expireSessionIfNeeded(req);
  if (!req.session.user && !req.session.externalUser) {
    // Two separate stash keys, not one shared one — see the bug this fixes:
    // requireLogin ('/','/admin', ADFS-only) also stashes into
    // redirectAfterLogin, which the ADFS '/redirect' callback reads. If the
    // ThaID '/callback' read that SAME key, a plain visit to '/' earlier in
    // the session (which always stashes redirectAfterLogin='/') would leak
    // into a later, unrelated ThaID login and send the user to '/' —  a
    // route only an ADFS session can ever satisfy — instead of '/external'.
    // The user would land back on the login page with no obvious error, and
    // only a second click (now that externalUser is already set) would
    // reach the menu. Keeping ThaID's own stash in a distinct key makes
    // that leak structurally impossible while still letting a deliberate
    // deep link like /approve-gate correctly return here after EITHER
    // identity provider.
    req.session.redirectAfterLogin = req.originalUrl;
    req.session.thaidRedirectAfterLogin = req.originalUrl;
    noStore(res);
    res.status(200).send(renderLoginLandingPage({ expired: justExpired }));
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Admin allowlist — which KMUTT emails may see the /admin page.
//
// Persisted to admin-allowlist.json (project root) so it survives restarts
// and can be edited both through the /admin settings zone and by hand. The
// file is the source of truth; config.adminSeedEmail only seeds it on first
// boot when the file doesn't exist yet. Emails are always compared/stored
// normalized (trimmed + lowercased) so "Chotthanin.Neti@KMUTT.ac.th" and
// "chotthanin.neti@kmutt.ac.th" are the same admin.
//
// Deliberately ADFS-only (see requireAdmin): the allowlist keys on KMUTT
// email, and ThaID identities have no @kmutt.ac.th email to match — an
// external ThaID user can never be an admin, which is the intended policy.
// ---------------------------------------------------------------------------

// Defaults to /app/data/admin-allowlist.json inside the shipped Docker image
// (see Dockerfile — /app/data is created and chowned to the non-root "node"
// user specifically so this is writable; /app itself is root-owned there and
// is NOT writable by the process). Override via ADMIN_ALLOWLIST_PATH if the
// deployment mounts a volume somewhere else. Mount /app/data as a volume for
// the allowlist to survive container restarts/redeploys — otherwise it
// reverts to just the seed admin every time, same as an in-memory list.
const ADMIN_ALLOWLIST_PATH =
  process.env.ADMIN_ALLOWLIST_PATH || path.join(__dirname, 'data', 'admin-allowlist.json');

function normalizeEmail(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase();
}

// Two roles, in descending privilege. 'admin' sees every panel on /admin,
// including the permission-management one; 'staff' sees everything EXCEPT
// permission management (they can work the request list and locations but
// cannot grant/revoke access). Anything not in this set is rejected.
const ADMIN_ROLES = ['admin', 'staff'];
const DEFAULT_ROLE = 'staff';

function normalizeRole(value) {
  const r = String(value == null ? '' : value).trim().toLowerCase();
  return ADMIN_ROLES.includes(r) ? r : null;
}

// In-memory cache of the normalized allowlist ([{ email, role }]), loaded
// once at first use and kept in sync on every save. null until first load.
let adminAllowlistCache = null;

// Accepts both the current shape ([{email, role}]) and the LEGACY shape
// (a plain array of email strings, before roles existed). Legacy entries are
// migrated to role 'admin' — the people already on the list had full access,
// so silently demoting them to 'staff' would revoke permission management
// from everyone, potentially locking the last admin out of the role UI.
function parseAllowlistEntries(parsed) {
  if (!Array.isArray(parsed)) return null;
  const out = [];
  for (const item of parsed) {
    if (typeof item === 'string') {
      const email = normalizeEmail(item);
      if (email) out.push({ email, role: 'admin' });
      continue;
    }
    if (item && typeof item === 'object') {
      const email = normalizeEmail(item.email);
      if (email) out.push({ email, role: normalizeRole(item.role) || DEFAULT_ROLE });
    }
  }
  // De-duplicate by email, first occurrence wins.
  const seen = new Set();
  return out.filter((e) => (seen.has(e.email) ? false : (seen.add(e.email), true)));
}

function loadAdminAllowlist() {
  if (adminAllowlistCache) return adminAllowlistCache;

  let list = null;
  try {
    const raw = fs.readFileSync(ADMIN_ALLOWLIST_PATH, 'utf8');
    list = parseAllowlistEntries(JSON.parse(raw));
    if (!list) {
      console.warn('[bpuu-workflow] admin-allowlist.json is not a JSON array — ignoring and reseeding');
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // A malformed/unreadable file must NOT silently grant nobody OR
      // everybody — log loudly and fall through to the seed so there is
      // always at least the seed admin who can fix it via the UI.
      console.error(`[bpuu-workflow] could not read admin-allowlist.json (${err.message}) — reseeding`);
    }
  }

  if (!list || list.length === 0) {
    const seed = normalizeEmail(config.adminSeedEmail);
    list = seed ? [{ email: seed, role: 'admin' }] : [];
    // Best-effort seed write; if the disk is read-only the app still works
    // in-memory for this run, it just won't persist across a restart.
    try {
      fs.mkdirSync(path.dirname(ADMIN_ALLOWLIST_PATH), { recursive: true });
      fs.writeFileSync(ADMIN_ALLOWLIST_PATH, JSON.stringify(list, null, 2) + '\n', 'utf8');
      console.log(`[bpuu-workflow] seeded admin-allowlist.json with ${list.length} admin(s)`);
    } catch (err) {
      console.error(`[bpuu-workflow] could not write admin-allowlist.json seed (${err.message})`);
    }
  }

  adminAllowlistCache = list;
  return adminAllowlistCache;
}

// Throws on write failure (e.g. read-only filesystem, missing permissions)
// — callers (the POST /api/admin/allowlist route) must catch this and
// respond with a clear error rather than letting it hit the generic error
// middleware, which historically returned an HTML page instead of JSON to
// this route's fetch()-based client code.
function saveAdminAllowlist(entries) {
  const seen = new Set();
  const normalized = [];
  for (const e of entries) {
    const email = normalizeEmail(e && e.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    normalized.push({ email, role: normalizeRole(e && e.role) || DEFAULT_ROLE });
  }
  fs.mkdirSync(path.dirname(ADMIN_ALLOWLIST_PATH), { recursive: true });
  fs.writeFileSync(ADMIN_ALLOWLIST_PATH, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  adminAllowlistCache = normalized;
  return normalized;
}

function countAdmins(entries) {
  return entries.filter((e) => e.role === 'admin').length;
}

// The KMUTT email of the currently logged-in ADFS user, normalized. ThaID
// sessions (externalUser) have no upn/email and return '' — so they never
// match the allowlist. upn is the KMUTT email in this deployment (it's what
// the Master Data lookups use as internalemail/KMUTT_EMAIL); email/
// preferred_username are checked only as fallbacks for robustness.
function getSessionAdminEmail(req) {
  const claims = req.session.user && req.session.user.claims;
  if (!claims) return '';
  return normalizeEmail(claims.upn || claims.email || claims.preferred_username || '');
}

// 'admin' | 'staff' | null (null = not on the allowlist at all).
function getSessionRole(req) {
  const email = getSessionAdminEmail(req);
  if (!email) return null;
  const entry = loadAdminAllowlist().find((e) => e.email === email);
  return entry ? entry.role : null;
}

// A calm, non-alarming "you don't have access yet" page — deliberately NOT
// the red renderErrorPage: being un-allowlisted is a normal state for most
// KMUTT staff who happen to open /admin, not a system fault. Shows the
// signed-in address so the user can quote it when asking for access.
function renderNoAccessPage(email) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ยังไม่มีสิทธิ์เข้าถึง — ระบบกระบวนงาน BPUU</title>
  <style>
    body { font-family: "Sarabun", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f2f4f7; color: #1f2933; margin: 0; padding: 56px 16px; line-height: 1.7; }
    .card { max-width: 520px; margin: 0 auto; background: #fff; border: 1px solid #e3e6ea;
      border-radius: 14px; padding: 32px 30px; text-align: center; }
    .icon { width: 62px; height: 62px; line-height: 62px; margin: 0 auto 16px; border-radius: 50%;
      background: #fff4e5; color: #b26a00; font-size: 1.8rem; }
    h1 { font-size: 1.25rem; margin: 0 0 10px; font-weight: 800; }
    p { margin: 8px 0; color: #55606d; }
    .who { display: inline-block; margin-top: 6px; background: #f6f8fa; border: 1px solid #e3e6ea;
      border-radius: 999px; padding: 6px 16px; font-size: .92rem; color: #1f2933; }
    .actions { margin-top: 24px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    a.btn { display: inline-block; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; font-size: .95rem; }
    a.primary { background: #FA4616; color: #fff; }
    a.ghost { background: #fff; color: #55606d; border: 1px solid #dde1e7; }
    .hint { margin-top: 22px; font-size: .88rem; color: #7a828d; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>ยังไม่มีสิทธิ์เข้าถึงหน้าผู้ดูแลระบบ</h1>
    <p>บัญชีนี้ยังไม่อยู่ในรายชื่อผู้มีสิทธิ์เข้าใช้งานหน้าผู้ดูแลระบบ</p>
    <div class="who">เข้าสู่ระบบเป็น: ${escapeHtml(email || '-')}</div>
    <div class="actions">
      <a class="btn primary" href="/">กลับหน้าหลัก</a>
      <a class="btn ghost" href="mailto:bpuu@kmutt.ac.th?subject=${encodeURIComponent('ขอสิทธิ์เข้าใช้งานหน้าผู้ดูแลระบบ BPUU')}">ขอสิทธิ์เข้าใช้งาน</a>
    </div>
    <div class="hint">หากต้องการสิทธิ์ กรุณาแจ้งผู้ดูแลระบบเพื่อเพิ่มอีเมลข้างต้นในรายชื่อที่อนุญาต</div>
  </div>
</body>
</html>`;
}

// Gate for /admin and its APIs — ANY allowlisted role (admin or staff) may
// reach the page. Assumes requireLogin ran first (so there IS a KMUTT
// session); this only adds the allowlist check on top.
//
// Content-negotiated: the JSON APIs under /api/ get a JSON 403 (their
// fetch()-based callers parse the body), while a browser hitting /admin gets
// the friendly notice page above instead of a red error screen.
function requireAdmin(req, res, next) {
  if (!getSessionRole(req)) {
    noStore(res);
    const wantsJson =
      req.path.startsWith('/api/') || String(req.get('accept') || '').includes('application/json');
    if (wantsJson) {
      res.status(403).json({ error: 'บัญชีของท่านยังไม่มีสิทธิ์เข้าถึงหน้าผู้ดูแลระบบ' });
    } else {
      res.status(403).send(renderNoAccessPage(getSessionAdminEmail(req)));
    }
    return;
  }
  next();
}

// Stricter gate: only role 'admin'. Guards permission management — a 'staff'
// user must never be able to grant themselves (or anyone) access, so this is
// enforced SERVER-SIDE here, not merely by hiding the panel in the UI.
// Responds JSON (not an HTML error page) because every route behind it is a
// fetch()-based JSON API.
function requireRoleAdmin(req, res, next) {
  if (getSessionRole(req) !== 'admin') {
    noStore(res);
    res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่จัดการสิทธิ์ได้' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Location manager storage — the list of places the workflow can reference
// (e.g. อาคารจอดรถ S2, โรงอาหาร S14). Same file-backed pattern, same
// data/ directory (writable in the Docker image), same override-by-env
// escape hatch as the allowlist above.
// ---------------------------------------------------------------------------

const LOCATIONS_PATH = process.env.LOCATIONS_PATH || path.join(__dirname, 'data', 'locations.json');

let locationsCache = null;

// Field set mirrors the "Area Master (Company)" master sheet:
// CampusCode/CampusName, BuildingCode/BuildingName, BusinessTypeCode/
// BusinessTypeName, CompanyCode/CompanyName, plus two area-manager
// contacts (name + email each). companyName is the required key — every row
// in the master sheet has one, while buildingName can legitimately be blank
// (e.g. the KX city campus rows).
const LOCATION_TEXT_FIELDS = [
  'campusCode',
  'campusName',
  'buildingCode',
  'buildingName',
  'businessTypeCode',
  'businessTypeName',
  'companyCode',
  'companyName',
  'manager1Name',
  'manager1Email',
  'manager2Name',
  'manager2Email',
];

// Fields that must look like an email if present at all — same discipline
// already applied to admin allowlist entries via looksLikeEmail(). Invalid
// values are dropped (field cleared), not rejected outright, since these are
// optional contact fields on an otherwise-valid location; that keeps this
// forgiving for hand-edited/imported data while still stopping a bad or
// garbage value from being persisted as if it were a real, usable address.
const LOCATION_EMAIL_FIELDS = ['manager1Email', 'manager2Email'];

function normalizeLocation(item) {
  if (!item || typeof item !== 'object') return null;
  const out = { id: String(item.id == null ? '' : item.id).trim() || null };
  for (const f of LOCATION_TEXT_FIELDS) {
    out[f] = String(item[f] == null ? '' : item[f]).trim();
  }
  for (const f of LOCATION_EMAIL_FIELDS) {
    if (out[f] && !looksLikeEmail(out[f])) out[f] = '';
  }
  if (!out.companyName) return null;
  return out;
}

function loadLocations() {
  if (locationsCache) return locationsCache;
  let list = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf8'));
    if (Array.isArray(parsed)) list = parsed.map(normalizeLocation).filter(Boolean);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[bpuu-workflow] could not read locations.json (${err.message}) — starting empty`);
    }
  }
  // Backfill ids for any hand-edited entry that omitted one.
  let maxId = 0;
  for (const l of list) {
    const n = Number(l.id);
    if (Number.isFinite(n) && n > maxId) maxId = n;
  }
  for (const l of list) {
    if (!l.id) l.id = String(++maxId);
  }
  locationsCache = list;
  return locationsCache;
}

function saveLocations(list) {
  const normalized = list.map(normalizeLocation).filter(Boolean);
  fs.mkdirSync(path.dirname(LOCATIONS_PATH), { recursive: true });
  fs.writeFileSync(LOCATIONS_PATH, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  locationsCache = normalized;
  return normalized;
}

function nextLocationId(list) {
  let max = 0;
  for (const l of list) {
    const n = Number(l.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
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

      console.log('[bpuu-workflow] redirecting to ThaID authorization endpoint');
      res.redirect(authUrl.toString());
      return;
    }

    noStore(res);
    res.sendFile(INDEX_HTML_PATH);
  })
);

// ThaID callback — matches THAID_REDIRECT_URI's path
// (https://bpuu-service.kmutt.ac.th/callback), deliberately a clean,
// top-level path separate from ADFS's '/redirect'. The authorization code
// ThaID issues is valid for only 30 seconds and is single-use, so this
// handler exchanges it for a token immediately; no other slow work happens
// before that POST.
app.get(
  '/callback',
  asyncHandler(async (req, res) => {
    console.log('[bpuu-workflow] ThaID callback received');

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
      console.error(`[bpuu-workflow] ThaID returned an error: ${errorCode} ${errorDescription}`);
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
      console.error('[bpuu-workflow] ThaID token endpoint request failed:', err.message);
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
      console.error('[bpuu-workflow] ThaID token endpoint returned invalid JSON');
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
      console.error(`[bpuu-workflow] ThaID token exchange failed: ${errorCode} ${errorDescription}`);
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: `ThaID returned "${errorCode}"${errorDescription ? ': ' + errorDescription : ''}`,
          retryHref: '/external',
        })
      );
      return;
    }

    console.log('[bpuu-workflow] ThaID token exchange ok');

    // Branch on whether the token response included an id_token. The
    // registered scope for this client is exactly "pid name" — no openid —
    // so per DOPA's ThaID API docs, the NORMAL/expected response here has NO
    // id_token: the requested fields are returned directly as plain
    // top-level JSON fields on the token response instead. The id_token
    // branch below is kept for robustness in case the scope is ever widened
    // to include openid in the future.
    let pid;
    let name;

    if (tokenBody.id_token) {
      // Scope included openid — standard OIDC id_token flow, unchanged.
      let payload;
      try {
        const verifyResult = await jwtVerify(tokenBody.id_token, thaidRemoteJwks, {
          issuer: thaidMetadata.issuer,
          audience: config.thaidClientId,
        });
        payload = verifyResult.payload;
      } catch (err) {
        console.error('[bpuu-workflow] ThaID id_token validation failed:', err.message);
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
        console.error('[bpuu-workflow] ThaID id_token nonce mismatch');
        res.status(400).send(
          renderErrorPage({
            title: 'เข้าสู่ระบบไม่สำเร็จ',
            message: "we couldn't verify your login, please try again.",
            retryHref: '/external',
          })
        );
        return;
      }

      pid = payload.pid;
      name = payload.name;
    } else {
      // No id_token — the expected shape for the registered "pid name" scope.
      // There is no signature to verify and, per this response shape's own
      // documented fields, no nonce claim available to check — that's an
      // inherent property of not requesting the openid scope, not a
      // shortcut being taken here.
      if (!tokenBody.pid && !tokenBody.name) {
        console.error('[bpuu-workflow] ThaID token response did not include the expected pid/name fields');
        res.status(502).send(
          renderErrorPage({
            title: 'เข้าสู่ระบบไม่สำเร็จ',
            message: 'The token response did not include the expected pid/name fields. Please try again.',
            retryHref: '/external',
          })
        );
        return;
      }

      pid = tokenBody.pid;
      name = tokenBody.name;
    }

    console.log('[bpuu-workflow] ThaID verification ok');

    // Read BEFORE regenerate() below, same reason as the ADFS callback
    // above: regenerate() replaces req.session with a fresh, empty object,
    // so anything stashed pre-regenerate (e.g. by requireAnyLogin when
    // /approve-gate sent the user through here) would otherwise be lost,
    // and this route would always land back on the hardcoded '/external'.
    //
    // Deliberately its OWN key (thaidRedirectAfterLogin), NOT the shared
    // redirectAfterLogin that requireLogin ('/', '/admin' — ADFS-only) also
    // writes to. Reading the shared key here was the actual bug: visiting
    // '/' while logged out always stashes redirectAfterLogin='/' (via
    // requireLogin), and nothing clears that when the user then goes to
    // /external instead — so a successful ThaID login would redirect back
    // to '/', a route only an ADFS session can ever satisfy, stranding the
    // user on the login page with no visible error. A second click (now
    // that externalUser is already set) would then reach the menu, which is
    // exactly the reported symptom. requireAnyLogin (/approve-gate) sets
    // both keys, so that deep-link case still works correctly for either
    // identity provider.
    const stashedRedirect = req.session.thaidRedirectAfterLogin;

    // Regenerate the session ID on successful login so a session ID observed
    // or fixed before authentication cannot be reused as an authenticated
    // session afterward (session fixation) — same pattern as the ADFS
    // callback above.
    req.session.regenerate((err) => {
      if (err) {
        console.error('[bpuu-workflow] session regenerate error:', err.message);
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
        pid,
        name,
        verifiedAt: new Date().toISOString(),
      };
      // Absolute 60-minute session cap — see SESSION_MAX_AGE_MS.
      req.session.absoluteExpiry = Date.now() + SESSION_MAX_AGE_MS;

      delete req.session.thaid_state;
      delete req.session.thaid_nonce;

      // Default stays '/external' — its own handler serves index.html once
      // externalUser is set, exactly as before — unless a gate elsewhere
      // (e.g. requireAnyLogin on /approve-gate) stashed a specific path to
      // return to instead.
      let redirectTo = '/external';
      if (
        typeof stashedRedirect === 'string' &&
        stashedRedirect.startsWith('/') &&
        !stashedRedirect.startsWith('//')
      ) {
        redirectTo = stashedRedirect;
      }

      console.log('[bpuu-workflow] ThaID login successful');
      res.redirect(redirectTo);
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

    console.log('[bpuu-workflow] redirecting to ADFS authorization endpoint');
    res.redirect(authUrl.toString());
  })
);

app.get(
  '/redirect',
  asyncHandler(async (req, res) => {
    console.log('[bpuu-workflow] callback received');

    if (req.query.error) {
      const errorCode = String(req.query.error);
      const errorDescription = req.query.error_description ? String(req.query.error_description) : '';
      console.error(`[bpuu-workflow] ADFS returned an error: ${errorCode} ${errorDescription}`);
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
      console.error('[bpuu-workflow] token endpoint request failed:', err.message);
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
      console.error('[bpuu-workflow] token endpoint returned invalid JSON');
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
      console.error(`[bpuu-workflow] token exchange failed: ${errorCode} ${errorDescription}`);
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: `ADFS returned "${errorCode}"${errorDescription ? ': ' + errorDescription : ''}`,
        })
      );
      return;
    }

    if (!tokenBody.id_token) {
      console.error('[bpuu-workflow] token response did not include an id_token');
      res.status(502).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: 'The token response did not include an ID token. Please try again.',
        })
      );
      return;
    }

    console.log('[bpuu-workflow] token exchange ok');

    let payload;
    try {
      const verifyResult = await jwtVerify(tokenBody.id_token, remoteJwks, {
        issuer: oidcMetadata.issuer,
        audience: config.clientId,
      });
      payload = verifyResult.payload;
    } catch (err) {
      console.error('[bpuu-workflow] id_token validation failed:', err.message);
      res.status(400).send(
        renderErrorPage({
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          message: "we couldn't verify your login, please try again.",
        })
      );
      return;
    }

    if (!payload.nonce || payload.nonce !== nonce) {
      console.error('[bpuu-workflow] nonce mismatch on id_token');
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

    // Read BEFORE regenerate() below — regenerate() replaces the session
    // store entry with a brand new, empty session object, so anything
    // stashed on the pre-regenerate req.session (like this) is gone by the
    // time the callback runs. Previously read after regenerate(), which
    // silently discarded it every time and fell back to '/' — invisible
    // as long as requireLogin only ever gated '/' and '/index.html'
    // (stashing '/' and falling back to '/' look identical), but broke any
    // deep link through requireLogin, e.g. /approve-gate.
    const stashedRedirect = req.session.redirectAfterLogin;

    // Regenerate the session ID on successful login so a session ID observed
    // or fixed before authentication cannot be reused as an authenticated
    // session afterward (session fixation).
    req.session.regenerate((err) => {
      if (err) {
        console.error('[bpuu-workflow] session regenerate error:', err.message);
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
      // Absolute 60-minute session cap — see SESSION_MAX_AGE_MS.
      req.session.absoluteExpiry = Date.now() + SESSION_MAX_AGE_MS;

      let redirectTo = '/';
      if (
        typeof stashedRedirect === 'string' &&
        stashedRedirect.startsWith('/') &&
        !stashedRedirect.startsWith('//')
      ) {
        redirectTo = stashedRedirect;
      }

      console.log(`[bpuu-workflow] login successful for sub=${payload.sub}`);
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
        console.error('[bpuu-workflow] session destroy error:', err.message);
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
    // Honor the absolute 60-minute cap here too (defense in depth), so a
    // client that ignores the cookie's maxAge can't keep reading identity.
    expireSessionIfNeeded(req);
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
// Approval gate — sits in front of JotForm's own approve/deny action links.
//
// Workflow emails used to link straight to {approvalDeeplink}?outcomeID=N,
// which JotForm completes with no login at all. The university's concern:
// anyone who gets hold of that email (forwarded, shared inbox, left open on
// a screen) can approve/deny on the real approver's behalf with zero
// authentication. Emails now link here first instead; this route forces an
// ADFS login, then forwards the browser on to the exact same JotForm link.
//
// Deliberately does NOT check that the logged-in identity matches the
// request's intended approver — staff sometimes delegate this to a
// secretary, and blocking that would break real workflows. The point isn't
// "only the approver may click" — JotForm's own deeplink already restricts
// who receives it — it's "whoever clicks must be a real, identified KMUTT
// login," so there is always an audit trail of who actually made the call.
// ---------------------------------------------------------------------------

// Only ever forward to JotForm's own domain. `target` is attacker-influenced
// input (it's echoed out of a query string an attacker could edit before
// clicking) — without this allowlist, this route would be an open redirect.
const JOTFORM_APPROVAL_TARGET_HOSTS = new Set(['www.jotform.com', 'submit.jotform.com', 'jotform.com']);

function isAllowedApprovalTarget(rawTarget) {
  try {
    const parsed = new URL(rawTarget);
    return parsed.protocol === 'https:' && JOTFORM_APPROVAL_TARGET_HOSTS.has(parsed.hostname);
  } catch (err) {
    return false;
  }
}

// JotForm's {approvalDeeplink} merge value is itself a full URL with its own
// query string (e.g. ".../deeplink?deeplink=...&redirect=...") — confirmed
// from a real workflow email — not the bare path the initial design assumed.
// req.query.target (Express's parsed query string) would silently truncate
// at that embedded '&', turning "&redirect=..." into an unrelated top-level
// req.query.redirect and leaving target missing its second half plus the
// "?outcomeID=N" suffix entirely. There is no JotForm merge-tag filter to
// percent-encode the value before it lands in the href, so this reads the
// tail of the raw request URL directly instead of trusting the query parser
// — target must stay the LAST parameter in the link for this to work.
function extractRawTarget(originalUrl) {
  const match = originalUrl.match(/[?&]target=(.*)$/);
  return match ? match[1] : '';
}

function outcomeToLabel(outcome) {
  return outcome === 'reject' ? 'ไม่อนุมัติ' : outcome === 'accept' ? 'อนุมัติ' : String(outcome || '-');
}

// requireAnyLogin accepts either identity — this builds the audit-trail
// label from whichever one is actually present. ThaID has no upn, only a
// national ID (pid); log it masked, same discipline as /api/me.
function resolveApprovalIdentityLabel(req) {
  if (req.session.user) {
    return (req.session.user.claims && req.session.user.claims.upn) || '(unknown upn)';
  }
  if (req.session.externalUser) {
    return `thaid:${maskPid(req.session.externalUser.pid)}`;
  }
  return '(unknown identity)';
}

// Confirmation screen shown after login, before forwarding to JotForm. Also
// protects against a real-world gotcha: corporate mail security scanners
// auto-crawl links in incoming email, which would silently auto-approve
// requests if the gate redirected immediately instead of requiring a click.
//
// HOW THE APPROVAL IS COMPLETED — settled by real end-to-end testing:
//   1. Server-side fetch() of the deeplink (2026-07-22): DOES NOT WORK.
//      Reported HTTP 200 while the workflow never advanced. Node's fetch has
//      no browser context (cookies across the redirect chain, JS).
//   2. Hidden iframe (2026-07-23): WORKS — confirmed end-to-end by the user.
//      JotForm sets no X-Frame-Options/CSP and no frame-busting, and the
//      approval really does land. This is what we use, because it keeps the
//      approver on our own domain and never exposes a JotForm URL.
//
// CAUTION about verifying it: q68 (สถานะดำเนินการ) is NOT updated by the
// approval step itself — on a real approved request it stayed "รอพิจารณา"
// with updated_at unchanged. The workflow only writes q68 at a later node.
// An earlier version treated "q68 unchanged" as failure and wrongly told
// approvers their approval had not gone through. So q68 may only ever be
// used as a *bonus* confirmation when it happens to change — never as
// evidence of failure.
//
// Reads ONE submission's current สถานะดำเนินการ (q68) straight from JotForm.
// Returns null when JotForm isn't configured or the submission can't be read.
async function fetchJotformSubmissionStatus(submissionId) {
  if (!isJotformConfigured() || !submissionId) return null;

  const url = new URL(`${config.jotformApiBaseUrl}/submission/${encodeURIComponent(submissionId)}`);
  url.searchParams.set('apiKey', config.jotformApiKey);

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(JOTFORM_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`JotForm submission lookup returned HTTP ${response.status}`);
  }

  const body = await response.json();
  const answers = (body.content && body.content.answers) || {};
  return jotformAnswer(answers, '68');
}

function renderApprovalConfirmPage({ id, outcomeLabel, target, upn, beforeStatus }) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ยืนยันการพิจารณาคำขอ — ระบบกระบวนงาน BPUU</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Sarabun", Roboto, Helvetica, Arial, sans-serif;
      background: #f2f4f7; color: #1f2430; margin: 0; padding: 48px 16px; line-height: 1.6; }
    .card { max-width: 480px; margin: 0 auto; background: #fff; border: 1px solid #dde1e7; border-radius: 10px; padding: 28px; text-align: center; }
    h1 { font-size: 1.2rem; margin: 0 0 12px; }
    p { margin: 8px 0; color: #444; }
    .meta { font-size: 0.9rem; color: #667; margin-top: 4px; }
    button.button, a.button { display: inline-block; margin-top: 20px; background: #ea580c; color: #fff; text-decoration: none;
      padding: 12px 28px; border-radius: 6px; font-weight: 600; border: none; font-size: 1rem; cursor: pointer;
      font-family: inherit; }
    .icon { width: 56px; height: 56px; line-height: 56px; margin: 0 auto 12px; border-radius: 50%;
      background: #e6f4ea; color: #1e7e34; font-size: 1.6rem; font-weight: 700; }
    .spinner { width: 34px; height: 34px; margin: 14px auto 6px; border: 3px solid #e6e9ee;
      border-top-color: #ea580c; border-radius: 50%; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .warn { color: #b26a00; font-size: 0.92rem; }
    .fallback { font-size: 0.9rem; margin-top: 14px; }
    .fallback a { color: #ea580c; }
    @media (prefers-color-scheme: dark) {
      body { background: #14161a; color: #e7e9ee; }
      .card { background: #1d2026; border-color: #2c313a; }
      p { color: #b7bfcc; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div id="stepConfirm">
      <h1>ยืนยันผลการพิจารณา</h1>
      <p>คำขอหมายเลข <strong>${escapeHtml(id || '-')}</strong></p>
      <p>ท่านกำลังจะบันทึกผล: <strong>${escapeHtml(outcomeLabel)}</strong></p>
      <p class="meta">เข้าสู่ระบบเป็น: ${escapeHtml(upn)}</p>
      <button type="button" id="confirmBtn" class="button">ยืนยัน — ${escapeHtml(outcomeLabel)}</button>
    </div>

    <div id="stepWorking" style="display:none">
      <h1>กำลังบันทึกผลการพิจารณา</h1>
      <div class="spinner"></div>
      <p id="workingMsg">กรุณารอสักครู่ อย่าปิดหน้าต่างนี้…</p>
    </div>

    <div id="stepDone" style="display:none">
      <div class="icon">✓</div>
      <h1>บันทึกผลเรียบร้อยแล้ว</h1>
      <p>คำขอหมายเลข <strong>${escapeHtml(id || '-')}</strong></p>
      <p>ผลการพิจารณา: <strong>${escapeHtml(outcomeLabel)}</strong></p>
      <p class="meta" id="doneStatus"></p>
      <button type="button" class="button" onclick="window.close()">ปิดหน้าต่างนี้</button>
      <p class="meta">หากกดแล้วหน้าต่างไม่ปิด ท่านสามารถปิดแท็บนี้ได้เอง</p>
      <div class="fallback">
        หากพบปัญหา กรุณาติดต่อกลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU)<br>
        โทร. 02-470-8320-3 &middot; <a href="mailto:bpuu@kmutt.ac.th">bpuu@kmutt.ac.th</a>
      </div>
    </div>
  </div>

  <script>
    // The approval is completed by loading JotForm's own deeplink in a HIDDEN
    // iframe — confirmed working end-to-end. The approver stays on this page
    // and never sees a JotForm URL.
    //
    // Verification note: q68 is NOT written by the approval step (see the
    // renderer comment above), so it is polled only in the BACKGROUND as a
    // bonus. "q68 didn't change" must never be presented as failure — an
    // earlier version did that and wrongly told approvers it hadn't worked.
    const TARGET = ${toScriptJson(target)};
    const SUBMISSION_ID = ${toScriptJson(id || '')};
    const BEFORE_STATUS = ${toScriptJson(beforeStatus === null || beforeStatus === undefined ? null : beforeStatus)};

    const show = (which) => {
      for (const s of ['stepConfirm', 'stepWorking', 'stepDone']) {
        document.getElementById(s).style.display = s === which ? 'block' : 'none';
      }
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Runs AFTER the result screen is already shown, so it never delays the
    // approver. Only ever upgrades the message; never downgrades it.
    async function watchStatusInBackground() {
      if (!SUBMISSION_ID || BEFORE_STATUS === null) return;
      const delays = [2000, 3000, 5000, 5000, 8000, 10000, 15000, 20000];
      for (const d of delays) {
        await sleep(d);
        try {
          const res = await fetch('/api/approve-gate/status?id=' + encodeURIComponent(SUBMISSION_ID), {
            headers: { Accept: 'application/json' },
          });
          const data = await res.json();
          if (data && data.verifiable && data.status && data.status !== BEFORE_STATUS) {
            document.getElementById('doneStatus').textContent = 'สถานะล่าสุดในระบบ: ' + data.status;
            return;
          }
        } catch (err) { /* keep watching quietly */ }
      }
    }

    document.getElementById('confirmBtn').addEventListener('click', async () => {
      show('stepWorking');

      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.src = TARGET;
      document.body.appendChild(frame);

      // React as soon as the framed page loads; the cap is only a safety net
      // so a redirect chain that never fires 'load' can't hang the screen.
      await Promise.race([
        new Promise((r) => frame.addEventListener('load', r, { once: true })),
        sleep(8000),
      ]);

      document.getElementById('doneStatus').textContent =
        'ระบบกำลังอัปเดตสถานะ อาจใช้เวลาสักครู่';
      show('stepDone');

      watchStatusInBackground();
    });
  </script>
</body>
</html>`;
}

app.get(
  '/approve-gate',
  requireAnyLogin,
  asyncHandler(async (req, res) => {
    noStore(res);

    // id/outcome are simple values and come before target in every link this
    // app generates, so Express's own query parser handles them fine. target
    // is NOT read from req.query — see extractRawTarget() for why.
    const { id, outcome } = req.query;
    const targetStr = extractRawTarget(req.originalUrl);

    if (!targetStr || !isAllowedApprovalTarget(targetStr)) {
      res.status(400).send(
        renderErrorPage({
          title: 'ลิงก์ไม่ถูกต้อง',
          message: 'ลิงก์อนุมัตินี้ไม่ถูกต้องหรือหมดอายุ กรุณาติดต่อผู้ดูแลระบบ',
          retryHref: '/',
        })
      );
      return;
    }

    const outcomeLabel = outcomeToLabel(outcome);
    const identityLabel = resolveApprovalIdentityLabel(req);

    // Capture the submission's status BEFORE the approver acts, so the page
    // can later prove the approval landed by detecting a change. Never fatal:
    // if this can't be read, the page degrades to "sent, but unverified"
    // rather than claiming an unproven success.
    let beforeStatus = null;
    try {
      beforeStatus = await fetchJotformSubmissionStatus(id);
    } catch (err) {
      console.warn(`[bpuu-workflow] approval gate: could not read pre-approval status: ${err.message}`);
    }

    console.log(
      `[bpuu-workflow] approval gate: identity=${identityLabel} id=${id || '(none)'} outcome=${outcome || '(none)'} beforeStatus=${
        beforeStatus === null ? '(unknown)' : beforeStatus
      } -> confirm screen`
    );

    res.status(200).send(
      renderApprovalConfirmPage({ id, outcomeLabel, target: targetStr, upn: identityLabel, beforeStatus })
    );
  })
);

// Status probe used by the confirm page to VERIFY that the in-page (iframe)
// approval actually advanced the workflow, rather than trusting a
// cross-origin load event. Returns the submission's current q68 value.
// `verifiable:false` tells the client it cannot prove success and must say so.
app.get(
  '/api/approve-gate/status',
  requireAnyLogin,
  asyncHandler(async (req, res) => {
    noStore(res);

    const id = req.query.id;
    if (!id) {
      res.status(400).json({ verifiable: false, error: 'id is required' });
      return;
    }
    if (!isJotformConfigured()) {
      res.status(200).json({ verifiable: false, status: null });
      return;
    }

    try {
      const status = await fetchJotformSubmissionStatus(String(id));
      res.status(200).json({ verifiable: true, status });
    } catch (err) {
      console.warn(`[bpuu-workflow] approval status probe failed: ${err.message}`);
      res.status(200).json({ verifiable: false, status: null });
    }
  })
);

// ---------------------------------------------------------------------------
// Admin page — request list + workflow-status tracking + permission settings.
//
// The request data lives entirely in JotForm (this app never stored it), so
// the list is read live from the JotForm submissions API using a read-only
// API key (JOTFORM_API_KEY). The "workflow status" shown per request is the
// form's own สถานะดำเนินการ field (q68), which the JotForm workflow updates
// as a request moves through approval stages — that field is the status
// signal available via the API; JotForm does not expose a separate
// per-submission "current workflow node" through this endpoint.
// ---------------------------------------------------------------------------

const JOTFORM_FETCH_TIMEOUT_MS = 8000;

// Serialize a value for safe embedding inside an inline <script> as a JS
// literal: JSON.stringify handles JS-string escaping, and escaping '<'
// prevents a "</script>" sequence in the data from closing the tag early.
function toScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// The /admin page. Server-rendered shell (branding, current admin, the two
// panels) with inline JS that pulls live data from the admin JSON APIs and
// builds the tables/lists with textContent — never innerHTML on the fetched
// values — so JotForm submission content and allowlist emails can't inject
// markup into this page.
function renderAdminPage({ currentEmail, currentRole, jotformConfigured }) {
  const isRoleAdmin = currentRole === 'admin';
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ผู้ดูแลระบบ — ระบบกระบวนงาน BPUU</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css">
  <link rel="stylesheet" href="/css/styles.css">
  <style>
    body { background: #f2f4f7; font-family: "Sarabun", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .admin-header { background: linear-gradient(135deg, #FA4616, #ff734d); color: #fff; padding: 18px 0; }
    .admin-header .sub { font-size: 12px; letter-spacing: .4px; opacity: .95; }
    .admin-header .title { font-size: 20px; font-weight: 800; }
    .panel { background: #fff; border: 1px solid #e3e6ea; border-radius: 12px; }
    .panel-head { padding: 16px 20px; border-bottom: 1px solid #eef0f3; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .panel-head h2 { font-size: 1.05rem; font-weight: 700; margin: 0; }
    .panel-body { padding: 16px 20px; }
    .status-badge { font-size: 0.8rem; font-weight: 600; padding: 4px 10px; border-radius: 999px; display: inline-block; white-space: nowrap; }
    .status-wait { background: #fff4e5; color: #b26a00; }
    .status-ok { background: #e6f4ea; color: #1e7e34; }
    .status-reject { background: #fdecea; color: #c0392b; }
    .status-neutral { background: #eef0f3; color: #55606d; }
    .muted { color: #7a828d; }
    .state-msg { padding: 24px; text-align: center; color: #7a828d; }
    .role-badge { display: inline-block; font-size: .72rem; font-weight: 800; letter-spacing: .3px;
      padding: 2px 9px; border-radius: 999px; background: rgba(255,255,255,.22); border: 1px solid rgba(255,255,255,.55); }
    .nav-menu { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
    .nav-menu button { border: 1px solid #e3e6ea; background: #fff; color: #55606d; font-weight: 700;
      font-size: .92rem; padding: 9px 18px; border-radius: 10px; cursor: pointer; font-family: inherit; }
    .nav-menu button.active { background: #FA4616; border-color: #FA4616; color: #fff; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    table.tbl { font-size: .88rem; }
    table.tbl td, table.tbl th { vertical-align: middle; }
    /* sortable headers */
    table.tbl thead th.sortable { cursor: pointer; white-space: nowrap; user-select: none; }
    table.tbl thead th.sortable:hover { color: #FA4616; }
    table.tbl thead th .arrow { opacity: .35; font-size: .8em; margin-left: 3px; }
    table.tbl thead th.sorted .arrow { opacity: 1; color: #FA4616; }
    /* group header row */
    tr.group-row td { background: #fff4ef; font-weight: 800; color: #a4400f; border-top: 2px solid #ffd2bd; }
    tr.group-row .count { font-weight: 600; color: #b98a76; font-size: .85rem; margin-left: 6px; }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .toolbar input, .toolbar select { font-size: .88rem; }
    .toolbar .form-control, .toolbar .form-select { height: 34px; padding-top: 2px; padding-bottom: 2px; }
    .result-count { font-size: .84rem; color: #7a828d; white-space: nowrap; }
  </style>
</head>
<body>
  <div class="admin-header">
    <div class="container d-flex align-items-center justify-content-between">
      <div>
        <div class="sub">มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี (มจธ.)</div>
        <div class="title">ผู้ดูแลระบบ · ระบบกระบวนงาน BPUU</div>
      </div>
      <div class="text-end">
        <div style="font-size:.85rem;opacity:.95;">
          ${escapeHtml(currentEmail)}
          <span class="role-badge ms-1">${isRoleAdmin ? 'ADMIN' : 'STAFF'}</span>
        </div>
        <a href="/logout" class="text-white" style="font-size:.85rem;"><i class="bi bi-box-arrow-right"></i> ออกจากระบบ</a>
      </div>
    </div>
  </div>

  <div class="container py-4">
    <!-- The permission tab is rendered ONLY for role 'admin'. The server also
         rejects permission writes from 'staff' (requireRoleAdmin), so hiding
         it here is presentation, not the security boundary. -->
    <nav class="nav-menu">
      <button type="button" class="active" data-tab="requests"><i class="bi bi-inbox"></i> รายการคำขอ</button>
      <button type="button" data-tab="locations"><i class="bi bi-geo-alt"></i> จัดการสถานที่</button>
      ${isRoleAdmin ? '<button type="button" data-tab="permissions"><i class="bi bi-shield-lock"></i> สิทธิ์การเข้าถึง</button>' : ''}
    </nav>

    <!-- Requests -->
    <div class="tab-panel active" id="tab-requests">
      <div class="panel">
        <div class="panel-head">
          <h2><i class="bi bi-inbox text-ci-orange"></i> รายการคำขอ &amp; สถานะ</h2>
          <div class="toolbar">
            <input id="reqSearch" class="form-control form-control-sm" style="width:190px" placeholder="ค้นหา…">
            <select id="reqGroup" class="form-select form-select-sm" style="width:180px">
              <option value="">ไม่จัดกลุ่ม</option>
              <option value="requestType">กลุ่ม: ประเภทบริการ</option>
              <option value="status">กลุ่ม: สถานะ</option>
              <option value="requester">กลุ่ม: ผู้ขอ</option>
              <option value="approver">กลุ่ม: ผู้อนุมัติ</option>
            </select>
            <span class="result-count" id="reqCount"></span>
            <button id="refreshBtn" class="btn btn-sm btn-outline-secondary"><i class="bi bi-arrow-clockwise"></i></button>
          </div>
        </div>
        <div class="panel-body">
          <div class="table-responsive">
            <table class="table table-hover tbl align-middle mb-0">
              <thead class="table-light"><tr id="reqHead"></tr></thead>
              <tbody id="reqBody"><tr><td colspan="7" class="state-msg">กำลังโหลด…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Locations -->
    <div class="tab-panel" id="tab-locations">
      <div class="panel">
        <div class="panel-head">
          <h2><i class="bi bi-geo-alt text-ci-orange"></i> จัดการข้อมูลสถานที่ (Area Master)</h2>
          <div class="toolbar">
            <input id="locSearch" class="form-control form-control-sm" style="width:190px" placeholder="ค้นหา…">
            <select id="locGroup" class="form-select form-select-sm" style="width:200px">
              <option value="">ไม่จัดกลุ่ม</option>
              <option value="campusName">กลุ่ม: พื้นที่การศึกษา</option>
              <option value="buildingName">กลุ่ม: อาคาร</option>
              <option value="businessTypeName">กลุ่ม: ประเภทธุรกิจ</option>
              <option value="companyName">กลุ่ม: บริษัท</option>
            </select>
            <span class="result-count" id="locCount"></span>
          </div>
        </div>
        <div class="panel-body">
          <div class="table-responsive mb-3">
            <table class="table table-hover tbl align-middle mb-0">
              <thead class="table-light"><tr id="locHead"></tr></thead>
              <tbody id="locBody"><tr><td colspan="8" class="state-msg">กำลังโหลด…</td></tr></tbody>
            </table>
          </div>
          <details>
            <summary class="fw-bold" style="cursor:pointer">+ เพิ่มข้อมูลสถานที่</summary>
            <form id="locAddForm" class="row g-2 mt-2">
              <div class="col-6 col-md-2"><input id="f_campusCode" class="form-control form-control-sm" placeholder="รหัสพื้นที่"></div>
              <div class="col-6 col-md-3"><input id="f_campusName" class="form-control form-control-sm" placeholder="พื้นที่การศึกษา"></div>
              <div class="col-6 col-md-2"><input id="f_buildingCode" class="form-control form-control-sm" placeholder="รหัสอาคาร"></div>
              <div class="col-6 col-md-5"><input id="f_buildingName" class="form-control form-control-sm" placeholder="อาคาร"></div>
              <div class="col-6 col-md-2"><input id="f_businessTypeCode" class="form-control form-control-sm" placeholder="รหัสประเภทธุรกิจ"></div>
              <div class="col-6 col-md-3"><input id="f_businessTypeName" class="form-control form-control-sm" placeholder="ประเภทธุรกิจ"></div>
              <div class="col-6 col-md-2"><input id="f_companyCode" class="form-control form-control-sm" placeholder="รหัสบริษัท"></div>
              <div class="col-6 col-md-5"><input id="f_companyName" class="form-control form-control-sm" placeholder="ชื่อบริษัท *" required></div>
              <div class="col-6 col-md-3"><input id="f_manager1Name" class="form-control form-control-sm" placeholder="ผู้ดูแลพื้นที่ 1"></div>
              <div class="col-6 col-md-3"><input id="f_manager1Email" class="form-control form-control-sm" placeholder="อีเมลผู้ดูแล 1"></div>
              <div class="col-6 col-md-3"><input id="f_manager2Name" class="form-control form-control-sm" placeholder="ผู้ดูแลพื้นที่ 2"></div>
              <div class="col-6 col-md-3"><input id="f_manager2Email" class="form-control form-control-sm" placeholder="อีเมลผู้ดูแล 2"></div>
              <div class="col-12"><button type="submit" class="btn btn-sm btn-ci-orange fw-bold"><i class="bi bi-plus-lg"></i> เพิ่มสถานที่</button></div>
            </form>
          </details>
          <div id="locMsg" class="mt-2" style="font-size:.9rem;"></div>
        </div>
      </div>
    </div>

    ${
      isRoleAdmin
        ? `<!-- Permissions (admin only) -->
    <div class="tab-panel" id="tab-permissions">
      <div class="panel">
        <div class="panel-head"><h2><i class="bi bi-shield-lock text-ci-orange"></i> สิทธิ์การเข้าถึงหน้าผู้ดูแล</h2></div>
        <div class="panel-body">
          <p class="muted mb-1">เฉพาะอีเมลในรายการนี้เท่านั้นที่เข้าหน้าผู้ดูแลระบบได้ (บัญชี KMUTT/ADFS เท่านั้น)</p>
          <p class="muted mb-3" style="font-size:.86rem;">
            <strong>Admin</strong> = เห็นทุกเมนู รวมถึงจัดการสิทธิ์ ·
            <strong>Staff</strong> = เห็นทุกเมนู ยกเว้นเมนูจัดการสิทธิ์
          </p>
          <div class="table-responsive mb-3">
            <table class="table table-hover tbl align-middle mb-0">
              <thead class="table-light">
                <tr><th style="width:52%">อีเมล</th><th style="width:26%">สิทธิ์ (Role)</th><th style="width:22%" class="text-end">จัดการ</th></tr>
              </thead>
              <tbody id="permBody"><tr><td colspan="3" class="state-msg">กำลังโหลด…</td></tr></tbody>
            </table>
          </div>
          <form id="addForm" class="row g-2 align-items-center" style="max-width:640px;">
            <div class="col-12 col-md-6"><input type="email" id="addEmail" class="form-control form-control-sm" placeholder="email@kmutt.ac.th" required></div>
            <div class="col-auto">
              <select id="addRole" class="form-select form-select-sm">
                <option value="staff" selected>Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div class="col-auto"><button type="submit" class="btn btn-sm btn-ci-orange fw-bold"><i class="bi bi-plus-lg"></i> เพิ่มอีเมล</button></div>
          </form>
          <div id="settingsMsg" class="mt-2" style="font-size:.9rem;"></div>
        </div>
      </div>
    </div>`
        : ''
    }
  </div>

  <script>
    const CURRENT_EMAIL = ${toScriptJson(currentEmail)};
    const IS_ROLE_ADMIN = ${isRoleAdmin ? 'true' : 'false'};

    // ---- menu / tabs ----
    document.querySelectorAll('.nav-menu button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-menu button').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById('tab-' + btn.dataset.tab);
        if (panel) panel.classList.add('active');
      });
    });

    function showMsg(id, text, ok) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.style.color = ok ? '#1e7e34' : '#c0392b';
    }

    // -----------------------------------------------------------------
    // Generic sortable / filterable / groupable table.
    // columns: [{ key, label, width?, align?, cell?(row) }]
    //   - key doubles as the sort key and the value read for grouping.
    //   - cell() returns a <td> for custom rendering (status badge, buttons).
    // Sorting is Thai-aware via localeCompare; numeric-looking values compare
    // numerically so amounts/ids don't sort as strings.
    // -----------------------------------------------------------------
    function createTable(opts) {
      const state = { rows: [], sortKey: null, sortDir: 1, filter: '', groupBy: '' };

      function val(row, key) {
        const v = row[key];
        return v == null ? '' : String(v);
      }
      function cmp(a, b, key) {
        const av = val(a, key), bv = val(b, key);
        const an = Number(String(av).replace(/,/g, '')), bn = Number(String(bv).replace(/,/g, ''));
        if (av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
        if (av === '' && bv !== '') return 1;   // blanks last
        if (bv === '' && av !== '') return -1;
        return av.localeCompare(bv, 'th');
      }

      function buildHead() {
        const tr = document.getElementById(opts.headId);
        tr.replaceChildren();
        for (const col of opts.columns) {
          const th = document.createElement('th');
          if (col.width) th.style.width = col.width;
          if (col.align) th.className = 'text-' + col.align;
          if (col.sortable === false) {
            th.textContent = col.label;
          } else {
            th.classList.add('sortable');
            if (state.sortKey === col.key) th.classList.add('sorted');
            th.textContent = col.label;
            const arrow = document.createElement('span');
            arrow.className = 'arrow';
            arrow.textContent = state.sortKey === col.key ? (state.sortDir === 1 ? '▲' : '▼') : '↕';
            th.appendChild(arrow);
            th.addEventListener('click', () => {
              if (state.sortKey === col.key) state.sortDir = -state.sortDir;
              else { state.sortKey = col.key; state.sortDir = 1; }
              render();
            });
          }
          tr.appendChild(th);
        }
      }

      function stateRow(text) {
        const body = document.getElementById(opts.bodyId);
        body.replaceChildren();
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = opts.columns.length;
        td.className = 'state-msg';
        td.textContent = text;
        tr.appendChild(td);
        body.appendChild(tr);
      }

      function makeRow(row) {
        const tr = document.createElement('tr');
        for (const col of opts.columns) {
          if (col.cell) { tr.appendChild(col.cell(row)); continue; }
          const td = document.createElement('td');
          const v = val(row, col.key);
          td.textContent = v === '' ? '—' : v;
          if (col.align) td.className = 'text-' + col.align;
          tr.appendChild(td);
        }
        return tr;
      }

      function render() {
        buildHead();
        const body = document.getElementById(opts.bodyId);
        const q = state.filter.trim().toLowerCase();
        let rows = state.rows;
        if (q) {
          rows = rows.filter((r) =>
            opts.columns.some((c) => val(r, c.key).toLowerCase().includes(q)) ||
            (opts.searchKeys || []).some((k) => val(r, k).toLowerCase().includes(q))
          );
        }
        if (state.sortKey) {
          rows = rows.slice().sort((a, b) => cmp(a, b, state.sortKey) * state.sortDir);
        }
        const countEl = document.getElementById(opts.countId);
        if (countEl) countEl.textContent = rows.length + ' รายการ';

        if (!rows.length) { stateRow(opts.emptyText || 'ไม่พบข้อมูล'); return; }

        body.replaceChildren();
        if (!state.groupBy) {
          for (const r of rows) body.appendChild(makeRow(r));
          return;
        }
        // group: bucket by value, groups sorted alphabetically, blanks last
        const groups = new Map();
        for (const r of rows) {
          const k = val(r, state.groupBy) || '(ไม่ระบุ)';
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(r);
        }
        const keys = [...groups.keys()].sort((a, b) => {
          if (a === '(ไม่ระบุ)') return 1;
          if (b === '(ไม่ระบุ)') return -1;
          return a.localeCompare(b, 'th');
        });
        for (const k of keys) {
          const tr = document.createElement('tr');
          tr.className = 'group-row';
          const td = document.createElement('td');
          td.colSpan = opts.columns.length;
          td.textContent = k;
          const c = document.createElement('span');
          c.className = 'count';
          c.textContent = '(' + groups.get(k).length + ')';
          td.appendChild(c);
          tr.appendChild(td);
          body.appendChild(tr);
          for (const r of groups.get(k)) body.appendChild(makeRow(r));
        }
      }

      // wire toolbar
      const search = document.getElementById(opts.searchId);
      if (search) search.addEventListener('input', () => { state.filter = search.value; render(); });
      const group = document.getElementById(opts.groupId);
      if (group) group.addEventListener('change', () => { state.groupBy = group.value; render(); });

      return {
        setRows(rows) { state.rows = rows || []; render(); },
        loading(text) { buildHead(); stateRow(text || 'กำลังโหลด…'); },
        message(text) { buildHead(); stateRow(text); },
      };
    }

    function textCell(value, align) {
      const td = document.createElement('td');
      td.textContent = value == null || value === '' ? '—' : String(value);
      if (align) td.className = 'text-' + align;
      return td;
    }

    // ---- requests ----
    function statusClass(status) {
      const s = String(status || '');
      if (/อนุมัติ|สำเร็จ|เสร็จ|เรียบร้อย|ผ่าน/.test(s) && !/ไม่อนุมัติ/.test(s)) return 'status-ok';
      if (/ไม่อนุมัติ|ปฏิเสธ|ยกเลิก|ไม่ผ่าน/.test(s)) return 'status-reject';
      if (/รอ|กำลัง|ตรวจสอบ/.test(s)) return 'status-wait';
      return 'status-neutral';
    }

    const reqTable = createTable({
      headId: 'reqHead', bodyId: 'reqBody', searchId: 'reqSearch', groupId: 'reqGroup', countId: 'reqCount',
      emptyText: 'ยังไม่มีคำขอ',
      searchKeys: ['requesterEmail', 'approverEmail'],
      columns: [
        { key: 'id', label: 'Ref' },
        { key: 'createdAt', label: 'วันที่' },
        { key: 'requester', label: 'ผู้ขอ' },
        { key: 'requestType', label: 'ประเภทบริการ' },
        { key: 'approver', label: 'ผู้อนุมัติ', cell: (r) => textCell(r.approver || r.approverEmail) },
        { key: 'amount', label: 'ยอด (บาท)', align: 'end', cell: (r) => textCell(r.amount, 'end') },
        {
          key: 'status', label: 'สถานะ',
          cell: (r) => {
            const td = document.createElement('td');
            const b = document.createElement('span');
            b.className = 'status-badge ' + statusClass(r.status);
            b.textContent = r.status && r.status !== '' ? r.status : 'ไม่ระบุ';
            td.appendChild(b);
            return td;
          },
        },
      ],
    });

    async function loadRequests() {
      reqTable.loading();
      try {
        const res = await fetch('/api/admin/requests', { headers: { 'Accept': 'application/json' } });
        const data = await res.json();
        if (data.configured === false) {
          reqTable.message('ยังไม่ได้ตั้งค่า JotForm API key — เพิ่ม JOTFORM_API_KEY ใน .env เพื่อดูรายการคำขอ');
          return;
        }
        if (data.error) { reqTable.message(data.error); return; }
        reqTable.setRows(data.requests || []);
      } catch (err) {
        reqTable.message('เกิดข้อผิดพลาดในการโหลดรายการคำขอ');
      }
    }

    // ---- locations ----
    const LOC_FIELDS = ['campusCode','campusName','buildingCode','buildingName','businessTypeCode',
      'businessTypeName','companyCode','companyName','manager1Name','manager1Email','manager2Name','manager2Email'];
    const LOC_LABELS = {
      campusCode: 'รหัสพื้นที่', campusName: 'พื้นที่การศึกษา', buildingCode: 'รหัสอาคาร', buildingName: 'อาคาร',
      businessTypeCode: 'รหัสประเภทธุรกิจ', businessTypeName: 'ประเภทธุรกิจ', companyCode: 'รหัสบริษัท',
      companyName: 'ชื่อบริษัท', manager1Name: 'ผู้ดูแลพื้นที่ 1', manager1Email: 'อีเมลผู้ดูแล 1',
      manager2Name: 'ผู้ดูแลพื้นที่ 2', manager2Email: 'อีเมลผู้ดูแล 2',
    };

    function managerCell(name, email) {
      const td = document.createElement('td');
      if (!name && !email) { td.textContent = '—'; return td; }
      const n = document.createElement('div');
      n.textContent = name || '—';
      td.appendChild(n);
      if (email) {
        const e = document.createElement('div');
        e.className = 'muted';
        e.style.fontSize = '.82rem';
        e.textContent = email;
        td.appendChild(e);
      }
      return td;
    }

    const locTable = createTable({
      headId: 'locHead', bodyId: 'locBody', searchId: 'locSearch', groupId: 'locGroup', countId: 'locCount',
      emptyText: 'ยังไม่มีข้อมูลสถานที่',
      searchKeys: LOC_FIELDS,
      columns: [
        { key: 'campusName', label: 'พื้นที่การศึกษา', width: '12%' },
        { key: 'buildingCode', label: 'รหัสอาคาร', width: '7%' },
        { key: 'buildingName', label: 'อาคาร', width: '19%' },
        { key: 'businessTypeName', label: 'ประเภทธุรกิจ', width: '10%' },
        { key: 'companyName', label: 'ชื่อบริษัท', width: '19%' },
        { key: 'manager1Name', label: 'ผู้ดูแลพื้นที่ 1', width: '11%', cell: (r) => managerCell(r.manager1Name, r.manager1Email) },
        { key: 'manager2Name', label: 'ผู้ดูแลพื้นที่ 2', width: '11%', cell: (r) => managerCell(r.manager2Name, r.manager2Email) },
        {
          key: '_actions', label: 'จัดการ', width: '11%', align: 'end', sortable: false,
          cell: (r) => {
            const td = document.createElement('td');
            td.className = 'text-end';
            td.style.whiteSpace = 'nowrap';
            const edit = document.createElement('button');
            edit.type = 'button'; edit.className = 'btn btn-sm btn-outline-secondary me-1'; edit.textContent = 'แก้ไข';
            edit.addEventListener('click', () => editLocation(r));
            const del = document.createElement('button');
            del.type = 'button'; del.className = 'btn btn-sm btn-outline-danger'; del.textContent = 'ลบ';
            del.addEventListener('click', () => {
              if (!confirm('ลบ "' + r.companyName + '" ที่ ' + (r.buildingName || r.campusName || '-') + ' ?')) return;
              mutateLocation({ action: 'remove', id: r.id }, 'ลบแล้ว');
            });
            td.appendChild(edit); td.appendChild(del);
            return td;
          },
        },
      ],
    });

    function editLocation(row) {
      const patch = { action: 'update', id: row.id };
      for (const f of LOC_FIELDS) {
        const v = prompt(LOC_LABELS[f] + (f === 'companyName' ? ' *' : ''), row[f] || '');
        if (v === null) return; // cancelled
        patch[f] = v;
      }
      mutateLocation(patch, 'บันทึกแล้ว');
    }

    async function mutateLocation(payload, okText) {
      try {
        const res = await fetch('/api/admin/locations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) { showMsg('locMsg', data.error || 'ดำเนินการไม่สำเร็จ', false); return false; }
        locTable.setRows(data.locations || []);
        showMsg('locMsg', okText, true);
        return true;
      } catch (err) {
        showMsg('locMsg', 'เกิดข้อผิดพลาด', false);
        return false;
      }
    }

    async function loadLocations() {
      locTable.loading();
      try {
        const res = await fetch('/api/admin/locations', { headers: { 'Accept': 'application/json' } });
        const data = await res.json();
        locTable.setRows(data.locations || []);
      } catch (err) {
        locTable.message('โหลดข้อมูลสถานที่ไม่สำเร็จ');
      }
    }

    document.getElementById('locAddForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = { action: 'add' };
      for (const f of LOC_FIELDS) {
        const el = document.getElementById('f_' + f);
        payload[f] = el ? el.value.trim() : '';
      }
      if (!payload.companyName) { showMsg('locMsg', 'กรุณาระบุชื่อบริษัท', false); return; }
      if (await mutateLocation(payload, 'เพิ่ม "' + payload.companyName + '" แล้ว')) {
        for (const f of LOC_FIELDS) {
          const el = document.getElementById('f_' + f);
          if (el) el.value = '';
        }
      }
    });

    // ---- permissions (admin only) ----
    function renderAllowlist(entries) {
      const body = document.getElementById('permBody');
      if (!body) return;
      body.replaceChildren();
      if (!entries.length) {
        const tr = document.createElement('tr'); const td = document.createElement('td');
        td.colSpan = 3; td.className = 'state-msg'; td.textContent = 'ยังไม่มีรายชื่อ';
        tr.appendChild(td); body.appendChild(tr); return;
      }
      const adminCount = entries.filter((e) => e.role === 'admin').length;
      for (const entry of entries) {
        const tr = document.createElement('tr');
        tr.appendChild(textCell(entry.email + (entry.email === CURRENT_EMAIL ? ' (คุณ)' : '')));

        const roleTd = document.createElement('td');
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-sm';
        sel.style.maxWidth = '150px';
        for (const r of ['staff', 'admin']) {
          const opt = document.createElement('option');
          opt.value = r; opt.textContent = r === 'admin' ? 'Admin' : 'Staff';
          if (entry.role === r) opt.selected = true;
          sel.appendChild(opt);
        }
        if (entry.role === 'admin' && adminCount <= 1) sel.disabled = true;
        sel.addEventListener('change', () => mutateAllowlist('setRole', entry.email, sel.value));
        roleTd.appendChild(sel);
        tr.appendChild(roleTd);

        const act = document.createElement('td');
        act.className = 'text-end';
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'btn btn-sm btn-outline-danger'; del.textContent = 'ลบ';
        del.disabled = entry.role === 'admin' && adminCount <= 1;
        del.addEventListener('click', () => {
          if (!confirm('ลบสิทธิ์ของ ' + entry.email + ' ?')) return;
          mutateAllowlist('remove', entry.email);
        });
        act.appendChild(del);
        tr.appendChild(act);
        body.appendChild(tr);
      }
    }

    async function loadAllowlist() {
      if (!IS_ROLE_ADMIN) return;
      try {
        const res = await fetch('/api/admin/allowlist', { headers: { 'Accept': 'application/json' } });
        const data = await res.json();
        renderAllowlist(data.entries || []);
      } catch (err) { showMsg('settingsMsg', 'โหลดรายชื่อไม่สำเร็จ', false); }
    }

    async function mutateAllowlist(action, email, role) {
      const payload = { action: action, email: email };
      if (role) payload.role = role;
      try {
        const res = await fetch('/api/admin/allowlist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) { showMsg('settingsMsg', data.error || 'ดำเนินการไม่สำเร็จ', false); await loadAllowlist(); return false; }
        renderAllowlist(data.entries || []);
        showMsg('settingsMsg', 'บันทึกแล้ว', true);
        return true;
      } catch (err) {
        showMsg('settingsMsg', 'เกิดข้อผิดพลาด', false);
        return false;
      }
    }

    const addForm = document.getElementById('addForm');
    if (addForm) {
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('addEmail');
        const email = input.value.trim();
        if (!email) return;
        const role = document.getElementById('addRole').value;
        if (await mutateAllowlist('add', email, role)) {
          showMsg('settingsMsg', 'เพิ่ม ' + email + ' (' + role + ') แล้ว', true);
          input.value = '';
        }
      });
    }

    document.getElementById('refreshBtn').addEventListener('click', loadRequests);

    loadRequests();
    loadLocations();
    loadAllowlist();
  </script>
</body>
</html>`;
}

// Maps a submission's answers object (JotForm keys answers by numeric qid)
// to the compact record the admin table needs. qid → meaning comes from
// js/app.js buildJotformSubmissionFields(): 15=ประเภทคำขอ, 16=ประเภทผู้ใช้,
// 19=ชื่อผู้ขอ, 20=อีเมลผู้ขอ, 22=หน่วยงาน, 28=ชื่อผู้อนุมัติ, 30=อีเมลผู้อนุมัติ,
// 67=ยอดค่าบริการประเมิน, 68=สถานะดำเนินการ.
function jotformAnswer(answers, qid) {
  const entry = answers && answers[qid];
  if (!entry) return '';
  // Simple text fields expose .answer as a string; .prettyFormat is a nicer
  // rendering some field types provide. Fall back across both, never return
  // an object (which would render as "[object Object]" in the table).
  const value = entry.answer !== undefined ? entry.answer : entry.prettyFormat;
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

async function fetchJotformRequests() {
  const url = new URL(`${config.jotformApiBaseUrl}/form/${config.jotformFormId}/submissions`);
  url.searchParams.set('apiKey', config.jotformApiKey);
  url.searchParams.set('limit', '1000');

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(JOTFORM_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`JotForm submissions API returned HTTP ${response.status}`);
  }

  const body = await response.json();
  const content = Array.isArray(body.content) ? body.content : [];

  const requests = content.map((sub) => {
    const answers = sub.answers || {};
    return {
      id: sub.id,
      createdAt: sub.created_at || '',
      requester: jotformAnswer(answers, '19'),
      requesterEmail: jotformAnswer(answers, '20'),
      requestType: jotformAnswer(answers, '15'),
      userType: jotformAnswer(answers, '16'),
      department: jotformAnswer(answers, '22'),
      approver: jotformAnswer(answers, '28'),
      approverEmail: jotformAnswer(answers, '30'),
      amount: jotformAnswer(answers, '67'),
      status: jotformAnswer(answers, '68'),
    };
  });

  // Newest first — JotForm returns oldest-first by default and there's no
  // stable server-side desc order across field types, so sort here.
  requests.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return requests;
}

// A syntactically-plausible email — intentionally loose. The real gate is
// that only an @kmutt.ac.th ADFS login can ever MATCH an allowlist entry
// (ThaID has no email), so a typo'd or non-KMUTT entry is harmless: it just
// never grants access to anyone.
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

app.get(
  '/admin',
  requireLogin,
  requireAdmin,
  asyncHandler(async (req, res) => {
    noStore(res);
    res.status(200).send(
      renderAdminPage({
        currentEmail: getSessionAdminEmail(req),
        currentRole: getSessionRole(req),
        jotformConfigured: isJotformConfigured(),
      })
    );
  })
);

app.get(
  '/api/admin/requests',
  requireLogin,
  requireAdmin,
  asyncHandler(async (req, res) => {
    noStore(res);

    if (!isJotformConfigured()) {
      res.status(200).json({ configured: false, requests: [] });
      return;
    }

    try {
      const requests = await fetchJotformRequests();
      res.status(200).json({ configured: true, requests });
    } catch (err) {
      console.error(`[bpuu-workflow] admin requests fetch failed: ${err.message}`);
      res.status(502).json({ configured: true, error: 'ไม่สามารถดึงรายการคำขอจาก JotForm ได้ในขณะนี้' });
    }
  })
);

// Readable by any allowlisted role so the page can show who has access, but
// only role 'admin' may CHANGE it (see the POST below).
app.get(
  '/api/admin/allowlist',
  requireLogin,
  requireAdmin,
  asyncHandler(async (req, res) => {
    noStore(res);
    res.status(200).json({
      entries: loadAdminAllowlist(),
      currentEmail: getSessionAdminEmail(req),
      currentRole: getSessionRole(req),
    });
  })
);

// Add / remove / change-role. State-changing, so POST (not GET): SameSite=Lax
// on the session cookie keeps a cross-site POST from carrying the session,
// matching the CSRF posture the existing /api/kmutt-dev-preview/clear route
// already relies on. requireRoleAdmin enforces admin-only SERVER-SIDE — a
// 'staff' user is not merely hidden from this UI, they are rejected here.
app.post(
  '/api/admin/allowlist',
  requireLogin,
  requireAdmin,
  requireRoleAdmin,
  asyncHandler(async (req, res) => {
    noStore(res);

    const action = req.body && req.body.action;
    const email = normalizeEmail(req.body && req.body.email);
    const requestedRole = normalizeRole(req.body && req.body.role);

    if (!['add', 'remove', 'setRole'].includes(action)) {
      res.status(400).json({ error: 'action must be "add", "remove" or "setRole"' });
      return;
    }
    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }
    if (action === 'add' && !looksLikeEmail(email)) {
      res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
      return;
    }
    if ((action === 'add' || action === 'setRole') && req.body.role !== undefined && !requestedRole) {
      res.status(400).json({ error: 'role ต้องเป็น admin หรือ staff' });
      return;
    }

    const current = loadAdminAllowlist();
    const existing = current.find((e) => e.email === email);
    const actor = getSessionAdminEmail(req);

    const persist = (next, logLine) => {
      let updated;
      try {
        updated = saveAdminAllowlist(next);
      } catch (err) {
        console.error(`[bpuu-workflow] could not persist admin-allowlist.json (${err.message})`);
        res.status(500).json({ error: 'บันทึกรายชื่อผู้ดูแลระบบไม่สำเร็จ กรุณาลองใหม่ภายหลัง' });
        return null;
      }
      console.log(`[bpuu-workflow] admin allowlist: ${actor} ${logLine}`);
      return updated;
    };

    if (action === 'add') {
      if (existing) {
        res.status(200).json({ entries: current, unchanged: true });
        return;
      }
      const role = requestedRole || DEFAULT_ROLE;
      const updated = persist([...current, { email, role }], `added ${email} as ${role}`);
      if (updated) res.status(200).json({ entries: updated });
      return;
    }

    if (action === 'setRole') {
      if (!existing) {
        res.status(404).json({ error: 'ไม่พบอีเมลนี้ในรายชื่อ' });
        return;
      }
      const role = requestedRole || DEFAULT_ROLE;
      if (existing.role === role) {
        res.status(200).json({ entries: current, unchanged: true });
        return;
      }
      // Demoting the last admin would leave nobody able to manage roles.
      if (existing.role === 'admin' && role !== 'admin' && countAdmins(current) <= 1) {
        res.status(409).json({ error: 'ต้องมีผู้ดูแลระบบ (Admin) อย่างน้อย 1 คน' });
        return;
      }
      const next = current.map((e) => (e.email === email ? { email, role } : e));
      const updated = persist(next, `set ${email} role to ${role}`);
      if (updated) res.status(200).json({ entries: updated });
      return;
    }

    // action === 'remove'
    if (!existing) {
      res.status(200).json({ entries: current, unchanged: true });
      return;
    }
    // Never let the last admin be removed — that would leave the system with
    // no one able to grant access again through the UI.
    if (existing.role === 'admin' && countAdmins(current) <= 1) {
      res.status(409).json({ error: 'ไม่สามารถลบผู้ดูแลระบบ (Admin) คนสุดท้ายได้' });
      return;
    }
    const updated = persist(current.filter((e) => e.email !== email), `removed ${email}`);
    if (updated) res.status(200).json({ entries: updated });
  })
);

// ---------------------------------------------------------------------------
// Location manager — data maintenance, available to BOTH roles (only the
// permission panel is admin-only).
// ---------------------------------------------------------------------------

app.get(
  '/api/admin/locations',
  requireLogin,
  requireAdmin,
  asyncHandler(async (req, res) => {
    noStore(res);
    res.status(200).json({ locations: loadLocations() });
  })
);

app.post(
  '/api/admin/locations',
  requireLogin,
  requireAdmin,
  asyncHandler(async (req, res) => {
    noStore(res);

    const body = req.body || {};
    const action = body.action;
    if (!['add', 'update', 'remove'].includes(action)) {
      res.status(400).json({ error: 'action must be "add", "update" or "remove"' });
      return;
    }

    const current = loadLocations();
    const actor = getSessionAdminEmail(req);

    const persist = (next, logLine) => {
      let updated;
      try {
        updated = saveLocations(next);
      } catch (err) {
        console.error(`[bpuu-workflow] could not persist locations.json (${err.message})`);
        res.status(500).json({ error: 'บันทึกข้อมูลสถานที่ไม่สำเร็จ กรุณาลองใหม่ภายหลัง' });
        return null;
      }
      console.log(`[bpuu-workflow] locations: ${actor} ${logLine}`);
      return updated;
    };

    if (action === 'add') {
      const candidate = normalizeLocation({ ...body, id: nextLocationId(current) });
      if (!candidate) {
        res.status(400).json({ error: 'กรุณาระบุชื่อบริษัท (CompanyName)' });
        return;
      }
      const updated = persist([...current, candidate], `added location "${candidate.companyName}"`);
      if (updated) res.status(200).json({ locations: updated });
      return;
    }

    const id = String(body.id == null ? '' : body.id).trim();
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    const existing = current.find((l) => String(l.id) === id);
    if (!existing) {
      res.status(404).json({ error: 'ไม่พบสถานที่นี้' });
      return;
    }

    if (action === 'remove') {
      const updated = persist(current.filter((l) => String(l.id) !== id), `removed location "${existing.companyName}"`);
      if (updated) res.status(200).json({ locations: updated });
      return;
    }

    // action === 'update'
    const merged = normalizeLocation({ ...existing, ...body, id: existing.id });
    if (!merged) {
      res.status(400).json({ error: 'กรุณาระบุชื่อบริษัท (CompanyName)' });
      return;
    }
    const updated = persist(
      current.map((l) => (String(l.id) === id ? merged : l)),
      `updated location "${merged.companyName}"`
    );
    if (updated) res.status(200).json({ locations: updated });
  })
);

// ---------------------------------------------------------------------------
// Unauthenticated diagnostics endpoint.
//
// Deliberately reachable with NO authentication and usable BEFORE ADFS is
// even correctly configured — a team deploying this app to a new host has no
// way to complete a real ADFS login until REDIRECT_URI is set correctly and
// registered with ADFS, so without this route they'd have no way to check
// "is my config even close to right" without already having a working login.
// Reports only non-sensitive, already-known state — never a client secret,
// session secret, or full client_id, and never a fresh network probe on this
// request: discoveryLoaded/issuer below just reflect whatever
// oidcMetadata/thaidMetadata were populated with (or left null as) by the
// discovery fetches already performed once at boot (see
// loadDiscoveryMetadata()/loadThaidDiscoveryMetadata() and main() above).
// ---------------------------------------------------------------------------

// Returns a short, non-sensitive preview of an OIDC client_id — first 8
// characters followed by '***' — never the full client_id. Used only by
// /diagnostics; kept generic so it could mask a ThaID/Master Data client_id
// the same way if this ever needs to report one.
function maskClientId(clientId) {
  if (!clientId) return null;
  return String(clientId).slice(0, 8) + '***';
}

app.get(
  '/diagnostics',
  asyncHandler(async (req, res) => {
    noStore(res);
    res.status(200).json({
      configuredRedirectUri: config.redirectUri,
      configuredPostLogoutRedirectUri: config.postLogoutRedirectUri,
      tls: {
        certMounted: hasTlsCert,
        listeningOn: hasTlsCert ? 'https' : 'http',
      },
      adfs: {
        // Always true: REQUIRED_ENV_VARS (ADFS_DISCOVERY_URL, ADFS_CLIENT_ID,
        // ADFS_CLIENT_SECRET, REDIRECT_URI) already enforces this at boot —
        // see validateEnv() above, which exits the process before this
        // handler could ever be reached if any were missing.
        configured: true,
        discoveryLoaded: Boolean(oidcMetadata),
        issuer: oidcMetadata ? oidcMetadata.issuer : null,
        clientIdPreview: maskClientId(config.clientId),
      },
      thaid: {
        configured: isThaidConfigured(),
        discoveryLoaded: Boolean(thaidMetadata),
        issuer: thaidMetadata ? thaidMetadata.issuer : null,
      },
      masterdata: {
        configured: isMasterDataConfigured(),
      },
      jotform: {
        // Whether the /admin request list can pull data. Reports only
        // configured-or-not and the form id — never the API key itself.
        configured: isJotformConfigured(),
        formId: config.jotformFormId,
      },
      serverTimeUtc: new Date().toISOString(),
    });
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
        `[bpuu-workflow] KMUTT dev preview used: real upn=${realUpn} now previewing as email=${previewEmail}`
      );

      res.status(200).json({ found: true, userType, requesterProfile });
    } catch (err) {
      console.error(
        `[bpuu-workflow] KMUTT dev preview lookup failed (non-fatal): ${err && err.message ? err.message : err}`
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
  return req.path && (req.path.startsWith('/external') || req.path.startsWith('/callback'))
    ? '/external'
    : '/login';
}

// Fallback error handler: never leak stack traces to the client.
app.use((err, req, res, next) => {
  console.error('[bpuu-workflow] unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = (err && (err.status || err.statusCode)) || 500;

  // API routes are consumed by fetch()-based client code expecting JSON
  // (res.json() on every response) — an HTML error page here just throws
  // client-side instead of surfacing a clear error. Covers cases like
  // malformed JSON bodies (express.json() throws a 400 SyntaxError) as well
  // as any other API-route failure.
  if (req.path && req.path.startsWith('/api/')) {
    res.status(status).json({ error: 'An unexpected error occurred while handling your request.' });
    return;
  }

  res.status(status).send(
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
  console.log(`[bpuu-workflow] fetching discovery metadata from ${config.discoveryUrl}`);
  oidcMetadata = await loadDiscoveryMetadata();
  console.log(`[bpuu-workflow] discovery metadata loaded. issuer=${oidcMetadata.issuer}`);

  remoteJwks = createRemoteJWKSet(new URL(oidcMetadata.jwks_uri));

  // ThaID discovery — best-effort, non-fatal (see loadThaidDiscoveryMetadata).
  console.log(
    `[bpuu-workflow] fetching ThaID discovery metadata from ${config.thaidBaseUrl}/.well-known/openid-configuration`
  );
  thaidMetadata = await loadThaidDiscoveryMetadata();
  if (thaidMetadata) {
    console.log(`[bpuu-workflow] ThaID discovery metadata loaded. issuer=${thaidMetadata.issuer}`);
    thaidRemoteJwks = createRemoteJWKSet(new URL(thaidMetadata.jwks_uri));
  } else {
    console.warn(
      '[bpuu-workflow] ThaID metadata unavailable — /external will show a friendly "unavailable" page ' +
        'until this is fixed. The KMUTT/ADFS flow above is unaffected.'
    );
  }

  if (hasTlsCert) {
    const tlsOptions = {
      cert: fs.readFileSync(config.tlsCertPath),
      key: fs.readFileSync(config.tlsKeyPath),
    };
    https.createServer(tlsOptions, app).listen(config.port, () => {
      console.log(`[bpuu-workflow] listening on https://localhost:${config.port}`);
      console.log(
        '[bpuu-workflow] using certs/cert.pem + certs/key.pem — if these were generated with plain ' +
          'openssl (not mkcert), the browser will warn the certificate is untrusted; that is expected, ' +
          'proceed past the warning. If generated with `mkcert` after `mkcert -install`, the browser ' +
          'should trust it with no warning.'
      );
    });
  } else {
    console.warn(
      `\n[bpuu-workflow] No TLS cert found at ${config.tlsCertPath} — falling back to plain HTTP.\n` +
        'ADFS requires an HTTPS redirect_uri (confirmed by KMUTT IT), so a REDIRECT_URI pointing at ' +
        'http://localhost will be rejected. Generate a local cert (e.g. via mkcert) or set TLS_CERT_PATH / ' +
        'TLS_KEY_PATH to use HTTPS.\n'
    );
    app.listen(config.port, () => {
      console.log(`[bpuu-workflow] listening on http://localhost:${config.port}`);
    });
  }
}

main().catch((err) => {
  console.error('[bpuu-workflow] fatal startup error:', err.message);
  process.exit(1);
});
