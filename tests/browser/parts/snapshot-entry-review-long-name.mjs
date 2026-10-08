// Reviewer's checks of a holding name with no break in it in the
// messages of Snapshot entry, written from spec/features/record-snapshot.md
// (Snapshot entry, States; criteria 87, 88 and 108) and app-shell.md (On
// a phone), without reading how the form is built. At 320px and 375px,
// measured on the boxes the browser draws: the message that the holding
// was archived or deleted in another window, on a new figure and on a
// move, wraps the name inside the Dialog and pans nothing sideways, and
// so does the notice the form leaves when it closes with a figure typed.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

// Far wider than the Dialog at any phone width, with no point a line may
// break at. Each case takes a holding of its own, so a letter tells them
// apart.
const LONG = 'UnterschleissheimerstrassenverkehrsgesellschaftsbeteiligungsanteilABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const WIDTHS = [320, 375];
const CASES = ['archived', 'deleted', 'moved', 'left'];

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, D1, ev, quiet, set, press, go, format, model, plantHere, reread, viewport, home } = r;

  const name = (px, kind) => `${LONG}${kind.toUpperCase()}${px}`;
  const holdings = WIDTHS.flatMap((px) => CASES.map((kind) => name(px, kind)));
  const ids = await plantHere(holdings.map((n, i) => ({
    type: 'account',
    payload: { name: n, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: `2020-01-03T00:00:${String(i).padStart(2, '0')}Z` },
  })));
  const idOf = Object.fromEntries(holdings.map((n, i) => [n, ids[i]]));
  // An entry at D1 on every holding, for the move to start from.
  await plantHere(holdings.map((n) => ({ type: 'snapshot', accountId: idOf[n], payload: { date: D1, value: '10', note: null } })));
  await reread();

  const holdingOf = (accountId) =>
    model(({ v }, at) => { const h = v.holdings.get(at); return h ? { version: h.version, payload: h.payload } : null; }, accountId);
  // What another window's archive leaves on the server: the zero at the
  // date, then the account record with `archivedAt` at it.
  const archiveElsewhere = async (holding, date) => {
    const h = await holdingOf(idOf[holding]);
    await plantHere([
      { type: 'snapshot', accountId: idOf[holding], payload: { date, value: '0', note: null } },
      { type: 'account', recordId: idOf[holding], version: h.version + 1, payload: { ...h.payload, archivedAt: date } },
    ]);
  };
  const purgeElsewhere = (holding) =>
    r.unwatched(() => rec.call(async (at) => (await import('/static/js/api.js')).del(`/api/accounts/${at}?mode=purge`), idOf[holding]));
  const openForm = async (holding) => {
    await go(`#/holding/${idOf[holding]}`);
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  };
  const editEntry = async (holding, iso) => {
    await go(`#/holding/${idOf[holding]}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the entry at ${iso}` });
    await quiet();
  };
  const save = async () => {
    await ev("[...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')].find(b => b.textContent === 'Save').click()");
    await quiet();
  };
  const closeDialogs = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
  };

  // Where the message naming `holding` is drawn, inside `scope` (the
  // topmost Dialog, or the whole page): the name's line boxes, the box
  // that holds them, and everything on the page that pans sideways.
  const measure = (holding, scope) => rec.call((n, where) => {
    const html = document.documentElement;
    const shown = (x) => x.getClientRects().length > 0 && getComputedStyle(x).visibility !== 'hidden';
    const box = (x) => { const b = x.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    const pans = [];
    if (html.scrollWidth > html.clientWidth + 0.5) pans.push(`page ${html.scrollWidth} > ${html.clientWidth}`);
    for (const x of document.querySelectorAll('body *')) {
      if (shown(x) && ['auto', 'scroll'].includes(getComputedStyle(x).overflowX) && x.scrollWidth > x.clientWidth + 0.5) {
        pans.push(`${x.tagName.toLowerCase()}.${[...x.classList].join('.')} ${x.scrollWidth} > ${x.clientWidth}`);
      }
    }
    const root = where === 'dialog' ? [...document.querySelectorAll('.dialog')].filter(shown).pop() : document.body;
    if (!root) return JSON.stringify({ found: false, why: 'no Dialog', pans });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = null;
    // Only the message itself, never the name in a heading or a title:
    // the element holding the name holds the message's wording too.
    const wording = where === 'dialog' ? 'in another window' : 'not saved';
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t.textContent.includes(n) && shown(t.parentElement) && t.parentElement.textContent.includes(wording)) { text = t; break; }
    }
    if (!text) return JSON.stringify({ found: false, why: 'no message names the holding', pans, said: root.innerText.slice(0, 400) });
    const range = document.createRange();
    range.setStart(text, text.textContent.indexOf(n));
    range.setEnd(text, text.textContent.indexOf(n) + n.length);
    const rects = [...range.getClientRects()].filter((b) => b.width > 0);
    // The nearest box that clips or scrolls, else the Dialog or the page.
    let frame = text.parentElement;
    while (frame !== root && getComputedStyle(frame).overflowX === 'visible') frame = frame.parentElement;
    const line = text.parentElement;
    return JSON.stringify({
      found: true,
      width: html.clientWidth,
      pans,
      said: line.textContent.trim().slice(0, 40) + '...' + line.textContent.trim().slice(-40),
      lines: new Set(rects.map((b) => Math.round(b.top))).size,
      nameLeft: Math.min(...rects.map((b) => b.left)),
      nameRight: Math.max(...rects.map((b) => b.right)),
      message: box(line),
      frame: box(frame),
      root: box(root),
    });
  }, holding, scope).then(JSON.parse);

  const holds = (seen, what, where) => {
    check(`review 108: ${what} names the holding ${where}`, seen.found, JSON.stringify(seen));
    check(`review 108: nothing pans sideways with ${what} ${where}`, seen.pans.length === 0, seen.pans.join('; '));
    if (!seen.found) return;
    const inside = (b) => seen.nameLeft >= b.left - 0.5 && seen.nameRight <= b.right + 0.5;
    check(`review 108: the name wraps onto more than one line in ${what} ${where}`, seen.lines > 1, JSON.stringify(seen));
    check(`review 108: the name lies inside its message line in ${what} ${where}`, inside(seen.message), JSON.stringify(seen));
    check(`review 108: the name is never cut off by the box around ${what} ${where}`, inside(seen.frame), JSON.stringify(seen));
    check(`review 108: the name lies inside the ${seen.root.right - seen.root.left < seen.width - 1 ? 'Dialog' : 'page'} in ${what} ${where}`,
      inside(seen.root) && seen.root.left >= -0.5 && seen.root.right <= seen.width + 0.5, JSON.stringify(seen));
  };

  for (const px of WIDTHS) {
    await viewport(px);
    await home();
    const where = `at ${px}px`;

    // 87 and 108: a new figure on a holding archived in another window.
    const archived = name(px, 'archived');
    await openForm(archived);
    await set('#snapshot-value', '7');
    await archiveElsewhere(archived, T);
    await save();
    const said = await ev("[...document.querySelectorAll('.dialog')].map(d => d.innerText).join(' | ')");
    check(`review 87: the message says the long-named holding was archived in another window ${where}`,
      said.includes(`${archived} was archived in another window. Nothing was saved.`), said.slice(-200));
    holds(await measure(archived, 'dialog'), 'the archived-elsewhere message', where);
    await closeDialogs();

    // A holding deleted in another window.
    const deleted = name(px, 'deleted');
    await openForm(deleted);
    await set('#snapshot-value', '3');
    await purgeElsewhere(deleted);
    await save();
    holds(await measure(deleted, 'dialog'), 'the deleted-elsewhere message', where);
    await closeDialogs();

    // 88: a move onto an archive another window made since the form opened.
    const moved = name(px, 'moved');
    await editEntry(moved, D1);
    await set('#snapshot-date', await format('date', T));
    await quiet();
    await archiveElsewhere(moved, T);
    await save();
    const saidMove = await ev("[...document.querySelectorAll('.dialog')].map(d => d.innerText).join(' | ')");
    check(`review 88: the message says nothing was moved for the long-named holding ${where}`,
      saidMove.includes(`${moved} was archived in another window. Nothing was moved.`), saidMove.slice(-200));
    holds(await measure(moved, 'dialog'), 'the nothing-was-moved message', where);
    await closeDialogs();

    // The notice the form leaves when it closes with a figure typed, which
    // names the holding at the head of the screen it closes onto.
    const left = name(px, 'left');
    await openForm(left);
    await set('#snapshot-value', '5');
    await rec.key('Escape');
    await rec.frames();
    await quiet();
    holds(await measure(left, 'page'), 'the unsaved-changes notice', where);
  }
  await rec.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
