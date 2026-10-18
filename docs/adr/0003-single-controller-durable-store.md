---
status: superseded by ADR-0004
---

# Keep issue admission and remediation state in one durable store

Use one controller-owned Pi Durable harness over one SQLite file, with a conversation and typed application state per remediation session plus a shared issue registry. This keeps issue ownership and initial session creation in one atomic commit instead of coordinating per-session databases with a separate catalogue or second ORM. Future concurrency is between independently scoped remediation sessions managed by that controller, not multiple controller processes opening the same store; external GitHub actions still require reconciliation rather than an exactly-once assumption.

**Superseded by [ADR 0004](0004-catalogue-and-session-stores.md):** actual 30-day transcript expiry was added later. The pinned public interface has no conversation/transcript purge operation, and the user selected a catalogue plus per-session native databases rather than maintenance coupled to Pi's internal schema. See the [retention-driven re-evaluation](../implementation-plan.md#persistence-re-evaluation-after-selecting-real-expiry).
