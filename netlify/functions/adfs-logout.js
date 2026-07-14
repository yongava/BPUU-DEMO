'use strict';

/**
 * /adfs/logout — Netlify Function
 *
 * Stateless design: there is no server-side session to destroy here, and no
 * id_token_hint is available (the raw ID token is never persisted anywhere
 * in this design — see _lib/oidc.js's popupBridgeHtml/encodeResultForFragment
 * comments). This endpoint's purpose is to let the user clear ADFS's own SSO
 * cookie between repeated test runs, so the ADFS login prompt reappears
 * instead of silently auto-approving via an existing SSO session.
 */

const { loadDiscoveryMetadata } = require('./_lib/oidc');

const POST_LOGOUT_REDIRECT_URI = 'https://bpuu-form-test.netlify.app/adfs';

exports.handler = async () => {
  const discoveryUrl = process.env.ADFS_DISCOVERY_URL;

  if (!discoveryUrl || !String(discoveryUrl).trim()) {
    return {
      statusCode: 302,
      headers: { Location: '/adfs' },
      body: '',
    };
  }

  let metadata;
  try {
    metadata = await loadDiscoveryMetadata(discoveryUrl);
  } catch (err) {
    return {
      statusCode: 302,
      headers: { Location: '/adfs' },
      body: '',
    };
  }

  if (!metadata.end_session_endpoint) {
    return {
      statusCode: 302,
      headers: { Location: '/adfs' },
      body: '',
    };
  }

  const logoutUrl = `${metadata.end_session_endpoint}?post_logout_redirect_uri=${encodeURIComponent(POST_LOGOUT_REDIRECT_URI)}`;

  return {
    statusCode: 302,
    headers: { Location: logoutUrl },
    body: '',
  };
};
