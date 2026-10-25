---
status: accepted
---

# Retain native durability while testing a Pi-owned inference seam

Keep the controller catalogue and Pi Durable case SQLite as the sole workflow and transcript authorities; prefer a stream-only Pi `ModelRuntime` adapter experiment over replacing them with the coding-agent runtime. RPC `prompt` is an agent loop, not a provider stream: nesting it under Pi Durable would introduce competing context/loop ownership, while adopting coding-agent sessions would require new recovery, document and expiry guarantees.

The operator's subsequent “yes continue implementing the next step” accepts the [bounded offline experiment](../pi-runtime-compatibility.md), **not a production adapter or runtime migration**. Its first synthetic SDK seam characterization passes; general cross-version conversion, native tool/recovery/expiry parity and real-provider auth ownership remain unproven. Production remains scripted on Pi AI/Pi Durable 1.3.0; no package upgrade, access to real Pi credentials or further inference is approved here. Selecting a production route still requires a separate decision. [ADR 0004](0004-catalogue-and-session-stores.md) is unchanged, not superseded.
