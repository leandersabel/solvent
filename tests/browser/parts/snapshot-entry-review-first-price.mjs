// Reviewer's checks that a price filled in on the single-holding form
// asks nothing, written from spec/features/record-snapshot.md (Snapshot
// entry, The prices line; Update values, Changing or clearing a rate
// says what it moves; criterion 102) alone: over a proposal at a date
// holding no recording, over a proposal and an estimate at a date
// missing them, and over a line nothing filled.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, D2, ago, id, proxy, ev, quiet, set, press, go, format, stored, on, figure, line } = r;

  const dialogs = () => ev("[...document.querySelectorAll('.dialog')].map((d) => d.innerText).join(' | ')");
  const openForm = async (name) => {
    await go(`#/holding/${id[name]}`);
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
    await quiet();
  };
  // Opens the folded prices line with a real press on its sentence.
  const unfold = async () => {
    const at = await rec.call(() => {
      const d = [...document.querySelectorAll('.dialog')].find((d) => d.querySelector('#snapshot-value'));
      const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!/\bprices\b/i.test(t.textContent)) continue;
        const range = document.createRange();
        range.selectNodeContents(t);
        const b = [...range.getClientRects()].find((x) => x.width > 0.5);
        if (b) return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 };
      }
      return null;
    });
    if (!at) return;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await rec.send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
    }
    await quiet();
  };
  // Types into the form's own line for `unit`; false when it has no field.
  const typeFormLine = (unit, value) =>
    rec.call((query, next) => {
      const form = [...document.querySelectorAll('.dialog')].find((d) => d.querySelector('#snapshot-value'));
      const field = form.querySelector(query + ' input');
      if (!field || field.disabled || field.readOnly) return false;
      field.value = next;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, line(unit), value);
  const fill = async (name, iso, value, prices) => {
    await openForm(name);
    await set('#snapshot-date', await format('date', iso));
    await ev('document.activeElement && document.activeElement.blur()');
    await quiet();
    await set('#snapshot-value', value);
    await unfold();
    const typed = {};
    for (const [unit, rate] of Object.entries(prices)) typed[unit] = await typeFormLine(unit, rate);
    await rec.call(() => [...[...document.querySelectorAll('.dialog')].find((d) => d.querySelector('#snapshot-value')).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save').click());
    await quiet();
    return { typed, asked: await dialogs() };
  };
  const rateAt = async (symbol, date) => on(await stored('rate'), date).filter((p) => p.payload.symbol === symbol).map((p) => figure(p.payload.rate));
  const valueAt = async (name, date) => on(await stored('snapshot'), date).filter((s) => s.accountId === id[name]).map((s) => s.payload.value);

  // ---- a date holding no recording: over a proposal ----------------------

  const NEW = ago(7);
  const fresh = await fill('Brokerage', NEW, '2222', { USD: '0.97' });
  check(
    'review 102: a price typed over a proposal on the form, at a date holding no recording, saves with the figure and no confirmation',
    fresh.typed.USD && fresh.asked === '' && (await valueAt('Brokerage', NEW)).join() === '2222' && (await rateAt('USD', NEW)).join() === '0.97',
    JSON.stringify({ ...fresh, value: await valueAt('Brokerage', NEW), usd: await rateAt('USD', NEW) }),
  );

  // ---- a date holding a recording that lacks gold and the flat ------------

  const joining = await fill('Dollar cash', D2, '333', { 'XAU-ozt': '2650', m2: '10400' });
  check(
    'review 102: prices typed over a missing unit\'s proposal and over an estimate, at a date holding a recording, save with the figure and no confirmation',
    joining.typed['XAU-ozt'] && joining.typed.m2 && joining.asked === '' && (await valueAt('Dollar cash', D2)).join() === '333' &&
      (await rateAt('XAU-ozt', D2)).join() === '2650' && (await rateAt('m2', D2)).join() === '10400',
    JSON.stringify({ ...joining, gold: await rateAt('XAU-ozt', D2), flat: await rateAt('m2', D2) }),
  );

  // ---- empty lines: a unit nothing prices, and a source with no answer ------

  const PAINTED = ago(9);
  const art = await fill('Art', PAINTED, '1', { PAINT: '650' });
  check(
    'review 102: a price typed into the empty line of a unit nothing prices saves with the figure and no confirmation',
    art.typed.PAINT && art.asked === '' && (await valueAt('Art', PAINTED)).join() === '1' && (await rateAt('PAINT', PAINTED)).join() === '650',
    JSON.stringify({ ...art, paint: await rateAt('PAINT', PAINTED) }),
  );

  const SILENT = ago(11);
  proxy.mode = 'none';
  const silent = await fill('Brokerage', SILENT, '2100', { USD: '0.88' });
  proxy.mode = 'answer';
  check(
    'review 102: a price typed into a line the source left empty saves with the figure and no confirmation',
    silent.typed.USD && silent.asked === '' && (await valueAt('Brokerage', SILENT)).join() === '2100' && (await rateAt('USD', SILENT)).join() === '0.88',
    JSON.stringify({ ...silent, usd: await rateAt('USD', SILENT) }),
  );
}, { signsIn: false });
