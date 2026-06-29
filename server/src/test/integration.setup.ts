// Safety guard for DB-backed integration tests: refuse to run unless DATABASE_URL
// clearly points at a TEST database. This makes it impossible to accidentally run
// the destructive integration suite against the production database.
const url = process.env.DATABASE_URL ?? '';
if (!/test/i.test(url)) {
  throw new Error(
    `Refusing to run integration tests: DATABASE_URL must point at a *test* database (got: ${url || '<unset>'}). ` +
      `Use the test:integration npm script.`,
  );
}
