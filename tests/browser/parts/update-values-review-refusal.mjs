// Reviewer's checks of a row's refused value on the sweep, written from
// spec/features/record-snapshot.md (Update values, States, "Row, invalid
// value"; criteria 6 and 111) and spec/design-system.md (Components,
// Input, The message line; Quantity field) alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, quiet, home, sweepToday, typeRow, pressRow, rowState, realKey, stored, on, writesSent } = r;

  // What a person and a screen reader meet in the row: its line, and the
  // field's own invalid state and description.
  const read = async (name) => ({
    ...(await rowState(name)),
    ...(await rec.call((holding) => {
      const row = [...document.querySelectorAll('.sweep-row')].find((x) => x.querySelector('.holding-name').textContent === holding);
      const field = row.querySelector('input');
      const lines = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((at) => document.getElementById(at));
      return {
        invalid: field.getAttribute('aria-invalid'),
        described: lines.every(Boolean) ? lines.map((l) => l.textContent.trim()).join(' ') : null,
        inRow: lines.length > 0 && lines.every((l) => l && row.contains(l)),
        polite: Boolean(row.querySelector('.field-error').closest('[aria-live="polite"], [role="status"]')),
      };
    }, name)),
  });
  const typeAndSettle = async (name, value) => {
    await typeRow(name, value);
    await quiet();
  };
  // Shown on the row's own line, which rowState reads inside the row.
  const shown = (s) => Boolean(s.error);
  // What a screen reader is told: the field invalid, described by that line.
  const announced = (s) => s.invalid === 'true' && s.described !== null && s.described.includes(s.error) && s.inRow;
    const clear = (s) => !s.error && s.invalid !== 'true';
  const savedAt = async (name) => on(await stored('snapshot'), T).filter((x) => x.accountId === r.id[name]).map((x) => x.payload.value);

  await home();
  await sweepToday();

  // ---- 111: Record on too many decimals, then a value that fits ----------

  const TOO_MANY = '1.1234567890123';
  const FITS = '1.123456789012';
  // Where the row ends, which a line that holds its place never moves.
  const rowEnd = (name) =>
    rec.call((holding) => {
      const row = [...document.querySelectorAll('.sweep-row')].find((x) => x.querySelector('.holding-name').textContent === holding);
      return row.getBoundingClientRect().bottom + scrollY;
    }, name);
  await typeAndSettle('Savings', TOO_MANY);
  const endTyped = await rowEnd('Savings');
  const writesBefore = writesSent().length;
  await pressRow('Savings');
  const endRefused = await rowEnd('Savings');
  check(
    'review invalid value: the refusal takes the place of its line, so the row neither grows nor moves the rows below it',
    endRefused === endTyped,
    JSON.stringify({ endTyped, endRefused }),
  );
  const onRecord = await read('Savings');
  const others = await read('Fund 1');
  check(
    'review 111: Record on a value with thirteen decimal places shows the refusal under its own row',
    shown(onRecord),
    JSON.stringify(onRecord),
  );
  check(
    'review invalid value: the refused field carries aria-invalid and an aria-describedby naming its own line',
    announced(onRecord),
    JSON.stringify(onRecord),
  );
  check(
    'review invalid value: the refusal line is a polite live region, so the turn to an error is announced',
    onRecord.polite,
    JSON.stringify(onRecord),
  );
  check(
    'review 111: Record on a refused value sends nothing, keeps what was typed and leaves the other rows alone',
    writesSent().length === writesBefore && onRecord.field === TOO_MANY && clear(others),
    JSON.stringify({ writes: writesSent().slice(writesBefore).map((w) => w.url), onRecord, others }),
  );

  // Still too many after an edit: the refusal holds.
  await typeAndSettle('Savings', '1.12345678901234');
  const stillTooMany = await read('Savings');
  check(
    'review invalid value: an edit that still does not fit keeps the refusal',
    shown(stillTooMany),
    JSON.stringify(stillTooMany),
  );

  await typeAndSettle('Savings', FITS);
  const corrected = await read('Savings');
  check(
    'review 111: correcting the value to twelve decimal places clears the refusal and aria-invalid before Record, with nothing sent',
    clear(corrected) && corrected.field === FITS && writesSent().length === writesBefore,
    JSON.stringify(corrected),
  );

  await pressRow('Savings');
  const savings = await savedAt('Savings');
  check(
    'review 111: Record on the corrected value saves it as typed',
    savings.length === 1 && savings[0] === FITS && clear(await read('Savings')),
    JSON.stringify(savings),
  );

  // ---- The same correction made at the keyboard ---------------------------

  await typeAndSettle('Fund 1', '2.1234567890123');
  await pressRow('Fund 1');
  const keyRefused = await read('Fund 1');
  await rec.call((holding) => {
    const field = [...document.querySelectorAll('.sweep-row')].find((x) => x.querySelector('.holding-name').textContent === holding).querySelector('input');
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, 'Fund 1');
  await realKey('Backspace', 'Backspace', 8);
  const keyCleared = await read('Fund 1');
  check(
    'review 111: deleting the thirteenth decimal with Backspace clears the refusal while the field still has focus',
    shown(keyRefused) && clear(keyCleared) && keyCleared.field === '2.123456789012',
    JSON.stringify({ keyRefused, keyCleared }),
  );

  // ---- A malformed value is refused inline and clears the same way -------

  const beforeMalformed = writesSent().length;
  await typeAndSettle('Fund 2', '1.2.3');
  await pressRow('Fund 2');
  const malformed = await read('Fund 2');
  await typeAndSettle('Fund 2', '1.23');
  const fixed = await read('Fund 2');
  check(
    'review invalid value: a malformed value is refused under its row on Record with nothing sent, and the refusal clears once it parses',
    shown(malformed) && writesSent().length === beforeMalformed && clear(fixed),
    JSON.stringify({ malformed, fixed }),
  );

  await home();
}, { signsIn: false });
