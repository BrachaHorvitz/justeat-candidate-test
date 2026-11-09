import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import * as employees from '../src/employees.js';
import { startServer, validEmployee } from './helpers.js';

let api;
before(async () => { api = await startServer(); });
after(() => api.close());

const search = (body) => api.call('POST', '/employees/search', body);
const create = (overrides) => api.call('POST', '/employees', validEmployee(overrides));
const ids = (items) => items.map((e) => e.id);

// Every employee, used as an independent expectation for what a filter should return.
async function everyone() {
  const { json } = await search({ pageSize: 100 });
  assert.ok(json.total <= 100, 'this file assumes everyone fits on one page');
  return json.items;
}

function tempDb(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { file: join(dir, 'employees.db'), remove: () => rmSync(dir, { recursive: true, force: true }) };
}

// Search filters

test('search returns exactly the employees of each gender', async () => {
  const all = await everyone();
  for (const gender of ['male', 'female', 'other']) {
    const expected = all.filter((e) => e.gender === gender);
    assert.ok(expected.length > 0 && expected.length < all.length, gender);
    const { json } = await search({ gender, pageSize: 100 });
    assert.equal(json.total, expected.length, gender);
    assert.deepEqual(ids(json.items), ids(expected), gender);
  }
});

test('search with maxAge alone returns everyone up to and including that age', async () => {
  const all = await everyone();
  const limit = all.map((e) => e.age).sort((a, b) => a - b)[Math.floor(all.length / 2)];
  const expected = all.filter((e) => e.age <= limit);
  assert.ok(expected.length < all.length);
  const { json } = await search({ maxAge: limit, pageSize: 100 });
  assert.deepEqual(ids(json.items), ids(expected));
});

test('search with minAge alone returns everyone from that age up', async () => {
  const all = await everyone();
  const limit = all.map((e) => e.age).sort((a, b) => a - b)[Math.floor(all.length / 2)];
  const expected = all.filter((e) => e.age >= limit);
  assert.ok(expected.length < all.length);
  const { json } = await search({ minAge: limit, pageSize: 100 });
  assert.deepEqual(ids(json.items), ids(expected));
});

test('search accepts minAge equal to maxAge', async () => {
  const all = await everyone();
  const age = all[0].age;
  const { status, json } = await search({ minAge: age, maxAge: age, pageSize: 100 });
  assert.equal(status, 200);
  assert.deepEqual(ids(json.items), ids(all.filter((e) => e.age === age)));
});

test('search applies all filters together', async () => {
  const all = await everyone();
  const expected = all.filter((e) => e.department === 'HR' && e.gender === 'female' && e.age >= 30);
  assert.ok(expected.length > 0);
  const { json } = await search({ department: 'HR', gender: 'female', minAge: 30, pageSize: 100 });
  assert.equal(json.total, expected.length);
  assert.deepEqual(ids(json.items), ids(expected));
});

// Search text

test('search ignores spaces around the term', async () => {
  const plain = await search({ search: 'ohana', pageSize: 100 });
  const padded = await search({ search: '  ohana ', pageSize: 100 });
  assert.ok(plain.json.total > 0);
  assert.deepEqual(padded.json, plain.json);
});

test('an empty or blank search means no name filter', async () => {
  const { total } = (await search({})).json;
  for (const term of ['', '   ']) {
    assert.equal((await search({ search: term })).json.total, total, JSON.stringify(term));
  }
});

test('search finds names containing %, _ and backslash literally', async () => {
  for (const [term, firstName] of [['%', '100%Sure'], ['_', 'Under_Score'], ['\\', 'Back\\Slash']]) {
    const { json: created } = await create({ firstName });
    const { json } = await search({ search: term, pageSize: 100 });
    assert.deepEqual(ids(json.items), [created.id], term);
  }
});

// Pagination

test('walking every page returns each match once, in id order', async () => {
  const { total } = (await search({ department: 'R&D' })).json;
  const seen = [];
  for (let page = 1; seen.length < total; page++) {
    const { json } = await search({ department: 'R&D', pageSize: 3, page });
    assert.ok(json.items.length > 0, `page ${page} came back empty early`);
    seen.push(...ids(json.items));
  }
  assert.equal(new Set(seen).size, total);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
});

test('page boundaries: smallest page, partial last page, exactly past the end', async () => {
  const department = 'R&D';
  const { total } = (await search({ department })).json;
  assert.ok(total > 1);
  assert.equal((await search({ department, pageSize: 1 })).json.items.length, 1);

  const partial = await search({ department, pageSize: total - 1, page: 2 });
  assert.equal(partial.json.items.length, 1);
  assert.equal(partial.json.total, total);

  const pastEnd = await search({ department, pageSize: total, page: 2 });
  assert.equal(pastEnd.status, 200);
  assert.deepEqual(pastEnd.json.items, []);
  assert.equal(pastEnd.json.total, total);
});

// PUT

test('put replaces every field and the change is saved', async () => {
  const { json: original } = await create({ firstName: 'PutOriginal' });
  const body = {
    firstName: 'PutChanged',
    lastName: 'Different',
    birthDate: '2000-05-17',
    gender: 'other',
    address: { street: 'New 2', city: 'Eilat', zip: '8800000' },
    department: 'Finance',
  };
  const put = await api.call('PUT', `/employees/${original.id}`, body);
  assert.equal(put.status, 200);
  assert.deepEqual(put.json, { ...body, id: original.id, age: original.age - 10 });
  assert.deepEqual((await api.call('GET', `/employees/${original.id}`)).json, put.json);
});

test('a rejected put leaves the employee unchanged', async () => {
  const { json: taken } = await create({ firstName: 'PutTaken' });
  const { json: target } = await create({ firstName: 'PutTarget' });

  const invalid = await api.call('PUT', `/employees/${target.id}`, validEmployee({ firstName: 'Changed', department: 'Nope' }));
  assert.equal(invalid.status, 400);
  const conflict = await api.call('PUT', `/employees/${target.id}`, validEmployee({ firstName: taken.firstName, department: 'HR' }));
  assert.equal(conflict.status, 409);

  assert.deepEqual((await api.call('GET', `/employees/${target.id}`)).json, target);
});

test('put validates the body before looking up the employee', async () => {
  const { status } = await api.call('PUT', '/employees/999999', validEmployee({ department: 'Nope' }));
  assert.equal(status, 400);
});

test('put on id 0 or a negative id is not found', async () => {
  for (const id of ['0', '-1']) {
    assert.equal((await api.call('PUT', `/employees/${id}`, validEmployee({ firstName: `Id${id}` }))).status, 404, id);
  }
});

// Duplicates

test('the duplicate check ignores case in the last name, on create and replace', async () => {
  const person = { firstName: 'CaseCheck', lastName: 'Sameperson' };
  assert.equal((await create(person)).status, 201);
  assert.equal((await create({ ...person, lastName: 'SAMEPERSON' })).status, 409);

  const { json: other } = await create({ firstName: 'CaseOther', lastName: 'Sameperson' });
  const put = await api.call('PUT', `/employees/${other.id}`, validEmployee({ ...person, lastName: 'samePERSON' }));
  assert.equal(put.status, 409);
});

test('the same name with a different birth date is a different person', async () => {
  const name = { firstName: 'Namesake', lastName: 'Shared' };
  assert.equal((await create({ ...name, birthDate: '1980-01-01' })).status, 201);
  assert.equal((await create({ ...name, birthDate: '1980-01-02' })).status, 201);
});

test('a rejected create adds nothing', async () => {
  const person = { firstName: 'OnlyOnce' };
  assert.equal((await create(person)).status, 201);
  const { total } = (await search({})).json;
  assert.equal((await create(person)).status, 409);
  assert.equal((await create({ firstName: 'Bad', department: 'Nope' })).status, 400);
  assert.equal((await search({})).json.total, total);
});

test('simultaneous identical creates produce exactly one employee', async () => {
  const person = { firstName: 'Race', lastName: 'Condition' };
  const results = await Promise.all(Array.from({ length: 8 }, () => create(person)));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409, 409, 409, 409]);
  assert.equal((await search({ search: 'Condition' })).json.total, 1);
});

// Birth date and age, with the clock under test control

test('a birth date of today is accepted and tomorrow is rejected', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-05-17T12:00:00Z') });
  const today = await create({ firstName: 'BornToday', birthDate: '2026-05-17' });
  assert.equal(today.status, 201);
  assert.equal(today.json.age, 0);
  assert.equal((await create({ firstName: 'BornTomorrow', birthDate: '2026-05-18' })).status, 400);
});

test('"today" for birth dates follows the UTC date', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-05-17T23:59:00Z') });
  const body = { firstName: 'UtcEdge', birthDate: '2026-05-18' };
  assert.equal((await create(body)).status, 400);
  t.mock.timers.setTime(Date.parse('2026-05-18T00:01:00Z'));
  assert.equal((await create(body)).status, 201);
});

test('age changes at the UTC date boundary', () => {
  const db = openDb(':memory:');
  const { id } = employees.create(db, validEmployee({ firstName: 'Midnight', birthDate: '1990-05-17' }));
  assert.equal(employees.get(db, id, new Date('2026-05-16T23:59:59Z')).age, 35);
  assert.equal(employees.get(db, id, new Date('2026-05-17T00:00:00Z')).age, 36);
  db.close();
});

test('someone born on 29 February ages on the day in a leap year', () => {
  const db = openDb(':memory:');
  const { id } = employees.create(db, validEmployee({ firstName: 'LeapDay', birthDate: '2000-02-29' }));
  assert.equal(employees.get(db, id, new Date('2024-02-28T12:00:00Z')).age, 23);
  assert.equal(employees.get(db, id, new Date('2024-02-29T12:00:00Z')).age, 24);
  db.close();
});

// Rules stricter than the contract

test('names are saved without surrounding spaces, on create and replace', async () => {
  const created = await create({ firstName: '  Trimmed\t', lastName: ' Spaces ' });
  assert.equal(created.status, 201);
  assert.equal(created.json.firstName, 'Trimmed');
  assert.equal(created.json.lastName, 'Spaces');

  const put = await api.call('PUT', `/employees/${created.json.id}`, validEmployee({ firstName: ' Retrimmed ', lastName: 'Spaces' }));
  assert.equal(put.status, 200);
  assert.equal(put.json.firstName, 'Retrimmed');
});

test('a name differing only by surrounding spaces is a duplicate', async () => {
  const person = { firstName: 'Padded', lastName: 'Duplicate' };
  assert.equal((await create(person)).status, 201);
  assert.equal((await create({ ...person, firstName: ' Padded' })).status, 409);
  assert.equal((await create({ ...person, lastName: 'Duplicate  ' })).status, 409);
});

test('a name made only of spaces is rejected', async () => {
  for (const field of ['firstName', 'lastName']) {
    const body = validEmployee({ [field]: '   ' });
    const created = await api.call('POST', '/employees', body);
    assert.equal(created.status, 400, `POST ${field}`);
    assert.equal(created.json.details[0].path, `/${field}`);
    assert.equal((await api.call('PUT', '/employees/1', body)).status, 400, `PUT ${field}`);
  }
});

test('the name length limit applies after trimming', async () => {
  const name = `  ${'T'.repeat(50)}  `;
  const { status, json } = await create({ firstName: name, lastName: 'Limit' });
  assert.equal(status, 201);
  assert.equal(json.firstName, 'T'.repeat(50));
});

test('the earliest accepted birth date is 1900-01-01', async () => {
  assert.equal((await create({ firstName: 'Earliest', birthDate: '1900-01-01' })).status, 201);
  for (const birthDate of ['1899-12-31', '0000-01-01']) {
    const body = validEmployee({ firstName: 'TooOld', birthDate });
    const created = await api.call('POST', '/employees', body);
    assert.equal(created.status, 400, `POST ${birthDate}`);
    assert.equal(created.json.details[0].path, '/birthDate');
    assert.equal((await api.call('PUT', '/employees/1', body)).status, 400, `PUT ${birthDate}`);
  }
});

// Behaviour kept on purpose. These record the decision, so changing it is a visible choice.

test('case-insensitive matching covers English letters only', async () => {
  const person = { lastName: 'Accented' };
  const upper = await create({ ...person, firstName: 'Émile' });
  const lower = await create({ ...person, firstName: 'émile' });
  assert.equal(upper.status, 201);
  assert.equal(lower.status, 201);
  assert.deepEqual(ids((await search({ search: 'ÉMILE' })).json.items), [upper.json.id]);
});

test('unknown fields inside address are accepted and not stored', async () => {
  const address = { street: 'a', city: 'b', country: 'IL' };
  const { status, json } = await create({ firstName: 'ExtraAddress', address });
  assert.equal(status, 201);
  assert.deepEqual(json.address, { street: 'a', city: 'b' });
});

test('an empty street or city is accepted', async () => {
  const { status, json } = await create({ firstName: 'EmptyAddress', address: { street: '', city: '' } });
  assert.equal(status, 201);
  assert.deepEqual(json.address, { street: '', city: '' });
});

test('an id with leading zeros refers to the same employee', async () => {
  const { json: created } = await create({ firstName: 'LeadingZero' });
  const read = await api.call('GET', `/employees/0${created.id}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.json, created);
  const put = await api.call('PUT', `/employees/0${created.id}`, validEmployee({ firstName: 'LeadingZero', department: 'HR' }));
  assert.equal(put.status, 200);
  assert.equal(put.json.id, created.id);
});

// Error responses

test('validation errors list every problem in details', async () => {
  const { status, json } = await create({ gender: 'Nope', department: 'Nope' });
  assert.equal(status, 400);
  assert.equal(json.message, 'Validation failed');
  assert.deepEqual(json.details.map((d) => d.path).sort(), ['/department', '/gender']);
  assert.ok(json.details.every((d) => typeof d.message === 'string'));
});

test('the extra validation rules name the field in details', async () => {
  assert.equal((await search({ minAge: 40, maxAge: 30 })).json.details[0].path, '/minAge');
  assert.equal((await create({ birthDate: '2999-01-01' })).json.details[0].path, '/birthDate');
  assert.equal((await api.call('PUT', '/employees/abc', validEmployee())).json.details[0].path, '/id');
});

test('an internal failure returns a generic 500 and is logged', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const broken = await startServer();
  try {
    broken.db.exec('DROP TABLE employees');
    const { status, json } = await broken.call('POST', '/employees/search', {});
    assert.equal(status, 500);
    assert.deepEqual(json, { message: 'Internal server error' });
    assert.equal(logged.mock.callCount(), 1);
  } finally {
    await broken.close();
  }
});

test('a body that is not sent as JSON returns 400', async () => {
  const res = await fetch(`${api.base}/employees/search`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(res.status, 400);
  assert.equal(typeof (await res.json()).message, 'string');
});

// Headers

test('API responses carry the security headers', async () => {
  const { headers } = await api.call('GET', '/employees/1');
  assert.match(headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
});

const fromOrigin = (origin) => ({ origin });
const preflightFrom = (origin) => ({ origin, 'access-control-request-method': 'PUT' });

test('by default no origin is granted CORS access', async () => {
  const simple = await api.call('GET', '/employees/1', undefined, fromOrigin('https://any.example'));
  assert.equal(simple.status, 200);
  assert.equal(simple.headers.get('access-control-allow-origin'), null);

  const preflight = await api.call('OPTIONS', '/employees/1', undefined, preflightFrom('https://any.example'));
  assert.ok(preflight.status < 500, `preflight returned ${preflight.status}`);
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
});

test('only listed origins are granted CORS access', async (t) => {
  const listed = await startServer({ corsOrigins: ['https://allowed.example'] });
  t.after(() => listed.close());

  const allowed = await listed.call('GET', '/employees/1', undefined, fromOrigin('https://allowed.example'));
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example');

  const unlisted = await listed.call('GET', '/employees/1', undefined, fromOrigin('https://other.example'));
  assert.equal(unlisted.status, 200);
  assert.equal(unlisted.headers.get('access-control-allow-origin'), null);
});

test('CORS preflight allows the methods the API uses for a listed origin only', async (t) => {
  const listed = await startServer({ corsOrigins: ['https://allowed.example'] });
  t.after(() => listed.close());

  const allowed = await listed.call('OPTIONS', '/employees/1', undefined, preflightFrom('https://allowed.example'));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example');
  assert.match(allowed.headers.get('access-control-allow-methods'), /PUT/);
  assert.match(allowed.headers.get('access-control-allow-methods'), /POST/);

  const unlisted = await listed.call('OPTIONS', '/employees/1', undefined, preflightFrom('https://other.example'));
  assert.ok(unlisted.status < 500, `preflight returned ${unlisted.status}`);
  assert.equal(unlisted.headers.get('access-control-allow-origin'), null);
});

test('/docs relaxes only the content security policy', async () => {
  const { status, headers } = await api.call('GET', '/docs/');
  assert.equal(status, 200);
  assert.equal(headers.get('content-security-policy'), null);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
});

// Database startup

test('processes starting together on a fresh database seed it once', async () => {
  const { file, remove } = tempDb('seed-race-');
  // Every process spins until the same moment, so their first database calls overlap.
  const startAt = Date.now() + 700;
  const opener = `import { openDb } from ${JSON.stringify(new URL('../src/db.js', import.meta.url).href)}; while (Date.now() < ${startAt}); openDb(process.argv[1]).close();`;
  try {
    const exits = await Promise.all(Array.from({ length: 6 }, async () => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', opener, file], { stdio: 'ignore' });
      const [code] = await once(child, 'close');
      return code;
    }));
    assert.deepEqual(exits, [0, 0, 0, 0, 0, 0]);
    const db = new DatabaseSync(file);
    assert.equal(db.prepare('SELECT count(*) AS n FROM employees').get().n, 50);
    db.close();
  } finally {
    remove();
  }
});

test('opening the database waits for another process holding the write lock', async () => {
  const { file, remove } = tempDb('busy-');
  try {
    openDb(file).close();
    const holder = spawn(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('BEGIN IMMEDIATE');
      console.log('locked');
      setTimeout(() => { db.exec('COMMIT'); db.close(); }, 400);
    `, file], { stdio: ['ignore', 'pipe', 'ignore'] });
    const closed = once(holder, 'close');
    await once(holder.stdout, 'data');

    openDb(file).close();
    await closed;
  } finally {
    remove();
  }
});

test('a failed startup does not keep the database locked', () => {
  const { file, remove } = tempDb('rollback-');
  const setup = new DatabaseSync(file);
  // The missing columns make the schema step fail once the write lock is held.
  setup.exec('CREATE TABLE employees (id INTEGER PRIMARY KEY)');
  setup.close();

  assert.throws(() => openDb(file));

  const other = new DatabaseSync(file);
  other.exec('BEGIN IMMEDIATE');
  other.exec('ROLLBACK');
  other.close();
  // openDb does not close its connection when it fails, so Windows may still hold the file.
  try { remove(); } catch {}
});
