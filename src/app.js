import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { HttpError } from './http-error.js';
import { contract } from './contract.js';
import { assertValidSearch, assertValidEmployee, badRequest } from './validation.js';
import * as employees from './employees.js';

const isIntegerText = (text) => /^-?\d+$/.test(text);
const notFound = () => new HttpError(404, 'Employee not found');

export function createApp(db, { log = false, corsOrigins = [] } = {}) {
  const app = express();

  // Swagger UI needs its own scripts and styles, so only /docs relaxes the content security policy.
  app.use('/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(contract));
  app.use(helmet());
  // Only listed origins get CORS headers, so an empty list grants no cross-origin access.
  app.use(cors({ origin: corsOrigins }));
  if (log) app.use(morgan('dev'));
  app.use(express.json());

  app.get('/openapi.json', (req, res) => res.json(contract));

  app.post('/employees/search', (req, res) => {
    assertValidSearch(req.body);
    res.json(employees.search(db, req.body));
  });

  app.post('/employees', (req, res) => {
    assertValidEmployee(req.body);
    res.status(201).json(employees.create(db, req.body));
  });

  app.get('/employees/:id', (req, res) => {
    // The contract defines only 404 here, so a non-numeric id is simply not found.
    const employee = isIntegerText(req.params.id) ? employees.get(db, Number(req.params.id)) : undefined;
    if (!employee) throw notFound();
    res.json(employee);
  });

  app.put('/employees/:id', (req, res) => {
    if (!isIntegerText(req.params.id)) {
      throw badRequest('/id', 'must be integer');
    }
    assertValidEmployee(req.body);
    const employee = employees.replace(db, Number(req.params.id), req.body);
    if (!employee) throw notFound();
    res.json(employee);
  });

  app.use((req, res) => res.status(404).json({ message: 'Not found' }));

  // Express needs all four arguments to treat this as the error handler.
  app.use((err, req, res, next) => {
    if (err instanceof employees.DuplicateEmployeeError) err = new HttpError(409, err.message);
    const isClientError = err.status >= 400 && err.status < 500;
    if (!isClientError) console.error(err);
    res.status(isClientError ? err.status : 500).json({
      message: isClientError ? err.message : 'Internal server error',
      ...(err.details && { details: err.details }),
    });
  });

  return app;
}
