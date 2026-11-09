# Employees API

## Tech choice

| Concern | Choice |
| --- | --- |
| Runtime and framework | Node.js with Express (ES modules) |
| Database | SQLite in memory, using the built-in `node:sqlite` module |
| Request validation | Ajv, using the schemas in `contract.json` |
| API docs | Swagger UI, serving `contract.json` |
| Tests | Node's built-in test runner |

## Why

- **One source of truth.** Validation and the docs both read `contract.json`, so neither can drift from the contract.
- **No database setup.** The brief recommends SQLite in memory. `node:sqlite` needs no server and no driver, and the data is seeded on every start.
- **Plain SQL, no ORM.** The service has one table and a few queries, so an ORM would add code without adding value.
- **Few dependencies.** Only Ajv and Swagger UI are added to the Express starter, and tests need no extra library.
- **Matches the contract's server.** Express runs on port 3000, the address given in the contract.
