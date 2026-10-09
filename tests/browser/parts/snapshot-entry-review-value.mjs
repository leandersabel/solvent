// Reviewer's checks of the value field's refusals in Snapshot entry
// (spec/features/record-snapshot.md, Snapshot entry, States,
// Validation, criteria 6 and 109, and spec/design-system.md,
// Components, Input and Quantity field), written from the spec alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, D1, id, traffic, writesSent, ev, quiet, set, press, go, format } = r;

  const formOpen = async () => {
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
    await quiet();
  };
  const openNew = async (name) => {
    await go(`#/holding/${id[name]}`);
    await press('Record a value', '.form-actions');
    await formOpen();
  };
  const openStored = async (name, iso) => {
    await go(`#/holding/${id[name]}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await formOpen();
  };
  const closeAll = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
    await quiet();
  };
  // Typing alone: an input event and no change or blur, so a refusal
  // that clears only on blur or Save fails here.
  const type = async (value) => {
    await rec.call((next) => {
      const node = document.querySelector('#snapshot-value');
      node.focus();
      node.value = next;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await rec.frames();
    await quiet();
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
  // The value field's state: its message line is what aria-describedby
  // names, and `text` found anywhere else in the Dialog counts against it.
  const field = (text = null) => rec.call((reason) => {
    const input = document.querySelector('#snapshot-value');
    const dialog = [...document.querySelectorAll('.dialog')].find((d) => d.contains(input));
    const lines = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      .map((i) => document.getElementById(i)).filter(Boolean);
    const leaves = reason ? [...dialog.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.includes(reason)) : [];
    return {
      value: input.value,
      invalid: input.getAttribute('aria-invalid'),
      lines: lines.map((l) => l.textContent.trim()),
      onLine: Boolean(reason) && lines.some((l) => l.textContent.includes(reason)),
      elsewhere: leaves.filter((n) => !lines.some((l) => l.contains(n))).map((n) => n.className || n.tagName),
      anywhere: Boolean(reason) && dialog.textContent.includes(reason),
    };
  }, text);
  // How far what follows the value's field sits below the value input,
  // in rendered pixels.
  const below = () => ev(`(() => {
    const input = document.querySelector('#snapshot-value');
    const next = input.closest('.field').nextElementSibling;
    return next.getBoundingClientRect().top - input.getBoundingClientRect().top;
  })()`);
  // The refusal is the text its line gained over what it read before.
  const refusalOf = (before, after) => after.lines.filter((l) => l && !before.lines.includes(l)).join(' ');

  const refuses = async (where, typed, fitting) => {
    const before = await field();
    await type(typed);
    const unrefused = await below();
    await save();
    const shown = await field();
    const refusedAt = await below();
    const reason = refusalOf(before, shown);
    const refused = await field(reason);
    check(
      `review 109: ${where}, Save on ${typed} refuses it on the value field's own line, with aria-invalid and aria-describedby, and nowhere else in the Dialog`,
      Boolean(reason) && refused.invalid === 'true' && refused.onLine && refused.elsewhere.length === 0,
      JSON.stringify({ before, refused, reason }),
    );
    check(
      `review 6: ${where}, ${typed} issues no PUT and stays as typed, never truncated`,
      writesSent().length === 0 && refused.value === typed,
      JSON.stringify({ value: refused.value, writes: writesSent().map((t) => t.method) }),
    );
    check(
      `review 109: ${where}, the refusal of ${typed} turns the value's message line critical in place, so nothing below the field moves (design-system.md, Components, Input, The message line)`,
      Math.abs(refusedAt - unrefused) < 0.5,
      JSON.stringify({ unrefused, refusedAt }),
    );
    await type(fitting);
    const fixed = await field(reason);
    check(
      `review 109: ${where}, correcting ${typed} to ${fitting} clears the refusal and aria-invalid as it is typed, without blur or Save`,
      Boolean(reason) && fixed.invalid !== 'true' && !fixed.anywhere,
      JSON.stringify({ fixed, reason }),
    );
    await blur();
    const blurred = await field(reason);
    check(
      `review 109: ${where}, the corrected value stays clear after blur`,
      Boolean(reason) && blurred.invalid !== 'true' && !blurred.anywhere,
      JSON.stringify({ blurred, reason }),
    );
    return reason;
  };

  // ---- a new figure ------------------------------------------------------

  await openNew('Savings');
  await refuses('a new figure', '5000.1234567890123', '5000.123456789012');
  await save();
  check(
    'review 6: a new figure with twelve decimal places, once corrected, saves and closes the form',
    writesSent().some((t) => t.method === 'PUT') && (await ev("document.querySelectorAll('.dialog').length")) === 0,
    JSON.stringify(writesSent().map((t) => t.method)),
  );

  // A malformed value is refused the same way (design-system.md, Quantity field).
  await openNew('Brokerage');
  await refuses('a new figure', '12.5.3', '12.53');
  await closeAll();

  // ---- a stored figure ---------------------------------------------------

  await openStored('Current account', D1);
  await refuses('a stored figure', '-0.0000000000001', '-0.000000000001');
  await save();
  check(
    'review 6: a stored figure corrected to twelve decimal places saves and closes the form',
    writesSent().some((t) => t.method === 'PUT') && (await ev("document.querySelectorAll('.dialog').length")) === 0,
    JSON.stringify(writesSent().map((t) => t.method)),
  );
}, { signsIn: false });
