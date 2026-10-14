// Figures typed on the sweep come back after a lock in the rows of the
// holdings they were typed for, also when the sweep drawn after the
// unlock orders its rows differently (spec/features/record-snapshot.md,
// Update values, Rules; criterion 116).
import { RECORDER_PASSWORD, check, enterPasswordOn, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ev, ago, quiet, home, newRecording, typeRow, rowState, plantHere } = r;

  const DL = ago(3);
  await home();
  await newRecording(DL);
  await typeRow('Savings', '5555');
  await typeRow('Brokerage', '777');

  // Another window adds a holding older than every other, so every row
  // moves down one place after the unlock.
  await plantHere([{
    type: 'account',
    payload: { name: 'Zeta fund', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: '2019-12-31T00:00:00Z' },
  }]);
  await ev("document.querySelector('.btn-lock').click()");
  await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card' });
  await enterPasswordOn(rec, RECORDER_PASSWORD);
  await rec.waitUntil("!document.querySelector('#unlock-password') && document.querySelector('.sweep-row')", { timeout: 90000, label: 'the sweep after unlocking' });
  await quiet();

  const order = await rec.call(() => [...document.querySelectorAll('.sweep-row .holding-name')].map((n) => n.textContent));
  const rows = {
    savings: await rowState('Savings'),
    brokerage: await rowState('Brokerage'),
    zeta: await rowState('Zeta fund'),
  };
  check(
    'the sweep after the unlock orders its rows differently than before the lock',
    order[0] === 'Zeta fund',
    JSON.stringify(order),
  );
  check(
    'after a lock, each typed figure is back in the row of the holding it was typed for, and the added row holds nothing typed',
    (await ev('location.hash')) === `#/sweep/${DL}` &&
      rows.savings.field === '5555' && rows.brokerage.field === '777' && rows.zeta.field === '',
    JSON.stringify({ rows, order }),
  );
});
