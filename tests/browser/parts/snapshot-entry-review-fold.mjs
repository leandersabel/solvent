// Reviewer's checks of the single-holding form's folded prices line
// (spec/features/record-snapshot.md, Snapshot entry, The prices line,
// Editing an existing entry and States, and criterion 95), written from
// the feature page and the design system alone. What counts is what is
// painted: a sentence inside a closed fold, or clipped away, is not shown.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const INK_SECONDARY = 'rgb(77, 87, 90)';
const PETROL_100 = 'rgb(224, 238, 242)';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, ago, D1, D2, id, holdRates, rateAsks, traffic, ev, quiet, set, press, go, format, plantHere, reread, snap, price } = r;

  // The form's Dialog as a person sees it: the text painted in it, in
  // order, whether any rate line is painted, the colour and centre of
  // the run naming what the save writes, and any skeleton block painted
  // between the value field and Save.
  const seen = () => ev(`(() => {
    const d = [...document.querySelectorAll('.dialog')].find((n) => n.querySelector('#snapshot-value'));
    if (!d) return null;
    const painted = (el, rects) => {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const live = rects.filter((b) => b.width > 0.5 && b.height > 0.5);
      if (!live.length) return false;
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.overflowX === 'visible' && s.overflowY === 'visible' && s.clipPath === 'none') continue;
        const c = n.getBoundingClientRect();
        if (!live.some((b) => b.left < c.right && c.left < b.right && b.top < c.bottom && c.top < b.bottom)) return false;
      }
      return true;
    };
    const runs = [];
    let says = null;
    const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      const rects = [...range.getClientRects()];
      if (!painted(t.parentElement, rects)) continue;
      runs.push(t.textContent);
      if (!says && /\\bprices\\b/i.test(t.textContent)) {
        const b = rects.find((x) => x.width > 0.5);
        says = { color: getComputedStyle(t.parentElement).color, x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 };
      }
    }
    const value = d.querySelector('#snapshot-value').getBoundingClientRect();
    const save = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save');
    const floor = save ? save.getBoundingClientRect().top : Infinity;
    const skeletons = [...d.querySelectorAll('*')].filter((n) => {
      const b = n.getBoundingClientRect();
      return (getComputedStyle(n).backgroundColor === '${PETROL_100}' || /skeleton/i.test(n.className)) &&
        painted(n, [b]) && b.top >= value.bottom - 0.5 && b.bottom <= floor + 0.5;
    }).length;
    return {
      text: runs.join(' ').replace(/\\s+/g, ' ').replace(/ ([.,])/g, '$1').trim(),
      lines: [...d.querySelectorAll('.rate-line')].some((l) => painted(l, [...l.getClientRects()])),
      says,
      skeletons,
    };
  })()`);
  // A real mouse press on the sentence, which is how the folded line is opened.
  const clickAt = async ({ x, y }) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await rec.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
    await quiet();
  };
  const closeDialogs = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
    await quiet();
  };
  const openForm = async (name) => {
    await go(`#/holding/${id[name]}`);
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
    await quiet();
  };
  const editEntry = async (name, iso) => {
    await go(`#/holding/${id[name]}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the entry at ${iso}` });
    await quiet();
  };
  const dateTo = async (iso) => {
    await set('#snapshot-date', await format('date', iso));
    await ev('document.activeElement && document.activeElement.blur()');
    await quiet();
  };
  // The page names a date as "31 July" or with its year; either is the date.
  const dates = async (iso) => [await format('dayMonth', iso), await format('longDate', iso)];
  const recordsWith = async (iso) => (await dates(iso)).map((d) => `Prices for ${d} will be recorded with this`);
  const holds = async (iso) => (await dates(iso)).map((d) => `${d} already holds prices. This figure joins them.`);
  const MISSING = 'The prices it is missing will be recorded with this.';
  // Folded: the sentence painted, no rate line painted, the sentence in
  // ink-secondary, and pressing the sentence opens the rate lines.
  const foldedSays = (s, expected) => s !== null && !s.lines && expected.some((e) => s.text.includes(e)) && s.says !== null && s.says.color === INK_SECONDARY;
  const opensFromSentence = async (s) => {
    if (!s || !s.says) return false;
    await clickAt(s.says);
    return (await seen()).lines;
  };

  // A date whose prices are complete for every unit the vault holds.
  const FULL = ago(50);
  await plantHere([
    snap('Savings', FULL, '5050'),
    ...[['USD', '0.9'], ['XAU-ozt', '2550'], ['XAG-ozt', '26'], ['m2', '10100'], ['PAINT', '700']].map(([unit, rate]) => price(unit, FULL, rate)),
  ]);
  await reread();

  // ---- a new figure, today, as the form opens ------------------------------

  await openForm('Brokerage');
  const today = await seen();
  check(
    'review 95: the form opened for today shows, folded and in ink-secondary, that today\'s prices will be recorded with the figure',
    foldedSays(today, await recordsWith(T)),
    JSON.stringify(today),
  );
  check('review 95: pressing that sentence opens the rate lines it folds', await opensFromSentence(today));
  await closeDialogs();

  // ---- the line follows the date at once --------------------------------------

  await openForm('Brokerage');
  await dateTo(ago(7));
  const week = await seen();
  check(
    'review 95: moving the new figure to another empty date names that date on the folded line, and no longer today',
    foldedSays(week, await recordsWith(ago(7))) && !(await recordsWith(T)).some((e) => week.text.includes(e)),
    JSON.stringify(week),
  );
  await dateTo(FULL);
  const full = await seen();
  check(
    'review 95: at a date whose prices are complete the folded line says the date already holds prices and the figure joins them, and nothing more is recorded',
    foldedSays(full, await holds(FULL)) && !full.text.includes('will be recorded'),
    JSON.stringify(full),
  );
  await closeDialogs();
  // Dollar cash has no figure at D2, so its figure arrives there.
  await openForm('Dollar cash');
  await dateTo(D2);
  const partial = await seen();
  check(
    'review 95: at a date holding a recording that lacks prices the folded line also says the missing ones will be recorded',
    foldedSays(partial, await holds(D2)) && partial.text.includes(MISSING),
    JSON.stringify(partial),
  );
  check('review 95: pressing the sentence of a recorded date opens its rate lines', await opensFromSentence(partial));
  await closeDialogs();

  // ---- a holding in the main currency still says so ----------------------

  await openForm('Savings');
  await dateTo(ago(9));
  const main = await seen();
  check(
    'review 95: a holding in the main currency still shows, folded, that the date\'s prices will be recorded',
    foldedSays(main, await recordsWith(ago(9))),
    JSON.stringify(main),
  );
  await closeDialogs();

  // ---- editing a stored entry ----------------------------------------------------

  traffic.length = 0;
  await editEntry('Brokerage', D1);
  const stored = await seen();
  check(
    'review 95: editing a stored entry, the folded line reads as the date\'s stored prices and promises to record nothing, asking no source',
    stored !== null && !stored.lines && (await dates(D1)).some((d) => stored.text.includes(d)) &&
      !stored.text.includes('will be recorded') && stored.says !== null && stored.says.color === INK_SECONDARY && rateAsks().length === 0,
    JSON.stringify({ stored, asks: rateAsks().length }),
  );
  await dateTo(ago(11));
  const moved = await seen();
  check(
    'review 95: moving a stored entry to an empty date says, folded, that that date\'s prices will be recorded',
    foldedSays(moved, await recordsWith(ago(11))),
    JSON.stringify(moved),
  );
  await dateTo(D2);
  const movedPartial = await seen();
  check(
    'review 95: moving a stored entry to a date missing prices says, folded, that the missing ones will be recorded',
    foldedSays(movedPartial, await holds(D2)) && movedPartial.text.includes(MISSING),
    JSON.stringify(movedPartial),
  );
  await dateTo(D1);
  const back = await seen();
  check(
    'review 95: picking the entry\'s own date again reads as its stored prices, folded, with nothing to record',
    back !== null && !back.lines && (await dates(D1)).some((d) => back.text.includes(d)) && !back.text.includes('will be recorded'),
    JSON.stringify(back),
  );
  await closeDialogs();

  // ---- proposals in flight -------------------------------------------------------

  const release = holdRates();
  await go(`#/holding/${id.Brokerage}`);
  traffic.length = 0;
  await ev("[...document.querySelectorAll('.form-actions button')].find((b) => b.textContent.trim() === 'Record a value').click()");
  await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  for (let n = 0; n < 500 && rateAsks().length === 0; n++) await rec.frames();
  await rec.frames();
  const flight = await seen();
  release();
  await quiet();
  const landed = await seen();
  check(
    'review States: with proposals in flight the folded prices line carries a skeleton, gone once they land',
    flight !== null && !flight.lines && flight.skeletons > 0 && landed.skeletons === 0 && foldedSays(landed, await recordsWith(T)),
    JSON.stringify({ flight, landed, asks: rateAsks().length }),
  );
  await closeDialogs();
}, { signsIn: false });
