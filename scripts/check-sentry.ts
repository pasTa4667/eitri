import { parseArgs } from 'node:util';
import { checkSentry, loadSentryToken } from '../src/sentry.ts';

let account: string | undefined;
try {
  const { values } = parseArgs({ options: { account: { type: 'string' } } });
  account = values.account;
} catch {
  console.error('Usage: npm run check:sentry -- --account <1Password-account-UUID-or-hostname>');
  process.exit(1);
}
if (!account) {
  console.error(
    'An explicit --account is required. Use op account list to find its hostname or UUID.',
  );
  process.exit(1);
}
try {
  const token = await loadSentryToken(account);
  console.log(JSON.stringify(await checkSentry(token)));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Sentry connection check failed.');
  process.exitCode = 1;
}
