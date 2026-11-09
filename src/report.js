import { contract } from './contract.js';
import { countByDepartment } from './employees.js';

const HEADER = ['מחלקה        | עובדים', '-------------|--------'];
const NAME_WIDTH = 13;

// Departments come from the contract, so order is fixed and an empty department still appears.
// A department outside the contract is an error, because leaving it out would misreport the totals.
export function formatDepartmentReport(counts) {
  const departments = contract.components.schemas.Department.enum;
  const unknown = [...counts.keys()].filter((department) => !departments.includes(department));
  if (unknown.length > 0) {
    throw new Error(`Unknown department(s) not in the contract: ${unknown.join(', ')}`);
  }
  const lines = departments
    .map((department) => `${department.padEnd(NAME_WIDTH)}| ${counts.get(department) ?? 0}`);
  return [...HEADER, ...lines].join('\n');
}

export function departmentReport(db) {
  return formatDepartmentReport(countByDepartment(db));
}
