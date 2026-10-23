import { useState } from 'react';
import { getCartTotal } from '../lib/cart.js';

export default function CartPage() {
  const [amounts, setAmounts] = useState([1250, 500, 250]);
  const total = getCartTotal(amounts);
  return (
    <section>
      <p data-testid="cart-total">Total: {total} cents</p>
      <button onClick={() => setAmounts([])}>Empty cart</button>
    </section>
  );
}
