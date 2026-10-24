"""Reap orphaned application/browser descendants within the existing PID ceiling."""
import ctypes
import os
import subprocess
import sys

# PR_SET_CHILD_SUBREAPER requires no capability or new seccomp exception.
if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "application-subreaper-unavailable")

child = subprocess.Popen(
    ["/usr/local/bin/node", "/opt/verify/run.mjs", sys.argv[1]],
    stdin=subprocess.DEVNULL,
)
status = None
while True:
    try:
        pid, result = os.waitpid(-1, 0)
    except ChildProcessError:
        break
    if pid == child.pid:
        status = os.waitstatus_to_exitcode(result)
        child.returncode = status
if status is None:
    sys.exit(126)
sys.exit(128 - status if status < 0 else status)
