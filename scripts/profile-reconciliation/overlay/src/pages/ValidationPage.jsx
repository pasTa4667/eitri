import { useState } from 'react';
import { parseConfig } from '../lib/errors.js';
import { reportScenario } from '../scenario-reporting.js';

export default function ValidationPage() {
  const [input, setInput] = useState('{}');
  const [status, setStatus] = useState(null);
  function validate() {
    try {
      parseConfig(input);
      setStatus('accepted');
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      reportScenario('expected-validation', error);
      setStatus('invalid');
    }
  }
  return (
    <section>
      <label>
        Configuration
        <textarea value={input} onChange={(event) => setInput(event.target.value)} />
      </label>
      <button onClick={validate}>Validate configuration</button>
      {status === 'invalid' && <p role="alert">Enter valid JSON.</p>}
      {status === 'accepted' && <p role="status">Configuration accepted.</p>}
    </section>
  );
}
