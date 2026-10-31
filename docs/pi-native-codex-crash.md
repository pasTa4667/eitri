# Offline Codex file-profile crash recovery and expiry

The operator approves only this follow-on to the [synthetic file-profile refresh slice](pi-native-codex-profile.md): parent-SIGKILL/orphan recovery and terminal-case expiry with the built-in Codex provider. Generated private profiles, fixed synthetic OAuth, intercepted HTTP/SSE and real temporary controller/native SQLite are used. No real credentials, network, inference or production route is enabled.

```sh
node --test test/pi-native-codex-crash.test.mjs test/pi-native-codex-profile.test.mjs
```

## Parent-crash contract

Four checks stop the actual helper and SIGKILL its controller parent, with and without a persisted Pause, at each existing trusted checkpoint:

- `refresh-response`: the synthetic response has not reached Pi; original auth bytes remain.
- `provider-request`: Pi has saved the replacement and is about to receive synthetic inference SSE.

Neither boundary is inside Pi's local credential write/lock release. The helper remains alive across restart. Resource ownership identifies the controller, helper, case, action and epoch; it is not inferred from a process scan. A short recovery attempt must refuse before opening native work and leave the catalogue file, resource record, auth bytes and profile lease unchanged. A subsequent open waits while the orphan is stopped. Only the test resumes its own helper; recovery never signals a recorded PID. IPC disconnect makes the orphan exit, then recovery removes its empty owned home before any native model boundary.

The interrupted action consumes exactly 120,000 ms of its original 600,000 ms allowance. Persisted Pause recovers as Paused with zero requests until explicit Continue. Unpaused recovery, or that Continue, admits one new model action but refuses the dead owner's profile lease as `sign-in-required` before spawning any new helper. There are no tool effects/results, token retries, lease resets or API-key fallback. Attempt/repair counts remain 1/0; two further reopen cycles preserve the transcript, 480,000 ms remainder and exact auth/lease bytes without redispatch.

## Expiry contract

Three checks run two sequential native cases through real built-in synthetic rotation and four streams, then dismiss only the first. The second case remains unfinished/Needs attention; explicit detail deletion is refused. Maintenance and startup expiry retain the terminal database one millisecond before 30 days and remove it at the threshold. Explicit confirmed cleanup removes it without waiting.

After cleanup and reopen, the terminal case has no native directory/messages and cannot recreate details through duplicate intake or a note. The unfinished case keeps its database inode, transcript and counters. Dedicated rotated auth bytes/private mode, the generated normal-profile sentinel's bytes/inode, and the absence of helper/resource/lease leftovers are checked. The fixed fixture clock measures policy, not real inference cost.

## Verification and limits

The [five-axis author review](evidence/pi-runtime/native-codex-crash-review.md) records focused/full verification, the initial missing-checkpoint RED, failure-path test cleanup and two restored mutation checks. All 18 combined focused checks pass. Full `npm run verify:all` exits **0** with **2,250 Node and 30 Rust tests passing**, no failures/cancellations/skips or ignored Rust tests. Lint, formatting, type/syntax checks and native compilation pass; existing Rust dependency future-incompatibility notices remain. Raw evidence is under `.audit/pi-native-codex-crash/`.

This accepts only combined synthetic crash/expiry evidence. It does not prove lossless rotation, shared-client safety, power-loss durability, inside-write fault handling, native-owner lease recovery or restricted-worker/source-edit tool confinement. Production source, schemas, dependencies, worker/operator and the demonstration checkout remain unchanged. Real native inference, broader tool integration, production selection, publication and M4 acceptance remain separately scoped gates. Stop after this slice.
