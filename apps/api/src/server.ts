import './config/load-env.js';
import { app } from './app.js';
import { prisma } from './db/prisma.js';

const port = Number(process.env.API_PORT ?? 3001);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`CyberNexus API listening on http://127.0.0.1:${port}`),
);

const shutdown = (): void => {
  server.close((error) => {
    void prisma.$disconnect().finally(() => {
      if (error) {
        console.error('CyberNexus API shutdown failed.');
        process.exitCode = 1;
      }
    });
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
