import { createApp } from './app.js';
import { openDb } from './db.js';
import { config } from './config.js';

const { port, host, corsOrigins } = config;

createApp(openDb(), { log: true, corsOrigins }).listen(port, host, (err) => {
  if (err) throw err;
  console.log(`Listening on http://${host}:${port} (docs at /docs)`);
});
