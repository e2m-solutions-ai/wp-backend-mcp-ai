// Shared HTTP clients for WP REST.
// - `core`  → authenticated with Application Password (Basic auth). Hits /wp/v2/* and /wp/v2/<custom>.
// - `mcp`   → primary auth: shared secret (X-WP-MCP-Key) to gate /wp-backend-mcp/v1/* routes.
//             Also sends Basic auth (Application Password) so WP's determine_current_user
//             resolves a real WP user inside the route. Needed for the Abilities API bridge
//             (WP_Ability::execute() runs permission_callback against the current user).

import axios from 'axios';
import https from 'node:https';

const baseURL = () => (process.env.WP_URL || '').replace(/\/$/, '');

function basicAuthHeader() {
  const user = process.env.WP_USER || '';
  const pass = (process.env.WP_APP_PASSWORD || '').replace(/\s+/g, '');
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

// HTTPS agent that tolerates self-signed certs when WP_INSECURE_TLS=1 or 'true'.
// Useful for Local-by-Flywheel / MAMP-style dev installs where WordPress is
// served with a self-signed cert under .local. Off by default; opt-in only.
function buildHttpsAgent() {
  const flag = String(process.env.WP_INSECURE_TLS || '').toLowerCase();
  const insecure = flag === '1' || flag === 'true' || flag === 'yes';
  if (!insecure) return undefined;
  return new https.Agent({ rejectUnauthorized: false });
}

const sharedAxiosConfig = {
  headers: { 'Content-Type': 'application/json' },
  validateStatus: () => true, // we'll format errors uniformly
};

export const core = axios.create(sharedAxiosConfig);
export const mcp  = axios.create(sharedAxiosConfig);

// Generic core REST helper. `path` is e.g. '/wp/v2/posts' or '/wp/v2/pages/123'.
export async function coreRequest(method, path, { params, data, headers, responseType } = {}) {
  const url = `${baseURL()}/wp-json${path}`;
  const res = await core.request({
    method,
    url,
    params,
    data,
    responseType,
    httpsAgent: buildHttpsAgent(),
    headers: {
      Authorization: basicAuthHeader(),
      ...(headers || {}),
    },
  });
  return formatResponse(res);
}

// MU-plugin route helper. `path` is e.g. '/wp-backend-mcp/v1/plugins/install'.
// Sends both the shared-secret (gate) and Basic auth (so WP sets the current user).
export async function mcpRequest(method, path, { params, data } = {}) {
  const url = `${baseURL()}/wp-json${path}`;
  const res = await mcp.request({
    method,
    url,
    params,
    data,
    httpsAgent: buildHttpsAgent(),
    headers: {
      'X-WP-MCP-Key': process.env.WP_BACKEND_MCP_KEY || '',
      Authorization: basicAuthHeader(),
    },
  });
  return formatResponse(res);
}

function formatResponse(res) {
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status, data: res.data };
  }
  return {
    ok: false,
    status: res.status,
    error: typeof res.data === 'object' ? res.data : { message: String(res.data) },
  };
}

export function asToolResult(payload) {
  return {
    content: [
      { type: 'text', text: JSON.stringify(payload, null, 2) },
    ],
  };
}
