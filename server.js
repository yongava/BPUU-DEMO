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

  // เลขเวอร์ชันที่โชว์ใน footer — รูปแบบ v.YYYYMMDD-<ลำดับ deploy ของวันนั้น>
  // ปกติถูก bake เข้า image ตอน build (ARG APP_VERSION ใน Dockerfile) เพื่อให้
  // เลขนี้ผูกกับ build จริงเสมอ แต่ override ที่ runtime ผ่าน env ได้ถ้าจำเป็น
  appVersion: process.env.APP_VERSION || 'dev',

  // ลิงก์ท้ายกล่องยินยอมคุกกี้ ปล่อยว่าง = ไม่แสดงลิงก์นั้น (ดีกว่าลิงก์ตาย)
  privacyPolicyUrl:
    process.env.PRIVACY_POLICY_URL === undefined
      ? 'https://privacy.kmutt.ac.th/law/'
      : process.env.PRIVACY_POLICY_URL,
  termsUrl: process.env.TERMS_URL || '',

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
// โลโก้ KMUTT ต้อง inline เป็น <svg> ไม่ใช่ <img src="...svg"> เพราะไฟล์ SVG ที่
// โหลดผ่าน <img> เป็นเอกสารแยก ไม่รับ currentColor จาก CSS ของหน้าเพจ — โลโก้จะ
// กลายเป็นสีดำบนปุ่มส้มแทนที่จะเป็นสีขาว อ่านครั้งเดียวตอนบูตแล้ว cache ไว้
const KMUTT_LOGO_SVG = (() => {
  try {
    return fs
      .readFileSync(path.join(__dirname, 'img', 'kmutt-logo.svg'), 'utf8')
      .replace(/<\?xml[^>]*\?>\s*/g, '')
      .replace(/<svg /, '<svg class="login-provider-logo login-provider-logo--kmutt" aria-hidden="true" ');
  } catch (e) {
    return ''; // ไม่มีไฟล์ก็ไม่ล้ม — ปุ่มจะขึ้นข้อความอย่างเดียว
  }
})();

// adfsOnly = ซ่อนปุ่ม ThaID สำหรับหน้าที่มีแต่บัญชี มจธ. เท่านั้นที่ใช้ได้
//            (/admin, /approve-gate) — intro ใช้บอกบริบทของหน้านั้น ๆ
function renderLoginLandingPage({ expired = false, adfsOnly = false, intro = '' } = {}) {
  const expiredNotice = expired
    ? `<div class="alert alert-warning py-2 mb-3" role="alert" style="font-size:.95rem;">
      <i class="bi bi-clock-history me-1"></i>เซสชันหมดอายุ (ครบ 60 นาที) กรุณาเข้าสู่ระบบใหม่
    </div>`
    : '';
  const introText =
    intro ||
    (adfsOnly
      ? 'กรุณาเข้าสู่ระบบด้วยบัญชี มจธ.'
      : `การให้บริการของ<br>กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน<br>
      กรุณาเลือกประเภทผู้ใช้งานเพื่อเริ่มยื่นคำขอ`);
  const thaidButton = adfsOnly
    ? ''
    : `
    <a href="/external" class="btn btn-ci-bluegrey btn-lg w-100 fw-bold login-provider-btn">
      <img src="/img/thaid-logo.png" alt="" class="login-provider-logo login-provider-logo--thaid"
           onerror="this.remove()"><span class="login-provider-text"><span>Login with ThaiD</span><span>(เฉพาะบุคคลภายนอกเท่านั้น)</span></span>
    </a>`;
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
    /* โลโก้หลักเป็นไฟล์ CI สีส้มบนพื้นโปร่งใส วางบนการ์ดขาวได้ตรง ๆ
       จึงไม่ต้องมีวงกลมสีส้มรองแบบเดิม (ซึ่งทำให้โลโก้ต้องกลับเป็นสีขาว) */
    .login-icon {
      margin: 0 auto 20px;
      display: flex;
      justify-content: center;
    }
    .login-icon img { height: 76px; width: auto; }
  </style>
</head>
<body>
  <div class="login-card">
    ${expiredNotice}
    <div class="login-icon"><img src="/img/kmutt-main-logo.png" alt="KMUTT"></div>
    <h4 class="fw-bold text-ci-orange mb-2">ระบบกระบวนงาน (Workflow)</h4>
    <p class="text-ci-bluegrey mb-4">
      ${introText}
    </p>
    <a href="/login" class="btn btn-ci-orange btn-lg w-100 fw-bold${adfsOnly ? '' : ' mb-2'} login-provider-btn">
      ${KMUTT_LOGO_SVG}<span class="login-provider-text"><span>Login with KMUTT Account</span><span>(บุคลากร / นักศึกษา)</span></span>
    </a>${thaidButton}
  </div>
  <script src="/js/site-chrome.js" defer></script>
  <script src="/js/login-fit.js" defer></script>
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
// (/api/approve-gate/record, /api/admin/request-note, /api/admin/allowlist,
// /api/admin/locations). Every other route in this file is a GET, so this has
// no effect on them; a small size limit keeps it from being usable to send
// oversized payloads at any route that does read a body.
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
    // requireLogin gates BOTH '/' (where a ThaID user legitimately clicks
    // through to /external) and '/admin' (which only an ADFS session can ever
    // satisfy — external users can never be on the admin allowlist). Showing
    // the ThaID button on the admin gate would send the user through a full
    // DOPA login only to land back here with no explanation, so hide it there.
    const adminGate = isAdminPath(req.originalUrl);
    res.status(200).send(
      renderLoginLandingPage({
        expired: justExpired,
        adfsOnly: adminGate,
        intro: adminGate ? 'สำหรับผู้ดูแลระบบ<br>กรุณาเข้าสู่ระบบด้วยบัญชี มจธ.' : '',
      })
    );
    return;
  }
  next();
}

// '/admin' และ '/api/admin/*' — ตัด query string ออกก่อนเทียบ กัน '/adminx'
// มาเข้าเงื่อนไขโดยไม่ตั้งใจ
function isAdminPath(originalUrl) {
  const path = String(originalUrl || '').split('?')[0];
  return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');
}

// JSON variant of requireLogin for fetch()-based admin APIs: an absent or
// expired session gets a plain 401 the client script can detect, instead of
// the 200 HTML login page (which a res.json() caller misreads as success and
// then crashes on). Deliberately does NOT stash req.originalUrl — an API path
// must never become a post-login redirect target.
function requireLoginJson(req, res, next) {
  expireSessionIfNeeded(req);
  if (!req.session.user) {
    noStore(res);
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  next();
}

// Used by /approve-gate. A session from EITHER provider still satisfies this
// gate (an approver who is already signed in with ThaID is not kicked out
// mid-approval), but the login page it shows offers ADFS only: approvers come
// from Master Data and are always KMUTT staff, so sending someone through a
// full ThaID/DOPA login here would only ever dead-end. See the adfsOnly flag
// passed to renderLoginLandingPage below.
// Factory so each route can set its own login-landing wording. /approve-gate
// addresses an approver; /form-gate addresses whoever was assigned to fill a
// form (which can legitimately be a ThaID/external user — the form pages
// already handle a 'restricted' external session), so it must NOT hide the
// ThaID button or call the visitor an approver. Called with no args it keeps
// the historical approver-facing, ADFS-only landing.
function makeRequireAnyLogin({ adfsOnly = true, intro = 'สำหรับผู้อนุมัติคำขอ<br>กรุณาเข้าสู่ระบบด้วยบัญชี มจธ.' } = {}) {
  return function requireAnyLoginRoute(req, res, next) {
    const justExpired = expireSessionIfNeeded(req);
    if (!req.session.user && !req.session.externalUser) {
      req.session.redirectAfterLogin = req.originalUrl;
      req.session.thaidRedirectAfterLogin = req.originalUrl;
      noStore(res);
      res.status(200).send(renderLoginLandingPage({ expired: justExpired, adfsOnly, intro }));
      return;
    }
    next();
  };
}

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
    res.status(200).send(
      renderLoginLandingPage({
        expired: justExpired,
        adfsOnly: true,
        intro: 'สำหรับผู้อนุมัติคำขอ<br>กรุณาเข้าสู่ระบบด้วยบัญชี มจธ.',
      })
    );
    return;
  }
  next();
}

// requireAnyLogin renders an HTML login-landing page (status 200) for
// unauthenticated requests — right for pages, wrong for JSON APIs: a
// fetch() caller would see a "successful" response whose body isn't JSON.
// The /api/approve-gate/* endpoints use this variant, which answers an
// expired/absent session with a plain 401 the client script can react to
// (and deliberately does NOT stash req.originalUrl — an API path must never
// become a post-login redirect target).
function requireAnyLoginJson(req, res, next) {
  expireSessionIfNeeded(req);
  if (!req.session.user && !req.session.externalUser) {
    noStore(res);
    res.status(401).json({ error: 'unauthenticated' });
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
  // BuildingName-Display จากมาสเตอร์ชีต — "รหัส-ชื่ออาคาร" (เช่น "S2-อาคารจอดรถ")
  // ใช้เป็นข้อความที่แสดงในดรอปดาวน์เลือกอาคารของฟอร์ม. แถวเก่าที่ยังไม่มีค่านี้
  // จะ fallback ไปใช้ buildingName ตามเดิม (ดู buildingDisplayName ด้านล่าง).
  'buildingNameDisplay',
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

// ชุดข้อมูลสถานที่ตั้งต้น (Area Master) ที่ฝังมากับ image — ใช้เมื่อ volume
// ยังไม่มี data/locations.json (deploy ครั้งแรก หรือ volume ใหม่) เพื่อให้ทุก
// environment ขึ้นมาพร้อมข้อมูลชุดเดียวกันโดยไม่ต้องคัดลอกไฟล์เข้าไปเอง
// แนวเดียวกับการ seed รายชื่อผู้ดูแลจาก ADMIN_SEED_EMAIL: seed เฉพาะตอนที่
// ยังไม่มีไฟล์เท่านั้น จะไม่เขียนทับข้อมูลที่ผู้ดูแลแก้ไว้แล้ว
const LOCATIONS_SEED_PATH =
  process.env.LOCATIONS_SEED_PATH || path.join(__dirname, 'data-seed', 'locations.json');

function readSeedLocations() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCATIONS_SEED_PATH, 'utf8'));
    if (Array.isArray(parsed)) return parsed.map(normalizeLocation).filter(Boolean);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[bpuu-workflow] could not read locations seed (${err.message})`);
    }
  }
  return [];
}

function loadLocations() {
  if (locationsCache) return locationsCache;
  let list = [];
  let seeded = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf8'));
    if (Array.isArray(parsed)) list = parsed.map(normalizeLocation).filter(Boolean);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[bpuu-workflow] could not read locations.json (${err.message}) — starting empty`);
    }
  }
  if (list.length === 0) {
    const seed = readSeedLocations();
    if (seed.length) {
      list = seed;
      seeded = true;
      console.log(`[bpuu-workflow] seeded ${seed.length} locations from ${LOCATIONS_SEED_PATH}`);
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
  // เขียนชุดตั้งต้นลง volume ครั้งแรก เพื่อให้การแก้ไขครั้งถัดไปต่อยอดจากไฟล์จริง
  // (best-effort — ถ้าเขียนไม่ได้ก็ยังทำงานต่อได้จากข้อมูลใน memory)
  if (seeded) {
    try {
      fs.mkdirSync(path.dirname(LOCATIONS_PATH), { recursive: true });
      fs.writeFileSync(LOCATIONS_PATH, JSON.stringify(list, null, 2) + '\n', 'utf8');
    } catch (err) {
      console.error(`[bpuu-workflow] could not persist seeded locations: ${err.message}`);
    }
  }
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

// ---------------------------------------------------------------------------
// Per-request admin notes (หมายเหตุ)
// JotForm owns the request data and is read-only from here, so notes live in
// a local file keyed by JotForm submission id — same load/save/cache pattern
// as the allowlist and locations stores. Lives in data/ so it rides the same
// /app/data docker volume and survives restarts.
const REQUEST_NOTES_PATH =
  process.env.REQUEST_NOTES_PATH || path.join(__dirname, 'data', 'request-notes.json');
const REQUEST_NOTE_MAX_LENGTH = 1000;

let requestNotesCache = null;

function loadRequestNotes() {
  if (requestNotesCache) return requestNotesCache;
  let notes = {};
  try {
    const raw = fs.readFileSync(REQUEST_NOTES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) notes = parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[bpuu-workflow] request notes file unreadable (${err.message}) — starting empty`);
      // Notes are hand-authored and can't be regenerated from JotForm — park
      // the unreadable file aside for hand-recovery so the next save can't
      // overwrite it with a near-empty store.
      try {
        fs.renameSync(REQUEST_NOTES_PATH, `${REQUEST_NOTES_PATH}.corrupt-${Date.now()}`);
      } catch (renameErr) {
        console.error(`[bpuu-workflow] could not preserve corrupt notes file: ${renameErr.message}`);
      }
    }
  }
  requestNotesCache = notes;
  return requestNotesCache;
}

function saveRequestNote(id, note, editorEmail) {
  const notes = { ...loadRequestNotes() };
  if (note === '') {
    // Clearing the text removes the entry entirely so the file doesn't
    // accumulate empty records.
    delete notes[id];
  } else {
    notes[id] = { note, updatedAt: new Date().toISOString(), updatedBy: editorEmail || '' };
  }
  fs.mkdirSync(path.dirname(REQUEST_NOTES_PATH), { recursive: true });
  // Write-then-rename so a crash mid-write can never leave a truncated
  // notes file behind (rename within the same directory is atomic).
  const tmpPath = `${REQUEST_NOTES_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(notes, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, REQUEST_NOTES_PATH);
  requestNotesCache = notes;
  return notes[id] || null;
}

// ข้อมูลสถานที่สำหรับ "ฟอร์มขอทำสัญญา" ในหน้าผู้ใช้ — เดิมหน้าฟอร์มดึง CSV
// จาก Google Sheets โดยตรง ทำให้ข้อมูลที่ผู้ดูแลแก้ในหน้า /admin กับที่ผู้ใช้
// เห็นในฟอร์มเป็นคนละชุดกัน. ตอนนี้ทั้งสองฝั่งอ่านจาก data/locations.json
// ชุดเดียวกัน (หน้า admin คือแหล่งข้อมูลจริงชุดเดียว).
//
// คืนค่าเป็น array-of-arrays เรียงคอลัมน์ตาม CSV เดิมเป๊ะ ๆ เพื่อให้โค้ดฝั่ง
// หน้าเว็บที่อ้าง row[1]/row[3]/row[5]/row[7] ทำงานได้เหมือนเดิม แล้วต่อท้าย
// index 9 = BuildingName-Display (ชื่ออาคารที่ใช้แสดงในดรอปดาวน์).
// เรียงตาม CompanyCode แล้ว CampusCode ตามที่ผู้ใช้งานกำหนด — ลำดับใน
// ดรอปดาวน์อิงลำดับของ array นี้โดยตรง.
//
// เปิด public โดยตั้งใจ (ไม่มี requireLogin): หน้า login โหลดข้อมูลชุดนี้ก่อน
// เข้าระบบ และผู้ใช้ภายนอก (ThaID) ไม่มี session แบบ ADFS — ใส่ด่าน login
// จะทำให้ดรอปดาวน์บริษัทว่างทั้งสองกรณี ข้อมูลนี้เคยเผยแพร่เป็น CSV สาธารณะ
// บน Google Sheets อยู่แล้ว และ endpoint นี้คืนเฉพาะฟิลด์ชุดเดียวกัน
// (ไม่มีชื่อ/อีเมลผู้ดูแลพื้นที่ ซึ่งมีเฉพาะใน /api/admin/locations ที่ยังติดด่านตามเดิม)
app.get(
  '/api/locations',
  asyncHandler(async (req, res) => {
    noStore(res);
    const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
    const rows = loadLocations()
      .slice()
      .sort(
        (a, b) =>
          collator.compare(a.companyCode || '', b.companyCode || '') ||
          collator.compare(a.campusCode || '', b.campusCode || '') ||
          collator.compare(a.buildingCode || '', b.buildingCode || '')
      )
      .map((l) => [
        l.campusCode || '',
        l.campusName || '',
        l.buildingCode || '',
        l.buildingName || '',
        l.businessTypeCode || '',
        l.businessTypeName || '',
        l.companyCode || '',
        l.companyName || '',
        'Y', // คอลัมน์ isactive เดิมของ CSV — เก็บไว้ให้รูปแบบแถวเท่าเดิม
        // แถวเก่าที่ยังไม่มี BuildingName-Display ให้ fallback เป็นชื่ออาคารเดิม
        l.buildingNameDisplay || l.buildingName || '',
      ]);
    res.status(200).json({ locations: rows });
  })
);

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
      // userType.type === null means KMUTT Master Data had no staff/student
      // record for this account (or was unconfigured/unreachable). The client
      // treats that as บุคคลภายนอก and renders the external menu set — see the
      // /api/me handler in index.html. Reported as-is here; this endpoint
      // states the facts and does not classify.
      res.status(200).json({
        type: 'kmutt',
        claims: req.session.user.claims,
        userType: req.session.user.kmuttUserType || { type: null, displayName: null, department: null, statusName: null },
        requesterProfile: req.session.user.kmuttRequesterProfile || { type: null, requester: null, approver: null },
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
// Shared by /approve-gate and /form-gate — both forward to JotForm URLs.
// Any *.jotform.com host qualifies (www/submit for deeplinks, form.jotform.com
// for {formLink} form URLs) — still strictly JotForm-owned, never elsewhere.
function isAllowedJotformTarget(rawTarget) {
  try {
    const parsed = new URL(rawTarget);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'jotform.com' || parsed.hostname.endsWith('.jotform.com'))
    );
  } catch (err) {
    return false;
  }
}

// Resolve the {approvalDeeplink} to the final JotForm approval-form URL by
// following its redirect chain server-side. The confirm page embeds THIS
// resolved URL in a visible iframe, not the deeplink: the deeplink's own
// multi-hop redirect renders blank inside a frame, but the final
// approval-form page frames cleanly (verified live 2026-08-27 — the blank
// was the redirect chain, never an iframe limitation of the task page).
// Returns the resolved https jotform.com URL, or null on any failure /
// non-jotform result — the caller then falls back to the raw deeplink so a
// resolver hiccup never blocks the approver.
async function resolveJotformTaskUrl(deeplinkTarget) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(deeplinkTarget, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          // browser UA — without it JotForm resolves to a login page instead
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
        },
      });
      const finalUrl = resp.url;
      return isAllowedJotformTarget(finalUrl) ? finalUrl : null;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`[bpuu-workflow] could not resolve approval deeplink: ${err.message}`);
    return null;
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

// 'special' covers boxes with a non-binary decision (e.g. จอดรถรายเดือน's
// "กรณีพิเศษ" button alongside the usual accept/reject) — same deeplink+
// iframe completion mechanism as accept/reject, just a third recorded label.
// 'invalid_code' / 'budget_insufficient' / 'other' cover the รหัสตัดงบประมาณ
// box's three distinct non-accept reasons — recorded and labeled separately
// (rather than lumped under 'reject') so the confirm screen and the audit
// trail in approval-decisions.json show which one was actually clicked.
// 'needs_edit' covers the นัดหมาย box's "แก้ไขข้อมูลนัดหมาย" button — a
// request to correct the appointment details, not a rejection of the
// request itself, hence its own outcome (and amber, not red, in the email).
const VALID_APPROVAL_OUTCOMES = new Set([
  'accept',
  'reject',
  'special',
  'invalid_code',
  'budget_insufficient',
  'other',
  'needs_edit',
]);

function outcomeToLabel(outcome) {
  if (outcome === 'reject') return 'ไม่อนุมัติ';
  if (outcome === 'accept') return 'อนุมัติ';
  if (outcome === 'special') return 'กรณีพิเศษ';
  if (outcome === 'invalid_code') return 'รหัสงบประมาณไม่ถูกต้อง';
  if (outcome === 'budget_insufficient') return 'งบประมาณคงเหลือไม่เพียงพอ';
  if (outcome === 'other') return 'อื่น ๆ';
  if (outcome === 'needs_edit') return 'แก้ไขข้อมูลนัดหมาย';
  return String(outcome || '-');
}

// The q68 (สถานะดำเนินการ) value written back after an approval step
// completes. JotForm's own workflow does NOT write q68 (verified 2026-08-27:
// after a real approval q68 stayed "รอพิจารณา", updated_at frozen), yet q68
// is the single field the request list / tracking reads — so the gate writes
// it itself once it has confirmed the task closed. Returns null for outcomes
// that are not a final request status (the budget-code box's reasons and the
// edit-appointment action are mid-workflow steps, not an end state) so those
// leave q68 untouched rather than mislabeling the request.
//
// NOTE for multi-step flows (e.g. จอดรถ: หัวหน้าหน่วยงาน → BPUU): an early
// accept here would prematurely mark the whole request "อนุมัติแล้ว". Flow 1
// (แจ้งปัญหา) is single-step so accept IS final. When a multi-step flow is
// wired, pass the intended status per link instead of relying on this map —
// see the `status` override read in /approve-gate.
function outcomeToQ68Status(outcome) {
  if (outcome === 'accept') return 'อนุมัติแล้ว';
  if (outcome === 'reject') return 'ไม่อนุมัติ';
  if (outcome === 'special') return 'อนุมัติแล้ว';
  return null;
}

// Writes a single field on a submission via JotForm's submission API — the
// same call proven to move q68 in the live table (2026-08-27). Best-effort:
// the approval itself already landed on JotForm's side, so a failed status
// write must be logged, never surfaced as an approval failure.
async function writeJotformSubmissionField(submissionId, fieldId, value) {
  if (!isJotformConfigured() || !submissionId) return false;
  const url = new URL(`${config.jotformApiBaseUrl}/submission/${encodeURIComponent(submissionId)}`);
  url.searchParams.set('apiKey', config.jotformApiKey);
  const body = new URLSearchParams();
  body.set(`submission[${fieldId}]`, value);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(JOTFORM_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`JotForm submission update returned HTTP ${response.status}`);
  }
  return true;
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
//   1. Server-side fetch()/POST of the deeplink: DOES NOT WORK. A GET only
//      reads the task page; the actual POST to submit.jotform.com is met by
//      a captcha ("Please Complete", verified 2026-08-27).
//   2. Hidden iframe: FALSE POSITIVE. It loaded the task page and reported
//      success while the workflow never advanced.
//   3. Visible iframe of the RESOLVED /approval-form URL (2026-08-27): WORKS,
//      end-to-end confirmed. The approver presses JotForm's own Submit inside
//      a frame embedded in our page — no new tab, no JotForm URL in the
//      address bar. Completion is confirmed server-side via the task-state
//      probe (the task's outcome buttons disappear), and only then recorded.
//      The frame must load the resolved /approval-form URL, not the deeplink
//      (the deeplink's redirect chain renders blank when framed).
//
// q68 (สถานะดำเนินการ) is NOT written by JotForm's approval step — it stays
// "รอพิจารณา" with updated_at frozen even on a real approval. Because q68 is
// the single field the request list / tracking reads, the gate writes it
// itself right after confirming completion (see outcomeToQ68Status +
// writeJotformSubmissionField in the record endpoint). It is therefore now a
// reliable status, not a mere bonus — but a WRITE failure still must never be
// reported as an approval failure, since the approval already landed.
//
// Reads ONE full submission straight from JotForm. Returns null when JotForm
// isn't configured or submissionId is missing; throws on API failure.
async function fetchJotformSubmission(submissionId) {
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
  return body.content || null;
}

// Reads ONE submission's current สถานะดำเนินการ (q68) straight from JotForm.
// Returns null when JotForm isn't configured or the submission can't be read.
async function fetchJotformSubmissionStatus(submissionId) {
  const content = await fetchJotformSubmission(submissionId);
  if (!content) return null;
  return jotformAnswer(content.answers || {}, '68');
}

// Layout/UI controls and other elements that carry no user-entered request
// data — excluded from the detail table on the approval confirm screen.
const JOTFORM_NON_DATA_TYPES = new Set([
  'control_head',
  'control_button',
  'control_pagebreak',
  'control_divider',
  'control_text',
  'control_image',
  'control_captcha',
]);

// A single answer entry → display string. prettyFormat (when JotForm
// provides one) is preferred because composite fields (name, date, matrix)
// render as readable text there; it can contain JotForm-generated HTML, so
// reduce it to plain text here — escapeHtml happens at render time.
function jotformAnswerDisplayValue(entry) {
  let value =
    entry.prettyFormat !== undefined && entry.prettyFormat !== null && entry.prettyFormat !== ''
      ? entry.prettyFormat
      : entry.answer;
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    value = value.filter((v) => v !== null && v !== undefined && v !== '').join(', ');
  } else if (typeof value === 'object') {
    value = Object.values(value)
      .filter((v) => typeof v === 'string' && v.trim() !== '')
      .join(' ');
  }
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();
}

// Builds the "รายละเอียดคำขอ" rows for the approval screens from a full
// submission — every answered data field, in form order, same information
// the approver already sees in the notification email's submission table.
// แสดงวันที่เป็น '01 August 2026' ให้เหมือนกับหน้าสรุปคำขอฝั่งผู้ยื่น
// (js/app.js formatDisplayDate) — ประกอบสตริงเองไม่ใช้ toLocaleDateString
// เพื่อไม่ให้ผลลัพธ์เปลี่ยนตาม locale ของเครื่องที่รัน container
const DISPLAY_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function formatDisplayDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return value;
  const month = DISPLAY_MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]} ${month} ${m[1]}` : value;
}

// ข้อความสรุป (q32) ถูกสร้างตอนยื่นคำขอ คำขอเก่าจึงยังฝังวันที่แบบ YYYY-MM-DD
// อยู่ข้างใน — แปลงตอนแสดงผลด้วย เพื่อให้คำขอเก่ากับใหม่หน้าตาเหมือนกัน
// (จับเฉพาะรูปแบบวันที่เต็ม ๆ ไม่แตะเลขอื่นอย่างทะเบียนรถหรือจำนวนเงิน)
function formatDatesInText(text) {
  return String(text ?? '').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (whole) => formatDisplayDate(whole));
}

function submissionDetailRows(content) {
  const answers = (content && content.answers) || {};
  const rows = [];
  for (const [qid, entry] of Object.entries(answers)) {
    if (!entry || JOTFORM_NON_DATA_TYPES.has(entry.type)) continue;
    // q68 (สถานะดำเนินการ) is written by a LATER workflow node, not the
    // approval step (see the doctrine above) — showing its stale value under
    // an approval screen misleads; it already has its own caveated channel.
    if (qid === '68') continue;
    const label = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!label) continue;
    const value = formatDatesInText(jotformAnswerDisplayValue(entry));
    if (!value) continue;
    rows.push({ order: Number(entry.order) || Number(qid) || 0, label, value });
  }
  rows.sort((a, b) => a.order - b.order);
  return rows.map(({ label, value }) => ({ label, value }));
}

// ---------------------------------------------------------------------------
// Double-approval guard.
//
// JotForm's deeplink happily completes the same approval step again (or the
// opposite outcome, from the other link in the same email) — nothing on the
// JotForm side stops a second click, and q68 explicitly cannot be trusted to
// reflect the approval step (see the renderer comment above). So this app
// keeps its own record of confirmed decisions, and later /approve-gate
// visits for the same step get the "already decided" screen instead of a
// confirm button. Persistence pattern (and directory/volume) mirrors
// admin-allowlist.json — and like it, WITHOUT a mounted volume the record
// only lasts until the next restart.
//
// The record is keyed per APPROVAL STEP, not per submission: one submission
// flows through several approval nodes (department manager → BPUU manager →
// …), each with its own email but all carrying the same submission id —
// keying on the id alone would deadlock every request at its second stage.
// One node = one {approvalDeeplink}; the accept/reject buttons within one
// email share that deeplink and differ only in ?outcomeID=N. So the step
// identity is the target minus its outcomeID: the same email's buttons
// collide (desired), the next stage's email does not (desired). A side
// benefit: because the key is derived from the real deeplink, a logged-in
// user cannot pre-poison the record for a step whose deeplink they don't
// possess — and someone who does possess the deeplink can already approve
// on JotForm directly, so the guard's residual exposure is unchanged.
// ---------------------------------------------------------------------------

const APPROVAL_DECISIONS_PATH =
  process.env.APPROVAL_DECISIONS_PATH ||
  path.join(path.dirname(ADMIN_ALLOWLIST_PATH), 'approval-decisions.json');

// Submission ids are numeric today; keep the accepted charset slightly wider
// but bounded, so a hostile id can't smuggle path/JSON/prototype tricks into
// the store ('__proto__' fails this test).
function isPlausibleSubmissionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== '__proto__';
}

function approvalStepKey(submissionId, target) {
  // The email templates build target as `{approvalDeeplink}?outcomeID=N`,
  // and the deeplink already carries its own query string — so the second
  // '?' is literal and outcomeID ends up glued onto the tail of the LAST
  // param's VALUE, not as a top-level param. The step key must be identical
  // for every button of one step (accept/reject/…) so that once ANY of them
  // is recorded, all of them show the close-only decided page. It must also
  // differ between genuinely different steps (a later approver on the same
  // submission) — the deeplink body carries that distinction.
  //
  // Two spellings routinely vary without changing which step it is, and both
  // must be normalized away before hashing or the guard fractures per-button:
  //   - the '?' / '&' before outcomeID is sometimes percent-encoded
  //     (%3F / %26) by the mail editor — some real templates in docs/ do this;
  //   - the jotform host casing can vary.
  // (Param REORDER inside the opaque deeplink is not normalized — templates
  // are author-controlled and stable per box, so it doesn't arise in practice.)
  let s = String(target || '')
    .replace(/%3f/gi, '?')
    .replace(/%26/gi, '&');
  const match = s.match(/[?&]outcomeID=([^&#]*)/i);
  const outcomeId = match ? match[1] : '';
  s = s.replace(/[?&]outcomeID=[^&#]*/gi, '');
  s = s.replace(/^https?:\/\/[^/?#]+/i, (host) => host.toLowerCase());
  const hash = crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  return { key: `${submissionId}:${hash}`, outcomeId };
}

// Re-read on every call — the file is tiny and consulted at most a couple of
// times per approval click, and skipping a cache means a decision cleared by
// hand (delete the entry, or the whole file) takes effect without a restart.
// Entries are rehosted onto a null-prototype object so a key like
// 'constructor' can never alias Object.prototype.
function loadApprovalDecisions() {
  let raw = null;
  try {
    raw = fs.readFileSync(APPROVAL_DECISIONS_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[bpuu-workflow] could not read approval-decisions.json (${err.message}) — treating as empty`);
    }
    return Object.create(null);
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.assign(Object.create(null), parsed);
    }
    console.warn('[bpuu-workflow] approval-decisions.json is not a JSON object — quarantining');
  } catch (err) {
    console.error(`[bpuu-workflow] approval-decisions.json is corrupt (${err.message}) — quarantining`);
  }
  // Malformed content: move it aside (never overwrite it on the next write —
  // it may be hand-recoverable) and start empty rather than taking the gate
  // down. JotForm's own approval history remains the audit backstop.
  try {
    fs.renameSync(APPROVAL_DECISIONS_PATH, `${APPROVAL_DECISIONS_PATH}.corrupt.${Date.now()}`);
  } catch (renameErr) {
    console.error(`[bpuu-workflow] could not quarantine approval-decisions.json: ${renameErr.message}`);
  }
  return Object.create(null);
}

function getRecordedApprovalDecision(stepKey) {
  const map = loadApprovalDecisions();
  const record = Object.hasOwn(map, stepKey) ? map[stepKey] : null;
  return record && typeof record === 'object' ? record : null;
}

// Atomic write (tmp + rename) so a crash mid-write can truncate only the
// tmp file, never the record itself. Callers treat a throw as "guard could
// not persist" and log it rather than blocking the approval.
function recordApprovalDecision(stepKey, record) {
  const map = loadApprovalDecisions();
  map[stepKey] = record;
  fs.mkdirSync(path.dirname(APPROVAL_DECISIONS_PATH), { recursive: true });
  const tmpPath = `${APPROVAL_DECISIONS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(map, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, APPROVAL_DECISIONS_PATH);
}

// Surface a missing/unwritable data directory at boot instead of at the
// first approval click: without it the double-approval guard silently
// degrades to per-run memory (see DEPLOY.md — mount a volume at /app/data).
try {
  fs.mkdirSync(path.dirname(APPROVAL_DECISIONS_PATH), { recursive: true });
  fs.accessSync(path.dirname(APPROVAL_DECISIONS_PATH), fs.constants.W_OK);
} catch (err) {
  console.warn(
    `[bpuu-workflow] WARNING: ${path.dirname(APPROVAL_DECISIONS_PATH)} is not writable (${err.message}) — approval decisions will NOT survive a restart`
  );
}

function formatThaiTimestamp(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return String(isoString || '-');
  return date.toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  });
}

const APPROVAL_PAGE_STYLE = `
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Sarabun", Roboto, Helvetica, Arial, sans-serif;
      background: #f2f4f7; color: #1f2430; margin: 0; padding: 48px 16px; line-height: 1.6; }
    .card { max-width: 620px; margin: 0 auto; background: #fff; border: 1px solid #dde1e7; border-radius: 10px; padding: 28px; text-align: center; }
    h1 { font-size: 1.2rem; margin: 0 0 12px; }
    p { margin: 8px 0; color: #444; }
    .meta { font-size: 0.9rem; color: #667; margin-top: 4px; }
    button.button, a.button { display: inline-block; margin-top: 20px; background: #ea580c; color: #fff; text-decoration: none;
      padding: 12px 28px; border-radius: 6px; font-weight: 600; border: none; font-size: 1rem; cursor: pointer;
      font-family: inherit; }
    .icon { width: 56px; height: 56px; line-height: 56px; margin: 0 auto 12px; border-radius: 50%;
      background: #e6f4ea; color: #1e7e34; font-size: 1.6rem; font-weight: 700; }
    .icon.decided { background: #fff4e5; color: #b26a00; }
    .spinner { width: 34px; height: 34px; margin: 14px auto 6px; border: 3px solid #e6e9ee;
      border-top-color: #ea580c; border-radius: 50%; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .warn { color: #b26a00; font-size: 0.92rem; }
    .fallback { font-size: 0.9rem; margin-top: 14px; }
    .fallback a { color: #ea580c; }
    .details { text-align: left; margin-top: 18px; border: 1px solid #e3e6ea; border-radius: 8px; overflow: hidden; }
    .details-title { padding: 10px 14px; background: #f7f8fa; border-bottom: 1px solid #e3e6ea;
      font-weight: 700; font-size: 0.95rem; }
    .details-scroll { max-height: 340px; overflow-y: auto; }
    .details table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .details th, .details td { padding: 7px 14px; border-top: 1px solid #eef0f3; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
    .details tr:first-child th, .details tr:first-child td { border-top: none; }
    .details th { width: 42%; color: #667; font-weight: 600; }
    @media (max-width: 480px) { .details th { width: 36%; } }
    .card.wide { max-width: 780px; }
    .jf-frame-holder { margin-top: 16px; border: 1px solid #dde1e7; border-radius: 8px; overflow: hidden; background: #fff; }
    .jf-frame-holder iframe { display: block; width: 100%; height: min(70vh, 620px); border: 0; }
    @media (prefers-color-scheme: dark) {
      body { background: #14161a; color: #e7e9ee; }
      .card { background: #1d2026; border-color: #2c313a; }
      p { color: #b7bfcc; }
      .meta { color: #98a0ae; }
      .warn { color: #e8a13d; }
      .details, .details th, .details td { border-color: #2c313a; }
      .details th { color: #9aa3b2; }
      .details-title { background: #23262d; border-color: #2c313a; }
      .jf-frame-holder { border-color: #2c313a; }
    }
`;

// The "รายละเอียดคำขอ" table shared by the confirm and already-decided
// screens. detailRows === null means the lookup failed (or JotForm isn't
// configured) — say so instead of silently showing nothing, so the approver
// knows to double-check the email before confirming. 'restricted' means the
// viewer's identity doesn't get to see submission contents (ThaID sessions:
// the submission is full of requester PII, and external identities have no
// business reading it — they can still complete the approval they were
// emailed, the details are in that same email).
function renderApprovalDetailsHtml(detailRows) {
  if (detailRows === 'restricted') {
    return '<p class="meta">รายละเอียดคำขอแสดงเฉพาะผู้ใช้งาน KMUTT — ท่านสามารถตรวจสอบรายละเอียดได้จากอีเมลแจ้งเตือน</p>';
  }
  if (detailRows === null) {
    return '<p class="warn">ไม่สามารถโหลดรายละเอียดคำขอได้ในขณะนี้ กรุณาตรวจสอบรายละเอียดจากอีเมลแจ้งเตือนก่อนยืนยัน</p>';
  }
  if (!detailRows.length) return '';
  const rows = detailRows
    .map(
      (r) =>
        `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value).replace(/\n/g, '<br>')}</td></tr>`
    )
    .join('');
  return `<div class="details"><div class="details-title">รายละเอียดคำขอ</div><div class="details-scroll"><table>${rows}</table></div></div>`;
}

const APPROVAL_FALLBACK_CONTACT_HTML = `<div class="fallback">
        หากพบปัญหา กรุณาติดต่อกลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU)<br>
        โทร. 02-470-8320-3 &middot; <a href="mailto:bpuu@kmutt.ac.th">bpuu@kmutt.ac.th</a>
      </div>`;

// Shown instead of the confirm screen once a decision for this approval
// step has already been recorded through this gate — the double-approval
// guard's user-facing half. No confirm button, and nothing on this page
// touches JotForm — a second visit can never re-fire the deeplink. Its only
// button closes the window, the same way the confirm page ends once a
// decision has gone through, so both paths finish on the same screen.
function renderApprovalDecidedPage({ id, decided, upn, detailRows }) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>คำขอนี้ได้รับการพิจารณาแล้ว — ระบบกระบวนงาน BPUU</title>
  <style>${APPROVAL_PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <div class="icon decided">!</div>
    <h1>ขั้นตอนการพิจารณานี้ได้รับการบันทึกผลไปแล้ว</h1>
    <p>คำขอหมายเลข <strong>${escapeHtml(id || '-')}</strong></p>
    <p>ผลที่บันทึกไว้: <strong>${escapeHtml(decided.outcomeLabel || outcomeToLabel(decided.outcome))}</strong></p>
    <p class="meta">บันทึกโดย: ${escapeHtml(decided.identity || '-')} &middot; เมื่อ ${escapeHtml(formatThaiTimestamp(decided.at))}</p>
    <p class="meta">เข้าสู่ระบบเป็น: ${escapeHtml(upn)}</p>
    <p class="warn">ระบบไม่เปิดให้บันทึกผลซ้ำ หากต้องการเปลี่ยนแปลงผลการพิจารณา กรุณาติดต่อเจ้าหน้าที่</p>
    <button type="button" class="button" onclick="window.close()">ปิดหน้าต่างนี้</button>
    <p class="meta">หากกดแล้วหน้าต่างไม่ปิด ท่านสามารถปิดแท็บนี้ได้เอง</p>
    ${renderApprovalDetailsHtml(detailRows)}
    ${APPROVAL_FALLBACK_CONTACT_HTML}
  </div>
</body>
</html>`;
}

function renderApprovalConfirmPage({ id, outcome, outcomeLabel, target, resolvedTarget, upn, beforeStatus, detailRows }) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ยืนยันการพิจารณาคำขอ — ระบบกระบวนงาน BPUU</title>
  <style>${APPROVAL_PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <div id="stepConfirm">
      <h1>ยืนยันผลการพิจารณา</h1>
      <p>คำขอหมายเลข <strong>${escapeHtml(id || '-')}</strong></p>
      <p>ท่านกำลังจะบันทึกผล: <strong>${escapeHtml(outcomeLabel)}</strong></p>
      <p class="meta">เข้าสู่ระบบเป็น: ${escapeHtml(upn)}</p>
      ${renderApprovalDetailsHtml(detailRows)}
      <button type="button" id="confirmBtn" class="button">ยืนยัน — ${escapeHtml(outcomeLabel)}</button>
    </div>

    <div id="stepWorking" style="display:none">
      <h1>กดยืนยันผลในกรอบด้านล่าง</h1>
      <p id="workingMsg">ผลที่เลือกไว้: <strong>${escapeHtml(outcomeLabel)}</strong> —
        กรุณากดปุ่ม <strong>Submit</strong> ในกรอบด้านล่างเพื่อบันทึกผล
        หน้านี้จะขึ้นผลให้อัตโนมัติเมื่อบันทึกสำเร็จ</p>
      <div id="frameHolder" class="jf-frame-holder"></div>
      <p class="meta" id="workingNote">กำลังรอการยืนยัน…</p>
      <button type="button" id="recheckBtn" class="button" style="display:none">ตรวจสถานะอีกครั้ง</button>
    </div>

    <div id="stepError" style="display:none">
      <div class="icon decided">!</div>
      <h1>ยังบันทึกผลไม่ได้</h1>
      <p>หน้าบันทึกผลเรียกขอการเข้าสู่ระบบเพิ่มเติม จึงยังไม่สามารถบันทึกผลได้</p>
      <p class="warn">กรุณาแจ้งผู้ดูแลระบบให้ตรวจการตั้งค่าการเข้าถึงของขั้นพิจารณา (Require login) ใน workflow</p>
      ${APPROVAL_FALLBACK_CONTACT_HTML}
    </div>

    <div id="stepDone" style="display:none">
      <div class="icon">✓</div>
      <h1>บันทึกผลเรียบร้อยแล้ว</h1>
      <p>คำขอหมายเลข <strong>${escapeHtml(id || '-')}</strong></p>
      <p>ผลการพิจารณา: <strong>${escapeHtml(outcomeLabel)}</strong></p>
      <p class="meta" id="doneStatus"></p>
      <button type="button" class="button" onclick="window.close()">ปิดหน้าต่างนี้</button>
      <p class="meta">หากกดแล้วหน้าต่างไม่ปิด ท่านสามารถปิดแท็บนี้ได้เอง</p>
      ${APPROVAL_FALLBACK_CONTACT_HTML}
    </div>
  </div>

  <script>
    // The deeplink does NOT complete the approval by itself (established
    // 2026-08-27 against the live task): it resolves to JotForm's own
    // approval FORM page (/approval-form/...) which renders the outcome
    // preselected and waits for a human to press Submit. A HIDDEN iframe
    // therefore only ever displayed that page to nobody — every "success"
    // it reported was a false positive. Self-posting the form server-side
    // is not an option either (captcha — verified live, the reason
    // /form-gate embeds the real form instead).
    //
    // The fix: embed the RESOLVED approval-form URL in a VISIBLE iframe and
    // let the approver press JotForm's own Submit inside it. This keeps
    // everything on our gated page — no new tab, no JotForm URL in the
    // address bar for the approver to copy and forward. Crucial detail: the
    // iframe must load the RESOLVED /approval-form URL (RESOLVED_TARGET),
    // NOT the raw deeplink — the deeplink's multi-hop redirect renders blank
    // inside a frame, but the final approval-form page frames cleanly
    // (verified live; the blank was never an iframe limit of the task page).
    // If resolution failed server-side, RESOLVED_TARGET is null and we fall
    // back to the deeplink so the approver is never blocked.
    //
    // Completion is detected by polling /api/approve-gate/task-state — a
    // server-side read of the task page reporting whether its outcome
    // buttons are still offered (GET on the chain is side-effect-free).
    // Only on 'completed' is the decision recorded with our double-approval
    // guard — recording at click time (as before) could lock the step as
    // "decided" while JotForm still had the task pending, deadlocking it.
    // The probe also surfaces JotForm demanding a login as a real error.
    //
    // Verification note: q68 is NOT written by the approval step (see the
    // renderer comment above), so it is polled only in the BACKGROUND as a
    // bonus. "q68 didn't change" must never be presented as failure — an
    // earlier version did that and wrongly told approvers it hadn't worked.
    const TARGET = ${toScriptJson(target)};
    const RESOLVED_TARGET = ${toScriptJson(resolvedTarget || null)};
    const SUBMISSION_ID = ${toScriptJson(id || '')};
    const OUTCOME = ${toScriptJson(outcome || '')};
    const BEFORE_STATUS = ${toScriptJson(beforeStatus === null || beforeStatus === undefined ? null : beforeStatus)};

    const show = (which) => {
      for (const s of ['stepConfirm', 'stepWorking', 'stepDone', 'stepError']) {
        document.getElementById(s).style.display = s === which ? 'block' : 'none';
      }
      document.querySelector('.card').classList.toggle('wide', which === 'stepWorking');
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

    // Runs once JotForm actually took the submission (second frame load).
    // The guard record is written here — HTTP 409 means the other outcome's
    // record won the race; reload so the server renders the already-decided
    // screen. Any other failure (network, expired session) must not hide
    // the fact that JotForm DID record the outcome — the done screen still
    // shows, and the server log is the audit fallback.
    let completed = false;
    async function onJotformCompleted() {
      if (completed) return;
      completed = true;
      try {
        const rec = await fetch('/api/approve-gate/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ id: SUBMISSION_ID, outcome: OUTCOME, target: TARGET }),
        });
        if (rec.status === 409) {
          window.location.reload();
          return;
        }
      } catch (err) { /* see comment above */ }

      document.getElementById('doneStatus').textContent =
        'ระบบกำลังอัปเดตสถานะ อาจใช้เวลาสักครู่';
      show('stepDone');
      watchStatusInBackground();
    }

    // Polls the server-side task probe until the JotForm tab's Submit has
    // actually landed. 'unknown' (probe could not read the page) just keeps
    // waiting — it must never be reported as either success or failure.
    // After the window runs out, the approver gets a manual re-check button
    // instead of an open-ended spinner.
    let polling = false;
    async function pollTaskState() {
      if (polling || completed) return;
      polling = true;
      document.getElementById('recheckBtn').style.display = 'none';
      document.getElementById('workingNote').textContent = 'กำลังรอการยืนยัน…';
      const startedAt = Date.now();
      while (Date.now() - startedAt < 5 * 60 * 1000) {
        await sleep(4000);
        if (completed) return;
        try {
          const res = await fetch('/api/approve-gate/task-state?target=' + encodeURIComponent(TARGET), {
            headers: { Accept: 'application/json' },
          });
          const data = await res.json();
          if (data && data.state === 'completed') {
            await onJotformCompleted();
            return;
          }
          if (data && data.state === 'login-required') {
            polling = false;
            show('stepError');
            return;
          }
        } catch (err) { /* keep waiting */ }
      }
      polling = false;
      document.getElementById('workingNote').textContent =
        'ยังไม่พบการบันทึกผล — หากกด Submit ในกรอบด้านบนแล้ว กรุณากด "ตรวจสถานะอีกครั้ง"';
      document.getElementById('recheckBtn').style.display = 'inline-block';
    }

    document.getElementById('recheckBtn').addEventListener('click', pollTaskState);

    document.getElementById('confirmBtn').addEventListener('click', () => {
      show('stepWorking');
      const frame = document.createElement('iframe');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      // The resolved /approval-form URL frames cleanly; the raw deeplink does
      // not (its redirect chain renders blank in a frame). Fall back to the
      // deeplink only if server-side resolution failed — better a blank frame
      // the approver can report than no path at all.
      frame.src = RESOLVED_TARGET || TARGET;
      document.getElementById('frameHolder').appendChild(frame);
      pollTaskState();
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

    if (!targetStr || !isAllowedJotformTarget(targetStr)) {
      res.status(400).send(
        renderErrorPage({
          title: 'ลิงก์ไม่ถูกต้อง',
          message: 'ลิงก์อนุมัตินี้ไม่ถูกต้องหรือหมดอายุ กรุณาติดต่อผู้ดูแลระบบ',
          retryHref: '/',
        })
      );
      return;
    }

    // The guard can only record what it can validate — so refuse to render a
    // confirm page for parameters the record endpoint would later reject
    // (unknown outcome, implausible id). Same failure mode as a bad target:
    // a link this app never generated. Template drift in the workflow emails
    // then fails loudly here instead of silently skipping the guard.
    if (!isPlausibleSubmissionId(typeof id === 'string' ? id : '') || !VALID_APPROVAL_OUTCOMES.has(outcome)) {
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

    // One JotForm read serves two needs: the detail table (the same request
    // information the approver sees in the notification email) and the
    // pre-approval q68 snapshot the done-screen watcher compares against.
    // Never fatal: if this can't be read, the confirm page says the details
    // couldn't be loaded and the done screen degrades to "sent, but
    // unverified" rather than claiming an unproven success.
    //
    // The submission is requester PII end to end, so the table is rendered
    // only for KMUTT (ADFS) sessions. A ThaID approver still completes the
    // approval normally — the same details are in the email they were sent.
    const isKmuttSession = Boolean(req.session.user);
    let detailRows = isKmuttSession ? null : 'restricted';
    let beforeStatus = null;
    try {
      const submission = await fetchJotformSubmission(id);
      if (submission) {
        if (isKmuttSession) detailRows = submissionDetailRows(submission);
        beforeStatus = jotformAnswer(submission.answers || {}, '68');
      }
    } catch (err) {
      console.warn(`[bpuu-workflow] approval gate: could not read submission ${id}: ${err.message}`);
    }

    // Double-approval guard: once a decision for this approval STEP has been
    // recorded through this gate, every later visit — either link from the
    // email, any tab, any login — sees what was recorded instead of another
    // confirm button. (Step keying: see the guard's header comment.)
    const { key: stepKey } = approvalStepKey(id, targetStr);
    const decided = getRecordedApprovalDecision(stepKey);
    if (decided) {
      console.log(
        `[bpuu-workflow] approval gate: identity=${identityLabel} id=${id} outcome=${outcome} -> already decided (${decided.outcome} by ${decided.identity} at ${decided.at})`
      );
      res.status(200).send(
        renderApprovalDecidedPage({
          id,
          decided,
          upn: identityLabel,
          detailRows,
        })
      );
      return;
    }

    // Resolve the deeplink to the final approval-form URL so the confirm
    // page can frame it directly (the deeplink itself won't frame — see the
    // confirm-page script). Non-fatal: on failure the page falls back to the
    // raw deeplink.
    const resolvedTarget = await resolveJotformTaskUrl(targetStr);

    console.log(
      `[bpuu-workflow] approval gate: identity=${identityLabel} id=${id} outcome=${outcome} beforeStatus=${
        beforeStatus === null ? '(unknown)' : beforeStatus
      } resolved=${resolvedTarget ? 'yes' : 'no'} -> confirm screen`
    );

    res.status(200).send(
      renderApprovalConfirmPage({ id, outcome, outcomeLabel, target: targetStr, resolvedTarget, upn: identityLabel, beforeStatus, detailRows })
    );
  })
);

// Status probe used by the confirm page to VERIFY that the in-page (iframe)
// approval actually advanced the workflow, rather than trusting a
// cross-origin load event. Returns the submission's current q68 value.
// `verifiable:false` tells the client it cannot prove success and must say so.
app.get(
  '/api/approve-gate/status',
  requireAnyLoginJson,
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

// Probes whether the JotForm approval task behind `target` still offers its
// outcome buttons. The confirm page polls this while the approver works in
// the JotForm tab (the task page refuses to render inside an iframe, so the
// tab is the only viable place for the actual click — see the confirm-page
// script). A GET of the task chain is side-effect-free: completing a task
// requires the form POST (established live 2026-08-27). Classification is
// by markers observed on the live pages:
//   'wfOutcomes'                        → buttons still offered → pending
//   'loginFlowHelper' / 'for-login-flow' → JotForm demands a login
//   any other 200 page                  → outcomes gone → completed
// Any fetch/HTTP failure reports 'unknown' so the poller keeps waiting
// rather than mis-reporting in either direction. Unlike /approve-gate, the
// target arrives properly URL-encoded here (our own client encodes it), so
// req.query is safe to use.
app.get(
  '/api/approve-gate/task-state',
  requireAnyLoginJson,
  asyncHandler(async (req, res) => {
    noStore(res);

    const target = typeof req.query.target === 'string' ? req.query.target : '';
    if (!isAllowedJotformTarget(target)) {
      res.status(400).json({ state: 'unknown', error: 'invalid target' });
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let html;
      try {
        const resp = await fetch(target, {
          redirect: 'follow',
          signal: controller.signal,
          // ไม่ใส่ UA แบบเบราว์เซอร์ JotForm จะพาไปหน้า login แทนหน้า task
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
          },
        });
        if (!resp.ok) {
          res.status(200).json({ state: 'unknown' });
          return;
        }
        html = await resp.text();
      } finally {
        clearTimeout(timer);
      }

      let state = 'completed';
      if (html.includes('wfOutcomes')) state = 'pending';
      else if (html.includes('loginFlowHelper') || html.includes('for-login-flow')) state = 'login-required';
      res.status(200).json({ state });
    } catch (err) {
      console.warn(`[bpuu-workflow] approval task-state probe failed: ${err.message}`);
      res.status(200).json({ state: 'unknown' });
    }
  })
);

// Records a confirmed decision — the write half of the double-approval
// guard. Called by the confirm page at the moment of the click, BEFORE the
// JotForm deeplink is loaded. First decision per approval step wins; a 409
// tells the page a decision already exists so it must not re-approve. The
// check-and-set below is synchronous end to end (no await between check and
// write), so two same-instant clicks (two tabs) cannot both pass it.
//
// `target` is required and must pass the same allowlist as /approve-gate:
// the record key is derived from it (see approvalStepKey), which is also
// what stops a logged-in user from pre-poisoning a step they don't hold the
// deeplink for. The recorded outcomeID is read from the target itself — the
// value JotForm will actually act on — so the audit record can always be
// reconciled even if the display-only `outcome` param ever drifts.
app.post(
  '/api/approve-gate/record',
  requireAnyLoginJson,
  asyncHandler(async (req, res) => {
    noStore(res);

    const body = req.body || {};
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const outcome = body.outcome;
    const target = typeof body.target === 'string' ? body.target : '';
    if (
      !isPlausibleSubmissionId(id) ||
      !VALID_APPROVAL_OUTCOMES.has(outcome) ||
      !isAllowedJotformTarget(target)
    ) {
      res.status(400).json({ error: 'invalid id, outcome, or target' });
      return;
    }

    const { key: stepKey, outcomeId } = approvalStepKey(id, target);
    const existing = getRecordedApprovalDecision(stepKey);
    if (existing) {
      res.status(409).json({ decided: existing });
      return;
    }

    const record = {
      submissionId: id,
      outcome,
      outcomeLabel: outcomeToLabel(outcome),
      outcomeId,
      identity: resolveApprovalIdentityLabel(req),
      at: new Date().toISOString(),
    };
    try {
      recordApprovalDecision(stepKey, record);
    } catch (err) {
      // Losing persistence must not block the actual approval — log loudly;
      // the decision itself still completes on JotForm's side.
      console.error(`[bpuu-workflow] could not persist approval decision for ${stepKey}: ${err.message}`);
    }
    console.log(
      `[bpuu-workflow] approval decision recorded: step=${stepKey} outcomeID=${outcomeId || '(none)'} outcome=${outcome} identity=${record.identity}`
    );

    // Write the request status back to q68 — JotForm's workflow doesn't, and
    // q68 is what the request list / tracking reads. Best-effort: the approval
    // already landed on JotForm, so a failed write is logged, not surfaced.
    const q68Status = outcomeToQ68Status(outcome);
    if (q68Status) {
      try {
        await writeJotformSubmissionField(id, '68', q68Status);
        console.log(`[bpuu-workflow] q68 set to "${q68Status}" for submission ${id}`);
      } catch (err) {
        console.error(`[bpuu-workflow] could not write q68 for submission ${id}: ${err.message}`);
      }
    }

    res.status(200).json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Form gate — sits in front of a JotForm form link (e.g. the payment-detail
// form BPUU staff fill in after an approval that carries a fee), for the
// same reason /approve-gate sits in front of the approve/deny deeplink:
// workflow emails only reached whoever the workflow addressed them to, but
// once that email exists, anyone who gets hold of it (forwarded, shared
// inbox, left open on a screen) could open the form with no login at all.
// Emails now link here first instead; this route forces an ADFS/ThaID
// login, then hands the browser a real link to the JotForm form itself.
//
// WHY THE FORM IS EMBEDDED AND NOT REBUILT — settled by testing 2026-08-10.
// A native BPUU-styled fill-in UI that posted the answers itself was built and
// measured, and it CANNOT work: JotForm answers any submission that does not
// originate from one of its own form pages with a CAPTCHA challenge page
// ("Please Complete", action=correctCaptcha) and the submission never lands.
// Reproduced three ways — server-side curl, curl with full browser headers,
// and a real browser POST from this app's own origin carrying every hidden
// field the real form ships (formID, jsExecutionTracker, buildDate,
// submitSource, submitDate, eventObserver, uploadServerUrl, website,
// simple_spc) — all three captcha'd, and the JotForm submissions API showed
// no new submission for any of them. Worse, the hidden iframe's 'load' event
// fires on that captcha page, so a self-submitting UI reports success while
// nothing happened.
//
// Going through the API instead is not an option either: JotForm support
// states there is no supported API endpoint for completing a workflow
// approval/task, so the workflow can only be advanced by a real submission
// made from a JotForm page carrying wfTaskID.
//
// Therefore the real form stays embedded — it is the only mechanism that
// actually advances a workflow task. That also means this route cannot
// observe the submit, so it has NO one-shot guard: re-submission is governed
// by JotForm's own task state, not by us.
// ---------------------------------------------------------------------------

// The form is embedded in the page rather than linked to: the visitor stays on
// our own domain, keeps the request number and the signed-in identity visible
// above the form, and never sees a raw JotForm URL. JotForm sets no
// X-Frame-Options/CSP and no frame-busting — the same property /approve-gate's
// hidden-iframe completion already depends on — so the form renders and submits
// normally inside the frame.
const FORM_GATE_STYLE = `
    .card.wide { max-width: 900px; }
    @media (max-width: 600px) { .card.wide { padding: 18px 12px; } }
    .form-frame { position: relative; margin-top: 18px; border: 1px solid #dde1e7;
      border-radius: 8px; overflow: hidden; background: #fff; }
    .form-frame iframe { display: block; width: 100%; height: 78vh; min-height: 560px; border: 0; }
    .form-frame .loading { position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; background: #fff; color: #667; font-size: 0.95rem; }
    @media (prefers-color-scheme: dark) { .form-frame { border-color: #2c313a; } }
`;

// JotForm posts "setHeight:<px>:<formID>" to the embedding window as its content
// grows (page changes, conditional fields, validation errors). This grows the
// frame to match so the form scrolls with the page instead of inside a small
// box. Deliberately additive-only on top of a tall CSS default: if those
// messages never arrive (protocol change, a form that doesn't emit them), the
// frame just stays at its default height with its own scrollbar — usable, only
// less pretty. Accepted only from a jotform.com https origin AND only from this
// frame's own contentWindow, so no other window can drive the resize.
const FORM_GATE_SCRIPT = `
    (function () {
      var frame = document.getElementById('formFrame');
      var loading = document.getElementById('formLoading');
      if (!frame) return;
      frame.addEventListener('load', function () { if (loading) loading.remove(); });
      window.addEventListener('message', function (e) {
        if (!frame.contentWindow || e.source !== frame.contentWindow) return;
        if (typeof e.data !== 'string') return;
        var origin;
        try { origin = new URL(e.origin); } catch (err) { return; }
        if (origin.protocol !== 'https:') return;
        if (origin.hostname !== 'jotform.com' && !origin.hostname.endsWith('.jotform.com')) return;
        var parts = e.data.split(':');
        if (parts[0] !== 'setHeight') return;
        var px = parseInt(parts[1], 10);
        if (!isFinite(px) || px < 200 || px > 20000) return;
        frame.style.height = px + 'px';
      });
    })();
`;

function renderFormGatePage({ id, target, upn, detailRows }) {
  const safeTarget = escapeHtml(target);
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>กรอกรายละเอียด — ระบบกระบวนงาน BPUU</title>
  <style>${APPROVAL_PAGE_STYLE}${FORM_GATE_STYLE}</style>
</head>
<body>
  <div class="card wide">
    <h1>กรอกรายละเอียด</h1>
    <p>คำขอหมายเลข <strong>${escapeHtml(id || '-')}</strong></p>
    <p class="meta">เข้าสู่ระบบเป็น: ${escapeHtml(upn)}</p>
    ${renderApprovalDetailsHtml(detailRows)}
    <div class="form-frame">
      <div class="loading" id="formLoading">กำลังโหลดฟอร์ม…</div>
      <iframe id="formFrame" src="${safeTarget}" title="ฟอร์มกรอกรายละเอียด"
        allow="geolocation; microphone; camera; fullscreen; payment"></iframe>
    </div>
    <p class="meta">หากฟอร์มไม่แสดง <a href="${safeTarget}" target="_blank" rel="noopener noreferrer">เปิดฟอร์มในแท็บใหม่</a></p>
    ${APPROVAL_FALLBACK_CONTACT_HTML}
  </div>
  <script>${FORM_GATE_SCRIPT}</script>
</body>
</html>`;
}

app.get(
  '/form-gate',
  makeRequireAnyLogin({
    adfsOnly: false,
    intro: 'สำหรับผู้ได้รับมอบหมายให้กรอกแบบฟอร์ม<br>กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ',
  }),
  asyncHandler(async (req, res) => {
    noStore(res);

    // target is NOT read from req.query — see extractRawTarget() for why
    // (a raw '&' inside JotForm's own merge value would otherwise truncate).
    const { id } = req.query;
    const targetStr = extractRawTarget(req.originalUrl);

    if (!targetStr || !isAllowedJotformTarget(targetStr) || !isPlausibleSubmissionId(typeof id === 'string' ? id : '')) {
      res.status(400).send(
        renderErrorPage({
          title: 'ลิงก์ไม่ถูกต้อง',
          message: 'ลิงก์เปิดฟอร์มนี้ไม่ถูกต้องหรือหมดอายุ กรุณาติดต่อผู้ดูแลระบบ',
          retryHref: '/',
        })
      );
      return;
    }

    const identityLabel = resolveApprovalIdentityLabel(req);

    // The request-detail table is shown above the form so the filler has the
    // same context the notification email carried. KMUTT sessions only — the
    // submission is requester PII and a ThaID filler has no business reading
    // it (they still complete their form normally).
    const isKmuttSession = Boolean(req.session.user);
    let detailRows = isKmuttSession ? null : 'restricted';
    try {
      const submission = await fetchJotformSubmission(String(id));
      if (submission && isKmuttSession) detailRows = submissionDetailRows(submission);
    } catch (err) {
      console.warn(`[bpuu-workflow] form gate: could not read submission ${id}: ${err.message}`);
    }

    console.log(`[bpuu-workflow] form gate: identity=${identityLabel} id=${id} -> form embedded`);
    res.status(200).send(renderFormGatePage({ id, target: targetStr, upn: identityLabel, detailRows }));
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
    /* ใช้โลโก้เวอร์ชันสีขาว เพราะแถบหัวเป็นพื้นส้ม (ตัวสีส้มจะจมหาย) */
    .admin-header .admin-logo { height: 44px; width: auto; flex: none; }
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
    .note-cell { display: flex; gap: 6px; align-items: center; justify-content: space-between; min-width: 140px; }
    .note-cell span { white-space: pre-wrap; word-break: break-word; }
    .note-cell .note-edit { flex: 0 0 auto; padding: 2px 6px; line-height: 1; }
  </style>
</head>
<body>
  <div class="admin-header">
    <div class="container d-flex align-items-center justify-content-between">
      <div class="d-flex align-items-center gap-3">
        <img src="/img/kmutt-main-logo-white.png" alt="KMUTT" class="admin-logo">
        <div>
          <div class="sub">มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี (มจธ.)</div>
          <div class="title">ผู้ดูแลระบบ · ระบบกระบวนงาน BPUU</div>
        </div>
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
      <button type="button" data-tab="report"><i class="bi bi-file-earmark-spreadsheet"></i> รายงาน</button>
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
              <tbody id="reqBody"><tr><td colspan="8" class="state-msg">กำลังโหลด…</td></tr></tbody>
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

    <!-- Report -->
    <div class="tab-panel" id="tab-report">
      <div class="panel">
        <div class="panel-head">
          <h2><i class="bi bi-file-earmark-spreadsheet text-ci-orange"></i> รายงาน</h2>
          <div class="toolbar">
            <select id="rptType" class="form-select form-select-sm" style="width:330px">
              ${REPORT_DEFS.map(
                (d) => '<option value="' + escapeHtml(d.key) + '">' + escapeHtml(d.title) + '</option>'
              ).join('')}
            </select>
            <input id="rptFrom" type="date" class="form-control form-control-sm" style="width:150px" title="วันที่คำขอ ตั้งแต่">
            <input id="rptTo" type="date" class="form-control form-control-sm" style="width:150px" title="วันที่คำขอ ถึง">
            <span id="rptFilters" class="d-flex flex-wrap gap-2"></span>
            <span class="result-count" id="rptCount"></span>
            <button id="rptRefresh" class="btn btn-sm btn-outline-secondary" title="โหลดใหม่"><i class="bi bi-arrow-clockwise"></i></button>
            <button id="rptExport" class="btn btn-sm btn-ci-orange fw-bold"><i class="bi bi-download"></i> ดาวน์โหลด CSV</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="table-responsive">
            <table class="table table-hover tbl align-middle mb-0">
              <thead class="table-light"><tr id="rptGroupHead"></tr><tr id="rptHead"></tr></thead>
              <tbody id="rptBody"><tr><td class="state-msg">กำลังโหลด…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- รายละเอียดคำขอ (เปิดจากการคลิกหมายเลขคำขอในตารางรายงาน) -->
    <div id="rptDetail" style="display:none; position:fixed; inset:0; z-index:1080;
         background:rgba(0,0,0,.35); align-items:center; justify-content:center;">
      <div style="background:#fff; border-radius:10px; max-width:560px; width:calc(100% - 2rem);
           max-height:80vh; overflow:auto; box-shadow:0 12px 32px rgba(0,0,0,.25);">
        <div class="d-flex align-items-center justify-content-between px-3 py-2 border-bottom">
          <strong>รายละเอียดคำขอ</strong>
          <button type="button" id="rptDetailClose" class="btn-close" aria-label="ปิด"></button>
        </div>
        <pre id="rptDetailBody" class="px-3 py-3 mb-0" style="white-space:pre-wrap; font-family:inherit; font-size:.9rem;"></pre>
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
          // เลือกกลุ่มไว้ = ค้นหาเฉพาะฟิลด์นั้น (รวมอีเมลคู่ของมัน ซึ่งเป็นค่าที่แสดงแทนเมื่อชื่อว่าง)
          const scope = state.groupBy ? [state.groupBy, state.groupBy + 'Email'] : null;
          rows = rows.filter((r) => scope
            ? scope.some((k) => val(r, k).toLowerCase().includes(q))
            : opts.columns.some((c) => val(r, c.key).toLowerCase().includes(q)) ||
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
      if (group) {
        // placeholder บอกขอบเขตที่ค้นหาอยู่ — ป้ายตัวเลือกขึ้นต้นด้วย 'กลุ่ม: '
        const basePlaceholder = search ? search.placeholder : '';
        group.addEventListener('change', () => {
          state.groupBy = group.value;
          if (search) {
            const label = (group.selectedOptions[0]?.textContent || '').replace(/^กลุ่ม: /, '');
            search.placeholder = state.groupBy ? 'ค้นหาใน ' + label + '…' : basePlaceholder;
          }
          render();
        });
      }

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
        { key: 'createdAt', label: 'วันที่ขอ' },
        { key: 'requester', label: 'ผู้ขอ' },
        { key: 'requestType', label: 'ประเภทบริการ' },
        { key: 'approver', label: 'ผู้อนุมัติ', cell: (r) => textCell(r.approver || r.approverEmail) },
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
        {
          key: 'durationDays', label: 'ระยะเวลา (วัน)', align: 'end',
          cell: (r) => textCell(r.durationDays == null ? '' : r.durationDays, 'end'),
        },
        {
          key: 'note', label: 'หมายเหตุ',
          cell: (r) => {
            const td = document.createElement('td');
            const wrap = document.createElement('div');
            wrap.className = 'note-cell';
            const text = document.createElement('span');
            text.textContent = r.note || '—';
            if (!r.note) text.className = 'muted';
            if (r.noteUpdatedBy) {
              text.title = 'แก้ไขโดย ' + r.noteUpdatedBy + (r.noteUpdatedAt ? ' เมื่อ ' + r.noteUpdatedAt : '');
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-sm btn-outline-secondary note-edit';
            btn.title = 'แก้ไขหมายเหตุ';
            const icon = document.createElement('i');
            icon.className = 'bi bi-pencil';
            btn.appendChild(icon);
            btn.addEventListener('click', () => editNote(r));
            wrap.appendChild(text);
            wrap.appendChild(btn);
            td.appendChild(wrap);
            return td;
          },
        },
      ],
    });

    let requestRows = [];

    async function editNote(row) {
      const input = prompt('หมายเหตุสำหรับคำขอ Ref ' + row.id + ' (เว้นว่างเพื่อลบหมายเหตุ)', row.note || '');
      if (input === null) return; // ยกเลิก
      try {
        const res = await fetch('/api/admin/request-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ id: row.id, note: input }),
        });
        if (res.status === 401) {
          alert('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
          window.location.reload();
          return;
        }
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'บันทึกหมายเหตุไม่สำเร็จ'); return; }
        row.note = data.note || '';
        row.noteUpdatedAt = data.noteUpdatedAt || '';
        row.noteUpdatedBy = data.noteUpdatedBy || '';
        reqTable.setRows(requestRows);
      } catch (err) {
        alert('บันทึกหมายเหตุไม่สำเร็จ');
      }
    }

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
        requestRows = data.requests || [];
        reqTable.setRows(requestRows);
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

    // -----------------------------------------------------------------
    // Report tab — หัวตาราง 2 ชั้นตามไฟล์ต้นแบบ จึงไม่ได้ใช้ createTable()
    // (ตัวนั้นรองรับหัวแถวเดียว) เรนเดอร์ด้วย textContent ล้วนเหมือนแท็บอื่น
    // เพื่อไม่ให้เนื้อหาจาก JotForm แทรก markup เข้าหน้านี้ได้
    // -----------------------------------------------------------------
    let rptData = { title: '', columns: [], rows: [], meta: [], filters: [], sumColumn: '' };
    let rptActiveFilters = {};

    function rptColIndex(header) {
      return rptData.columns.findIndex((c) => c.header === header);
    }

    function rptMessage(text) {
      const body = document.getElementById('rptBody');
      body.replaceChildren();
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'state-msg';
      td.colSpan = Math.max(1, rptData.columns.length);
      td.textContent = text;
      tr.appendChild(td);
      body.appendChild(tr);
    }

    // สร้าง dropdown ตัวกรองจากค่าที่มีจริงในข้อมูล (ไม่ hardcode รายชื่อหน่วยงาน)
    function renderFilters() {
      const host = document.getElementById('rptFilters');
      host.replaceChildren();
      rptActiveFilters = {};
      for (const f of rptData.filters || []) {
        const values = [...new Set(rptData.meta.map((m) => m[f.key]).filter(Boolean))]
          .sort((a, b) => String(a).localeCompare(String(b), 'th'));
        if (!values.length) continue;
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-sm';
        sel.style.width = '200px';
        sel.title = f.label;
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'ทุก' + f.label;
        sel.appendChild(all);
        for (const v of values) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = v;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => {
          rptActiveFilters[f.key] = sel.value;
          renderReport();
        });
        host.appendChild(sel);
      }
    }

    // คืน index ของแถวที่ผ่านตัวกรองทั้งหมด (เก็บ index ไว้เพื่ออ้าง meta ได้ตรงแถว)
    function rptVisibleIndexes() {
      const from = document.getElementById('rptFrom').value;
      const to = document.getElementById('rptTo').value;
      const dateIdx = rptColIndex('วันที่คำขอ');
      const out = [];
      rptData.rows.forEach((r, i) => {
        if (dateIdx >= 0) {
          const d = r[dateIdx] || '';
          if (from && d < from) return;
          if (to && d > to) return;
        }
        const m = rptData.meta[i] || {};
        for (const [key, want] of Object.entries(rptActiveFilters)) {
          if (want && String(m[key] || '') !== want) return;
        }
        out.push(i);
      });
      return out;
    }

    // แถวสรุปท้ายตาราง: ถ้ามีคอลัมน์ที่กำหนดไว้ก็รวมค่าในคอลัมน์นั้น
    // ถ้าไม่มี (เช่นรายเดือนที่ 1 คำขอ = 1 คัน) ให้นับจำนวนแถวแทน
    function rptTotal(indexes) {
      const idx = rptData.sumColumn ? rptColIndex(rptData.sumColumn) : -1;
      if (idx < 0) return indexes.length;
      return indexes.reduce((sum, i) => {
        const n = Number(String(rptData.rows[i][idx]).replace(/,/g, ''));
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }

    function showRequestDetail(index) {
      const m = rptData.meta[index];
      if (!m) return;
      const lines = [];
      lines.push('หมายเลขคำขอ : ' + m.id);
      if (m.requesterName) lines.push('ผู้ยื่นคำขอ : ' + m.requesterName);
      if (m.startDate || m.endDate) lines.push('ช่วงวันที่ : ' + (m.startDate || '-') + ' ถึง ' + (m.endDate || '-'));
      if (m.amount) lines.push('จำนวนเงิน : ' + m.amount);
      if (m.vehicleCount) lines.push('จำนวนรถ : ' + m.vehicleCount + ' คัน');
      if (m.vehicles && m.vehicles.length) {
        lines.push('');
        lines.push('รายการรถทั้งหมด');
        for (const v of m.vehicles) {
          lines.push('  คันที่ ' + v.index + (v.owner ? ' (' + v.owner + ')' : '') +
            ' : ' + [v.name, v.plate].filter(Boolean).join(' — '));
        }
      }
      const box = document.getElementById('rptDetailBody');
      box.textContent = lines.join('\n');
      document.getElementById('rptDetail').style.display = 'flex';
    }

    function renderReport() {
      const groupHead = document.getElementById('rptGroupHead');
      const head = document.getElementById('rptHead');
      const body = document.getElementById('rptBody');
      groupHead.replaceChildren();
      head.replaceChildren();

      // แถวบน: ยุบคอลัมน์ที่อยู่กลุ่มเดียวกันติดกันให้เป็นเซลล์เดียว (colspan)
      let i = 0;
      while (i < rptData.columns.length) {
        const g = rptData.columns[i].group || '';
        let span = 1;
        while (i + span < rptData.columns.length && (rptData.columns[i + span].group || '') === g) span++;
        const th = document.createElement('th');
        th.colSpan = span;
        th.textContent = g;
        if (g) th.className = 'text-center';
        groupHead.appendChild(th);
        i += span;
      }

      for (const col of rptData.columns) {
        const th = document.createElement('th');
        th.textContent = col.header;
        // คอลัมน์ที่ยังไม่มีแหล่งข้อมูล — ทำให้เห็นชัดว่าตั้งใจเว้นว่าง ไม่ใช่บั๊ก
        if (!col.mapped) {
          th.style.color = '#9aa1a9';
          th.title = 'ยังไม่มีข้อมูลในระบบ — รอกำหนดวิธีแมป';
        }
        head.appendChild(th);
      }

      const indexes = rptVisibleIndexes();
      document.getElementById('rptCount').textContent = indexes.length + ' คำขอ';
      if (!indexes.length) { rptMessage('ไม่มีข้อมูลตามเงื่อนไขที่เลือก'); return; }

      const idIdx = rptColIndex('หมายเลขคำขอ');
      body.replaceChildren();
      for (const rowIndex of indexes) {
        const tr = document.createElement('tr');
        rptData.rows[rowIndex].forEach((cell, idx) => {
          const td = document.createElement('td');
          if (idx === idIdx && cell) {
            // คลิกหมายเลขคำขอเพื่อดูรายละเอียด เช่น ทะเบียนรถครบทุกคัน
            const a = document.createElement('button');
            a.type = 'button';
            a.className = 'btn btn-link btn-sm p-0 text-decoration-underline';
            a.textContent = cell;
            a.addEventListener('click', () => showRequestDetail(rowIndex));
            td.appendChild(a);
          } else {
            td.textContent = cell;
          }
          if (!rptData.columns[idx] || !rptData.columns[idx].mapped) td.style.background = '#fafafa';
          tr.appendChild(td);
        });
        body.appendChild(tr);
      }

      if (rptData.sumColumn) {
        const sumIdx = rptColIndex(rptData.sumColumn);
        const tr = document.createElement('tr');
        tr.className = 'fw-bold table-light';
        const label = document.createElement('td');
        label.colSpan = sumIdx > 0 ? sumIdx : rptData.columns.length;
        label.className = 'text-end';
        label.textContent = 'รวมจำนวนรถ';
        tr.appendChild(label);
        if (sumIdx > 0) {
          const total = document.createElement('td');
          total.textContent = String(rptTotal(indexes));
          tr.appendChild(total);
          for (let c = sumIdx + 1; c < rptData.columns.length; c++) tr.appendChild(document.createElement('td'));
        }
        body.appendChild(tr);
      }
    }

    async function loadReport() {
      const key = document.getElementById('rptType').value;
      rptData = { title: '', columns: [], rows: [], meta: [], filters: [], sumColumn: '' };
      document.getElementById('rptFilters').replaceChildren();
      rptMessage('กำลังโหลด…');
      document.getElementById('rptCount').textContent = '';
      try {
        const res = await fetch('/api/admin/report?key=' + encodeURIComponent(key), {
          headers: { 'Accept': 'application/json' },
        });
        const data = await res.json();
        if (data.notConfigured) { rptMessage('ยังไม่ได้ตั้งค่า JotForm API key'); return; }
        if (data.error) { rptMessage(data.error); return; }
        rptData = data;
        renderFilters();
        renderReport();
      } catch (err) {
        rptMessage('เกิดข้อผิดพลาดในการโหลดรายงาน');
      }
    }

    function rptExportCsv() {
      if (!rptData.columns.length) return;
      const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const indexes = rptVisibleIndexes();
      const lines = [
        rptData.columns.map((c) => esc(c.group || '')).join(','),
        rptData.columns.map((c) => esc(c.header)).join(','),
        ...indexes.map((i) => rptData.rows[i].map(esc).join(',')),
      ];
      if (rptData.sumColumn) {
        const sumIdx = rptColIndex(rptData.sumColumn);
        const cells = rptData.columns.map(() => esc(''));
        cells[0] = esc('รวมจำนวนรถ');
        if (sumIdx >= 0) cells[sumIdx] = esc(rptTotal(indexes));
        lines.push(cells.join(','));
      }
      // ﻿ (BOM) จำเป็นมาก — ถ้าไม่มี Excel จะอ่านภาษาไทยเป็นอักขระเพี้ยน
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (rptData.title || 'report') + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    }

    document.getElementById('rptDetailClose').addEventListener('click', () => {
      document.getElementById('rptDetail').style.display = 'none';
    });
    document.getElementById('rptDetail').addEventListener('click', (e) => {
      // คลิกพื้นหลังนอกกล่องเพื่อปิด
      if (e.target.id === 'rptDetail') e.target.style.display = 'none';
    });

    document.getElementById('rptType').addEventListener('change', loadReport);
    document.getElementById('rptRefresh').addEventListener('click', loadReport);
    document.getElementById('rptExport').addEventListener('click', rptExportCsv);
    document.getElementById('rptFrom').addEventListener('change', renderReport);
    document.getElementById('rptTo').addEventListener('change', renderReport);

    loadRequests();
    loadLocations();
    loadReport();
    loadAllowlist();
  </script>
</body>
</html>`;
}

// Maps a submission's answers object (JotForm keys answers by numeric qid)
// to the compact record the admin table needs. qid → meaning comes from
// js/app.js buildJotformSubmissionFields(): 15=ประเภทคำขอ, 16=ประเภทผู้ใช้,
// 19=ชื่อผู้ขอ, 20=อีเมลผู้ขอ, 22=หน่วยงาน, 28=ชื่อผู้อนุมัติ, 30=อีเมลผู้อนุมัติ,
// 36=วันที่เริ่มต้น, 37=วันที่สิ้นสุด, 67=ยอดค่าบริการประเมิน, 68=สถานะดำเนินการ.
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

// JotForm DATE fields (q36 วันที่เริ่มต้น, q37 วันที่สิ้นสุด) expose .answer as an
// OBJECT of sub-fields ({ year, month, day, datetime }) — jotformAnswer()'s
// String() would render "[object Object]". Extract a comparable YYYY-MM-DD
// string, or '' when absent (several request types carry no dates at all).
function jotformDateAnswer(answers, qid) {
  const entry = answers && answers[qid];
  const a = entry && entry.answer;
  if (a && typeof a === 'object' && a.year && a.month && a.day) {
    const pad = (v) => String(v).padStart(2, '0');
    return `${a.year}-${pad(a.month)}-${pad(a.day)}`;
  }
  // Defensive fallbacks in case JotForm ever returns a plain string here:
  // "YYYY-MM-DD ..." or the DD-MM-YYYY prettyFormat this form uses.
  const s =
    typeof a === 'string' ? a
    : typeof (entry && entry.prettyFormat) === 'string' ? entry.prettyFormat
    : '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
}

// สถานะที่ถือว่า "จบ flow แล้ว" — เกณฑ์คำเดียวกับ statusClass ของหน้า admin:
// จบแบบสำเร็จ (อนุมัติ/สำเร็จ/เสร็จ/เรียบร้อย/ผ่าน) หรือจบแบบปฏิเสธ
// (ไม่อนุมัติ/ปฏิเสธ/ยกเลิก/ไม่ผ่าน). สถานะ รอ/กำลังดำเนินการ = ยังไม่จบ.
function isRequestFlowEnded(status) {
  const s = String(status || '');
  if (/ไม่อนุมัติ|ปฏิเสธ|ยกเลิก|ไม่ผ่าน/.test(s)) return true;
  return /อนุมัติ|สำเร็จ|เสร็จ|เรียบร้อย|ผ่าน/.test(s);
}

// จำนวนวันดำเนินการ = วันที่จบ flow − วันที่ขอ (นับเป็นวัน). JotForm ไม่มี
// timestamp "จบงาน" โดยตรง — ตัวแทนที่ใกล้ที่สุดคือ updated_at ของ submission
// ซึ่งขยับเมื่อโหนดท้ายของ workflow เขียนสถานะ (q68) ลงฟอร์ม (ดูหมายเหตุที่
// fetchJotformSubmissionStatus: q68 ถูกเขียนโดย workflow ทีหลัง ไม่ใช่ตอนกด
// อนุมัติ). คำขอที่ยังไม่จบ flow → null = แสดงเป็นช่องว่าง.
function requestDurationDays(createdAt, updatedAt, status) {
  if (!isRequestFlowEnded(status)) return null;
  const start = Date.parse(`${String(createdAt).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(updatedAt).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86400000);
}

// ดึง submission ดิบทั้งหมด — ใช้ร่วมกันระหว่างตาราง "รายการคำขอ" กับ tab "รายงาน"
// (แยกออกมาเพื่อไม่ให้ทั้งสองที่มี logic การเรียก API ซ้ำกันคนละชุด)
async function fetchJotformSubmissionsRaw() {
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
  return Array.isArray(body.content) ? body.content : [];
}

async function fetchJotformRequests() {
  const content = await fetchJotformSubmissionsRaw();

  const notes = loadRequestNotes();
  const requests = content.map((sub) => {
    const answers = sub.answers || {};
    const status = jotformAnswer(answers, '68');
    const noteEntry = notes[sub.id] || null;
    return {
      id: sub.id,
      createdAt: sub.created_at || '',
      updatedAt: sub.updated_at || '',
      requester: jotformAnswer(answers, '19'),
      requesterEmail: jotformAnswer(answers, '20'),
      requestType: jotformAnswer(answers, '15'),
      userType: jotformAnswer(answers, '16'),
      department: jotformAnswer(answers, '22'),
      approver: jotformAnswer(answers, '28'),
      approverEmail: jotformAnswer(answers, '30'),
      amount: jotformAnswer(answers, '67'),
      status,
      startDate: jotformDateAnswer(answers, '36'),
      endDate: jotformDateAnswer(answers, '37'),
      durationDays: requestDurationDays(sub.created_at, sub.updated_at, status),
      note: noteEntry ? noteEntry.note : '',
      noteUpdatedAt: noteEntry ? noteEntry.updatedAt : '',
      noteUpdatedBy: noteEntry ? noteEntry.updatedBy : '',
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

// ---------------------------------------------------------------------------
// รายงาน (tab "รายงาน" ในหน้า admin)
//
// โครงคอลัมน์ยึดตามไฟล์ต้นแบบ "รายงานระบบ Work Flow.xlsx" (11 ชีต) หัวตาราง
// เป็น 2 ชั้น: แถวบน = หัวกลุ่ม (ส่วนที่ 1/2/3 ฯลฯ), แถวล่าง = ชื่อคอลัมน์จริง
//
// คอลัมน์ที่ src เป็น null คือช่องที่ระบบ "ยังไม่มีแหล่งข้อมูล" (ใบเสร็จรับเงิน,
// ใบแจ้งหนี้, เลขที่ Voucher) — คงคอลัมน์ไว้ให้ครบตามต้นแบบแต่ปล่อยค่าว่าง
// รอผู้ใช้ระบุวิธีแมปภายหลัง ห้ามเดาค่าใส่
// ---------------------------------------------------------------------------

const FORM_AREA = 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว';
const FORM_CONTRACT = 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา';
const FORM_OVERNIGHT = 'แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)';
const FORM_MONTHLY = 'แบบฟอร์มขอจอดรถรายเดือน';
const FORM_STAMP = 'แบบฟอร์มขอใช้ตราประทับ';
const FORM_ISSUE = 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ';

const G_REQUESTER = '(ส่วนที่ 1) รายละเอียดผู้ยื่นคำขอ';
const G_CONTACT = '(ส่วนที่ 1) ข้อมูลผู้ติดต่อ';
const G_APPROVER = '(ส่วนที่ 2) ผู้บังคับบัญชา (หน่วยงาน)';
const G_DETAIL2 = '(ส่วนที่ 2) รายละเอียดคำขอ';
const G_DETAIL3 = '(ส่วนที่ 3) รายละเอียดคำขอ';
const G_RECEIPT = 'ใบเสร็จรับเงิน';
const G_INVOICE = 'ใบแจ้งหนี้';

// ช่องใบเสร็จ 3 ช่องท้ายตารางที่ซ้ำกันในหลายรายงาน — ยังไม่มีแหล่งข้อมูล
const RECEIPT_COLUMNS = [
  { header: 'ชื่อที่ออกใบเสร็จรับเงิน', group: G_RECEIPT, src: null },
  { header: 'เลขที่ใบเสร็จรับเงิน', group: G_RECEIPT, src: null },
  { header: 'วันที่ใบเสร็จรับเงิน', group: G_RECEIPT, src: null },
];

const COL_SEQ = { header: 'ลำดับ', group: '', src: 'seq' };
const COL_ID = { header: 'หมายเลขคำขอ', group: '', src: 'id' };
const COL_CREATED = { header: 'วันที่คำขอ', group: '', src: 'createdAt' };
const COL_AMOUNT = { header: 'จำนวนเงิน', group: '', src: 'amount' };

// filters: ตัวกรองที่แท็บรายงานจะสร้าง dropdown ให้ (ค่าตัวเลือกดึงจากข้อมูลจริง)
// sumColumn: หัวคอลัมน์ที่จะรวมยอดในแถวท้ายตาราง
const REPORT_DEFS = [
  {
    key: 'area-internal',
    title: 'รายงานการขอใช้พื้นที่ชั่วคราว (บุคลากรภายใน)',
    match: (r) => r.formName === FORM_AREA && r.userType === 'บุคลากร',
    filters: ['department'],
    columns: [
      COL_ID, COL_CREATED,
      { header: 'ชื่อ-สกุล', group: G_REQUESTER, src: 'requesterName' },
      { header: 'หน่วยงาน', group: G_REQUESTER, src: 'department' },
      { header: 'ผู้มีอำนาจอนุมัติ', group: G_APPROVER, src: 'approver' },
      { header: 'วันที่อนุมัติ', group: G_APPROVER, src: 'approvedAt' },
      { header: 'ชื่อกิจกรรม', group: G_DETAIL3, src: 'eventName' },
      { header: 'วัตถุประสงค์', group: G_DETAIL3, src: 'eventObjectives' },
      { header: 'จำนวนบูธ', group: G_DETAIL3, src: 'boothCount' },
      { header: 'สถานที่', group: G_DETAIL3, src: 'eventLocations' },
      { header: 'วันที่เริ่มต้น', group: G_DETAIL3, src: 'startDate' },
      { header: 'วันที่สิ้นสุด', group: G_DETAIL3, src: 'endDate' },
    ],
  },
  {
    key: 'area-external',
    title: 'รายงานการขอใช้พื้นที่ชั่วคราว (บุคคลภายนอก)',
    match: (r) => r.formName === FORM_AREA && r.userType === 'บุคคลภายนอก',
    filters: ['department', 'externalType'],
    columns: [
      COL_ID, COL_CREATED,
      { header: 'ชื่อ', group: G_CONTACT, src: 'firstName' },
      { header: 'นามสกุล', group: G_CONTACT, src: 'lastName' },
      { header: 'หน่วยงาน / บริษัท / นิติบุคคล', group: G_CONTACT, src: 'department' },
      { header: 'ชื่อกิจกรรม', group: G_DETAIL2, src: 'eventName' },
      { header: 'วัตถุประสงค์', group: G_DETAIL2, src: 'eventObjectives' },
      { header: 'จำนวนบูธ', group: G_DETAIL2, src: 'boothCount' },
      { header: 'สถานที่', group: G_DETAIL2, src: 'eventLocations' },
      { header: 'วันที่เริ่มต้น', group: G_DETAIL2, src: 'startDate' },
      { header: 'วันที่สิ้นสุด', group: G_DETAIL2, src: 'endDate' },
      COL_AMOUNT,
      ...RECEIPT_COLUMNS,
    ],
  },
  {
    key: 'contract',
    title: 'รายงานการขอใช้พื้นที่ภายใต้คู่สัญญา',
    match: (r) => r.formName === FORM_CONTRACT,
    filters: ['department', 'contractCampus'],
    columns: [
      COL_ID, COL_CREATED,
      { header: 'ชื่อ', group: G_CONTACT, src: 'firstName' },
      { header: 'นามสกุล', group: G_CONTACT, src: 'lastName' },
      { header: 'หน่วยงาน / บริษัท / นิติบุคคล', group: G_CONTACT, src: 'department' },
      { header: 'ชื่อบริษัท', group: G_DETAIL2, src: 'contractCompany' },
      { header: 'ประเภทธุรกิจ', group: G_DETAIL2, src: 'contractBusinessType' },
      { header: 'พื้นที่การศึกษา', group: G_DETAIL2, src: 'contractCampus' },
      { header: 'อาคาร', group: G_DETAIL2, src: 'contractBuilding' },
      { header: 'วันที่ขอเข้าพื้นที่เริ่มต้น', group: G_DETAIL2, src: 'startDate' },
      { header: 'วันที่ขอเข้าพื้นที่สิ้นสุด', group: G_DETAIL2, src: 'endDate' },
      { header: 'ข้อความเสนอพิจารณา', group: G_DETAIL2, src: 'considerationNote' },
      { header: 'ผู้มีอำนาจอนุมัติ', group: 'เจ้าของพื้นที่', src: 'approver' },
      { header: 'วันที่อนุมัติ', group: 'เจ้าของพื้นที่', src: 'approvedAt' },
    ],
  },
  {
    key: 'overnight-internal',
    title: 'รายงานการขอจอดรถค้างคืน (บุคลากรภายใน)',
    match: (r) => r.formName === FORM_OVERNIGHT && r.userType === 'บุคลากร',
    filters: ['department'],
    sumColumn: 'จำนวนรถ (คัน)',
    columns: [
      COL_SEQ, COL_ID, COL_CREATED,
      { header: 'ผู้ยื่นคำขอ', group: '(ส่วนที่ 1) ผู้ยื่นคำขอ', src: 'requesterName' },
      { header: 'หน่วยงาน', group: '(ส่วนที่ 1) ผู้ยื่นคำขอ', src: 'department' },
      { header: 'ผู้มีอำนาจอนุมัติ', group: G_APPROVER, src: 'approver' },
      { header: 'วันที่อนุมัติ', group: G_APPROVER, src: 'approvedAt' },
      { header: 'ทะเบียนรถ', group: G_DETAIL3, src: 'singlePlate' },
      { header: 'ชื่อ-สกุล', group: G_DETAIL3, src: 'singleOwner' },
      { header: 'จำนวนรถ (คัน)', group: G_DETAIL3, src: 'vehicleCount' },
      { header: 'วันที่เริ่มต้น', group: G_DETAIL3, src: 'startDate' },
      { header: 'วันที่สิ้นสุด', group: G_DETAIL3, src: 'endDate' },
      { header: 'จำนวนคืน', group: G_DETAIL3, src: 'totalDays' },
      { header: 'เหตุผลการขอจอด', group: G_DETAIL3, src: 'parkReason' },
      COL_AMOUNT,
      ...RECEIPT_COLUMNS,
    ],
  },
  {
    key: 'overnight-external',
    title: 'รายงานการขอจอดรถค้างคืน (บุคคลภายนอก)',
    match: (r) => r.formName === FORM_OVERNIGHT && r.userType === 'บุคคลภายนอก',
    filters: ['department', 'externalType'],
    sumColumn: 'จำนวนรถ (คัน)',
    columns: [
      COL_ID, COL_CREATED,
      { header: 'ประเภทผู้ขอ', group: G_CONTACT, src: 'externalType' },
      { header: 'ชื่อ', group: G_CONTACT, src: 'firstName' },
      { header: 'นามสกุล', group: G_CONTACT, src: 'lastName' },
      { header: 'หน่วยงาน / บริษัท / นิติบุคคล', group: G_CONTACT, src: 'department' },
      { header: 'ทะเบียนรถ', group: G_DETAIL2, src: 'singlePlate' },
      { header: 'จำนวนรถ (คัน)', group: G_DETAIL2, src: 'vehicleCount' },
      { header: 'วันที่เริ่มต้น', group: G_DETAIL2, src: 'startDate' },
      { header: 'วันที่สิ้นสุด', group: G_DETAIL2, src: 'endDate' },
      { header: 'จำนวนคืน', group: G_DETAIL2, src: 'totalDays' },
      { header: 'เหตุผลการขอจอด', group: G_DETAIL2, src: 'parkReason' },
      COL_AMOUNT,
      ...RECEIPT_COLUMNS,
    ],
  },
  {
    key: 'overnight-student',
    title: 'รายงานการขอจอดรถค้างคืน (นักศึกษา)',
    match: (r) => r.formName === FORM_OVERNIGHT && r.userType === 'นักศึกษา',
    filters: ['faculty'],
    sumColumn: 'จำนวนรถ (คัน)',
    columns: [
      COL_ID, COL_CREATED,
      { header: 'รหัสนักศึกษา', group: G_REQUESTER, src: 'requesterId' },
      { header: 'ผู้ยื่นคำขอ', group: G_REQUESTER, src: 'requesterName' },
      { header: 'คณะ / สังกัด', group: G_REQUESTER, src: 'faculty' },
      { header: 'ภาควิชา / สาขาวิชา', group: G_REQUESTER, src: 'major' },
      { header: 'ทะเบียนรถ', group: G_DETAIL2, src: 'singlePlate' },
      { header: 'จำนวนรถ (คัน)', group: G_DETAIL2, src: 'vehicleCount' },
      { header: 'วันที่เริ่มต้น', group: G_DETAIL2, src: 'startDate' },
      { header: 'วันที่สิ้นสุด', group: G_DETAIL2, src: 'endDate' },
      { header: 'จำนวนคืน', group: G_DETAIL2, src: 'totalDays' },
      { header: 'เหตุผลการขอจอด', group: G_DETAIL2, src: 'parkReason' },
      COL_AMOUNT,
      ...RECEIPT_COLUMNS,
    ],
  },
  {
    key: 'monthly-internal',
    title: 'รายงานการขอจอดรถรายเดือน (บุคลากรภายใน)',
    match: (r) => r.formName === FORM_MONTHLY && r.userType === 'บุคลากร',
    filters: ['department'],
    sumColumn: 'จำนวนรถ (คัน)',
    columns: [
      COL_ID, COL_CREATED,
      { header: 'ชื่อ', group: G_REQUESTER, src: 'firstName' },
      { header: 'นามสกุล', group: G_REQUESTER, src: 'lastName' },
      { header: 'หน่วยงาน', group: G_REQUESTER, src: 'department' },
      { header: 'ผู้มีอำนาจอนุมัติ', group: G_APPROVER, src: 'approver' },
      { header: 'วันที่อนุมัติ', group: G_APPROVER, src: 'approvedAt' },
      { header: 'ผู้ใช้บริการจริง', group: G_DETAIL3, src: 'actualUserName' },
      { header: 'ทะเบียนรถ', group: G_DETAIL3, src: 'singlePlate' },
      { header: 'วันที่เริ่มต้น', group: G_DETAIL3, src: 'startDate' },
      { header: 'วันที่สิ้นสุด', group: G_DETAIL3, src: 'endDate' },
      COL_AMOUNT,
      ...RECEIPT_COLUMNS,
    ],
  },
  {
    key: 'monthly-external',
    title: 'รายงานการขอจอดรถรายเดือน (บุคคลภายนอก)',
    match: (r) => r.formName === FORM_MONTHLY && r.userType === 'บุคคลภายนอก',
    filters: ['department', 'externalType'],
    sumColumn: 'จำนวนรถ (คัน)',
    columns: [
      COL_ID, COL_CREATED,
      { header: 'ประเภทผู้ขอ', group: G_CONTACT, src: 'externalType' },
      { header: 'ชื่อ', group: G_CONTACT, src: 'firstName' },
      { header: 'นามสกุล', group: G_CONTACT, src: 'lastName' },
      { header: 'หน่วยงาน / บริษัท / นิติบุคคล', group: G_CONTACT, src: 'department' },
      { header: 'ทะเบียนรถ', group: G_DETAIL2, src: 'singlePlate' },
      { header: 'วันที่เริ่มต้น', group: G_DETAIL2, src: 'startDate' },
      { header: 'วันที่สิ้นสุด', group: G_DETAIL2, src: 'endDate' },
      COL_AMOUNT,
      ...RECEIPT_COLUMNS,
    ],
  },
  {
    key: 'monthly-student',
    title: 'รายงานการขอจอดรถรายเดือน (นักศึกษา)',
    match: (r) => r.formName === FORM_MONTHLY && r.userType === 'นักศึกษา',
    filters: ['faculty'],
    sumColumn: 'จำนวนรถ (คัน)',
    columns: [
      COL_ID, COL_CREATED,
      { header: 'รหัสนักศึกษา', group: G_REQUESTER, src: 'requesterId' },
      { header: 'ผู้ยื่นคำขอ', group: G_REQUESTER, src: 'requesterName' },
      { header: 'คณะ / สังกัด', group: G_REQUESTER, src: 'faculty' },
      { header: 'ภาควิชา / สาขาวิชา', group: G_REQUESTER, src: 'major' },
      { header: 'ข้อมูลรถ', group: G_DETAIL2, src: 'singlePlate' },
      { header: 'วันที่เริ่มต้น', group: G_DETAIL2, src: 'startDate' },
      { header: 'วันที่สิ้นสุด', group: G_DETAIL2, src: 'endDate' },
      COL_AMOUNT,
      ...RECEIPT_COLUMNS,
    ],
  },
  {
    key: 'stamp',
    title: 'รายงานการขอใช้ตราประทับ',
    match: (r) => r.formName === FORM_STAMP,
    filters: ['department', 'stampUserType'],
    columns: [
      COL_ID, COL_CREATED,
      { header: 'ชื่อ-สกุล', group: G_REQUESTER, src: 'requesterName' },
      { header: 'หน่วยงาน', group: G_REQUESTER, src: 'department' },
      { header: 'ผู้มีอำนาจอนุมัติ', group: G_APPROVER, src: 'approver' },
      { header: 'วันที่อนุมัติ', group: G_APPROVER, src: 'approvedAt' },
      { header: 'ชื่อโครงการ / หน่วยงาน', group: '', src: 'stampProjectName' },
      { header: 'ประเภทผู้ใช้ตราประทับ', group: '', src: 'stampUserType' },
      { header: 'วันที่เริ่มต้น', group: '', src: 'startDate' },
      { header: 'วันที่สิ้นสุด', group: '', src: 'endDate' },
      // ชื่อผู้ใช้ตราประทับถูกเก็บรวมอยู่ในข้อความสรุป q32 ไม่มีฟิลด์แยก (รอ mapping)
      { header: 'ชื่อ-สกุล ผู้ใช้ตราประทับ', group: '', src: null },
      { header: 'จำนวนเงิน', group: G_INVOICE, src: null },
      { header: 'ชื่อหน่วยงาน', group: G_INVOICE, src: null },
      { header: 'วันที่ใบแจ้งหนี้', group: G_INVOICE, src: null },
      { header: 'เลขที่ใบแจ้งหนี้', group: G_INVOICE, src: null },
      { header: 'เลขที่ Voucher', group: '', src: null },
    ],
  },
  {
    key: 'issue',
    title: 'รายงานแจ้งปัญหาทั่วไป',
    match: (r) => r.formName === FORM_ISSUE,
    filters: ['userType', 'issueCategory'],
    // ชีตนี้รวมทุกประเภทผู้ใช้ไว้ตารางเดียว แต่ละแถวจะมีค่าเฉพาะบล็อกของตัวเอง
    columns: [
      COL_ID, COL_CREATED,
      { header: 'ชื่อ-สกุล', group: '(ส่วนที่ 1) รายละเอียดผู้ยื่นคำขอ (บุคลากรภายใน)', src: 'staffName' },
      { header: 'ตำแหน่ง', group: '(ส่วนที่ 1) รายละเอียดผู้ยื่นคำขอ (บุคลากรภายใน)', src: 'staffPosition' },
      { header: 'หน่วยงาน', group: '(ส่วนที่ 1) รายละเอียดผู้ยื่นคำขอ (บุคลากรภายใน)', src: 'staffDepartment' },
      { header: 'ประเภทผู้ขอ', group: '(ส่วนที่ 1) ข้อมูลผู้ติดต่อ (บุคคลภายนอก)', src: 'extType' },
      { header: 'ชื่อ', group: '(ส่วนที่ 1) ข้อมูลผู้ติดต่อ (บุคคลภายนอก)', src: 'extFirstName' },
      { header: 'นามสกุล', group: '(ส่วนที่ 1) ข้อมูลผู้ติดต่อ (บุคคลภายนอก)', src: 'extLastName' },
      { header: 'หน่วยงาน / บริษัท / นิติบุคคล', group: '(ส่วนที่ 1) ข้อมูลผู้ติดต่อ (บุคคลภายนอก)', src: 'extCompany' },
      { header: 'รหัสนักศึกษา', group: '(ส่วนที่ 1) รายละเอียดผู้ยื่นคำขอ (นักศึกษา)', src: 'studentId' },
      { header: 'ชื่อ-สกุล', group: '(ส่วนที่ 1) รายละเอียดผู้ยื่นคำขอ (นักศึกษา)', src: 'studentName' },
      { header: 'คณะ / สังกัด', group: '(ส่วนที่ 1) รายละเอียดผู้ยื่นคำขอ (นักศึกษา)', src: 'studentFaculty' },
      { header: 'ภาควิชา / สาขาวิชา', group: '(ส่วนที่ 1) รายละเอียดผู้ยื่นคำขอ (นักศึกษา)', src: 'studentMajor' },
      { header: 'กลุ่มของปัญหาที่แจ้ง', group: G_DETAIL2, src: 'issueCategory' },
      { header: 'รายละเอียดปัญหาที่พบ', group: G_DETAIL2, src: 'issueDetail' },
    ],
  },
];

// ป้ายกำกับตัวกรองที่ให้ผู้ใช้เลือกในแท็บรายงาน
const REPORT_FILTER_LABELS = {
  department: 'หน่วยงาน',
  faculty: 'คณะ / สังกัด',
  externalType: 'ประเภทผู้ขอ',
  userType: 'ประเภทผู้ยื่นคำขอ',
  issueCategory: 'กลุ่มของปัญหา',
  contractCampus: 'พื้นที่การศึกษา',
  stampUserType: 'ประเภทผู้ใช้ตราประทับ',
};

// q19 เก็บชื่อ-สกุลรวมเป็นสตริงเดียว (บุคคลภายนอกคือ extFname + ' ' + extLname)
// ตัดที่ช่องว่างสุดท้าย: ส่วนท้าย = นามสกุล ที่เหลือ = ชื่อ (คำนำหน้าติดมากับชื่อ)
function splitFullName(full) {
  const s = String(full || '').trim();
  if (!s) return { firstName: '', lastName: '' };
  const cut = s.lastIndexOf(' ');
  if (cut === -1) return { firstName: s, lastName: '' };
  return { firstName: s.slice(0, cut).trim(), lastName: s.slice(cut + 1).trim() };
}

// เก็บเฉพาะผลที่แปลว่า "อนุมัติ" — VALID_APPROVAL_OUTCOMES มี reject/needs_edit/
// invalid_code ฯลฯ ปนอยู่ด้วย ถ้าไม่กรอง วันที่ของการ "ไม่อนุมัติ" จะไปโผล่ใต้หัว
// คอลัมน์ "วันที่อนุมัติ" ('special' = กรณีพิเศษ ถือเป็นการอนุมัติ)
const APPROVED_OUTCOMES = new Set(['accept', 'special']);

// record.at เป็น ISO UTC (new Date().toISOString()) — ตัด 10 ตัวแรกตรง ๆ จะได้
// วันที่ตามเวลา UTC ทำให้การอนุมัติช่วงเที่ยงคืน–07:00 น. ไทย เพี้ยนไป 1 วัน
const BANGKOK_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function bangkokDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : BANGKOK_DATE_FMT.format(d);
}

// ไฟล์บันทึกผลอนุมัติมี key เป็น `${submissionId}:${hash(target)}` จึงไม่มี index
// ตรงต่อ submission — ไล่ทั้งไฟล์ครั้งเดียวแล้วยุบเป็น map (ไฟล์เล็ก อ่านครั้งเดียว
// ต่อการเรียก API หนึ่งครั้ง) เก็บเวลาอนุมัติ "ครั้งแรกสุด" ของแต่ละคำขอ
function approvalDatesBySubmission() {
  const out = Object.create(null);
  for (const record of Object.values(loadApprovalDecisions())) {
    if (!record || typeof record !== 'object') continue;
    const id = record.submissionId;
    const at = record.at;
    if (!id || !at) continue;
    if (!APPROVED_OUTCOMES.has(record.outcome)) continue;
    if (!out[id] || String(at) < String(out[id])) out[id] = String(at);
  }
  for (const id of Object.keys(out)) out[id] = bangkokDate(out[id]);
  return out;
}

// ช่อง checkbox หลายค่า (q57 วัตถุประสงค์ / q59 สถานที่) JotForm คืน .answer เป็น
// array — jotformAnswer() ทำ String(array) ได้ 'ก,ข' (ไม่มีเว้นวรรค) จึงอ่านดิบเอง
function jotformListAnswer(answers, qid) {
  const entry = answers && answers[qid];
  const a = entry && entry.answer;
  if (Array.isArray(a)) return a.map((v) => String(v).trim()).filter(Boolean);
  const s = typeof a === 'string' ? a : '';
  return s ? s.split(/\s*(?:\r?\n|,)\s*/).map((v) => v.trim()).filter(Boolean) : [];
}

// ตัวเลือก "อื่นๆ" เก็บข้อความที่ผู้ใช้ระบุไว้คนละฟิลด์ (q57↔q58, q59↔q60, q17↔q35)
// ถ้าไม่ประกบกลับ รายงานจะเห็นแค่คำว่า "อื่นๆ" ลอย ๆ ไม่รู้ว่าอื่นๆ คืออะไร
function mergeOtherOption(list, otherText) {
  const extra = String(otherText || '').trim();
  return list.map((v) => (v === 'อื่นๆ' && extra ? `อื่นๆ: ${extra}` : v)).join(', ');
}

// q22 ของบุคลากรเป็นชื่อหน่วยงานหลายระดับคั่นด้วยขึ้นบรรทัดใหม่ — ยุบให้อยู่บรรทัด
// เดียวแบบเดียวกับที่หน้าสรุปคำขอทำอยู่ (js/app.js) เพื่อไม่ให้เซลล์ตารางสูงผิดรูป
function flattenMultiline(value) {
  return String(value || '').replace(/\s*\r?\n\s*/g, ' / ').trim();
}

// เมื่อ Master Data หาสายอนุมัติไม่เจอ ฝั่งหน้าเว็บเขียนข้อความแจ้งเตือนลงช่อง
// ชื่อผู้อนุมัติแล้วส่งเป็น q28 ตามนั้น — ในรายงานต้องแสดงเป็นช่องว่าง ไม่ใช่ประโยค
const NO_APPROVER_SENTINEL = 'ไม่มีข้อมูลผู้อนุมัติในสายงาน (ติดต่อส่วนกลาง)';
function sanitizeApprover(name) {
  const s = String(name || '').trim();
  return s === NO_APPROVER_SENTINEL ? '' : s;
}

// q42 เก็บรถทุกคันเป็นข้อความหลายบรรทัด รูปแบบที่หน้าเว็บสร้างไว้คือ
//   'คันที่ 1 (ตนเอง): ชื่อ สกุล ทะเบียน'
// แยกกลับเป็นรายการเพื่อเอาไปลงคอลัมน์ทะเบียน/ชื่อ และแสดงรายละเอียดตอนคลิก
const VEHICLE_LINE_RE = /^คันที่\s*(\d+)\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/;
function parseVehicleLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => {
      const m = VEHICLE_LINE_RE.exec(line.trim());
      if (!m) return null;
      const parts = m[3].trim().split(/\s+/);
      // ทะเบียนคือคำสุดท้าย ที่เหลือคือชื่อ-สกุล (ชื่อไทยมีช่องว่างได้หลายจุด)
      const plate = parts.length > 1 ? parts[parts.length - 1] : '';
      const name = parts.length > 1 ? parts.slice(0, -1).join(' ') : m[3].trim();
      return { index: Number(m[1]), owner: m[2] || '', name, plate };
    })
    .filter(Boolean);
}

function reportRecordFromSubmission(sub, approvalDates) {
  const a = sub.answers || {};
  const q = (id) => jotformAnswer(a, id);
  const list = (id) => jotformListAnswer(a, id);
  const userType = q('16');
  const fullName = q('19');
  const { firstName, lastName } = splitFullName(fullName);
  const department = flattenMultiline(q('22'));
  const rawExternalType = q('17');
  const isStaff = userType === 'บุคลากร';
  const isStudent = userType === 'นักศึกษา';
  const isExternal = userType === 'บุคคลภายนอก';
  const externalType = rawExternalType
    ? mergeOtherOption([rawExternalType], q('35'))
    : '';
  const vehicles = parseVehicleLines(q('42'));
  return {
    id: sub.id,
    createdAt: String(sub.created_at || '').slice(0, 10),
    formName: q('15'),
    userType,
    externalType,
    requesterId: q('18'),
    requesterName: fullName,
    firstName,
    lastName,
    department,
    position: q('23'),
    faculty: q('26'),
    major: q('27'),
    approver: sanitizeApprover(q('28')),
    approvedAt: approvalDates[sub.id] || '',
    startDate: jotformDateAnswer(a, '36'),
    endDate: jotformDateAnswer(a, '37'),
    totalDays: q('40'),
    vehiclePlate: q('41'),
    vehicleList: q('42') || q('41'), // เผื่อคำขอเก่าที่ยังไม่มีรายการรายคัน
    vehicleCount: q('43'),
    // ต้นแบบแยก "ทะเบียนรถ" กับ "ชื่อ-สกุล" เป็นคนละคอลัมน์ และในตัวอย่างจะกรอก
    // เฉพาะคำขอที่มีรถคันเดียว ส่วนคำขอหลายคันเว้นว่างไว้ (ดูรายการเต็มได้จากการ
    // คลิกหมายเลขคำขอ) — ทำตามนั้นเพื่อไม่ให้เซลล์เดียวมีหลายทะเบียนปนกัน
    singlePlate: vehicles.length === 1 ? vehicles[0].plate : (Number(q('43')) === 1 ? q('41') : ''),
    singleOwner: vehicles.length === 1 ? vehicles[0].name : '',
    vehicles,
    parkReason: q('44'),
    considerationNote: q('46'),
    actualUserName: q('48'),
    stampProjectName: q('52'),
    stampUserType: q('53'),
    eventName: q('56'),
    eventObjectives: mergeOtherOption(list('57'), q('58')),
    eventLocations: mergeOtherOption(list('59'), q('60')),
    contractCompany: q('61'),
    contractBusinessType: q('62'),
    contractCampus: q('63'),
    contractBuilding: q('64'),
    issueCategory: q('65'),
    issueDetail: q('66'),
    amount: q('67'),
    boothCount: q('69'),
    // รายงานแจ้งปัญหาแยกบล็อกตามประเภทผู้ใช้ — เว้นว่างเมื่อไม่ตรงประเภท
    staffName: isStaff ? fullName : '',
    staffPosition: isStaff ? q('23') : '',
    staffDepartment: isStaff ? department : '',
    extType: isExternal ? externalType : '',
    extFirstName: isExternal ? firstName : '',
    extLastName: isExternal ? lastName : '',
    extCompany: isExternal ? department : '',
    studentId: isStudent ? q('18') : '',
    studentName: isStudent ? fullName : '',
    studentFaculty: isStudent ? q('26') : '',
    studentMajor: isStudent ? q('27') : '',
  };
}

app.get(
  '/api/admin/report',
  requireLogin,
  requireAdmin,
  asyncHandler(async (req, res) => {
    noStore(res);
    const def = REPORT_DEFS.find((d) => d.key === req.query.key);
    if (!def) {
      res.status(400).json({ error: 'unknown report key' });
      return;
    }
    if (!config.jotformApiKey) {
      res.status(200).json({ notConfigured: true, title: def.title, columns: [], rows: [] });
      return;
    }

    const submissions = await fetchJotformSubmissionsRaw();
    const approvalDates = approvalDatesBySubmission();
    const records = submissions
      .map((sub) => reportRecordFromSubmission(sub, approvalDates))
      .filter((r) => def.match(r))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    // ลำดับนับจากรายการทั้งหมดของรายงานนี้ (ก่อนกรองฝั่ง client) เพื่อให้เลขคงที่
    records.forEach((r, i) => { r.seq = String(i + 1); });

    const rows = records.map((r) => def.columns.map((c) => (c.src ? String(r[c.src] ?? '') : '')));

    // ข้อมูลประกอบต่อแถว: ใช้ทำตัวกรอง และแสดงรายละเอียดตอนคลิกหมายเลขคำขอ
    const meta = records.map((r) => ({
      id: r.id,
      department: r.department,
      faculty: r.faculty,
      externalType: r.externalType,
      userType: r.userType,
      issueCategory: r.issueCategory,
      contractCampus: r.contractCampus,
      stampUserType: r.stampUserType,
      vehicles: r.vehicles,
      vehicleCount: r.vehicleCount,
      requesterName: r.requesterName,
      startDate: r.startDate,
      endDate: r.endDate,
      amount: r.amount,
    }));

    res.status(200).json({
      title: def.title,
      columns: def.columns.map((c) => ({ header: c.header, group: c.group, mapped: Boolean(c.src) })),
      rows,
      meta,
      // ชื่อคอลัมน์ที่จะรวมยอดในแถวท้ายตาราง ('' = รายงานนี้ไม่มีแถวสรุป)
      sumColumn: def.sumColumn || '',
      filters: (def.filters || []).map((f) => ({ key: f, label: REPORT_FILTER_LABELS[f] || f })),
    });
  })
);

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

// Save/clear the admin note (หมายเหตุ) for one request. Deliberately open to
// BOTH roles — same rationale as locations: notes are day-to-day operational
// data, not permission management.
app.post(
  '/api/admin/request-note',
  requireLoginJson,
  requireAdmin,
  asyncHandler(async (req, res) => {
    noStore(res);
    const id = typeof req.body.id === 'string' ? req.body.id.trim() : '';
    // JotForm submission ids are long digit strings — reject anything else so
    // arbitrary keys can't accumulate in the notes file.
    if (!/^\d{6,32}$/.test(id)) {
      res.status(400).json({ error: 'รหัสคำขอไม่ถูกต้อง' });
      return;
    }
    const note = (typeof req.body.note === 'string' ? req.body.note : '').trim();
    if (note.length > REQUEST_NOTE_MAX_LENGTH) {
      res.status(400).json({ error: `หมายเหตุยาวเกินกำหนด (ไม่เกิน ${REQUEST_NOTE_MAX_LENGTH} ตัวอักษร)` });
      return;
    }
    try {
      const saved = saveRequestNote(id, note, getSessionAdminEmail(req));
      res.status(200).json({
        ok: true,
        id,
        note: saved ? saved.note : '',
        noteUpdatedAt: saved ? saved.updatedAt : '',
        noteUpdatedBy: saved ? saved.updatedBy : '',
      });
    } catch (err) {
      console.error(`[bpuu-workflow] request note persist failed: ${err.message}`);
      res.status(500).json({ error: 'บันทึกหมายเหตุไม่สำเร็จ (เขียนไฟล์ไม่ได้)' });
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
// which is the CSRF posture every state-changing route here relies on.
// requireRoleAdmin enforces admin-only SERVER-SIDE — a 'staff' user is not
// merely hidden from this UI, they are rejected here.
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

// เลขเวอร์ชันสำหรับ footer — ต้องเป็น public เพราะหน้า login (ยังไม่ล็อกอิน)
// ก็แสดง footer เดียวกัน ไม่มีข้อมูลอ่อนไหว มีแค่สตริงเวอร์ชันที่เรากำหนดเอง
// ส่งลิงก์นโยบายมาด้วย เพื่อให้ index.html (ไฟล์ static ที่ template ไม่ได้)
// กับหน้า login ใช้ค่าจาก env ชุดเดียวกัน ไม่ต้อง hardcode สองที่
app.get('/api/version', (req, res) => {
  noStore(res);
  res.status(200).json({
    version: config.appVersion,
    privacyUrl: config.privacyPolicyUrl,
    termsUrl: config.termsUrl,
  });
});

app.get(
  '/diagnostics',
  asyncHandler(async (req, res) => {
    noStore(res);
    res.status(200).json({
      version: config.appVersion,
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
// KMUTT-hosted attachments (แทนการฝากไฟล์แนบไว้กับ JotForm)
//
// The request form no longer submits file bytes to JotForm. The browser
// uploads each file here first (POST /api/attachments, login-gated), gets
// back a signed expiring /files/<token> URL served from THIS server, and
// submits only those URLs to JotForm inside q32_summary. Files live under
// ATTACHMENTS_PATH (same /app/data volume as the admin allowlist), so KMUTT
// keeps the bytes and email recipients need no JotForm account — the token
// in the link IS the credential, valid for FILE_LINK_TTL_DAYS. After expiry
// a link with a genuine signature degrades to requiring a KMUTT/ThaID login
// instead of going public-forever or dying outright.
// ---------------------------------------------------------------------------

const ATTACHMENTS_PATH =
  process.env.ATTACHMENTS_PATH || path.join(path.dirname(ADMIN_ALLOWLIST_PATH), 'attachments');

const FILE_LINK_TTL_DAYS = Math.max(1, parseInt(process.env.FILE_LINK_TTL_DAYS, 10) || 60);

// Dedicated signing secret so rotating SESSION_SECRET doesn't invalidate
// every attachment link already sitting in submitted requests and sent
// emails. Falls back to SESSION_SECRET (with a warning) so existing env
// files keep working.
const fileLinkSecret = process.env.FILE_LINK_SECRET || config.sessionSecret;
if (!process.env.FILE_LINK_SECRET) {
  console.warn(
    '[bpuu-workflow] FILE_LINK_SECRET is not set — attachment links are signed with SESSION_SECRET. ' +
      'Set FILE_LINK_SECRET so links survive a session-secret rotation.'
  );
}

// Links are minted absolute so they work inside JotForm emails. Base
// priority: FILE_LINK_BASE_URL env > origin of POST_LOGOUT_REDIRECT_URI
// (already this deployment's public URL in every env file).
function fileLinkBaseUrl() {
  if (process.env.FILE_LINK_BASE_URL) return process.env.FILE_LINK_BASE_URL.replace(/\/+$/, '');
  try {
    return new URL(config.postLogoutRedirectUri).origin;
  } catch (err) {
    return '';
  }
}

const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

// Retention: files are deleted ATTACHMENT_RETENTION_DAYS after upload — this
// makes the error page's 'อาจถูกลบตามรอบการจัดเก็บ' true and bounds disk
// growth (orphans from abandoned submissions included). Never shorter than
// the link TTL, so a live link never points at a swept file.
const ATTACHMENT_RETENTION_DAYS = Math.max(
  FILE_LINK_TTL_DAYS,
  parseInt(process.env.ATTACHMENT_RETENTION_DAYS, 10) || FILE_LINK_TTL_DAYS + 30
);

function sweepExpiredAttachments() {
  let sidecars = [];
  try {
    sidecars = fs.readdirSync(ATTACHMENTS_PATH).filter((f) => f.endsWith('.json'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[bpuu-workflow] attachment sweep could not list ${ATTACHMENTS_PATH}: ${err.message}`);
    }
    return;
  }
  const cutoff = Date.now() - ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const sidecarName of sidecars) {
    const id = sidecarName.slice(0, -5);
    if (!/^[0-9a-f]{32}$/.test(id)) continue;
    const meta = readAttachmentSidecar(id);
    const uploadedAt = meta ? Date.parse(meta.uploadedAt) : NaN;
    if (!Number.isFinite(uploadedAt) || uploadedAt > cutoff) continue;
    try {
      fs.rmSync(attachmentFilePath(id), { force: true });
      fs.rmSync(attachmentSidecarPath(id), { force: true });
      removed += 1;
    } catch (err) {
      console.error(`[bpuu-workflow] attachment sweep could not remove ${id}: ${err.message}`);
    }
  }
  if (removed) {
    console.log(`[bpuu-workflow] attachment sweep: removed ${removed} file(s) older than ${ATTACHMENT_RETENTION_DAYS} days`);
  }
}
sweepExpiredAttachments();
setInterval(sweepExpiredAttachments, 12 * 60 * 60 * 1000).unref();

// Per-identity upload budget (in-memory, resets on restart). An honest
// requester never gets near these numbers — this exists so a single looping
// account can't fill the shared /app/data volume (which also holds the
// admin allowlist and approval decisions).
const ATTACHMENT_BUDGET_WINDOW_MS = 60 * 60 * 1000;
const ATTACHMENT_BUDGET_MAX_FILES = 50;
const ATTACHMENT_BUDGET_MAX_BYTES = 500 * 1024 * 1024;
const attachmentBudgets = new Map();

function attachmentBudgetAllows(identity, bytes) {
  const now = Date.now();
  let budget = attachmentBudgets.get(identity);
  if (!budget || now - budget.windowStart > ATTACHMENT_BUDGET_WINDOW_MS) {
    budget = { windowStart: now, files: 0, bytes: 0 };
    attachmentBudgets.set(identity, budget);
  }
  if (
    budget.files + 1 > ATTACHMENT_BUDGET_MAX_FILES ||
    budget.bytes + bytes > ATTACHMENT_BUDGET_MAX_BYTES
  ) {
    return false;
  }
  budget.files += 1;
  budget.bytes += bytes;
  if (attachmentBudgets.size > 1000) {
    for (const [key, value] of attachmentBudgets) {
      if (now - value.windowStart > ATTACHMENT_BUDGET_WINDOW_MS) attachmentBudgets.delete(key);
    }
  }
  return true;
}

// Content types safe to render inline in the browser. Anything else is
// forced to download as application/octet-stream with an attachment
// disposition — an uploaded HTML/SVG served inline from this origin would
// be stored XSS.
const ATTACHMENT_INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function signFileToken(id, exp) {
  return crypto.createHmac('sha256', fileLinkSecret).update(`${id}.${exp}`).digest('hex');
}

function mintFileToken(id) {
  const exp = Math.floor(Date.now() / 1000) + FILE_LINK_TTL_DAYS * 24 * 60 * 60;
  return `${id}.${exp}.${signFileToken(id, exp)}`;
}

// Returns {id, expired} when the token's signature is genuine, else null.
// Signature is checked before expiry so an expired-but-real link can degrade
// to login-gated access, while a forged one learns nothing (timing-safe).
function verifyFileToken(token) {
  const m = /^([0-9a-f]{32})\.(\d{1,12})\.([0-9a-f]{64})$/.exec(String(token || ''));
  if (!m) return null;
  const [, id, expStr, sig] = m;
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(signFileToken(id, expStr), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { id, expired: Math.floor(Date.now() / 1000) > parseInt(expStr, 10) };
}

function attachmentFilePath(id) {
  return path.join(ATTACHMENTS_PATH, `${id}.bin`);
}

function attachmentSidecarPath(id) {
  return path.join(ATTACHMENTS_PATH, `${id}.json`);
}

function readAttachmentSidecar(id) {
  try {
    const meta = JSON.parse(fs.readFileSync(attachmentSidecarPath(id), 'utf8'));
    return meta && typeof meta === 'object' ? meta : null;
  } catch (err) {
    return null;
  }
}

// One file per request, raw body — no multipart, so no new dependency. The
// browser sends the bytes directly with the original filename URL-encoded in
// X-Attachment-Name (Thai filenames survive) and the MIME type in
// X-Attachment-Type.
app.post(
  '/api/attachments',
  requireAnyLoginJson,
  express.raw({ type: () => true, limit: ATTACHMENT_MAX_BYTES }),
  (req, res) => {
    noStore(res);

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'empty upload' });
      return;
    }

    let originalName = '';
    try {
      originalName = decodeURIComponent(req.headers['x-attachment-name'] || '');
    } catch (err) {
      originalName = '';
    }
    // slice โดยนับ code point ไม่ใช่ UTF-16 unit — .slice(0,200) ตรง ๆ อาจตัด
    // กลาง surrogate pair (อีโมจิ/อักขระนอก BMP) แล้ว encodeURIComponent ตอน
    // ดาวน์โหลดจะ throw ใส่ทุก request ของไฟล์นั้นตลอดไป
    originalName =
      Array.from(originalName.replace(/[\r\n\\/]+/g, ' ').trim()).slice(0, 200).join('') ||
      'attachment';

    const mime = String(req.headers['x-attachment-type'] || req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    const id = crypto.randomBytes(16).toString('hex');
    const uploader = resolveApprovalIdentityLabel(req);
    if (!attachmentBudgetAllows(uploader, req.body.length)) {
      console.warn(`[bpuu-workflow] attachment upload quota exceeded by ${uploader}`);
      res.status(429).json({ error: 'upload quota exceeded — try again later' });
      return;
    }
    try {
      fs.mkdirSync(ATTACHMENTS_PATH, { recursive: true });
      fs.writeFileSync(attachmentFilePath(id), req.body);
      fs.writeFileSync(
        attachmentSidecarPath(id),
        JSON.stringify(
          { originalName, size: req.body.length, mime, uploader, uploadedAt: new Date().toISOString() },
          null,
          2
        ) + '\n',
        'utf8'
      );
    } catch (err) {
      console.error(`[bpuu-workflow] attachment store failed: ${err.message}`);
      res.status(500).json({ error: 'could not store the file' });
      return;
    }

    console.log(
      `[bpuu-workflow] attachment stored: id=${id} size=${req.body.length} name="${originalName}" by ${uploader}`
    );
    res.status(200).json({
      url: `${fileLinkBaseUrl()}/files/${mintFileToken(id)}`,
      name: originalName,
      size: req.body.length,
    });
  }
);

// Serves a stored attachment. A valid, unexpired token needs no login at
// all — this is exactly what lets email recipients open files without a
// JotForm (or any) account. Expired-but-genuine tokens fall back to the
// same any-login gate as /approve-gate. Forged/garbled tokens 404.
app.get('/files/:token', (req, res) => {
  const parsed = verifyFileToken(req.params.token);
  if (!parsed) {
    res.status(404).send(
      renderErrorPage({
        title: 'ไม่พบไฟล์',
        message: 'ลิงก์ไฟล์แนบไม่ถูกต้อง กรุณาตรวจสอบลิงก์จากอีเมลอีกครั้ง',
        retryHref: '/',
      })
    );
    return;
  }

  if (parsed.expired) {
    const justExpired = expireSessionIfNeeded(req);
    if (!req.session.user && !req.session.externalUser) {
      req.session.redirectAfterLogin = req.originalUrl;
      req.session.thaidRedirectAfterLogin = req.originalUrl;
      noStore(res);
      res.status(200).send(renderLoginLandingPage({ expired: justExpired }));
      return;
    }
  }

  const meta = readAttachmentSidecar(parsed.id);
  const filePath = attachmentFilePath(parsed.id);
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    stat = null;
  }
  if (!meta || !stat || !stat.isFile()) {
    res.status(404).send(
      renderErrorPage({
        title: 'ไม่พบไฟล์',
        message: 'ไฟล์แนบนี้ไม่อยู่ในระบบแล้ว (อาจถูกลบตามรอบการจัดเก็บ)',
        retryHref: '/',
      })
    );
    return;
  }

  const inline = ATTACHMENT_INLINE_TYPES.has(meta.mime);
  const rawName = meta.originalName || 'attachment';
  // RFC 5987 ext-value: encodeURIComponent เว้น ' ( ) * ไว้ — ต้อง escape
  // เพิ่มเอง ไม่งั้นชื่อไฟล์ที่มีวงเล็บ/apostrophe พังในบาง client
  const encodedName = encodeURIComponent(rawName).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
  // ASCII fallback สำหรับ client เก่าที่ไม่อ่าน filename* (ชื่อไทยจะกลายเป็น _
  // แต่ยังดาวน์โหลดได้ ส่วน client ปกติใช้ filename* ได้ชื่อจริงครบ)
  const asciiName =
    rawName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\;]/g, '_').trim() || 'attachment';
  res.status(200);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', inline ? meta.mime : 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
  );
  console.log(
    `[bpuu-workflow] attachment served: id=${parsed.id} expired=${parsed.expired} viewer=${resolveApprovalIdentityLabel(req)}`
  );
  fs.createReadStream(filePath)
    .on('error', (err) => {
      console.error(`[bpuu-workflow] attachment stream failed: id=${parsed.id} ${err.message}`);
      res.destroy();
    })
    .pipe(res);
});

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
app.use('/img', express.static(path.join(__dirname, 'img')));
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

  // แตะข้อมูลสถานที่ตั้งแต่ตอนบูต เพื่อให้การ seed ชุดตั้งต้นลง volume เกิดขึ้น
  // ทันทีและเห็นผลใน log ของ container ไม่ต้องรอ request แรก
  console.log(`[bpuu-workflow] locations loaded: ${loadLocations().length} entries`);

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
