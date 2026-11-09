export class DuplicateEmployeeError extends Error {
  constructor() {
    super('A person with the same first name, last name, and birth date already exists');
  }
}

// The contract says age is computed at request time, so it exists only here.
// Every read goes through this one definition, which keeps filter and output in step.
const EMPLOYEES_WITH_AGE = `(
  SELECT *, (:year - CAST(substr(birth_date, 1, 4) AS INTEGER) - (substr(birth_date, 6) > :monthDay)) AS age
  FROM employees
)`;

function today(now) {
  const iso = now.toISOString();
  return { year: Number(iso.slice(0, 4)), monthDay: iso.slice(5, 10) };
}

function toEmployee(row) {
  const address = { street: row.street, city: row.city };
  if (row.zip !== null) address.zip = row.zip;
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    gender: row.gender,
    address,
    department: row.department,
    age: row.age,
  };
}

function toColumns(input) {
  return {
    first: input.firstName,
    last: input.lastName,
    birth: input.birthDate,
    gender: input.gender,
    street: input.address.street,
    city: input.address.city,
    zip: input.address.zip ?? null,
    department: input.department,
  };
}

function write(action) {
  try {
    return action();
  } catch (err) {
    // 2067 is SQLITE_CONSTRAINT_UNIQUE. The code is stable, unlike the message text.
    if (err.errcode === 2067) {
      throw new DuplicateEmployeeError();
    }
    throw err;
  }
}

export function search(db, filters, now = new Date()) {
  const clauses = [];
  const params = today(now);

  if (filters.department !== undefined) { clauses.push('department = :department'); params.department = filters.department; }
  if (filters.gender !== undefined) { clauses.push('gender = :gender'); params.gender = filters.gender; }
  if (filters.minAge !== undefined) { clauses.push('age >= :minAge'); params.minAge = filters.minAge; }
  if (filters.maxAge !== undefined) { clauses.push('age <= :maxAge'); params.maxAge = filters.maxAge; }
  if (filters.search !== undefined && filters.search.trim() !== '') {
    // Escape LIKE wildcards so a search for "%" means the literal character.
    params.term = `%${filters.search.trim().replace(/[\\%_]/g, '\\$&')}%`;
    clauses.push(`(first_name LIKE :term ESCAPE '\\' OR last_name LIKE :term ESCAPE '\\')`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { page, pageSize } = filters;
  const total = db.prepare(`SELECT count(*) AS n FROM ${EMPLOYEES_WITH_AGE} ${where}`).get(params).n;

  // Skipping the query past the end also keeps huge page numbers away from SQLite's OFFSET.
  const offset = (page - 1) * pageSize;
  const rows = offset >= total
    ? []
    : db.prepare(`SELECT * FROM ${EMPLOYEES_WITH_AGE} ${where} ORDER BY id LIMIT :limit OFFSET :offset`)
      .all({ ...params, limit: pageSize, offset });

  return { items: rows.map(toEmployee), total, page, pageSize };
}

export function get(db, id, now = new Date()) {
  if (!Number.isSafeInteger(id)) return undefined;
  const row = db.prepare(`SELECT * FROM ${EMPLOYEES_WITH_AGE} WHERE id = :id`).get({ ...today(now), id });
  return row ? toEmployee(row) : undefined;
}

export function create(db, input) {
  const result = write(() => db.prepare(`
    INSERT INTO employees (first_name, last_name, birth_date, gender, street, city, zip, department)
    VALUES (:first, :last, :birth, :gender, :street, :city, :zip, :department)
  `).run(toColumns(input)));
  return get(db, Number(result.lastInsertRowid));
}

export function replace(db, id, input) {
  if (!Number.isSafeInteger(id)) return undefined;
  const result = write(() => db.prepare(`
    UPDATE employees
    SET first_name = :first, last_name = :last, birth_date = :birth, gender = :gender,
        street = :street, city = :city, zip = :zip, department = :department
    WHERE id = :id
  `).run({ ...toColumns(input), id }));
  return result.changes === 0 ? undefined : get(db, id);
}

export function countByDepartment(db) {
  const rows = db.prepare('SELECT department, count(*) AS n FROM employees GROUP BY department').all();
  return new Map(rows.map((row) => [row.department, row.n]));
}
