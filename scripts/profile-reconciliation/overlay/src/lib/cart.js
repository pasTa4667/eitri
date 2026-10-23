export function getCartTotal(amounts) {
  return amounts.reduce((total, amount) => total + amount);
}
