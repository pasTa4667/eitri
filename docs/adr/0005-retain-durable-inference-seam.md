---
status: proposed
---

# Retain native durability while testing a Pi-owned inference seam

Keep the controller catalogue and Pi Durable case SQLite as the sole workflow and transcript authorities; prefer a stream-only Pi `ModelRuntime` adapter experiment over replacing them with the coding-agent runtime. RPC `prompt` is an agent loop, not a provider stream: nesting it under Pi Durable would introduce competing context/loop ownership, while adopting coding-agent sessions would require new recovery, document and expiry guarantees.

The [compatibility design](../pi-runtime-compatibility.md) completes the requested design/review checkpoint, but **operator approval of the proposed offline experiment is pending**. Production remains scripted on Pi AI/Pi Durable 1.3.0; no runtime migration, package upgrade, access to real Pi credentials or further inference is approved here. The installed 1.4.0 SDK's stream-only feasibility, cross-version conversion and auth ownership must be demonstrated before selecting it for production. [ADR 0004](0004-catalogue-and-session-stores.md) is unchanged, not superseded.
