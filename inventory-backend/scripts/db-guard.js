#!/usr/bin/env node
// scripts/db-guard.js
// Blocks destructive database scripts from running against a production
// database unless the operator explicitly opts in.
//
// "Destructive" means dropping/recreating the schema — e.g.
// `prisma db push --force-reset` (permanent data loss).
// Set ALLOW_DESTRUCTIVE_DB_SCRIPTS=true only for a deliberate, reviewed reset.

const env = (process.env.NODE_ENV ?? 'development').trim();
const allowed = process.env.ALLOW_DESTRUCTIVE_DB_SCRIPTS === 'true';

if (env === 'production' && !allowed) {
  console.error(
    [
      '',
      'Refusing to run a destructive database script in production.',
      'This command can DROP and recreate the database (permanent data loss).',
      '',
      'If you are absolutely sure this is a deliberate reset, re-run with:',
      '  ALLOW_DESTRUCTIVE_DB_SCRIPTS=true npm run <script>',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
