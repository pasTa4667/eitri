import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';

test('cart caller regression renders Total: 0 cents after emptying', async () => {
  const errors = [];
  const onError = (event) => errors.push(event.error);
  window.addEventListener('error', onError);
  try {
    render(
      <MemoryRouter initialEntries={['/cart-total']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('cart-total').textContent).toBe('Total: 2000 cents');
    await userEvent.click(screen.getByRole('button', { name: 'Empty cart' }));
    const total = screen.getByTestId('cart-total').textContent;
    expect(total, total).toBe('Total: 0 cents');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(errors).toEqual([]);
  } finally {
    window.removeEventListener('error', onError);
  }
});
