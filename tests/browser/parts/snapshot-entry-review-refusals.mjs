// Reviewer's checks of the Date field's refusals in Snapshot entry
// (spec/features/record-snapshot.md, criteria 81 to 83, Refusing a
// date, and spec/design-system.md, Components, Date field), written
// from the spec alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, id, traffic, writesSent, ev, quiet, set, press, go, format } = r;

  const openForm = async (name) => {
    await go(`#/holding/${id[name]}`);
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the form for ${name}` });
    await quiet();
  };
  const escape = async () => {
    await rec.key('Escape');
    await rec.frames();
    await quiet();
  };
  const closeAll = async () => {
    while (await ev("document.querySelectorAll('.dialog').length")) await escape();
  };
  const typeDate = async (value) => {
    await ev("document.querySelector('#snapshot-date').focus()");
    await set('#snapshot-date', value);
  };
  // A real Tab, because blur() fires nothing in a page without focus.
  const blur = async () => {
    await rec.key('Tab');
    await rec.frames();
    await quiet();
  };
  const save = async () => {
    traffic.length = 0;
    await press('Save', '.dialog');
    await quiet();
  };
  // The field's state: its message line is what aria-describedby names,
  // and a reason shown elsewhere in the Dialog counts against it.
  const field = (reason) => ev(`(() => {
    const input = document.querySelector('#snapshot-date');
    const dialog = [...document.querySelectorAll('.dialog')].pop();
    const lines = (input.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)
      .map((i) => document.getElementById(i)).filter(Boolean);
    const reason = ${JSON.stringify(reason)};
    const all = [...dialog.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.includes(reason));
    return {
      invalid: input.getAttribute('aria-invalid'),
      lines: lines.map((l) => l.textContent.trim()),
      onLine: lines.some((l) => l.textContent.trim() === reason),
      elsewhere: all.filter((n) => !lines.some((l) => l.contains(n))).map((n) => n.className || n.tagName),
      focused: document.activeElement === input,
      placeholder: input.getAttribute('placeholder'),
    };
  })()`);
  const refused = (f) => f.invalid === 'true' && f.onLine && f.elsewhere.length === 0;

  const FUTURE = 'That date is in the future.';
  const EMPTY = 'Enter a date.';

  // ---- 81: a typed future date ----------------------------------------

  await openForm('Savings');
  await set('#snapshot-value', '321');
  await typeDate(await format('date', ago(-3)));
  await blur();
  const onBlur = await field(FUTURE);
  check(
    'review 81: a future date is refused on blur, on the field\'s own line, with aria-invalid and aria-describedby',
    refused(onBlur),
    JSON.stringify(onBlur),
  );
  await save();
  const onSave = await field(FUTURE);
  check(
    'review 81: Save on a future date refuses it on the field\'s own line only, issues no PUT and moves focus to the field',
    refused(onSave) && onSave.focused && writesSent().length === 0,
    JSON.stringify({ onSave, writes: writesSent().map((t) => t.method) }),
  );

  // ---- 83: correcting it clears the refusal before Save ----------------

  await typeDate(await format('date', ago(5)));
  await rec.frames();
  const fixed = await field(FUTURE);
  check(
    'review 83: correcting a refused date clears the refusal and aria-invalid as it is typed, without Save or blur',
    fixed.invalid !== 'true' && !fixed.onLine && fixed.elsewhere.length === 0,
    JSON.stringify(fixed),
  );
  await closeAll();

  // ---- 82: unparseable text, and an emptied field ----------------------

  await openForm('Savings');
  await set('#snapshot-value', '322');
  const placeholder = await ev("document.querySelector('#snapshot-date').getAttribute('placeholder')");
  const UNREAD = `Enter the date as ${placeholder}.`;
  await typeDate('not a date');
  await save();
  const unread = await field(UNREAD);
  const notEmpty = await field(EMPTY);
  check(
    'review 82: unparseable text on Save shows the unparseable reason with the field\'s own pattern, never the empty one, and issues no PUT',
    Boolean(placeholder) && refused(unread) && !notEmpty.onLine && notEmpty.elsewhere.length === 0 && writesSent().length === 0,
    JSON.stringify({ placeholder, unread, notEmpty, writes: writesSent().map((t) => t.method) }),
  );
  await typeDate('');
  await save();
  const emptied = await field(EMPTY);
  check(
    'review 82: an emptied field on Save shows the empty-date reason and issues no PUT',
    refused(emptied) && writesSent().length === 0,
    JSON.stringify({ emptied, writes: writesSent().map((t) => t.method) }),
  );

  // A day that does not exist does not parse, so nothing saves under it.
  const year = Number(r.T.slice(0, 4)) - 1;
  const typed = (await format('date', `${year}-02-28`)).replace('28', '30');
  await typeDate(typed);
  await save();
  const nonexistent = await field(UNREAD);
  check(
    'review 82: a day that does not exist is refused as unparseable and issues no PUT',
    refused(nonexistent) && writesSent().length === 0,
    JSON.stringify({ typed, nonexistent, writes: writesSent().map((t) => t.method) }),
  );
  await typeDate(await format('date', ago(6)));
  await rec.frames();
  const cleared = await field(UNREAD);
  check(
    'review 83: correcting unparseable text clears the refusal before Save',
    cleared.invalid !== 'true' && !cleared.onLine,
    JSON.stringify(cleared),
  );
  await save();
  check(
    'review 81-83: the corrected date then saves',
    writesSent().some((t) => t.method === 'PUT') && (await ev("document.querySelectorAll('.dialog').length")) === 0,
    JSON.stringify(writesSent().map((t) => t.method)),
  );
}, { signsIn: false });
