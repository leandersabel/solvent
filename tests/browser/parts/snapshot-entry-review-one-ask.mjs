// Reviewer's checks that the single-holding form asks for a date's prices
// once (spec/features/record-snapshot.md, Snapshot entry, The prices line
// and Editing an existing entry, criteria 110 and 74), written from the
// feature page alone. The date is chosen as a person chooses it, by
// typing, by the calendar's keyboard and by its mouse, and the folded
// line is opened by a real press on its sentence, which takes focus off
// the date field on the way.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, ago, D1, dayOf, isoOf, id, traffic, rateAsks, ev, quiet, go, format, realClick, realKey, stored } = r;

  const asked = () => rateAsks().map((a) => new URL(a.url).searchParams.get('date'));
  const closeDialogs = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
    await quiet();
  };
  const openForm = async (name) => {
    await go(`#/holding/${id[name]}`);
    await realClick('.form-actions button', 'Record a value');
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
  // Typed into the field with the keyboard, focus left where typing put it.
  const typeDate = async (iso) => {
    await realClick('#snapshot-date');
    await rec.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] });
    await rec.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await rec.send('Input.insertText', { text: await format('date', iso) });
    await quiet();
  };
  // The calendar opened from the button beside the field, focus moved
  // `back` days earlier than the day it lands on, and that day chosen by
  // Enter or by a mouse press on it.
  const pickDate = async (back, by) => {
    const at = await rec.call(() => {
      const input = document.querySelector('#snapshot-date');
      for (let n = input.parentElement; n; n = n.parentElement) {
        const b = n.querySelector('button');
        if (b) {
          const box = b.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }
      }
      return null;
    });
    await rec.mouseClick(at.x, at.y);
    await quiet();
    for (let n = 0; n < back; n++) await realKey('ArrowLeft', 'ArrowLeft', 37);
    if (by === 'Enter') {
      await rec.key('Enter');
    } else {
      const day = await rec.call(() => {
        const box = document.activeElement.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
      await rec.mouseClick(day.x, day.y);
    }
    await quiet();
  };
  // A real press on the folded line's painted sentence, then whether a
  // rate line is painted.
  const openLine = async () => {
    const at = await rec.call(() => {
      const d = [...document.querySelectorAll('.dialog')].find((n) => n.querySelector('#snapshot-value'));
      const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!/will be recorded with this/.test(t.textContent) || !t.parentElement.checkVisibility()) continue;
        t.parentElement.scrollIntoView({ block: 'center' });
        const range = document.createRange();
        range.selectNodeContents(t);
        const b = [...range.getClientRects()].find((x) => x.width > 0.5);
        if (b) return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 };
      }
      return null;
    });
    if (!at) return false;
    await rec.mouseClick(at.x, at.y);
    await quiet();
    return ev("[...document.querySelectorAll('.dialog .rate-line')].some((l) => l.checkVisibility() && l.getClientRects().length > 0)");
  };

  // Each case chooses a date of its own that holds no recording, so a
  // proposal kept from an earlier case cannot stand in for the ask.
  const cases = [
    ['typed, then the line pressed with focus still in the field', 'Brokerage', ago(3), async (iso) => typeDate(iso), false, true],
    ['typed and left with Tab, then the line pressed', 'Brokerage', ago(4), async (iso) => { await typeDate(iso); await rec.key('Tab'); await quiet(); }, false],
    ['picked in the calendar with Enter, then the line pressed', 'Brokerage', ago(5), async () => pickDate(5, 'Enter'), false],
    ['picked in the calendar with the mouse, then the line pressed', 'Brokerage', ago(6), async () => pickDate(6, 'mouse'), false],
    ['an entry moved by typing, then the line pressed', 'Brokerage', ago(8), async (iso) => typeDate(iso), true, true],
    // The calendar of an entry lands on the entry's own date.
    ['an entry moved in the calendar, then the line pressed', 'Brokerage', isoOf(dayOf(D1) - 9), async () => pickDate(9, 'mouse'), true],
  ];
  const keys = new Set();
  for (const [how, name, iso, choose, editing, typing = false] of cases) {
    if (editing) await editEntry(name, D1);
    else await openForm(name);
    traffic.length = 0;
    await choose(iso);
    const chosen = asked();
    const opened = await openLine();
    const all = asked();
    for (const a of rateAsks()) for (const k of new URL(a.url).searchParams.keys()) keys.add(k);
    if (typing) {
      // A typed date may settle on input or on blur; either way, typing
      // it and pressing the line, which blurs the field, asks once in all.
      check(
        `review 110: a date holding no recording, ${how}: typing it and opening the line asks for its prices exactly once`,
        opened && all.length === 1 && all[0] === iso,
        JSON.stringify({ iso, opened, chosen, all }),
      );
    } else {
      check(
        `review 110: a date holding no recording, ${how}: choosing it asks for its prices exactly once`,
        chosen.length === 1 && chosen[0] === iso,
        JSON.stringify({ iso, chosen }),
      );
      check(
        `review 110: a date holding no recording, ${how}: pressing the folded line opens it and asks nothing more`,
        opened && all.length === chosen.length,
        JSON.stringify({ iso, opened, chosen, all }),
      );
    }
    await closeDialogs();
  }
  // A day corrected in place, digit by digit, as a person types it: the
  // field holds 5 March of last year, its day is selected, and 2 then 5
  // are typed, so 25 March is chosen.
  {
    const year = Number(T.slice(0, 4)) - 1;
    const base = `${year}-03-05`;
    const iso = `${year}-03-25`;
    await openForm('Brokerage');
    await typeDate(base);
    await rec.key('Tab');
    await quiet();
    traffic.length = 0;
    await realClick('#snapshot-date');
    await rec.call(() => {
      const input = document.querySelector('#snapshot-date');
      const day = [...input.value.matchAll(/[0-9]+/g)].find((m) => m[0] === '05');
      input.setSelectionRange(day.index, day.index + 2);
    });
    for (const digit of ['2', '5']) {
      await rec.send('Input.insertText', { text: digit });
      await quiet();
    }
    const opened = await openLine();
    const all = asked();
    check(
      'review 110: a date holding no recording, its day corrected digit by digit: choosing it and opening the line asks for its prices exactly once',
      opened && all.length === 1 && all[0] === iso,
      JSON.stringify({ iso, opened, all }),
    );
    await closeDialogs();
  }
  // A date typed without its leading zeros, focus still in the field,
  // and Save pressed: the date is accepted as typed (design-system.md,
  // Date field), its prices asked for once, and the figure saved there.
  {
    const iso = `${Number(T.slice(0, 4)) - 1}-04-07`;
    const loose = (await format('date', iso)).replace(/(^|[^0-9])0+(?=[0-9])/g, '$1');
    await openForm('Brokerage');
    traffic.length = 0;
    await realClick('#snapshot-date');
    await rec.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] });
    await rec.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await rec.send('Input.insertText', { text: loose });
    await quiet();
    await rec.call((v) => {
      const input = document.querySelector('#snapshot-value');
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, '777');
    const folded = await ev("(f => f && f.innerText)(document.querySelector('.dialog .prices-fold'))");
    const named = [await format('dayMonth', iso), await format('longDate', iso)].some((d) => folded.includes(`Prices for ${d} will be recorded with this`));
    check(
      'review 95: a date typed without leading zeros is named on the folded prices line before the field is left',
      named,
      JSON.stringify({ loose, folded }),
    );
    await realClick('.dialog button', 'Save');
    const closed = await rec.holds("!document.querySelector('#snapshot-value')", { label: 'the form to close' });
    await quiet();
    const left = closed ? null : await ev("(() => { const d = document.querySelector('.dialog'); return d && { text: d.innerText, date: document.querySelector('#snapshot-date').value }; })()");
    if (!closed) await closeDialogs();
    const all = asked();
    const saved = (await stored('snapshot')).filter((row) => row.payload && row.payload.date === iso && row.payload.value === '777');
    check(
      'review 110 and Date field: a date typed without leading zeros and saved with one press of Save is saved at that date, its prices asked for once',
      closed && all.length === 1 && all[0] === iso && saved.length === 1,
      JSON.stringify({ iso, loose, all, saved: saved.length, left }),
    );
  }
  // What the proxy learns is the date and the main currency
  // (spec/architecture.md, Threat model; rate-lookup.md), never a figure.
  check(
    'review security: a rate ask from the form carries only the date, the quote and a symbol',
    [...keys].every((k) => ['date', 'quote', 'symbol'].includes(k)),
    JSON.stringify([...keys]),
  );
}, { signsIn: false });
