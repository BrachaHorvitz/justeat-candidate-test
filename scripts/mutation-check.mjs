// Breaks one rule at a time and checks that the test suite notices.
// It works on a temporary copy, so the project itself is never changed.
//
// The list below is hand-picked and aimed at places where tests looked weak, so the
// result shows whether these specific rules are protected. It is not a coverage score.
//
// Usage: node scripts/mutation-check.mjs
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const E = 'src/employees.js', V = 'src/validation.js', A = 'src/app.js', D = 'src/db.js';

// Removing this guard gives the pattern %%, which still matches everyone, so no test can notice.
const CANNOT_CHANGE_BEHAVIOR = new Set(['blank search not treated as no filter']);

const mutants = [
  ['gender filter ignored', E, 'if (filters.gender !== undefined) {', 'if (false) {'],
  ['minAge exclusive (>)', E, 'age >= :minAge', 'age > :minAge'],
  ['maxAge exclusive (<)', E, 'age <= :maxAge', 'age < :maxAge'],
  ['minAge filter ignored', E, 'if (filters.minAge !== undefined) {', 'if (false) {'],
  ['maxAge filter ignored', E, 'if (filters.maxAge !== undefined) {', 'if (false) {'],
  ['filters OR instead of AND', E, "clauses.join(' AND ')", "clauses.join(' OR ')"],
  ['search ignores first name', E, "(first_name LIKE :term ESCAPE '\\\\' OR last_name LIKE :term ESCAPE '\\\\')", "(last_name LIKE :term ESCAPE '\\\\')"],
  ['search ignores last name', E, "(first_name LIKE :term ESCAPE '\\\\' OR last_name LIKE :term ESCAPE '\\\\')", "(first_name LIKE :term ESCAPE '\\\\')"],
  ['search term not trimmed', E, 'filters.search.trim().replace', 'filters.search.replace'],
  ['blank search not treated as no filter', E, " && filters.search.trim() !== ''", ''],
  ['backslash not escaped in search', E, '/[\\\\%_]/g', '/[%_]/g'],
  ['results not ordered by id', E, 'ORDER BY id ', 'ORDER BY first_name '],
  ['PUT does not update lastName', E, 'last_name = :last', 'last_name = coalesce(last_name, :last)'],
  ['PUT does not update birthDate', E, 'birth_date = :birth', 'birth_date = coalesce(birth_date, :birth)'],
  ['PUT does not update gender', E, 'gender = :gender,', 'gender = coalesce(gender, :gender),'],
  ['PUT does not update street', E, 'street = :street', 'street = coalesce(street, :street)'],
  ['PUT does not update city', E, 'city = :city', 'city = coalesce(city, :city)'],
  ['PUT does not update zip', E, 'zip = :zip', 'zip = coalesce(zip, :zip)'],
  ['PUT does not update department', E, 'department = :department\n    WHERE', 'department = coalesce(department, :department)\n    WHERE'],
  ['minAge == maxAge rejected', V, 'minAge > maxAge', 'minAge >= maxAge'],
  ['birth date of today rejected', V, 'body.birthDate > new Date()', 'body.birthDate >= new Date()'],
  ['future birth date allowed', V, 'body.birthDate > new Date()', 'false && body.birthDate > new Date()'],
  ['names not trimmed', V, '  trimNames(body);\n', ''],
  ['earliest birth date not enforced', V, 'body.birthDate < EARLIEST_BIRTH_DATE', 'false'],
  ['earliest birth date itself rejected', V, 'body.birthDate < EARLIEST_BIRTH_DATE', 'body.birthDate <= EARLIEST_BIRTH_DATE'],
  ['seed whenever the table is empty', D, 'if (!existed) db.exec', "if (db.prepare('SELECT count(*) AS n FROM employees').get().n === 0) db.exec"],
  ['validation details dropped', A, '...(err.details && { details: err.details }),', ''],
  ['500 leaks internal error text', A, "message: isClientError ? err.message : 'Internal server error',", 'message: err.message,'],
  ['API security headers removed', A, '  app.use(helmet());\n', ''],
  ['CORS removed', A, '  app.use(cors({ origin: corsOrigins }));\n', ''],
  ['/docs keeps strict CSP (Swagger UI blocked)', A, 'helmet({ contentSecurityPolicy: false })', 'helmet()'],
  ['duplicate check case-sensitive on last name', D, 'last_name COLLATE NOCASE', 'last_name'],
  ['seed lock removed (BEGIN IMMEDIATE to BEGIN)', D, "db.exec('BEGIN IMMEDIATE')", "db.exec('BEGIN')"],
  ['busy_timeout removed', D, "db.exec('PRAGMA busy_timeout = 5000');", ''],
  ['seed failure not rolled back', D, "db.exec('ROLLBACK');", ''],
];

const dir = mkdtempSync(join(tmpdir(), 'mutation-check-'));
let caught = 0, expected = 0, problems = 0;

try {
  for (const name of ['src', 'test', 'docs', 'scripts', 'node_modules', 'package.json']) {
    cpSync(join(root, name), join(dir, name), { recursive: true });
  }
  const tests = readdirSync(join(dir, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);

  for (const [label, rel, from, to] of mutants) {
    const file = join(dir, rel);
    const original = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (!original.includes(from)) {
      problems++;
      console.log(`NOT APPLIED  ${label}`);
      continue;
    }
    writeFileSync(file, original.replace(from, () => to));
    const run = spawnSync(process.execPath, ['--test', ...tests], { cwd: dir, encoding: 'utf8' });
    writeFileSync(file, original);

    if (run.status !== 0) {
      caught++;
      console.log(`caught       ${label}`);
    } else if (CANNOT_CHANGE_BEHAVIOR.has(label)) {
      expected++;
      console.log(`no effect    ${label}`);
    } else {
      problems++;
      console.log(`SURVIVED     ${label}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(`\n${mutants.length} rules: ${caught} caught, ${expected} cannot change behavior, ${problems} need attention`);
process.exitCode = problems === 0 ? 0 : 1;
