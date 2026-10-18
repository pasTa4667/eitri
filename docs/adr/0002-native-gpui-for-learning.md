---
status: accepted
---

# Use native GPUI because learning it is a project goal

The operator application will be a native Rust/GPUI desktop application, not a browser client. Learning GPUI is an explicit goal, so we accept the additional Rust toolchain and GPUI's pre-1.0 changes rather than optimize solely for the lowest-effort existing web or terminal interface. The small React demonstration project is a separate monitored application; it is not the operator interface.
