// The hero while no active holding is valued, written from
// spec/features/net-worth-view.md alone (What the client gets, The
// total; Hero figure; States; acceptance criteria 55, 75 and 77): the
// total, gross assets and gross liabilities each read a dash, never 0,
// with no change beneath them, and the hero follows neither hover nor
// keyboard. That holds with holdings and no values, with an archived
// valued holding beside active unvalued ones, and with every holding
// archived, where the chart still fills its tooltip. A side with no
// holdings beside valued ones reads 0, and the shown parts add up to
// the total.
// Templates: dashboard.html. Modules: view-dashboard.js, model.js,
// format.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const TODAY = '2026-06-30';
const DASH = '—';

// The hero as shown: the total under "Net worth", each part under its
// label, the change and the date line, and New recording.
const hero = () =>
  page.call(() => {
    const root = document.querySelector('.dashboard .hero');
    if (!root) return null;
    const labelled = (name) => {
      const label = [...root.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === name);
      return label ? label.parentElement.textContent.replace(name, '').trim() : null;
    };
    const at = root.querySelector('.hero-at');
    return {
      total: root.querySelector('.hero-figure')?.textContent.trim() ?? null,
      assets: labelled('Assets'),
      liabilities: labelled('Liabilities'),
      change: root.querySelector('.hero-change')?.textContent.trim() ?? null,
      date: at && !at.hidden ? at.textContent.trim() : '',
      newRecording: [...root.querySelectorAll('button')].some((b) => b.textContent.trim() === 'New recording'),
      chart: Boolean(document.querySelector('.chart-frame svg.trend')),
    };
  });
const dashed = (h) => h && h.total === DASH && h.assets === DASH && h.liabilities === DASH;
// A figure as shown under en-US in whole units, the currency code and
// group commas dropped; `null` for a dash or anything else.
const amount = (text) => {
  const match = /^([−-]?)([0-9]+)$/.exec((text || '').replace(/[A-Z]{3}|[,\s]/g, ''));
  if (!match) return null;
  return match[1] ? -BigInt(match[2]) : BigInt(match[2]);
};

// The pointer over the middle of the plot, then the readout and the hero.
const hover = async () => {
  const box = await page.call(() => {
    const svg = document.querySelector('.chart-frame svg.trend');
    svg.scrollIntoView({ block: 'center' });
    const b = svg.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await page.frames();
  return {
    readout: await page.eval("document.querySelector('.chart-readout .readout-date')?.textContent || ''"),
    hero: await hero(),
  };
};
// Focus on the chart, `keys` pressed, then the readout and the hero.
const keyed = async (keys) => {
  const readout = await page.call((list) => {
    const chart = document.querySelector('.chart-frame svg.trend');
    chart.focus();
    for (const key of list) chart.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    return document.querySelector('.chart-readout .readout-date')?.textContent || '';
  }, keys);
  const seen = { readout, hero: await hero() };
  await page.eval("document.querySelector('.chart-frame svg.trend').blur()");
  return seen;
};
const home = async () => {
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard .hero')", { label: 'the dashboard hero' });
  await page.frames();
};
const archive = (name, date) =>
  page.call(async (wanted, day) => {
    const v = (await import('/static/js/session.js')).currentVault();
    const writes = await import('/static/js/writes.js');
    const holding = [...v.holdings.values()].find((h) => h.payload.name === wanted);
    return (await writes.archiveHolding(v, holding, day)).status;
  }, name, date);

await run(async () => {
  await vaultOwner();
  await holdToday(TODAY);
  await setProfile({ locale: 'en-US' });
  await holdings([['Cash', 'CHF'], ['Loan', 'CHF']]);

  // Criterion 55 and Empty, holdings but no snapshots.
  await home();
  const empty = await hero();
  check('net-worth-view 55: with holdings and no values the total, gross assets and gross liabilities read a dash',
    dashed(empty), JSON.stringify(empty));
  check('net-worth-view 55: with holdings and no values there is no change and no chart, and New recording stays',
    empty && empty.change === null && !empty.chart && empty.newRecording, JSON.stringify(empty));
  const listed = await page.eval("document.querySelector('.dashboard').innerText");
  check('net-worth-view 55: each active holding with no snapshot is listed under Not yet valued',
    /Not yet valued/i.test(listed) && listed.includes('Cash') && listed.includes('Loan'), listed);

  // Hero figure: no active holding valued, an archived one valued with
  // a history to draw.
  const { Old } = await holdings([['Old', 'CHF']]);
  await plant([
    { type: 'snapshot', accountId: Old, payload: { date: '2026-01-15', value: '1000', note: null } },
    { type: 'snapshot', accountId: Old, payload: { date: '2026-03-15', value: '1500', note: null } },
  ]);
  await home();
  const oldArchived = await archive('Old', '2026-04-01');
  await home();
  const besideArchived = await hero();
  check('net-worth-view Hero figure: with only an archived holding valued, the total and both sides read a dash, with no change',
    oldArchived === 'archived' && dashed(besideArchived) && besideArchived.change === null, JSON.stringify({ oldArchived, besideArchived }));
  if (besideArchived && besideArchived.chart) {
    const pointed = await hover();
    check('net-worth-view Hero figure: with no active holding valued, hovering the chart fills its tooltip and leaves the hero a dash with no date',
      pointed.readout.trim() !== '' && dashed(pointed.hero) && pointed.hero.date === '' && pointed.hero.change === null, JSON.stringify(pointed));
  }

  // Criterion 77 and All holdings archived.
  const statuses = [await archive('Cash', '2026-05-01'), await archive('Loan', '2026-05-01')];
  await home();
  const archived = await hero();
  check('net-worth-view 77: with every holding archived the total, gross assets and gross liabilities read a dash with no change',
    statuses.every((s) => s === 'archived') && dashed(archived) && archived.change === null, JSON.stringify({ statuses, archived }));
  check('net-worth-view 77: with every holding archived the history still renders', archived && archived.chart, JSON.stringify(archived));
  if (archived && archived.chart) {
    const pointed = await hover();
    check('net-worth-view 77: hovering the chart fills its tooltip',
      pointed.readout.trim() !== '', JSON.stringify(pointed));
    check('net-worth-view 77: hovering the chart leaves the hero a dash with no date and no change',
      dashed(pointed.hero) && pointed.hero.date === '' && pointed.hero.change === null, JSON.stringify(pointed));
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    await page.frames();
    const left = await hero();
    check('net-worth-view 77: the pointer leaving the chart leaves the hero a dash with no date',
      dashed(left) && left.date === '', JSON.stringify(left));
    // A span dragged across the plot, the pointer held down.
    const plot = await page.call(() => {
      const b = document.querySelector('.chart-frame svg.trend').getBoundingClientRect();
      return { y: b.top + b.height / 2, from: b.left + b.width * 0.3, to: b.left + b.width * 0.7 };
    });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: plot.from, y: plot.y, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: plot.to, y: plot.y, button: 'left', buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plot.to, y: plot.y, button: 'left', buttons: 0, clickCount: 1 });
    await page.frames();
    const dragged = await hero();
    check('net-worth-view 77: a span dragged across the chart leaves the hero a dash with no change and no date',
      dashed(dragged) && dragged.change === null && dragged.date === '', JSON.stringify(dragged));
    for (const keys of [['Home'], ['End'], ['Home', 'ArrowRight', 'ArrowRight']]) {
      const read = await keyed(keys);
      check(`net-worth-view Hero figure: with every holding archived, ${keys.join(', ')} on the chart fills the readout and leaves the hero a dash with no date`,
        read.readout.trim() !== '' && dashed(read.hero) && read.hero.date === '' && read.hero.change === null, JSON.stringify(read));
    }
  }

  // Hero figure: a side with no holdings beside valued ones reads 0, and
  // the two sides add up to the total as shown (criteria 66 and 75).
  const later = await holdings([['Debt', 'CHF'], ['Fund', 'CHF']]);
  await plant([{ type: 'snapshot', accountId: later.Debt, payload: { date: '2026-06-01', value: '-200.40', note: null } }]);
  await home();
  const onlyDebt = await hero();
  check('net-worth-view Hero figure: with only a liability valued, gross assets read 0, never a dash',
    onlyDebt && amount(onlyDebt.assets) === 0n && amount(onlyDebt.liabilities) !== null && amount(onlyDebt.total) === -200n,
    JSON.stringify(onlyDebt));
  check('net-worth-view 75: with only a liability valued, assets and liabilities add up to the total as shown',
    onlyDebt && amount(onlyDebt.assets) !== null && amount(onlyDebt.liabilities) !== null &&
      amount(onlyDebt.assets) + amount(onlyDebt.liabilities) === amount(onlyDebt.total),
    JSON.stringify(onlyDebt));

  await plant([{ type: 'snapshot', accountId: later.Fund, payload: { date: '2026-06-01', value: '500.40', note: null } }]);
  await plant([{ type: 'snapshot', accountId: later.Debt, payload: { date: '2026-06-02', value: '0', note: null } }]);
  await home();
  const onlyFund = await hero();
  check('net-worth-view Hero figure: with only an asset valued beside a liability at zero, gross liabilities read 0, never a dash',
    onlyFund && amount(onlyFund.liabilities) === 0n && amount(onlyFund.assets) === 500n && amount(onlyFund.total) === 500n,
    JSON.stringify(onlyFund));
  check('net-worth-view Hero figure: with an active holding valued, the hero follows the chart again',
    onlyFund && onlyFund.chart && (await keyed(['Home'])).hero.date !== '' && (await hover()).hero.date !== '', JSON.stringify(onlyFund));
}, { signsIn: false });
