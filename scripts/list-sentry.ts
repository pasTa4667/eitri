import { parseArgs } from 'node:util';
import { loadSentryToken, listSentryIssues } from '../src/sentry.ts';

type Selection = Readonly<{ account: string }>;

function parseSelection(argv: readonly string[]): Selection | undefined {
  try {
    const { values, tokens } = parseArgs({
      args: [...argv],
      options: { account: { type: 'string' } },
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    if (
      tokens.length !== 1 ||
      tokens[0].kind !== 'option' ||
      !values.account ||
      !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}(?![\s\S])/.test(values.account)
    )
      return undefined;
    return { account: values.account };
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const selection = parseSelection(process.argv.slice(2));
  if (!selection) {
    console.error('Usage: npm run list:sentry -- --account <explicit-account>');
    process.exitCode = 1;
    return;
  }
  try {
    const token = await loadSentryToken(selection.account);
    const page = await listSentryIssues(token);
    console.log(JSON.stringify(page));
  } catch {
    console.error('Sentry discovery failed.');
    process.exitCode = 1;
  }
}

await main();
