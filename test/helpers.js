import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

// Starts the real app on a random port against a fresh seeded in-memory database.
// Options are passed straight to createApp.
export async function startServer(options) {
  const db = openDb(':memory:');
  const server = await new Promise((resolve) => {
    const s = createApp(db, options).listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json, text, headers: res.headers };
  }

  return {
    db,
    base,
    call,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); db.close(); }),
  };
}

export const validEmployee = (overrides = {}) => ({
  firstName: 'Test',
  lastName: 'Person',
  birthDate: '1990-05-17',
  gender: 'female',
  address: { street: 'Herzl 1', city: 'Haifa', zip: '3100000' },
  department: 'Sales',
  ...overrides,
});
