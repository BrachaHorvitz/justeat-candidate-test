import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { HttpError } from './http-error.js';
import { contract } from './contract.js';

// useDefaults fills in page and pageSize from the contract.
const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });
addFormats(ajv);
ajv.addSchema({ $id: 'contract', components: contract.components });

const validators = new Map();

// Earlier dates can only be typing mistakes, and they would produce impossible ages.
const EARLIEST_BIRTH_DATE = '1900-01-01';

// Longer terms can exceed SQLite's LIKE pattern limit, which is below the request body limit,
// and fail as a 500. Names are at most 50 characters, so no valid search is lost.
const MAX_SEARCH_LENGTH = 100;

function validatorFor(schemaName) {
  if (!validators.has(schemaName)) {
    validators.set(schemaName, ajv.compile({ $ref: `contract#/components/schemas/${schemaName}` }));
  }
  return validators.get(schemaName);
}

export function badRequest(path, message) {
  return new HttpError(400, 'Validation failed', [{ path, message }]);
}

function assertValid(schemaName, body) {
  const validate = validatorFor(schemaName);
  if (!validate(body)) {
    throw new HttpError(400, 'Validation failed', validate.errors.map((e) => ({
      path: e.instancePath || '/',
      message: e.message,
    })));
  }
}

// Rules the contract's schema can't express live here, next to the schema checks.
export function assertValidSearch(body) {
  assertValid('EmployeeSearch', body);
  const { minAge, maxAge, search } = body;
  if (search !== undefined && search.length > MAX_SEARCH_LENGTH) {
    throw badRequest('/search', `must not be longer than ${MAX_SEARCH_LENGTH} characters`);
  }
  if (minAge !== undefined && maxAge !== undefined && minAge > maxAge) {
    throw badRequest('/minAge', 'must not be greater than maxAge');
  }
}

// Surrounding spaces are never part of a name, so " Dana" and "Dana" are the same person
// and a name of only spaces fails the contract's minimum length.
function trimNames(body) {
  for (const field of ['firstName', 'lastName']) {
    if (typeof body?.[field] === 'string') body[field] = body[field].trim();
  }
}

export function assertValidEmployee(body) {
  trimNames(body);
  assertValid('EmployeeInput', body);
  if (body.birthDate < EARLIEST_BIRTH_DATE) {
    throw badRequest('/birthDate', `must not be before ${EARLIEST_BIRTH_DATE}`);
  }
  if (body.birthDate > new Date().toISOString().slice(0, 10)) {
    throw badRequest('/birthDate', 'must not be in the future');
  }
}
