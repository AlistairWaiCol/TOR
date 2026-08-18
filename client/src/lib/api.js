/** Tiny fetch wrapper. Session lives in an httpOnly cookie, so credentials only. */

async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${url}`, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body ?? {}),
  del: (url) => request('DELETE', url),
  async upload(url, formData) {
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
    return data;
  },
};

export function mapImageUrl(calibrationId, tier = 'web') {
  return `/api/map/calibrations/${calibrationId}/image/${tier}`;
}

/** The only route handout pixels come from — see server/routes/handouts.js. */
export function handoutImageUrl(handoutId, tier = 'view') {
  return `/api/handouts/${handoutId}/image/${tier}`;
}
