import { afterEach, expect, test, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import { reportScenario } from './scenario-reporting.js';

vi.mock('./scenario-reporting.js', () => ({ reportScenario: vi.fn(), attributeScenario: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function renderAt(path) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </StrictMode>,
  );
}
async function validate(value) {
  await userEvent.clear(screen.getByRole('textbox', { name: 'Configuration' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Configuration' }), value);
  await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
}
async function load() {
  await userEvent.click(screen.getByRole('button', { name: 'Load order' }));
}

test('cart page initially renders Total: 2000 cents', () => {
  renderAt('/cart-total');
  expect(screen.getByTestId('cart-total').textContent).toBe('Total: 2000 cents');
});
test('expected validation accepts valid configuration without reporting', async () => {
  renderAt('/expected-validation');
  await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
  expect(screen.getByRole('status').textContent).toBe('Configuration accepted.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(reportScenario).toHaveBeenCalledTimes(0);
});
test('expected validation reports invalid configuration and displays Enter valid JSON.', async () => {
  renderAt('/expected-validation');
  const errors = [];
  const onError = (event) => errors.push(event.error);
  window.addEventListener('error', onError);
  try {
    await validate('invalid');
    expect(screen.getByRole('alert').textContent).toBe('Enter valid JSON.');
    expect(reportScenario).toHaveBeenCalledExactlyOnceWith(
      'expected-validation',
      expect.any(SyntaxError),
    );
    await validate('42');
    expect(screen.getByRole('status').textContent).toBe('Configuration accepted.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(reportScenario).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  } finally {
    window.removeEventListener('error', onError);
  }
});
test('transient page reports once and succeeds on repeated presses', async () => {
  renderAt('/transient-upstream');
  await load();
  expect(screen.getByRole('alert').textContent).toBe(
    'Order service temporarily unavailable. Try again.',
  );
  expect(reportScenario).toHaveBeenCalledExactlyOnceWith(
    'transient-upstream',
    expect.objectContaining({ message: 'Order service temporarily unavailable. Try again.' }),
  );
  await load();
  expect(screen.getByRole('status').textContent).toBe('Order 42 loaded.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await load();
  expect(screen.getByRole('status').textContent).toBe('Order 42 loaded.');
  expect(reportScenario).toHaveBeenCalledTimes(1);
});
test('transient page resets its sequence after remount', async () => {
  const view = renderAt('/transient-upstream');
  await load();
  await load();
  expect(screen.getByRole('status').textContent).toBe('Order 42 loaded.');
  view.unmount();
  renderAt('/transient-upstream');
  await load();
  expect(screen.getByRole('alert').textContent).toBe(
    'Order service temporarily unavailable. Try again.',
  );
  expect(reportScenario).toHaveBeenCalledTimes(2);
  await load();
  expect(screen.getByRole('status').textContent).toBe('Order 42 loaded.');
});
