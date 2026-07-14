'use strict';

/**
 * /adfs/discovery — Netlify Function
 *
 * Informational-only endpoint backing the discovery-metadata card on
 * adfs.html. Never returns the client secret or the full client ID — only a
 * masked preview. Failures are reported as { error: 'unavailable' } with a
 * 200 status so the page can show "unavailable" gracefully instead of
 * breaking the console.
 */

const { loadDiscoveryMetadata } = require('./_lib/oidc');

exports.handler = async () => {
  const discoveryUrl = process.env.ADFS_DISCOVERY_URL;
  const clientId = process.env.ADFS_CLIENT_ID;

  try {
    if (!discoveryUrl || !String(discoveryUrl).trim()) {
      throw new Error('ADFS_DISCOVERY_URL is not set.');
    }
    const metadata = await loadDiscoveryMetadata(discoveryUrl);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issuer: metadata.issuer,
        authorization_endpoint: metadata.authorization_endpoint,
        token_endpoint: metadata.token_endpoint,
        clientIdPreview: clientId ? `${String(clientId).slice(0, 8)}***` : null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unavailable' }),
    };
  }
};
