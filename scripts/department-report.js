import { openReportDb } from '../src/db.js';
import { departmentReport } from '../src/report.js';

const db = openReportDb();
console.log(departmentReport(db));
db.close();
