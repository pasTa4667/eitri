import { useRef, useState } from 'react';
import { simulateUpstream } from '../lib/transient-upstream.js';
import { reportScenario } from '../scenario-reporting.js';

export default function TransientPage() {
  const attempts = useRef(0);
  const [result, setResult] = useState(null);
  function load() {
    const next = simulateUpstream(++attempts.current);
    if (next.kind === 'unavailable') reportScenario('transient-upstream', new Error(next.message));
    setResult(next);
  }
  return (
    <section>
      <button onClick={load}>Load order</button>
      {result && <p role={result.kind === 'unavailable' ? 'alert' : 'status'}>{result.message}</p>}
    </section>
  );
}
