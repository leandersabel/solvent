// Reviewer's checks of the single-holding form's heading
// (spec/features/record-snapshot.md, Snapshot entry, Layout, and
// criterion 93), written from the feature page and the Dialog component
// (design-system.md, Components) alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, D1, id, ev, quiet, set, press, go, format } = r;

  const script = '<script>alert(1)</script>';
  // The form's dialog: its first line, every heading in it, and whether
  // any markup from a holding's name became an element.
  const shown = () => ev(`(() => {
    const d = [...document.querySelectorAll('.dialog')].find((n) => n.querySelector('#snapshot-value'));
    if (!d) return null;
    const first = d.innerText.split('\\n').map((l) => l.trim()).find(Boolean);
    const headings = [...d.querySelectorAll('h1, h2, h3, h4, [role=heading]')].map((h) => h.textContent.trim());
    return { first, headings, scripts: d.querySelectorAll('script').length };
  })()`);
  const reads = (seen, expected) =>
    seen !== null && seen.first === expected && seen.headings.length === 1 && seen.headings[0] === expected && seen.scripts === 0;
  const close = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
    await quiet();
  };
  const formOpen = () => rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  const fromScreen = async (name) => {
    await go(`#/holding/${id[name]}`);
    await press('Record a value', '.form-actions');
    await formOpen();
    await quiet();
  };
  const fromRow = async (name) => {
    await go('#/');
    await rec.call((holding) => [...document.querySelectorAll('.holdings-table tbody tr')]
      .find((tr) => tr.querySelector('.row-name').textContent === holding)
      .querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Record a value') b.click(); }), name);
    await formOpen();
    await quiet();
  };
  const editEntry = async (name, iso) => {
    await go(`#/holding/${id[name]}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await formOpen();
    await quiet();
  };

  // ---- a new figure, from the holding's own screen ----------------------

  for (const name of ['Savings', 'Current account', script]) {
    await fromScreen(name);
    const seen = await shown();
    check(
      `review 93: a new figure for ${JSON.stringify(name)} opened from its screen is headed "Record a value for ${name}", as its first line`,
      reads(seen, `Record a value for ${name}`),
      JSON.stringify(seen),
    );
    await close();
  }

  // ---- a new figure, from the holding's row on the dashboard ------------

  await fromRow('Savings');
  const row = await shown();
  check(
    'review 93: a new figure opened from the dashboard row is headed "Record a value for Savings"',
    reads(row, 'Record a value for Savings'),
    JSON.stringify(row),
  );
  await close();

  // ---- a stored figure ---------------------------------------------------

  for (const name of ['Savings', script]) {
    await editEntry(name, D1);
    const seen = await shown();
    check(
      `review 93: the stored figure of ${JSON.stringify(name)} opened to edit is headed "Edit this value", and never names the act of recording`,
      reads(seen, 'Edit this value'),
      JSON.stringify(seen),
    );
    await close();
  }

  // ---- declining a duplicate returns to the same form, same heading -----

  await fromScreen('Savings');
  await set('#snapshot-date', await format('date', D1));
  await ev('document.activeElement && document.activeElement.blur()');
  await set('#snapshot-value', '5100');
  await quiet();
  await ev("[...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')].find(b => b.textContent === 'Save').click()");
  await quiet();
  await press('Keep what is there', '.dialog');
  const back = await shown();
  check(
    'review 93: declining the duplicate returns to a new figure still headed "Record a value for Savings"',
    reads(back, 'Record a value for Savings'),
    JSON.stringify(back),
  );
  await close();
}, { signsIn: false });
