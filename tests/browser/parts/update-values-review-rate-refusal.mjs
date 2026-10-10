// Reviewer's checks of a rate line's refused price on the sweep, written
// from spec/features/record-snapshot.md (Update values, States, "Rate
// line, invalid price"; criterion 112), spec/features/record-rate.md
// (Record shape; criterion 40) and spec/design-system.md (Components,
// Input, The message line) alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, quiet, home, sweepToday, line, lineState, typeLine, typeRow, pressRow, realKey, stored, on, plantHere, reread, go } = r;

  // What a person and a screen reader meet on the line: its message line,
  // and the field's own invalid state and description.
  const read = async (unit) => ({
    ...(await lineState(unit)),
    ...(await rec.call((query) => {
      const l = document.querySelector(query);
      const field = l.querySelector('input');
      const named = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((at) => document.getElementById(at));
      return {
        invalid: field.getAttribute('aria-invalid'),
        described: named.every(Boolean) ? named.map((n) => n.textContent.trim()).join(' ') : null,
        onLine: named.length > 0 && named.every((n) => n && l.contains(n)),
        polite: Boolean(l.querySelector('.field-error').closest('[aria-live="polite"], [role="status"]')),
      };
    }, line(unit))),
  });
  const typeAndSettle = async (unit, value) => {
    await typeLine(unit, value);
    await quiet();
  };
  const announced = (s) => Boolean(s.error) && s.invalid === 'true' && s.described !== null && s.described.includes(s.error) && s.onLine;
  const clear = (s) => !s.error && s.invalid !== 'true';
  const pricesAt = async (symbol) => on(await stored('rate'), T).filter((x) => x.payload.symbol === symbol).map((x) => x.payload.rate);

  // A free-text unit may hold a space (manage-accounts.md, Account form), which
  // must not split the field's description in two.
  const SPACED = 'wine bottles';
  await plantHere([{
    type: 'account',
    payload: { name: 'Cellar', unit: SPACED, dims: {}, note: null, archivedAt: null, createdAt: '2020-01-01T00:01:00Z' },
  }]);
  await reread();
  await go('#/');
  await home();
  await sweepToday();

  const TOO_MANY = '0.1234567890123';
  const FITS = '0.123456789012';

  // A live region announces a change to what it already holds, so the
  // line must be one before the refusal arrives.
  const before = await read('USD');
  check(
    'review 112: the price line is a polite live region before any refusal, so the turn to an error is announced',
    before.polite && clear(before),
    JSON.stringify(before),
  );

  // ---- 112: a price with thirteen decimal places, then one that fits ----

  await typeAndSettle('USD', TOO_MANY);
  const refused = await read('USD');
  const neighbour = await read('XAU-ozt');
  check(
    'review 112: a price with thirteen decimal places shows the refusal on its own rate line',
    Boolean(refused.error) && refused.value === TOO_MANY,
    JSON.stringify(refused),
  );
  check(
    'review 112: the refused price field carries aria-invalid="true" and an aria-describedby naming its own line',
    announced(refused),
    JSON.stringify(refused),
  );
  check(
    'review 112: the refusal line is a polite live region',
    refused.polite,
    JSON.stringify(refused),
  );
  check(
    'review 112: the refusal stays on its own line and leaves the other rate lines alone',
    clear(neighbour),
    JSON.stringify(neighbour),
  );

  await typeAndSettle('USD', '0.12345678901234');
  const stillTooMany = await read('USD');
  check(
    'review 112: an edit that still does not fit keeps the refusal',
    announced(stillTooMany),
    JSON.stringify(stillTooMany),
  );

  await typeAndSettle('USD', FITS);
  const corrected = await read('USD');
  check(
    'review 112: correcting the price to twelve decimal places clears the refusal and aria-invalid',
    clear(corrected) && corrected.value === FITS,
    JSON.stringify(corrected),
  );

  // ---- The same correction made at the keyboard ---------------------------

  await typeAndSettle('m2', '9000.1234567890123');
  const keyRefused = await read('m2');
  await rec.call((query) => {
    const field = document.querySelector(query).querySelector('input');
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, line('m2'));
  await realKey('Backspace', 'Backspace', 8);
  const keyCleared = await read('m2');
  check(
    'review 112: on a line with no proposal, deleting the thirteenth decimal with Backspace clears the refusal while the field has focus',
    announced(keyRefused) && clear(keyCleared) && keyCleared.value === '9000.123456789012',
    JSON.stringify({ keyRefused, keyCleared }),
  );

  // ---- A free-text unit whose name holds a space -------------------------

  await typeAndSettle(SPACED, '3.1234567890123');
  const spaced = await read(SPACED);
  check(
    'review 112: on a line for a free-text unit with a space in it, the refused field is described by its own line',
    announced(spaced) && spaced.polite,
    JSON.stringify(spaced),
  );
  await typeAndSettle(SPACED, '3');

  // ---- record-rate.md 40: refused, never truncated -----------------------

  await typeAndSettle('USD', TOO_MANY);
  await typeAndSettle('m2', '9000');
  await typeRow('Savings', '5100');
  await quiet();
  await pressRow('Savings');
  const usd = await pricesAt('USD');
  check(
    'review rate 40: recording a row while the USD price is refused stores no USD price, rounded, truncated or otherwise',
    usd.length === 0,
    JSON.stringify(usd),
  );

  await home();
}, { signsIn: false });
