# Employees API

A backend service for managing employees, implementing `docs/contract.json`, plus a reliable department headcount report that anyone can get by asking Claude Code.

## Tech stack

Plain JavaScript (ES modules) with no build step. Versions are the ones currently installed.

| Area | Technology | Used for |
| --- | --- | --- |
| Runtime | Node.js 22.13 or later | The API, the report script and the tests |
| Web framework | Express 5.3 | Routing, JSON body parsing, error handling |
| Database | SQLite, through Node's built-in `node:sqlite` | Employee storage in one file, with no database server |
| Data access | Plain SQL with bound parameters | All queries, in `src/employees.js`. No ORM |
| API definition | OpenAPI 3.1 (`docs/contract.json`) | The source for validation, docs and the department list |
| Validation | Ajv 8.20, ajv-formats 3.0 | Request validators compiled from the contract |
| API docs | swagger-ui-express 5.0 | Interactive docs at `/docs` |
| Security | Helmet 8.3, cors 2.8 | Security headers and the browser origin allowlist |
| Logging | morgan 1.12 | Request logs |
| Tests | Node's built-in test runner (`node:test`) | Real HTTP calls against real SQLite databases |
| AI integration | Claude Code skill and project instructions | Routing the headcount question to the report script |

## Run it

Needs Node.js 22.13 or later (built and tested on 26.13).

```
npm install
npm start
```

| What | Where |
| --- | --- |
| API | `http://localhost:3000` |
| Interactive docs (Swagger UI) | `http://localhost:3000/docs` |
| Contract as JSON | `http://localhost:3000/openapi.json` |

The first start creates `data/employees.db` and loads the 50 seed employees. The seed is loaded only when the database is first created, so a database that has been emptied stays empty. To start over from the seed, stop the server and delete the `data` folder.

| Setting (`.env`) | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | API port |
| `HOST` | `127.0.0.1` | Address the API binds to. Only this machine can reach it unless this is changed |
| `CORS_ORIGINS` | empty | Comma-separated list of origins allowed to call the API from a browser. Empty means no cross-origin access is granted |
| `DB_PATH` | `data/employees.db` | Database file, or `:memory:` (the API only; the report refuses it). Pointing it at the default location, as `.env.example` does, counts as the default, so a fresh clone provisions the database and the report works. Any other path, and `:memory:`, is explicit, and the report fails loudly if it's missing |

`.env` is read from the project root, whatever folder you run from, and real environment variables win over it. The report script needs no `npm install`; the API does.

```
npm test
```

## API

| Endpoint | Purpose | Responses |
| --- | --- | --- |
| `POST /employees/search` | Filter and paginate employees | 200, 400 |
| `POST /employees` | Create an employee | 201, 400, 409 |
| `GET /employees/{id}` | Read one employee | 200, 404 |
| `PUT /employees/{id}` | Replace an employee | 200, 400, 404, 409 |
| `GET /docs` | Swagger UI | 200 |
| `GET /openapi.json` | The contract as JSON | 200 |

Search filters are `department`, `gender`, `minAge`, `maxAge`, `search` (first or last name), `page` and `pageSize`. Errors are returned as `{ message, details }`, where `details` is a list of `{ path, message }` on validation failures.

## Department report (Stage 2)

Open Claude Code in this folder and ask, in any wording, in English or Hebrew:

> How many employees are currently in each department?

The answer is always in this format, with live numbers:

```
מחלקה        | עובדים
-------------|--------
HR           | 8
R&D          | 16
Maintenance  | 10
Sales        | 9
Finance      | 7
```

The same table is available without AI: `node scripts/department-report.js`.

How it stays reliable:

| Piece | Job |
| --- | --- |
| `scripts/department-report.js` and `src/report.js` | Code produces the table, so the numbers and layout never depend on the AI. The report opens the database read-only and never writes to an existing one. If the data contains a department that isn't in the contract, the script names it, exits non-zero and prints no table, so nothing is silently dropped |
| `.claude/skills/department-headcount/SKILL.md` | Tells Claude to run that command and return its output unchanged, and to give no numbers if it fails |
| `CLAUDE.md` | Always-loaded rule that sends this question to the skill |
| `.claude/settings.json` | Pre-approves only that one command, so nobody gets a permission prompt |

These files are all part of the repository, so everyone who clones it gets the same behavior.

## Architecture

The project has two entry points, the API server and the report script. They run as separate processes and share the data layer and the SQLite file.

```
   HTTP client                       Claude Code or a terminal
        |                                        |
        v                                        v
  src/index.js                     scripts/department-report.js
        |                                        |
        v                                        v
   src/app.js                              src/report.js
   routes, errors                          table text
        |                                        |
        v                                        |
 src/validation.js                               |
 request rules                                   |
        |                                        |
        v                                        v
 src/employees.js  <-----------------------------+
 all employee SQL, age
        |
        v
    src/db.js  ---------->  data/employees.db (SQLite file)
    read-write for the API, read-only for the report

 docs/contract.json  feeds validation, /docs and the report's department list
 src/config.js       is the only place that reads the environment and .env
```

### Handling a request

1. `src/app.js` applies the middleware in order: security headers (Helmet), the CORS allowlist, request logging (server only), then JSON body parsing. `/docs` is mounted first, with its own relaxed content security policy.
2. The route calls `src/validation.js`, which checks the body against the contract and then applies the rules the contract can't express. A failure throws an `HttpError`, which becomes a 400.
3. The route calls `src/employees.js`, which runs the SQL and converts rows to the contract's shape, including the nested `address` and the computed `age`.
4. The error handler at the end of `src/app.js` builds every error response. A duplicate person becomes a 409. Anything unexpected is logged and returned as a generic 500, so internal details never reach the client.

### Design principles

| Principle | How it shows up |
| --- | --- |
| The contract is the source of truth | Validation and `/docs` are generated from `docs/contract.json`, and the report takes its department list from it. The database `CHECK` lists are the one separate copy, and a test fails if they differ |
| Each layer has one job | `src/app.js` handles HTTP, `src/validation.js` handles request rules, and `src/employees.js` handles SQL and knows nothing about HTTP |
| The database enforces its own rules | A unique index stops duplicate people, including from simultaneous requests, and `CHECK` constraints restrict department and gender |
| The report doesn't depend on the server or on the AI | It reads the database directly, so it works with the server off, and code produces the numbers and the layout. It needs only Node builtins, so it runs without `npm install` |

### Data model

There is one table, `employees`. `age` isn't stored: it's computed in SQL on every read.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | integer | Primary key, autoincrement |
| `first_name`, `last_name` | text | Required |
| `birth_date` | text (`YYYY-MM-DD`) | Required |
| `gender` | text | Required, `CHECK`: `male`, `female`, `other` |
| `street` | text | Optional in the table, required by the contract |
| `city` | text | Required |
| `zip` | text | Optional |
| `department` | text | Required, `CHECK`: `HR`, `R&D`, `Maintenance`, `Sales`, `Finance` |
| `created_at` | text (ISO datetime) | Set by the database, kept on PUT, not returned by the API |

A unique index on `first_name` and `last_name` (both case-insensitive) plus `birth_date` defines "the same person".

## How the code is organized

| File | Responsibility |
| --- | --- |
| `src/index.js` | Entry point: opens the database, creates the app with logging on, and starts listening. A busy port exits non-zero |
| `src/app.js` | Express routes, docs, and turning errors into responses |
| `src/contract.js` | Loads `contract.json` once for everything else |
| `src/http-error.js` | Error class carrying an HTTP status and optional details, used only by the HTTP-facing code |
| `src/validation.js` | Compiles request validators from the contract and holds the extra rules (trimmed names, birth date from 1900-01-01 up to today, `search` of at most 100 characters, `minAge` above `maxAge`) |
| `src/employees.js` | All employee SQL (including the report's per-department count), age calculation, conflict detection (throws `DuplicateEmployeeError`, which `app.js` turns into 409) |
| `src/config.js` | The only place that reads environment variables or loads `.env` (from the project root); exports `root` and `config` (`port`, `host`, `corsOrigins`, `dbPath`, `dbPathIsExplicit`) |
| `src/db.js` | `openDb` creates the schema and seeds only when the table did not exist. `openReportDb` is read-only and fails if an explicitly set `DB_PATH` file is missing |
| `src/report.js` | Builds the department table text from the counts, and throws, naming the department, if the data contains one that isn't in the contract |
| `scripts/department-report.js` | Opens the database with `openReportDb`, prints the report and closes |
| `test/` | API behavior, invalid input sweep, report format |
| `scripts/mutation-check.mjs` | Breaks hand-picked rules on a temporary copy to confirm the tests notice |

## Decisions

### Decisions on conflicts between the task documents

| Question | Decision | Why |
| --- | --- | --- |
| The contract mentions a "provided Postgres" database, but none was provided, and the task allows any storage | SQLite | The task recommends it, and it needs no database server |
| In-memory or a file? The task recommends in-memory but also asks for persistent storage | A SQLite file | Data survives restarts. A separate report process can read a file, but it could never see another process's memory, so an in-memory database would make the report fail whenever the server is down |
| The task lists 2 endpoints, the contract says to implement all 4 | All 4 | The interactive docs must match the contract, and they would otherwise advertise endpoints that don't exist |
| The task mentions first name and last name filters, the contract has one `search` field and rejects unknown fields | The contract: `search` matches first or last name | The contract is the precise API definition, and `firstName` as a filter would have to return 400 under it |
| The contract defines 409 for POST only. Should PUT be able to create a duplicate person? | PUT also returns 409, and that one response is added to `contract.json` | Otherwise PUT would be a way around the no-duplicates rule. This is the only change made to the contract |
| The Stage 2 sample shows R&D 14 and Finance 9, but the seed data has R&D 16 and Finance 7 | The report shows real data, and the sample is treated as format only | The report must be reliable. Hardcoding the sample or altering the seed would make it wrong. The totals are both 50 |
| Which AI tool for the report? | Claude Code only | The task allows any AI tool and recommends opencode, and Stage 2 doesn't name one. Claude Code was the quickest route, and the report logic is in a plain script, so other tools can reuse it. An `AGENTS.md` for opencode or an MCP server could be added later on top of the same script |

### Technical decisions

| Decision | Why | Alternative rejected |
| --- | --- | --- |
| Node.js | Easy to install and run: one runtime, then `npm install` and `npm start`, with no build step and no database server. It suits a service of this scope, a small API that mostly runs short database queries. Built-ins cover SQLite, tests and `.env` loading, which keeps dependencies few, and the JSON contract loads directly into the validators | Java with Spring or .NET need more setup and project structure than this scope calls for |
| Express | Quick to set up and minimal: a few lines give routing, JSON parsing and one central error handler, which is all four endpoints need. It's widely known, so the code is easy for others to read, and the middleware used here (Helmet, cors, morgan, swagger-ui-express) plugs straight in. It was also already in the starter | NestJS adds structure that four endpoints don't need. Fastify would also fit, but its extra features add little at this scope |
| Built-in `node:sqlite` | No native build step and no extra dependency | `better-sqlite3` needs a compiled binary for each Node version |
| Plain SQL, no ORM | One table and a few queries | An ORM adds code with no benefit here |
| Validation with Ajv, compiled from `contract.json` | The contract is the source for validation and docs, so they can't drift from it (the database `CHECK` lists are a separate copy, see Known limitations) | Hand-written rules would duplicate the contract |
| Swagger UI served from `contract.json` | The docs are the contract itself | |
| Helmet's content security policy relaxed only on `/docs` | Swagger UI needs its own scripts and styles, and the rest of the API keeps the full policy | Turning the policy off everywhere |
| A unique database index for duplicates | The database enforces the rule, even for simultaneous requests | Checking first in code can miss a race between two requests |
| Age computed in one SQL expression | The contract says age isn't stored, and filter and output can never disagree | Separate calculations in SQL and JavaScript |
| The report reads the database directly through `openReportDb` (read-only) | It works with the server off, never writes to an existing database, and on a fresh clone with the default path it provisions the database first | Calling the API would fail whenever the server is down |
| The department list comes from the contract | Fixed order, and an empty department still shows 0 | Listing only departments found by the query would drop empty ones |
| Node's built-in test runner, tests use a real in-memory database | No extra test libraries, and no mocks | |
| A script behind the skill | Code owns the numbers and the format | Asking the AI to query and format varies between runs |
| `BEGIN IMMEDIATE` around schema creation and seeding | Two processes starting together can't both load the seed | Checking and seeding without the write lock |
| `busy_timeout = 5000` | A process waits up to 5 seconds rather than failing if another one holds the database | |
| Duplicates detected by SQLite error code 2067 (`SQLITE_CONSTRAINT_UNIQUE`) | A wording change in SQLite can't turn a 409 into a 500 | Matching the message text |
| `WHERE` built only from supplied filters, always with bound parameters | Prevents SQL injection | |
| Query skipped when the offset is past the total | Returns an empty page and keeps enormous page numbers away from SQLite's `OFFSET` | |
| Ajv with `allErrors`, `useDefaults` and `strict: false` | Every problem is reported at once, `page` and `pageSize` defaults come from the contract, and the wrapper around the contract's schemas isn't pure JSON Schema | |

### Behavior the contract leaves open

The rule applied: be stricter than the contract only where input breaks one of our rules or produces a wrong result.

| Case | Behavior | Why |
| --- | --- | --- |
| Result order | By `id` | Pages stay stable and never overlap |
| `search` | Case-insensitive partial match, trimmed. `%` and `_` are literal characters | "Match" most usefully means partial, and user input must not act as a wildcard |
| `search` length | Over 100 characters is a 400, with details path `/search`. The rule is in `src/validation.js`, and `contract.json` is unchanged | SQLite's `LIKE` pattern limit is 50,000 bytes, below the 100 KB body limit, so long terms used to return 500. Names are at most 50 characters |
| Names | Surrounding spaces are removed before validating and saving, so a name of only spaces is a 400 | Stricter than the contract, because a stray space would otherwise get around the no-duplicates rule |
| Same person | Same first name, last name and birth date, ignoring upper and lower case and surrounding spaces | `dana`, `Dana` and ` Dana` are the same person |
| Birth date | Must be a real calendar date, from `1900-01-01` up to today | A future date would give a negative age, and a date like `0000-01-01` an impossible one |
| `minAge` greater than `maxAge` | 400 | It's a mistake in the request, and an empty result would hide it |
| Page past the end | 200 with empty `items` and the real `total` | The request is valid, there's just nothing on that page |
| Non-numeric id | 404 on GET, 400 on PUT | The contract defines only 404 for GET, and PUT has 400 for invalid input |
| Very large id | 404 | No such employee can exist |
| Malformed JSON | 400 | |
| Body over 100 KB | 413 | Express's default limit, far beyond any valid request |
| Birthday on 29 February | Age changes on 1 March in common years | The person hasn't reached the anniversary until 28 February has passed |
| Age "today" | Uses the UTC date | One definition regardless of server timezone |
| `created_at` | Set by the database, kept on PUT, not returned | It's required in the table but isn't in the contract's response |
| Starter `/api/hello` route | Removed | It isn't part of the contract |
| Accented letters such as `É` and `é` | Treated as different letters in search and the duplicate check. A test records this | The data is English and Hebrew, and a proper fix needs a normalized column or custom collation |
| Unknown field inside `address` | Accepted and not stored. A test records this | The contract forbids extra fields at the top level but not in `Address`, so a 400 would reject a valid request |
| Empty `street` or `city` | Accepted. A test records this | The contract sets a minimum length on names but not here, and a blank value breaks no rule or calculation |
| Id with leading zeros, such as `/employees/01` | Refers to employee 1. A test records this | `01` is a valid integer and the response still returns `id: 1` |

## Testing

`npm test` runs the suite. It covers every endpoint and error code, including the generic 500, every field with every wrong JSON type, what each search filter returns, full replacement on PUT, limits at and beyond their boundaries, malformed paths and bodies, birthday and UTC date boundaries, security and CORS headers, restart persistence, processes starting together, and the exact report text.

| File | Tests | Covers |
| --- | --- | --- |
| `test/api.test.js` | 12 | The main behavior of every endpoint and the docs |
| `test/hardening.test.js` | 31 | Wrong types for every field, limits, malformed input, age boundaries, restart, database `CHECK` lists matching the contract |
| `test/report.test.js` | 15 | Exact text, live changes, empty departments, fresh database, `.env` handling, missing explicit `DB_PATH`, no `node_modules` needed, busy port |
| `test/behavior.test.js` | 43 | What valid requests actually do: filters, pagination, full PUT replacement, duplicates, date limits, error responses, security headers, processes starting together, and the behaviors kept on purpose |
| `test/review-fixes.test.js` | 6 | `search` length limits, and report failure on a department outside the contract |
| `test/helpers.js` | not a test | Starts the real app on a random port with a fresh in-memory database |

To check the tests themselves, run `node scripts/mutation-check.mjs`. It breaks 35 rules one at a time on a temporary copy of the project and reports whether the tests noticed, so the project itself is never changed. All 35 are handled: 34 are caught, and the other one, removing the blank-search guard, can't change behavior, because the resulting `%%` pattern still matches everyone.

The rules were picked by hand and aimed at places where the tests looked weak, so this shows that those rules are protected. It isn't a coverage score, and an automated tool such as Stryker would be needed for one. The first run, on 31 rules, found 19 that the tests missed. `test/behavior.test.js` was added to close those gaps, and it was written knowing which breaks it had to catch, so the later result confirms the gaps were closed rather than measuring coverage.

The report was also tested end to end: new Claude Code sessions asked the question in English and in Hebrew and returned the exact table with live data, with no permission prompts.

Also checked by hand during the build: a clean-start HTTP run returned 200, 201, 409, 404 and 400 as expected; the report's Finance count went from 7 to 8 after adding an employee with the server running; and Swagger UI in a real browser listed all 4 operations with no console errors. The code has had AI review only, with no independent human code review.

## Known limitations

- Each clone has its own database, so teammates see their own local data. For one shared set of numbers, the service and its database need to be deployed in one place.
- The department and gender lists are written twice: in `contract.json` (used for validation, docs and the report) and in the `CHECK` constraints in `src/db.js`. Changing one means changing the other, but a test now fails if they differ.
- There's no authentication, as none is defined in the contract. It's still required before any shared deployment.
- Case-insensitive matching applies to English letters only. Hebrew has no case, so it's unaffected.
- `openDb` doesn't close its connection when startup fails. The process exits in that case, so on Windows the file only stays locked until then.
- In the contract, `Employee` combines `EmployeeInput`, which forbids extra fields, with `id` and `age`. A strict validator would reject every response. Validation here applies to requests, where the rule is unambiguous.
- Tested only on Node 26.13 on Windows.
- The report has been tested only in Claude Code. Other AI tools may need their own instructions, though the script runs anywhere.
- The contract has no DELETE, so employees can't be removed through the API.
- The age filter wraps the whole table in a subquery, so it can't use an index. This is fine at the current size.
- Because "today" is the UTC date, a birthday can show the old age for part of the local day.
- WAL mode isn't enabled, so a process can stall for up to 5 seconds on a database lock.
- Port 3000 is hard-coded in the contract's `servers`, so the docs' default server is wrong if `PORT` is changed.
- A non-numeric `PORT` isn't rejected.
- There's no graceful shutdown.
- NUL characters are accepted in names, and a broken Unicode character from a malformed client is stored as `�`.
- An unexpected error that carries a `details` property would pass it through on the 500 response.
- The test for processes starting together depends on them overlapping. It detected a removed lock in 8 of 8 runs on the development machine, but a much slower machine could miss it. The simultaneous-creates test isn't a true race.

## Next steps

- Move to a shared database and deployment so everyone sees the same numbers.
- Add authentication, and a soft delete if employees can leave.
- Automated contract tests against the served responses.
- Support for other AI tools through `AGENTS.md` or an MCP server.
