import { readFileSync } from 'node:fs';

// The source for validation, docs and the department list. The CHECK constraints in db.js repeat the department and gender values.
export const contract = JSON.parse(readFileSync(new URL('../docs/contract.json', import.meta.url), 'utf8'));
