import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from './helpers.js';
import { departmentReport, formatDepartmentReport } from '../src/report.js';

async function search(term) {
  const api = await startServer();
  try {
    return await api.call('POST', '/employees/search', { search: term });
  } finally {
    await api.close();
  }
}

test('a search of exactly 100 characters is allowed', async () => {
  const res = await search('a'.repeat(100));
  assert.equal(res.status, 200);
});

test('a search of 101 characters is rejected at /search', async () => {
  const res = await search('a'.repeat(101));
  assert.equal(res.status, 400);
  assert.equal(res.json.details[0].path, '/search');
});

test('a search beyond the SQLite LIKE limit is a 400, not a 500', async () => {
  const res = await search('a'.repeat(60000));
  assert.equal(res.status, 400);
  assert.equal(res.json.details[0].path, '/search');
});

test('a search that escaping would push beyond the SQLite LIKE limit is a 400', async () => {
  const res = await search('%'.repeat(30000));
  assert.equal(res.status, 400);
  assert.equal(res.json.details[0].path, '/search');
});

test('formatDepartmentReport names a department outside the contract', () => {
  assert.throws(() => formatDepartmentReport(new Map([['HR', 1], ['Legal', 2]])), /Legal/);
});

test('departmentReport throws for a stored department outside the contract', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE employees (department TEXT)');
    db.exec("INSERT INTO employees (department) VALUES ('Legal')");
    assert.throws(() => departmentReport(db), /Legal/);
  } finally {
    db.close();
  }
});
