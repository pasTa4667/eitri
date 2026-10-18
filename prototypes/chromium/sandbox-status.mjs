export function isSandboxStatusVerified(text) {
  const requiredRows = new Map([
    ['Layer 1 Sandbox', 'Namespace'],
    ['PID namespaces', 'Yes'],
    ['Network namespaces', 'Yes'],
    ['Seccomp-BPF sandbox', 'Yes'],
  ]);
  const seen = new Set();
  for (const line of text.split('\n')) {
    const columns = line
      .trim()
      .split(/\t+| {2,}/)
      .map((column) => column.trim());
    const [name, value] = columns;
    if (!requiredRows.has(name)) continue;
    if (columns.length !== 2 || seen.has(name) || value !== requiredRows.get(name)) return false;
    seen.add(name);
  }
  return seen.size === requiredRows.size;
}
