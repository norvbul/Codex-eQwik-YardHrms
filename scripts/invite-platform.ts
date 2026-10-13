import '../packages/configuration/env.js';
import argon2 from 'argon2';
import { z } from 'zod';
import { db, random, hash, sendMail, audit, publicContext, jobs } from '../apps/api/src/core.js';
const email = z.email().parse(process.argv[2]).toLowerCase(),
  name = z.string().min(2).parse(process.argv[3]);
const role = z
  .enum(['PLATFORM_SUPER_ADMIN', 'PLATFORM_LICENSING_OFFICER'])
  .parse(process.argv[4] || 'PLATFORM_SUPER_ADMIN');
const token = random(),
  passwordHash = await argon2.hash(random(), { type: argon2.argon2id });
await db.$transaction(async (tx) => {
  const user = await tx.user.upsert({
    where: { email },
    update: { platformRole: role },
    create: { email, name, passwordHash, platformRole: role },
  });
  await tx.authToken.create({
    data: {
      userId: user.id,
      hash: hash(token),
      kind: 'PLATFORM_INVITE',
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await audit(tx, publicContext(user.id), 'platform.bootstrap_invite', user.id, { email, role });
});
await sendMail(
  email,
  'Qwik Licence Manager invitation',
  `Set your password: ${process.env.QWIK_URL}/reset-password?token=${token}\n\nMFA enrollment is mandatory after sign-in. This link expires in 24 hours.`,
);
console.log(
  'Invitation queued. Read it in the configured mailbox. No password or token is logged.',
);
await jobs.close();
await db.$disconnect();
