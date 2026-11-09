import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, validEmployee } from './helpers.js';

let api;
before(async () => { api = await startServer(); });
after(() => api.close());

test('search with an empty body returns the first page of the seeded data', async () => {
  const { status, json } = await api.call('POST', '/employees/search', {});
  assert.equal(status, 200);
  assert.equal(json.total >= 50, true);
  assert.equal(json.items.length, 20);
  assert.equal(json.page, 1);
  assert.equal(json.pageSize, 20);
  const first = json.items[0];
  assert.deepEqual(Object.keys(first).sort(),
    ['address', 'age', 'birthDate', 'department', 'firstName', 'gender', 'id', 'lastName']);
  assert.equal(typeof first.address.city, 'string');
});

test('search filters by department and reports the full total', async () => {
  const { json } = await api.call('POST', '/employees/search', { department: 'Maintenance', pageSize: 3 });
  assert.equal(json.total, 10);
  assert.equal(json.items.length, 3);
  assert.ok(json.items.every((e) => e.department === 'Maintenance'));
});

test('search matches first or last name case-insensitively', async () => {
  const { json } = await api.call('POST', '/employees/search', { search: 'OHANA', pageSize: 100 });
  assert.ok(json.total > 0);
  assert.ok(json.items.every((e) => e.firstName.toLowerCase().includes('ohana') || e.lastName.toLowerCase().includes('ohana')));
});

test('create returns 201 and the employee can be read back', async () => {
  const created = await api.call('POST', '/employees', validEmployee({ firstName: 'Create' }));
  assert.equal(created.status, 201);
  assert.equal(Number.isInteger(created.json.id), true);
  assert.equal(Number.isInteger(created.json.age), true);
  assert.deepEqual(created.json.address, { street: 'Herzl 1', city: 'Haifa', zip: '3100000' });
  const read = await api.call('GET', `/employees/${created.json.id}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.json, created.json);
});

test('create rejects the same person with 409', async () => {
  const person = validEmployee({ firstName: 'Twin' });
  assert.equal((await api.call('POST', '/employees', person)).status, 201);
  const again = await api.call('POST', '/employees', { ...person, firstName: 'TWIN', department: 'HR' });
  assert.equal(again.status, 409);
  assert.deepEqual(again.json, { message: 'A person with the same first name, last name, and birth date already exists' });
});

test('create rejects an invalid body with 400 and an error message', async () => {
  const { status, json } = await api.call('POST', '/employees', validEmployee({ department: 'Nope' }));
  assert.equal(status, 400);
  assert.equal(typeof json.message, 'string');
});

test('get returns 404 for an unknown id', async () => {
  const { status, json } = await api.call('GET', '/employees/999999');
  assert.equal(status, 404);
  assert.equal(typeof json.message, 'string');
});

test('put replaces all fields', async () => {
  const { json: created } = await api.call('POST', '/employees', validEmployee({ firstName: 'Before' }));
  const body = validEmployee({ firstName: 'After', department: 'Finance', address: { street: 'New 2', city: 'Eilat' } });
  const put = await api.call('PUT', `/employees/${created.id}`, body);
  assert.equal(put.status, 200);
  assert.equal(put.json.id, created.id);
  assert.equal(put.json.firstName, 'After');
  assert.equal(put.json.department, 'Finance');
  assert.deepEqual(put.json.address, { street: 'New 2', city: 'Eilat' });
});

test('put returns 404 for an unknown id', async () => {
  assert.equal((await api.call('PUT', '/employees/999999', validEmployee({ firstName: 'Ghost' }))).status, 404);
});

test('put returns 409 when it would duplicate another person', async () => {
  const a = validEmployee({ firstName: 'PutA' });
  const b = validEmployee({ firstName: 'PutB' });
  await api.call('POST', '/employees', a);
  const { json: second } = await api.call('POST', '/employees', b);
  assert.equal((await api.call('PUT', `/employees/${second.id}`, a)).status, 409);
});

test('put keeps working when a person is saved over themselves', async () => {
  const person = validEmployee({ firstName: 'Self' });
  const { json } = await api.call('POST', '/employees', person);
  assert.equal((await api.call('PUT', `/employees/${json.id}`, { ...person, department: 'HR' })).status, 200);
});

test('interactive docs and the contract are served', async () => {
  const docs = await api.call('GET', '/docs/');
  assert.equal(docs.status, 200);
  assert.match(docs.text, /swagger/i);
  const spec = await api.call('GET', '/openapi.json');
  assert.equal(spec.status, 200);
  assert.equal(spec.json.openapi, '3.1.0');
  assert.ok(spec.json.paths['/employees/{id}'].put.responses['409']);
});
