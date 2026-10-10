// Reviewer's checks that the single-holding form's folded prices line
// keeps its place when the prices it looked up land
// (spec/features/record-snapshot.md, Snapshot entry, States, Proposals in
// flight, and criteria 112, 110 and 95), written from the feature page
// alone. The proposals are held while the line is measured and a press
// is aimed at its sentence, then let through; the press lands after
// they have, as a person's would when the answer beats their hand.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, ago, D1, D2, id, traffic, rateAsks, ev, quiet, go, format, realClick, holdRates, proxy } = r;

  const size = (width, height) =>
    rec.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const closeDialogs = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
    await quiet();
  };
  const opener = async (name) => {
    await go(`#/holding/${id[name]}`);
    // Pressed without waiting for the page to settle, which a held ask
    // keeps it from doing.
    const at = await rec.call(() => {
      const b = [...document.querySelectorAll('.form-actions button')].find((n) => n.textContent.trim() === 'Record a value');
      b.scrollIntoView({ block: 'center' });
      const box = b.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await rec.mouseClick(at.x, at.y);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the form for ${name}` });
  };
  const editEntry = async (name, iso) => {
    await go(`#/holding/${id[name]}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the entry at ${iso}` });
    await quiet();
  };
  // A date typed into the field, then left with Tab unless `stay`.
  const typeDate = async (iso, { stay = false } = {}) => {
    await realClick('#snapshot-date');
    await rec.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] });
    await rec.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await rec.send('Input.insertText', { text: await format('date', iso) });
    if (!stay) await rec.key('Tab');
  };
  // Where the folded line is painted, and the point of its sentence a
  // press aims at: the first painted run of its text.
  const where = () => rec.call(() => {
    const d = [...document.querySelectorAll('.dialog')].find((n) => n.querySelector('#snapshot-value'));
    const fold = d && d.querySelector('.prices-fold');
    if (!fold) return null;
    const box = fold.getBoundingClientRect();
    let aim = null;
    const walker = document.createTreeWalker(fold, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t && !aim; t = walker.nextNode()) {
      if (!t.textContent.trim() || !t.parentElement.checkVisibility()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      const b = [...range.getClientRects()].find((x) => x.width > 0.5);
      if (b) aim = { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 };
    }
    const shown = (l) => l.checkVisibility() && l.getClientRects().length > 0;
    return {
      top: box.top, left: box.left, width: box.width, height: box.height,
      dialogTop: d.getBoundingClientRect().top,
      aim, text: fold.innerText, open: [...d.querySelectorAll('.rate-line')].some(shown),
    };
  });
  const still = (a, b) => a && b && ['top', 'left', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 1);
  // Holds the proposals, runs `ask` and waits for its request, measures
  // the line in flight, lets the answer through, measures it again, then
  // presses where the line was.
  const flight = async (ask) => {
    const release = holdRates();
    traffic.length = 0;
    await ask();
    for (let n = 0; n < 500 && rateAsks().length === 0; n++) await rec.frames();
    await rec.frames();
    const asked = rateAsks().length;
    const before = await where();
    release();
    await quiet();
    const after = await where();
    let opened = false;
    if (before && before.aim) {
      await rec.mouseClick(before.aim.x, before.aim.y);
      await quiet();
      opened = (await where())?.open ?? false;
    }
    return { asked, before, after, opened, asks: rateAsks().length };
  };
  const dayNamed = async (text, iso) =>
    (await Promise.all(['dayMonth', 'longDate'].map((m) => format(m, iso)))).some((d) => text.includes(d));

  const sizes = [[1280, 800], [901, 700], [601, 800], [375, 667], [320, 568]];
  for (const [width, height] of sizes) {
    await size(width, height);
    const at = `${width}x${height}`;

    // Opening the form asks for today's prices at once.
    const opening = await flight(() => opener('Brokerage'));
    check(
      `review 112: at ${at}, the folded prices line of a form just opened stays where it was when today's prices land`,
      opening.asked === 1 && still(opening.before, opening.after),
      JSON.stringify(opening),
    );
    check(
      `review 112: at ${at}, a press aimed at the folded line while today's prices were in flight opens it once they have landed`,
      opening.opened,
      JSON.stringify(opening),
    );
    check(
      `review 95: at ${at}, once today's prices land the folded line says they will be recorded`,
      opening.after && /will be recorded with this/.test(opening.after.text) && (await dayNamed(opening.after.text, T)),
      JSON.stringify(opening.after),
    );
    check(
      `review 110: at ${at}, opening the form asks once and pressing the folded line asks nothing more`,
      opening.asks === 1,
      JSON.stringify(opening),
    );
    await closeDialogs();

    // A date holding no recording, typed with focus left in the field,
    // as in the case the issue reports.
    await opener('Brokerage');
    await quiet();
    const typed = await flight(() => typeDate(ago(3), { stay: true }));
    check(
      `review 112: at ${at}, a date holding no recording typed into the field: the folded line stays where it was when its prices land`,
      typed.asked === 1 && still(typed.before, typed.after),
      JSON.stringify(typed),
    );
    check(
      `review 112: at ${at}, a date holding no recording typed into the field: a press aimed at the folded line in flight opens it once its prices have landed`,
      typed.opened,
      JSON.stringify(typed),
    );
    await closeDialogs();
  }

  await size(1280, 800);
  // A date that holds a recording missing a price: the missing ones are
  // looked up, and the line names them.
  await opener('Gold bars');
  await quiet();
  const missing = await flight(() => typeDate(D2));
  check(
    'review 112: a date holding a recording that misses prices: the folded line stays where it was when the missing ones land',
    missing.asked === 1 && still(missing.before, missing.after),
    JSON.stringify(missing),
  );
  check(
    'review 112: a date holding a recording that misses prices: a press aimed at the folded line in flight opens it once they have landed',
    missing.opened,
    JSON.stringify(missing),
  );
  await closeDialogs();

  // A holding in the main currency still writes every other unit's prices.
  await opener('Current account');
  await quiet();
  const main = await flight(() => typeDate(ago(5)));
  check(
    'review 112: a holding in the main currency: the folded line stays where it was when the date\'s prices land',
    main.asked === 1 && still(main.before, main.after),
    JSON.stringify(main),
  );
  await closeDialogs();

  // A source that does not answer ends the lookup too, and the line
  // still never moves under a press aimed at it.
  proxy.mode = 'down';
  await opener('Brokerage');
  await quiet();
  const down = await flight(() => typeDate(ago(6)));
  proxy.mode = 'answer';
  check(
    'review States: a price source that does not answer: the folded line stays where it was when the lookup ends',
    down.asked === 1 && still(down.before, down.after),
    JSON.stringify(down),
  );
  await closeDialogs();

  // A stored entry moved to a date holding no recording.
  await editEntry('Brokerage', D1);
  const moved = await flight(() => typeDate(ago(7)));
  check(
    'review 112: a stored entry moved to a date holding no recording: the folded line stays where it was when that date\'s prices land',
    moved.asked === 1 && still(moved.before, moved.after),
    JSON.stringify(moved),
  );
  check(
    'review 112: a stored entry moved to a date holding no recording: a press aimed at the folded line in flight opens it once the prices have landed',
    moved.opened,
    JSON.stringify(moved),
  );
  await closeDialogs();
}, { signsIn: false });
