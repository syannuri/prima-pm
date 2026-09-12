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

// Force a dormant-AI baseline regardless of how the suite is launched. The app bootstrap runs
// `import 'dotenv/config'`, so on a box where server/.env has a live ANTHROPIC/OPENAI/ELEVENLABS
// key that key would leak into every test (tests assume AI is OFF unless they arm it themselves).
// setupFiles run before the test module imports the app; SET the vars to '' (do NOT delete) so
// dotenv — which never overrides an already-set var — leaves them empty → aiEnabled() === false.
// Belt-and-suspenders with the `test:integration` npm script scrub.
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY']) {
  if (process.env[k]) process.env[k] = '';
}
