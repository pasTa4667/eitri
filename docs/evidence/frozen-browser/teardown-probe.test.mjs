import test from 'node:test';

test('separate teardown hooks after a close failure', (t) => {
  t.after(() => {
    console.log('FIRST_CLOSE_ATTEMPTED');
    throw new Error('synthetic close failure');
  });
  t.after(() => console.log('SECOND_CLOSE_ATTEMPTED'));
});
