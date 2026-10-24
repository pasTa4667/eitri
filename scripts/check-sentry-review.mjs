import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSentryToken, sentryTarget } from '../src/sentry.ts';

// Fixed acceptance instrument, not controller intake or a general issue-update API.
const issueId = '155897738'; // Previously verified synthetic profile-name group.
const assigneeId = '5090062'; // Operator-selected user, not the token's authenticated identity.
const issueUrl = `https://sentry.io/api/0/organizations/${sentryTarget.organization}/issues/${issueId}/`;
const stateUrl = `${issueUrl}?expand=inbox`;
const identity = (value) => typeof value === 'string' && /^[1-9][0-9]{0,19}(?![\s\S])/.test(value);

function projectState(value) {
  assert.equal(value.id, issueId);
  assert.equal(value.project?.id, sentryTarget.projectId);
  assert.equal(value.status, 'unresolved');
  assert.equal(value.priority, 'high');
  assert.ok(['new', 'ongoing'].includes(value.substatus));
  assert.equal(typeof value.hasSeen, 'boolean');
  assert.ok(
    value.inbox === null ||
      (value.inbox && typeof value.inbox === 'object' && !Array.isArray(value.inbox)),
  );
  assert.ok(
    value.assignedTo === null ||
      (['user', 'team'].includes(value.assignedTo?.type) && identity(value.assignedTo.id)),
  );
  return {
    status: value.status,
    priority: value.priority,
    substatus: value.substatus,
    hasSeen: value.hasSeen,
    inInbox: value.inbox !== null,
    assignedTo:
      value.assignedTo === null ? null : { type: value.assignedTo.type, id: value.assignedTo.id },
  };
}

export async function verifySentryReviewAssignment(
  token,
  { activate = false, resumeAssignment = false } = {},
) {
  const result = {
    organization: sentryTarget.organization,
    projectId: sentryTarget.projectId,
    issueId,
    assigneeId,
    activated: activate,
    scope: resumeAssignment ? 'assignment-after-review' : 'review-and-assignment',
    attemptedWrites: [],
    responses: [],
    verdict: 'failed',
  };
  const controller = new AbortController();
  const stopped = Promise.withResolvers();
  void stopped.promise.catch(() => {});
  const deadline = Date.now() + 60_000;
  const timer = setTimeout(() => {
    controller.abort();
    stopped.reject(new Error());
  }, 60_000);
  const checkLifetime = () => {
    assert.ok(!controller.signal.aborted && Date.now() < deadline);
  };
  let stage = 'selection';

  async function requestJson(url, body) {
    checkLifetime();
    if (body) result.attemptedWrites.push(body);
    const pending = fetch(new URL(url), {
      method: body ? 'PUT' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    }).then((response) => {
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new Error();
      }
      return response;
    });
    const response = await Promise.race([pending, stopped.promise]);
    let reader;
    let consumed = false;
    try {
      checkLifetime();
      result.responses.push({ stage, status: response.status });
      assert.ok(
        !response.redirected &&
          response.url === url &&
          [200, 400].includes(response.status) &&
          response.body,
      );
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const chunk = await Promise.race([reader.read(), stopped.promise]);
        checkLifetime();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        assert.ok(size <= 1_048_576);
        chunks.push(chunk.value);
      }
      consumed = true;
      const value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
      if (response.status === 400) {
        // Exact known source messages map to fixed codes; arbitrary error text never survives.
        const reasons = new Map([
          ['Cannot assign to non-team member', 'non-team-member'],
          ['User is not a member of this organization', 'non-organization-member'],
          ['Cannot assign to a deactivated member', 'deactivated-member'],
          ['User does not exist', 'missing-user'],
        ]);
        const messages = value?.assignedTo;
        result.responses.at(-1).rejection =
          Array.isArray(messages) && messages.length === 1
            ? (reasons.get(messages[0]) ?? 'unclassified')
            : 'unclassified';
        throw new Error();
      }
      return value;
    } finally {
      if (reader) {
        if (!consumed) void reader.cancel().catch(() => {});
        reader.releaseLock();
      } else void response.body?.cancel().catch(() => {});
    }
  }

  try {
    assert.ok(
      typeof token === 'string' &&
        token.length > 0 &&
        token.length <= 8192 &&
        !/\s|[^\x21-\x7e]/.test(token),
    );
    assert.equal(typeof activate, 'boolean');
    assert.equal(typeof resumeAssignment, 'boolean');
    assert.ok(!resumeAssignment || activate);
    stage = 'authenticated-user';
    const auth = await requestJson('https://sentry.io/api/0/');
    assert.ok(identity(auth.user?.id));
    result.authenticatedUserId = auth.user.id;
    stage = 'before';
    result.before = projectState(await requestJson(stateUrl));
    if (!activate) {
      result.verdict = 'inspected';
      return result;
    }
    assert.ok(Array.isArray(auth.auth?.scopes));
    assert.ok(auth.auth.scopes.includes('event:write') || auth.auth.scopes.includes('event:admin'));
    // Recovery requires a separate explicit mode after a fresh read-only reconciliation.
    assert.equal(result.before.inInbox, !resumeAssignment);
    assert.equal(result.before.assignedTo, null);
    if (!resumeAssignment) {
      stage = 'review-write';
      // Sentry removes from inbox with false; hasSeen is a separate operation.
      await requestJson(issueUrl, { inbox: false });
      stage = 'review-readback';
      result.afterReview = projectState(await requestJson(stateUrl));
      assert.equal(result.afterReview.inInbox, false);
      assert.equal(result.afterReview.hasSeen, result.before.hasSeen);
      assert.equal(result.afterReview.assignedTo, null);
    }
    stage = 'assignment-write';
    await requestJson(issueUrl, { assignedTo: `user:${assigneeId}` });
    stage = 'assignment-readback';
    result.afterAssignment = projectState(await requestJson(stateUrl));
    assert.equal(result.afterAssignment.inInbox, false);
    assert.equal(result.afterAssignment.hasSeen, result.before.hasSeen);
    assert.equal(result.afterAssignment.substatus, (result.afterReview ?? result.before).substatus);
    assert.deepEqual(result.afterAssignment.assignedTo, { type: 'user', id: assigneeId });
    checkLifetime();
    result.verdict = 'passed';
  } catch {
    result.failedStage = stage;
    result.failure =
      controller.signal.aborted || Date.now() >= deadline ? 'deadline' : 'request-or-verification';
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length === 1 && !['--activate', '--assign-reviewed'].includes(args[0]))
  ) {
    console.error('Usage: node scripts/check-sentry-review.mjs [--activate | --assign-reviewed]');
    process.exitCode = 1;
    return;
  }
  try {
    const token = await loadSentryToken('aurumcars.1password.eu');
    const result = await verifySentryReviewAssignment(token, {
      activate: args.length === 1,
      resumeAssignment: args[0] === '--assign-reviewed',
    });
    console.log(JSON.stringify(result));
    if (result.verdict === 'failed') process.exitCode = 1;
  } catch {
    console.error('Sentry review verification failed before observation.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
