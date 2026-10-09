// The hero's change follows the figures as shown, written from
// spec/features/net-worth-view.md (Hero figure, The change and
// acceptance criteria 37, 38 and 39) without reading how the screen is
// built or tested. A figure carries `+` or `−` only where it shows a
// digit other than zero, and an amount that reads zero has no arrow and
// the flat tone, as an exact zero has. A legend entry's change across a
// selection follows the same sign rule.
// Templates: dashboard.html. Modules: view-dashboard.js, decimal.js,
// format.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const FIRST = '2026-01-01';
const SECOND = '2026-01-02';

// The design system's tones, as the browser computes them.
const tones = () =>
  page.call(() => {
    const probe = document.createElement('span');
    document.body.append(probe);
    const tone = (token) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const found = { good: tone('--status-good'), critical: tone('--status-critical'), flat: tone('--ink-secondary') };
    probe.remove();
    return found;
  });

// The hero's change as a person reads it: its text with every run of
// white space as one space, whether an icon sits beside it, the icon's
// drawing, and the color it is written in.
const hero = () =>
  page.call(() => {
    const line = document.querySelector('.dashboard .hero-change');
    const delta = document.querySelector('.dashboard .hero-delta');
    const icon = line && line.querySelector('svg');
    return {
      text: delta ? delta.textContent.replace(/\s+/g, ' ').trim() : null,
      arrow: icon ? icon.innerHTML : null,
      color: delta ? getComputedStyle(delta).color : null,
    };
  });

await run(async () => {
  await vaultOwner();
  await holdToday(SECOND);
  const { Only } = await holdings([['Only', 'CHF']]);
  await setProfile({ locale: 'en-US' });
  const tone = await tones();

  // One holding with a figure on each of two days, rewritten in place
  // for each case, so All runs from the first day to today, the second.
  let version = 0;
  const ids = {};
  const between = async (earlier, later) => {
    version += 1;
    await plant([[FIRST, earlier], [SECOND, later]].map(([date, value]) => ({
      type: 'snapshot', accountId: Only, recordId: ids[date], version, payload: { date, value, note: null },
    }))).then(([a, b]) => { ids[FIRST] = a; ids[SECOND] = b; });
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.dashboard .hero-amount')", { label: 'the dashboard' });
    await page.call(() => [...document.querySelectorAll('.range-buttons button')].find((b) => b.textContent.trim() === 'All').click());
    await page.frames();
    return hero();
  };

  const rise = await between('2000', '2001');
  check('net-worth-view: criterion 39, 2000 to 2001 reads CHF +1 · 0.0%', rise.text === 'CHF +1 · 0.0%', JSON.stringify(rise));
  check('net-worth-view: criterion 39, a rise of 1 has an arrow and the good tone', rise.arrow !== null && rise.color === tone.good,
    JSON.stringify({ rise, tone }));

  const fall = await between('10000', '9997');
  check('net-worth-view: criterion 39, 10000 to 9997 reads CHF −3 · 0.0%, with no minus on the zero percentage',
    fall.text === 'CHF −3 · 0.0%', JSON.stringify(fall));
  check('net-worth-view: criterion 39, a fall of 3 has an arrow other than the rising one and the critical tone',
    fall.arrow !== null && fall.arrow !== rise.arrow && fall.color === tone.critical, JSON.stringify({ fall, rise, tone }));

  for (const [later, how] of [['9999.6', 'a fall'], ['10000.4', 'a rise'], ['10000', 'no move']]) {
    const flat = await between('10000', later);
    check(`net-worth-view: criterion 39, 10000 to ${later} reads CHF 0 · 0.0%, ${how} that reads zero carrying no sign`,
      flat.text === 'CHF 0 · 0.0%', JSON.stringify(flat));
    check(`net-worth-view: criterion 39, 10000 to ${later} has no arrow and the flat tone`,
      flat.arrow === null && flat.color === tone.flat, JSON.stringify({ flat, tone }));
  }

  // An amount that reads zero beside a percentage that does not: the
  // percentage keeps its sign, and the amount still rules the arrow and
  // the tone.
  const tiny = await between('0.40', '0.80');
  check('net-worth-view: 0.40 to 0.80 reads CHF 0 · +100.0%, each figure signed only where it shows a digit other than zero',
    tiny.text === 'CHF 0 · +100.0%', JSON.stringify(tiny));
  check('net-worth-view: 0.40 to 0.80 has no arrow and the flat tone, since its amount reads zero',
    tiny.arrow === null && tiny.color === tone.flat, JSON.stringify({ tiny, tone }));

  const debt = await between('-1000', '-500');
  check('net-worth-view: criterion 39, −1000 to −500 reads +50.0%, a rise, by the earlier figure\'s magnitude',
    debt.text === 'CHF +500 · +50.0%' && debt.color === tone.good && debt.arrow === rise.arrow, JSON.stringify(debt));

  const fromZero = await between('0', '500');
  check('net-worth-view: criterion 39, 0 to 500 shows the amount with no percentage',
    fromZero.text === 'CHF +500' && fromZero.arrow === rise.arrow && fromZero.color === tone.good, JSON.stringify(fromZero));
  const zeroToZero = await between('0', '0.4');
  check('net-worth-view: 0 to 0.4 reads CHF 0 alone, with no arrow and the flat tone',
    zeroToZero.text === 'CHF 0' && zeroToZero.arrow === null && zeroToZero.color === tone.flat, JSON.stringify(zeroToZero));

  const up = await between('2000', '2005');
  const down = await between('2000', '1995');
  check('net-worth-view: criterion 38, 2000 to 2005 reads +0.2% and 2000 to 1995 reads −0.2%, rounding half-even',
    up.text === 'CHF +5 · +0.2%' && down.text === 'CHF −5 · −0.2%', JSON.stringify({ up, down }));

  // Criterion 37, under de-DE with a period.
  await setProfile({ locale: 'de-DE', groupSeparator: 'period' });
  const large = await between('1000', '1368946');
  check('net-worth-view: criterion 37, 1000 to 1368946 under de-DE with a period gives +1.367.946 and +136.794,6%',
    /(^|\s)\+1\.367\.946(\s|$)/.test(large.text) && /(^|\s)\+136\.794,6\s?%/.test(large.text), JSON.stringify(large));
  await setProfile({ locale: 'en-US', groupSeparator: 'locale' });

  // A selection across both days, under a dimension: each band's change
  // in the legend carries a sign only where it shows a digit other than
  // zero, and so does the hero's.
  const others = await holdings([['Rise', 'CHF', { side: 'r' }], ['Dip', 'CHF', { side: 'd' }], ['Drop', 'CHF', { side: 'x' }]]);
  await setProfile({
    dimensions: [{ id: 'side', label: 'Side', values: [{ id: 'r', label: 'Rising' }, { id: 'd', label: 'Dipping' }, { id: 'x', label: 'Dropping' }] }],
  });
  await plant([
    ['Rise', FIRST, '1000'], ['Rise', SECOND, '1000.4'],
    ['Dip', FIRST, '500'], ['Dip', SECOND, '499.7'],
    ['Drop', FIRST, '200'], ['Drop', SECOND, '197'],
  ].map(([name, date, value]) => ({ type: 'snapshot', accountId: others[name], payload: { date, value, note: null } })));
  await between('3000', '3000.2');
  await page.call(() => {
    const s = document.querySelector('.chart-card select');
    s.value = 'side';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.frames();
  const plot = await page.call(() => {
    const svg = document.querySelector('svg.trend');
    const box = svg.getBoundingClientRect();
    const zero = svg.querySelector('.zero-line');
    return { left: box.left, top: box.top, scale: box.width / svg.viewBox.baseVal.width, x0: Number(zero.getAttribute('x1')), x1: Number(zero.getAttribute('x2')) };
  });
  const pointAt = (type, x) =>
    page.call((name, clientX, clientY) => {
      document.querySelector('svg.trend').dispatchEvent(new PointerEvent(name, { clientX, clientY, button: 0, bubbles: true }));
    }, type, plot.left + x * plot.scale, plot.top + 40);
  await pointAt('pointerdown', plot.x0);
  await pointAt('pointermove', plot.x1);
  await pointAt('pointerup', plot.x1);
  await page.frames();
  await page.waitUntil("document.querySelectorAll('.legend-delta').length > 0", { label: 'a selected span' });
  const legend = Object.fromEntries(await page.call(() =>
    [...document.querySelectorAll('.legend-entry')].map((e) => [
      e.querySelector('.legend-name').textContent, e.querySelector('.legend-delta')?.textContent.replace(/\s+/g, ' ').trim(),
    ])));
  const digits = (text) => (text || '').replace(/[^0-9+−-]/g, '');
  check('net-worth-view: across a selection, a band that rose by 0.4 reads 0 with no sign in the legend',
    digits(legend.Rising) === '0', JSON.stringify(legend));
  check('net-worth-view: across a selection, a band that fell by 0.3 reads 0 with no sign in the legend',
    digits(legend.Dipping) === '0', JSON.stringify(legend));
  check('net-worth-view: across a selection, a band that fell by 3 reads −3 in the legend',
    digits(legend.Dropping) === '−3', JSON.stringify(legend));
  check('net-worth-view: across a selection, an unassigned band that rose by 0.2 reads 0 with no sign in the legend',
    digits(legend.Unassigned) === '0', JSON.stringify(legend));
  const selected = await hero();
  check('net-worth-view: across a selection, the hero\'s change of −2.7 reads CHF −3 · −0.1% with the falling arrow',
    selected.text === 'CHF −3 · −0.1%' && selected.arrow === fall.arrow && selected.color === tone.critical, JSON.stringify(selected));
}, { signsIn: false });
