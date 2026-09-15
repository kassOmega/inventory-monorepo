// prisma/seed-entry.ts
// Entry point for compiled seed scripts. Routes to the correct seed based on
// the environment so production uses the idempotent owner seed and development
// uses demo data. This intentionally does not require ts-node, so it can run in
// the production container after the scripts are compiled to dist/prisma/*.js.

const seedFile =
  process.env.NODE_ENV === 'production' ? './seed-prod.js' : './seed.js';

async function main() {
  console.log(
    `Seeding with ${seedFile} (NODE_ENV=${process.env.NODE_ENV ?? 'development'})`,
  );

  await import(seedFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
