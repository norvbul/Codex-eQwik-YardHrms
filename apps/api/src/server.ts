import { app } from './app.js';
import { db, jobs } from './core.js';
const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () =>
  console.log('YardHRMS API listening on port ' + (process.env.PORT || 3000)),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(async () => {
      await jobs.close();
      await db.$disconnect();
      process.exit(0);
    }),
  );
