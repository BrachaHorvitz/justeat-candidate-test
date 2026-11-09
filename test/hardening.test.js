import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { contract } from '../src/contract.js';
import * as employees from '../src/employees.js';
import { startServer, validEmployee } from './helpers.js';

let api;
before(async () => { api = await startServer(); });
after(() => api.close());

const search = (body) => api.call('POST', '/employees/search', body);

const wrongBodies = {
  firstName: [null, 1, true, [], {}, '', 'x'.repeat(51)],
  lastName: [null, 1, true, [], {}, '', 'x'.repeat(51)],
  birthDate: [null, 1, true, [], {}, '', 'nope', '2023-02-30', '1990-13-01', '17/05/1990', '2999-01-01'],
  gender: [null, 1, true, [], {}, '', 'Male'],
  department: [null, 1, true, [], {}, '', 'hr'],
  address: [null, 1, true, [], 'x', {}, { street: 'a' }, { city: 'a' }, { street: 1, city: 'a' }, { street: 'a', city: 1 }, { street: 'a', city: 'b', zip: 1 }],
};

for (const [field, values] of Object.entries(wrongBodies)) {
  test(`create and replace reject every invalid ${field}`, async () => {
    for (const value of values) {
      const body = validEmployee({ firstName: 'Sweep', [field]: value });
      assert.equal((await api.call('POST', '/employees', body)).status, 400, `POST ${JSON.stringify(value)}`);
      assert.equal((await api.call('PUT', '/employees/1', body)).status, 400, `PUT ${JSON.stringify(value)}`);
    }
  });
}

test('create rejects missing required fields and unknown fields', async () => {
  for (const field of ['firstName', 'lastName', 'birthDate', 'gender', 'address', 'department']) {
    const body = validEmployee();
    delete body[field];
    assert.equal((await api.call('POST', '/employees', body)).status, 400, field);
  }
  assert.equal((await api.call('POST', '/employees', validEmployee({ id: 7 }))).status, 400);
});

test('name length limits accept 1 and 50 characters', async () => {
  const one = await api.call('POST', '/employees', validEmployee({ firstName: 'Q', lastName: 'One' }));
  const fifty = await api.call('POST', '/employees', validEmployee({ firstName: 'Z'.repeat(50) }));
  assert.equal(one.status, 201);
  assert.equal(fifty.status, 201);
});

const wrongFilters = {
  department: [null, 1, true, [], {}, 'hr'],
  gender: [null, 1, true, [], {}, 'x'],
  minAge: [null, 'x', true, [], {}, -1, 1.5, 0.10000000000000001],
  maxAge: [null, 'x', true, [], {}, -1, 1.5],
  search: [null, 1, true, [], {}],
  page: [null, 'x', true, [], {}, 0, -1, 1.5],
  pageSize: [null, 'x', true, [], {}, 0, -1, 1.5, 101],
  unknownField: ['x'],
};

for (const [field, values] of Object.entries(wrongFilters)) {
  test(`search rejects every invalid ${field}`, async () => {
    for (const value of values) {
      assert.equal((await search({ [field]: value })).status, 400, JSON.stringify(value));
    }
  });
}

test('search rejects minAge greater than maxAge', async () => {
  assert.equal((await search({ minAge: 40, maxAge: 30 })).status, 400);
});

test('search treats LIKE wildcards as literal characters', async () => {
  assert.equal((await search({ search: '%' })).json.total, 0);
  assert.equal((await search({ search: '_' })).json.total, 0);
});

test('search pages do not overlap and pageSize 100 is allowed', async () => {
  const one = await search({ pageSize: 10, page: 1 });
  const two = await search({ pageSize: 10, page: 2 });
  assert.notEqual(one.json.items[0].id, two.json.items[0].id);
  assert.ok(one.json.items.at(-1).id < two.json.items[0].id);
  assert.equal((await search({ pageSize: 100 })).status, 200);
});

test('search past the end returns no items and the real total', async () => {
  for (const page of [1000, Number.MAX_SAFE_INTEGER, 1e300]) {
    const { status, json } = await search({ page, department: 'HR' });
    assert.equal(status, 200, String(page));
    assert.deepEqual(json.items, []);
    assert.ok(json.total >= 8);
  }
});

test('extreme numbers and odd text never crash search', async () => {
  for (const body of [{ minAge: 1e300 }, { maxAge: 1e300 }, { search: 'a\u0000b' }, { search: '\'; DROP TABLE employees; --' }, { search: '😀' }]) {
    assert.equal((await search(body)).status, 200, JSON.stringify(body));
  }
  assert.ok((await search({})).json.total >= 50);
  assert.equal((await search('{"page":1.0000000000000000001}')).status, 200);
});

test('bad request bodies return 400 with an error message', async () => {
  for (const body of ['{bad', '[]', 'null', '"text"', '1']) {
    const { status, json } = await search(body);
    assert.equal(status, 400, body);
    assert.equal(typeof json.message, 'string');
  }
  assert.equal((await api.call('POST', '/employees/search')).status, 400);
  assert.equal((await api.call('POST', '/employees')).status, 400);
});

test('an oversized body returns 413', async () => {
  const { status, json } = await search({ search: 'a'.repeat(200_000) });
  assert.equal(status, 413);
  assert.equal(typeof json.message, 'string');
});

test('non-numeric and out-of-range ids follow the contract', async () => {
  for (const id of ['abc', '1.5', '1e3', '%20', '99999999999999999999', '0', '-1']) {
    assert.equal((await api.call('GET', `/employees/${id}`)).status, 404, `GET ${id}`);
  }
  for (const id of ['abc', '1.5', '1e3']) {
    assert.equal((await api.call('PUT', `/employees/${id}`, validEmployee())).status, 400, `PUT ${id}`);
  }
  assert.equal((await api.call('PUT', '/employees/99999999999999999999', validEmployee({ firstName: 'Big' }))).status, 404);
});

test('malformed paths and unknown routes never return 500', async () => {
  for (const path of ['/employees/%E0%A4%A', '/employees/%', '//employees', '/nope', '/employees/1/extra']) {
    const { status, json } = await api.call('GET', path);
    assert.ok(status === 400 || status === 404, `${path} -> ${status}`);
    assert.equal(typeof json.message, 'string');
  }
});

test('the zip is optional and omitted when absent', async () => {
  const { status, json } = await api.call('POST', '/employees', validEmployee({ firstName: 'NoZip', address: { street: 'a', city: 'b' } }));
  assert.equal(status, 201);
  assert.deepEqual(json.address, { street: 'a', city: 'b' });
});

test('age changes exactly on the birthday', () => {
  const db = openDb(':memory:');
  const { id } = employees.create(db, validEmployee({ firstName: 'Bday', birthDate: '1990-05-17' }));
  assert.equal(employees.get(db, id, new Date('2026-05-16T12:00:00Z')).age, 35);
  assert.equal(employees.get(db, id, new Date('2026-05-17T12:00:00Z')).age, 36);

  const find = (now) => employees.search(db, { search: 'Bday', minAge: 36, maxAge: 36, page: 1, pageSize: 20 }, now).total;
  assert.equal(find(new Date('2026-05-16T12:00:00Z')), 0);
  assert.equal(find(new Date('2026-05-17T12:00:00Z')), 1);
  db.close();
});

test('someone born on 29 February ages on 1 March in a common year', () => {
  const db = openDb(':memory:');
  const { id } = employees.create(db, validEmployee({ firstName: 'Leap', birthDate: '2000-02-29' }));
  assert.equal(employees.get(db, id, new Date('2023-02-28T12:00:00Z')).age, 22);
  assert.equal(employees.get(db, id, new Date('2023-03-01T12:00:00Z')).age, 23);
  db.close();
});

test('data survives a restart and the seed is not applied twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'restart-'));
  const file = join(dir, 'employees.db');
  try {
    let db = openDb(file);
    employees.create(db, validEmployee({ firstName: 'Durable' }));
    db.close();
    db = openDb(file);
    assert.equal(db.prepare('SELECT count(*) AS n FROM employees').get().n, 51);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replacing an employee keeps the original created_at', async () => {
  const { json } = await api.call('POST', '/employees', validEmployee({ firstName: 'Stamp' }));
  const createdAt = () => api.db.prepare('SELECT created_at AS c FROM employees WHERE id = ?').get(json.id).c;
  const before = createdAt();
  await api.call('PUT', `/employees/${json.id}`, validEmployee({ firstName: 'Stamp2' }));
  assert.equal(createdAt(), before);
});

test('the database CHECK lists match the contract enums', () => {
  const db = openDb(':memory:');
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employees'").get().sql;
  db.close();
  const schemas = contract.components.schemas;
  for (const [column, schema] of [['department', schemas.Department], ['gender', schemas.Gender]]) {
    const match = sql.match(new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`));
    assert.ok(match, `no ${column} IN (...) CHECK found in the table SQL`);
    const values = [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    assert.deepEqual([...values].sort(), [...schema.enum].sort(), `${column} CHECK differs from the contract`);
  }
});
