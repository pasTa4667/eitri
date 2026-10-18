---
status: accepted
---

# Separate admission from per-session durable payloads

Use one controller-owned SQLite catalogue for atomic issue admission, ownership, compact history, and PR tracking, plus one Pi Durable SQLite file per remediation session for its conversation, tasks, and application state. This supersedes [ADR 0003](0003-single-controller-durable-store.md): real 30-day transcript expiry was added later, and the inspected pinned interface has no standard transcript purge operation. Independent case files avoid building a Pi-internals garbage collector and let expired detailed data be removed without deleting another case's state or the duplicate-work guards.

Admission atomically records the issue claim, case record, and provisioning intent in the catalogue; case-file initialization is idempotent, and no agent starts before it is ready. This is recoverable provisioning, not a cross-database atomic transaction. Expiry closes the terminal case's harness/readers before deleting its database, associated SQLite sidecars, and raw artifacts; live work, global credentials, and source-repository history are not swept. All stores still have one controller owner, with prototype execution concurrency one and independent-session concurrency possible later.
