import ctypes
import errno
import json
import os
import platform

if platform.machine() != "aarch64":
    raise RuntimeError("Namespace probe requires the reviewed ARM64 syscall table")

libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long
USER = 0x10000000
PID = 0x20000000
NET = 0x40000000
cases = [
    ("clone-user", 220, [USER | 17], True),
    ("clone-user-pid", 220, [USER | PID | 17], True),
    ("clone-user-net", 220, [USER | NET | 17], True),
    ("clone-user-pid-net", 220, [USER | PID | NET | 17], True),
    ("unshare-user", 97, [USER], True),
    ("clone3-fallback", 435, [0, 0], False),
    ("setns-denied", 268, [-1, USER], False),
    ("mount-denied", 40, [0, 0, 0, 0, 0], False),
]
for name, flag in [("mount", 0x20000), ("ipc", 0x8000000), ("uts", 0x4000000), ("cgroup", 0x2000000)]:
    cases.append((f"clone-{name}-denied", 220, [USER | flag | 17], False))
    cases.append((f"unshare-{name}-denied", 97, [flag], False))

results = []
for name, number, args, positive in cases:
    read_fd, write_fd = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(read_fd)
        ctypes.set_errno(0)
        syscall_args = args + [0] * (6 - len(args))
        result = libc.syscall(ctypes.c_long(number), *(ctypes.c_long(arg) for arg in syscall_args))
        error = ctypes.get_errno() if result == -1 else 0
        if number == 220 and result == 0:
            os._exit(0)
        child_exit = None
        if number == 220 and result > 0:
            _, cloned_status = os.waitpid(result, 0)
            child_exit = os.waitstatus_to_exitcode(cloned_status)
        observation = {"name": name, "success": result >= 0 and child_exit in (None, 0), "errno": error, "positive": positive, "childExit": child_exit}
        os.write(write_fd, json.dumps(observation).encode())
        os._exit(0)
    os.close(write_fd)
    _, status = os.waitpid(child, 0)
    payload = os.read(read_fd, 4096)
    os.close(read_fd)
    if status != 0 or not payload:
        raise RuntimeError(f"Syscall probe did not complete: {name}")
    results.append(json.loads(payload))

negative_ok = all(row["errno"] == (errno.ENOSYS if row["name"] == "clone3-fallback" else errno.EPERM) for row in results if not row["positive"])
print(json.dumps({"checks": results, "negativeControlsPassed": negative_ok, "userNamespacesUsable": all(row["success"] for row in results if row["positive"])}))
if not negative_ok:
    raise SystemExit(1)
