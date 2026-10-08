// Reviewer's checks of a holding name with no space on Update values,
// written from spec/features/record-snapshot.md (Update values, Layout,
// a row, and At phone width; criterion 106) and net-worth-view.md (a
// holding's name wraps wherever it must), without reading how the sweep
// is built. Measured on the boxes the browser draws: the name wraps
// inside its own column, is shown whole inside its card, never runs
// under the field or the control, the rows' columns stay in line, and
// nothing pans sideways, on a new recording and a reopened one alike,
// and in the banner a row raises when its holding was archived in
// another window (Update values, States).
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

// The name from the issue: far wider than the name column at every
// width, with no point a line may break at.
const LONG = 'Unterschleissheimerstrassenverkehrsgesellschaftsbeteiligungsanteil_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// Never valued, so its row carries no figure to confirm.
const NEVER = `${LONG}_never`;
const WIDTHS = [320, 375, 601, 901, 1280];
// Widths that are a phone's and a desktop's under any reading of the
// phone breakpoint. 601px sits on the edge, so only the checks that
// hold at every width apply there.
const PHONE = 375;
const DESKTOP = 901;

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, D1, ago, go, plantHere, reread, home, sweepToday, viewport, stored, typeRow, pressRow } = r;
  const [id] = await plantHere([
    { type: 'account', payload: { name: LONG, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-02T00:00:00Z' } },
    { type: 'account', payload: { name: NEVER, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-02T00:00:01Z' } },
  ]);
  // Recorded at D1, so the reopened recording shows it with Save, and
  // later, so today's sweep shows it with its last figure and Confirm.
  await plantHere([
    { type: 'snapshot', accountId: id, payload: { date: D1, value: '1234567.89', note: null } },
    { type: 'snapshot', accountId: id, payload: { date: ago(60), value: '1234999.01', note: null } },
  ]);
  await reread();

  // Every row of the sweep, its card and its pieces, as drawn.
  const measure = () => rec.call((names) => {
    const html = document.documentElement;
    const width = html.clientWidth;
    const box = (n) => { const b = n.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; };
    const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const shown = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const pans = [];
    if (html.scrollWidth > html.clientWidth + 0.5) pans.push(`page ${html.scrollWidth} > ${html.clientWidth}`);
    for (const n of document.querySelectorAll('body *')) {
      if (!shown(n)) continue;
      if (['auto', 'scroll'].includes(getComputedStyle(n).overflowX) && n.scrollWidth > n.clientWidth + 0.5) {
        pans.push(`${n.tagName.toLowerCase()}.${[...n.classList].join('.')} ${n.scrollWidth} > ${n.clientWidth}`);
      }
    }
    const rows = [...document.querySelectorAll('.sweep-row')].map((row) => {
      const nameBox = row.querySelector('.holding-name');
      const field = row.querySelector('input');
      const control = row.querySelector(':scope > button');
      const card = row.closest('.sweep-rows');
      const s = getComputedStyle(row);
      const inner = box(row);
      inner.left += parseFloat(s.paddingLeft);
      inner.right -= parseFloat(s.paddingRight);
      const out = {
        name: nameBox.textContent,
        long: names.includes(nameBox.textContent),
        card: card ? box(card) : null,
        row: inner,
        field: field ? box(field) : null,
        control: control ? box(control) : null,
        controlText: control ? control.textContent.trim() : '',
        clipped: nameBox.scrollWidth > nameBox.clientWidth + 0.5 && getComputedStyle(nameBox).overflowX !== 'visible',
        ellipsis: getComputedStyle(nameBox).textOverflow === 'ellipsis',
        // Every piece of the row a reader sees: the name, its sentence and
        // age, the field, the figure beneath it and the control.
        outside: card
          ? [...row.querySelectorAll('*')].filter(shown).filter((n) => {
            const b = box(n);
            const c = box(card);
            return b.width > 0 && (b.left < c.left - 0.5 || b.right > c.right + 0.5);
          }).map((n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')}`)
          : [],
      };
      const range = document.createRange();
      range.selectNodeContents(nameBox);
      const rects = [...range.getClientRects()].filter((b) => b.width > 0);
      out.lines = new Set(rects.map((b) => Math.round(b.top))).size;
      out.nameLeft = Math.min(...rects.map((b) => b.left));
      out.nameRight = Math.max(...rects.map((b) => b.right));
      out.nameBottom = Math.max(...rects.map((b) => b.bottom));
      out.underField = Boolean(field) && rects.some((b) => meets(b, box(field)));
      out.underControl = Boolean(control) && rects.some((b) => meets(b, box(control)));
      return out;
    });
    return JSON.stringify({ width, pans, rows });
  }, [LONG, NEVER]).then(JSON.parse);

  const holds = (seen, where, px) => {
    check(`review 106: nothing pans sideways ${where}`, seen.pans.length === 0, seen.pans.join('; '));
    const longRows = seen.rows.filter((row) => row.long);
    check(`review 106: both long-named rows are on the sweep ${where}`, longRows.length === 2, JSON.stringify(seen.rows.map((row) => row.name)));
    for (const row of longRows) {
      const tag = `"${row.name.slice(-12)}"`;
      check(`review 106: the name ${tag} sits in a card ${where}`, row.card !== null, '');
      if (!row.card) continue;
      check(`review 106: the name ${tag} wraps onto more than one line ${where}`, row.lines > 1, JSON.stringify(row));
      check(`review 106: the name ${tag} is shown whole, never cut off ${where}`, !row.clipped && !row.ellipsis, JSON.stringify(row));
      check(`review 106: the name ${tag} lies inside its card ${where}`,
        row.nameLeft >= row.card.left - 0.5 && row.nameRight <= row.card.right + 0.5, JSON.stringify(row));
      check(`review 106: every piece of the row ${tag} lies inside its card ${where}`, row.outside.length === 0, row.outside.join('; '));
      check(`review layout: the name ${tag} never runs under the field ${where}`, !row.underField, JSON.stringify(row));
      check(`review layout: the name ${tag} never runs under the control ${where}`, !row.underControl, JSON.stringify(row));
    }
    const withControl = seen.rows.filter((row) => row.control && row.field);
    if (px >= DESKTOP) {
      // Three columns: the name left of the field, and every row's field
      // and control in line whatever its name or its control reads.
      for (const row of longRows) {
        check(`review layout: the name "${row.name.slice(-12)}" stays in the column left of the field ${where}`,
          row.field && row.nameRight <= row.field.left + 0.5, JSON.stringify(row));
      }
      const lefts = (pick) => new Set(withControl.map((row) => Math.round(pick(row).left)));
      check(`review layout: every row's field lines up ${where}`, lefts((row) => row.field).size === 1,
        JSON.stringify(withControl.map((row) => [row.name.slice(-12), Math.round(row.field.left)])));
      check(`review layout: every row's control lines up ${where}`, lefts((row) => row.control).size === 1,
        JSON.stringify(withControl.map((row) => [row.name.slice(-12), Math.round(row.control.left)])));
      check(`review layout: every row's control is 112px wide ${where}`,
        withControl.every((row) => Math.abs(row.control.width - 112) <= 1),
        JSON.stringify(withControl.map((row) => [row.name.slice(-12), row.control.width])));
    }
    if (px <= PHONE) {
      // One column: the name, then the field, then the control at full width.
      for (const row of longRows.filter((x) => x.field && x.control)) {
        const tag = `"${row.name.slice(-12)}"`;
        check(`review phone: the field sits beneath the name ${tag} ${where}`, row.field.top >= row.nameBottom - 0.5, JSON.stringify(row));
        check(`review phone: the control sits beneath the field ${tag} ${where}`, row.control.top >= row.field.bottom - 0.5, JSON.stringify(row));
        check(`review phone: the control fills the row's width ${tag} ${where}`,
          Math.abs(row.control.left - row.row.left) <= 1 && Math.abs(row.control.right - row.row.right) <= 1, JSON.stringify(row));
      }
    }
  };

  for (const px of WIDTHS) {
    await viewport(px);
    await home();
    await sweepToday();
    holds(await measure(), `on today's sweep at ${px}px`, px);
    await go(`#/sweep/${D1}`);
    const reopened = await measure();
    holds(reopened, `on the recording at ${D1} at ${px}px`, px);
    check(`review 106: the long-named row reads Save on the recording at ${D1} at ${px}px`,
      reopened.rows.some((row) => row.name === LONG && row.controlText === 'Save'), JSON.stringify(reopened.rows.map((row) => [row.name.slice(-12), row.controlText])));
  }
  // The banner a row raises when its holding was archived in another
  // window names the holding (Update values, States), so the name wraps
  // there too. Archived after the sweep is drawn, as another window would.
  const bannerAt = async (px) => {
    await viewport(px);
    await home();
    await sweepToday();
    const account = (await stored('account')).find((a) => a.recordId === id);
    await plantHere([
      { type: 'snapshot', accountId: id, payload: { date: T, value: '0', note: null } },
      { type: 'account', recordId: id, version: account.version + 1, payload: { ...account.payload, archivedAt: T } },
    ]);
    await typeRow(LONG, '1');
    await pressRow(LONG);
    const seen = await rec.call((name) => {
      const html = document.documentElement;
      const banner = [...document.querySelectorAll('.banner')].find((b) => b.textContent.includes(name));
      if (!banner) return JSON.stringify({ banner: false });
      const node = [...banner.querySelectorAll('*'), banner].find((n) => [...n.childNodes].some((t) => t.nodeType === 3 && t.textContent.includes(name)));
      const text = [...node.childNodes].find((t) => t.nodeType === 3 && t.textContent.includes(name));
      const range = document.createRange();
      range.setStart(text, text.textContent.indexOf(name));
      range.setEnd(text, text.textContent.indexOf(name) + name.length);
      const rects = [...range.getClientRects()].filter((b) => b.width > 0);
      const b = banner.getBoundingClientRect();
      return JSON.stringify({
        banner: true,
        width: html.clientWidth,
        scrollWidth: html.scrollWidth,
        bannerLeft: b.left,
        bannerRight: b.right,
        nameLeft: Math.min(...rects.map((r) => r.left)),
        nameRight: Math.max(...rects.map((r) => r.right)),
        lines: new Set(rects.map((r) => Math.round(r.top))).size,
      });
    }, LONG).then(JSON.parse);
    const where = `in the archived-elsewhere banner at ${px}px`;
    check(`review 106: the banner names the long-named holding ${where}`, seen.banner, JSON.stringify(seen));
    if (!seen.banner) return;
    check(`review 106: nothing pans sideways ${where}`, seen.scrollWidth <= seen.width, JSON.stringify(seen));
    check(`review 106: the name wraps onto more than one line ${where}`, seen.lines > 1, JSON.stringify(seen));
    check(`review 106: the name lies inside the banner ${where}`,
      seen.nameLeft >= seen.bannerLeft - 0.5 && seen.nameRight <= seen.bannerRight + 0.5, JSON.stringify(seen));
  };
  await bannerAt(375);
  await rec.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
