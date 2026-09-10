// prisma/seed-entry.ts
// Entry point for `prisma db seed`. Routes to the correct seed based on the
// environment so production always uses seed-prod.ts (idempotent owner seed)
// and development uses seed.ts (demo data). This makes `npx prisma db seed`
// safe in any environment without changing the command.
import { execSync } from 'child_process';

const seedFile =
  process.env.NODE_ENV === 'production'
    ? 'prisma/seed-prod.ts'
    : 'prisma/seed.ts';

console.log(
  `Seeding with ${seedFile} (NODE_ENV=${process.env.NODE_ENV ?? 'development'})`,
);

execSync(`npx ts-node ${seedFile}`, { stdio: 'inherit' });
