import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { create } from '../src/employees.js';
import { departmentReport, formatDepartmentReport } from '../src/report.js';
import { validEmployee } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = join(root, 'scripts/department-report.js');

// A developer's shell may set DB_PATH or PORT, so tests start from an environment without them.
function withEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of ['DB_PATH', 'PORT', 'HOST', 'CORS_ORIGINS']) if (!(key in extra)) delete env[key];
  return env;
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'report-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A copy of the project without node_modules, so it behaves like a fresh clone.
function copyProject(dir) {
  for (const name of ['src', 'scripts', 'docs/contract.json', 'docs/db', 'package.json']) cpSync(join(root, name), join(dir, name), { recursive: true });
}

const seededReport = [
  'מחלקה        | עובדים',
  '-------------|--------',
  'HR           | 8',
  'R&D          | 16',
  'Maintenance  | 10',
  'Sales        | 9',
  'Finance      | 7',
].join('\n');

test('report matches the required layout exactly', () => {
  const db = openDb(':memory:');
  assert.equal(departmentReport(db), seededReport);
  db.close();
});

test('report reflects a newly created employee', () => {
  const db = openDb(':memory:');
  create(db, validEmployee({ firstName: 'Counted', department: 'Finance' }));
  assert.match(departmentReport(db), /^Finance {6}\| 8$/m);
  db.close();
});

test('report still lists a department with no employees', () => {
  const db = openDb(':memory:');
  db.exec("DELETE FROM employees WHERE department = 'Finance'");
  assert.match(departmentReport(db), /^Finance {6}\| 0$/m);
  db.close();
});

test('script output stays exact when a .env file is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'report-env-'));
  try {
    writeFileSync(join(dir, '.env'), 'SOME_SETTING=1\n');
    openDb(join(dir, 'fresh.db')).close();
    const result = spawnSync(process.execPath, [script], {
      cwd: dir,
      env: withEnv({ DB_PATH: join(dir, 'fresh.db') }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${seededReport}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('script prints the report on a fresh database with no server running', () => {
  const dir = mkdtempSync(join(tmpdir(), 'report-'));
  try {
    openDb(join(dir, 'fresh.db')).close();
    const result = spawnSync(process.execPath, ['scripts/department-report.js'], {
      env: withEnv({ DB_PATH: join(dir, 'fresh.db') }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${seededReport}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('script fails loudly on an explicit DB_PATH that does not exist, and creates nothing', () => {
  withTempDir((dir) => {
    const file = join(dir, 'missing.db');
    const result = spawnSync(process.execPath, [script], { env: withEnv({ DB_PATH: file }), encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /missing\.db/);
    assert.equal(existsSync(file), false);
  });
});

test('script fails loudly on DB_PATH=:memory:', () => {
  const result = spawnSync(process.execPath, [script], { env: withEnv({ DB_PATH: ':memory:' }), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('script reports all zeros for an emptied database and leaves it empty', () => {
  withTempDir((dir) => {
    const file = join(dir, 'empty.db');
    const db = openDb(file);
    db.exec('DELETE FROM employees');
    db.close();
    const result = spawnSync(process.execPath, [script], { env: withEnv({ DB_PATH: file }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${formatDepartmentReport(new Map())}
`);
    assert.match(result.stdout, /^HR {11}\| 0$/m);
    const after = openDb(file);
    assert.equal(after.prepare('SELECT count(*) AS n FROM employees').get().n, 0);
    after.close();
  });
});

test('openDb does not re-seed an emptied database', () => {
  withTempDir((dir) => {
    const file = join(dir, 'empty.db');
    const first = openDb(file);
    first.exec('DELETE FROM employees');
    first.close();
    const second = openDb(file);
    assert.equal(second.prepare('SELECT count(*) AS n FROM employees').get().n, 0);
    second.close();
  });
});

test('a fresh clone without node_modules prints the seeded report', () => {
  withTempDir((dir) => {
    copyProject(dir);
    const result = spawnSync(process.execPath, ['scripts/department-report.js'], { cwd: dir, env: withEnv(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${seededReport}
`);
  });
});

test('a fresh clone that copied .env.example prints the seeded report', () => {
  withTempDir((dir) => {
    copyProject(dir);
    writeFileSync(join(dir, '.env'), 'DB_PATH=data/employees.db\n');
    const result = spawnSync(process.execPath, ['scripts/department-report.js'], { cwd: dir, env: withEnv(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${seededReport}\n`);
  });
});

test('config binds to loopback and allows no origins by default, and parses CORS_ORIGINS', () => {
  withTempDir((dir) => {
    copyProject(dir);
    const load = (env) => {
      const code = "import { config } from './src/config.js'; console.log(JSON.stringify(config));";
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };

    const defaults = load(withEnv());
    assert.equal(defaults.host, '127.0.0.1');
    assert.deepEqual(defaults.corsOrigins, []);

    const custom = load(withEnv({ HOST: '0.0.0.0', CORS_ORIGINS: ' https://a.example, ,https://b.example,' }));
    assert.equal(custom.host, '0.0.0.0');
    assert.deepEqual(custom.corsOrigins, ['https://a.example', 'https://b.example']);
  });
});

test('.env is read from the project root, not the working directory', () => {
  withTempDir((dir) => {
    const project = join(dir, 'project');
    const elsewhere = join(dir, 'elsewhere');
    mkdirSync(project);
    mkdirSync(elsewhere);
    copyProject(project);
    const rootDb = join(dir, 'root.db');
    openDb(rootDb).close();
    writeFileSync(join(project, '.env'), `DB_PATH=${rootDb}
`);
    writeFileSync(join(elsewhere, '.env'), `DB_PATH=${join(dir, 'cwd-missing.db')}
`);
    const run = (env) => spawnSync(process.execPath, [join(project, 'scripts/department-report.js')], { cwd: elsewhere, env, encoding: 'utf8' });

    const fromRoot = run(withEnv());
    assert.equal(fromRoot.status, 0, fromRoot.stderr);
    assert.equal(fromRoot.stdout, `${seededReport}
`);

    // A real environment variable beats the .env file.
    const emptyDb = join(dir, 'empty.db');
    const db = openDb(emptyDb);
    db.exec('DELETE FROM employees');
    db.close();
    const overridden = run(withEnv({ DB_PATH: emptyDb }));
    assert.equal(overridden.status, 0, overridden.stderr);
    assert.match(overridden.stdout, /^HR {11}\| 0$/m);
  });
});

test('the server exits non-zero and never says it is listening when the port is busy', async () => {
  await withBlockedPort((port, dir) => {
    const result = spawnSync(process.execPath, ['src/index.js'], {
      cwd: root,
      env: withEnv({ PORT: String(port), DB_PATH: join(dir, 'busy.db') }),
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Listening/);
  });
});

test('formatDepartmentReport works from a plain Map', () => {
  const counts = new Map([['HR', 3], ['Finance', 12]]);
  assert.equal(formatDepartmentReport(counts), [
    'מחלקה        | עובדים',
    '-------------|--------',
    'HR           | 3',
    'R&D          | 0',
    'Maintenance  | 0',
    'Sales        | 0',
    'Finance      | 12',
  ].join('\n'));
});

async function withBlockedPort(fn) {
  const blocker = net.createServer();
  // Same address the server binds by default: a wildcard bind would not conflict with it.
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(join(tmpdir(), 'busy-'));
  try {
    // spawnSync blocks this process, but the OS keeps the socket bound for the child.
    fn(blocker.address().port, dir);
  } finally {
    blocker.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
