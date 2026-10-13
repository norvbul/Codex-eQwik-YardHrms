import '../../../packages/configuration/env.js';
import { Worker } from 'bullmq';
import { applyDueConfigurations } from '../../api/src/configuration-review.js';
import nodemailer from 'nodemailer';
import { redisConnection, db, jobs } from '../../api/src/core.js';
const configurationTimer = setInterval(
  () =>
    applyDueConfigurations().catch((error) =>
      console.error(
        JSON.stringify({ event: 'configuration.apply_failed', message: error.message }),
      ),
    ),
  60000,
);
await applyDueConfigurations();
const mail = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  disableFileAccess: true,
  disableUrlAccess: true,
  requireTLS: process.env.NODE_ENV === 'production',
  ...(process.env.SMTP_USER
    ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
    : {}),
});
const worker = new Worker(
  (process.env.QUEUE_NAMESPACE || 'yard') + '-jobs',
  async (job) => {
    if (job.name === 'email') await mail.sendMail({ from: process.env.SMTP_FROM, ...job.data });
    else if (job.name === 'file-scan') {
      const { processFileScan } = await import('../../api/src/files.js');
      await processFileScan(job.data.fileId);
    } else if (job.name === 'report') {
      const { processReport } = await import('../../api/src/reports.js');
      await processReport(job.data.jobId);
    } else if (job.name === 'import') {
      const { processImport } = await import('../../api/src/imports.js');
      await processImport(job.data.batchId);
    } else if (job.name === 'payroll-prepare') {
      const { preparePayroll } = await import('../../api/src/payroll.js');
      await preparePayroll(job.data.runId, job.data.tenantId, job.data.actorId, job.data.version);
    } else if (job.name === 'payslip') {
      const { generatePayslip } = await import('../../api/src/payslips.js');
      await generatePayslip(job.data.snapshotId, job.data.tenantId, job.data.actorId, job.data.key);
    } else throw new Error('Unsupported job type');
  },
  { connection: redisConnection, concurrency: 3 },
);
worker.on('failed', (job, error) =>
  console.error(JSON.stringify({ event: 'job.failed', id: job?.id, message: error.message })),
);
worker.on('ready', () => console.log('YardHRMS worker ready'));
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    clearInterval(configurationTimer);
    await worker.close();
    await jobs.close();
    await db.$disconnect();
    process.exit(0);
  });
