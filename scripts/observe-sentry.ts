import { parseArgs } from 'node:util';
import { loadSentryToken, observeSentryIssue } from '../src/sentry.ts';

type Selection = Readonly<{ account: string; issueId: string }>;

function parseSelection(argv: readonly string[]): Selection | undefined {
  try {
    const { values, tokens } = parseArgs({
      args: [...argv],
      options: { account: { type: 'string' }, issue: { type: 'string' } },
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    if (
      tokens.length !== 2 ||
      tokens.some((token) => token.kind !== 'option') ||
      tokens.filter((token) => token.kind === 'option' && token.name === 'account').length !== 1 ||
      tokens.filter((token) => token.kind === 'option' && token.name === 'issue').length !== 1 ||
      !values.account ||
      !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}(?![\s\S])/.test(values.account) ||
      !values.issue ||
      !/^[1-9][0-9]{0,19}(?![\s\S])/.test(values.issue)
    )
      return undefined;
    return { account: values.account, issueId: values.issue };
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const selection = parseSelection(process.argv.slice(2));
  if (!selection) {
    console.error(
      'Usage: npm run observe:sentry -- --account <explicit-account> --issue <positive-decimal-id>',
    );
    process.exitCode = 1;
    return;
  }
  try {
    const token = await loadSentryToken(selection.account);
    const observation = await observeSentryIssue(token, selection.issueId);
    console.log(JSON.stringify(observation));
  } catch {
    console.error('Sentry observation failed.');
    process.exitCode = 1;
  }
}

await main();
