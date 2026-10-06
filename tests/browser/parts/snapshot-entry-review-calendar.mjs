// Reviewer's checks of the Date field's calendar in Snapshot entry
// (spec/features/record-snapshot.md, criterion 101), the field's
// calendar rules (spec/design-system.md, Components, Date field) and
// Escape over a confirmation on this form (app-shell.md, criterion 17),
// written from the spec alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, D1, id, traffic, writesSent, ev, quiet, set, realClick, go, format } = r;

  const size = (width, height) =>
    rec.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const dialogs = () => ev("document.querySelectorAll('.dialog').length");
  const escape = async () => {
    await rec.key('Escape');
    await rec.frames();
    await quiet();
  };
  const openForm = async (name) => {
    await go(`#/holding/${id[name]}`);
    // A real click, so the opener holds focus for the Dialog to return it.
    await realClick('.form-actions button', 'Record a value');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the form for ${name}` });
    await quiet();
  };

  // The button beside the date input: the first button in the nearest
  // ancestor of the input that holds one and is not the whole form.
  const findToggle = () => ev(`(() => {
    const input = document.querySelector('#snapshot-date');
    for (let n = input.parentElement; n; n = n.parentElement) {
      if (n.querySelector('#snapshot-value')) return false;
      const b = n.querySelector('button');
      if (b) { window.__toggle = b; return true; }
    }
    return false;
  })()`);
  // The calendar: the widest ancestor of its grid that does not hold the
  // date input itself.
  const CALENDAR = `(() => {
    const dialog = [...document.querySelectorAll('.dialog')].pop();
    const input = document.querySelector('#snapshot-date');
    const day = dialog && dialog.querySelector('[role=grid], .date-day');
    if (!day) return null;
    let root = day;
    while (root.parentElement && !root.parentElement.contains(input)) root = root.parentElement;
    return root.offsetParent === null && getComputedStyle(root).position !== 'fixed' ? null : root;
  })()`;
  const calendarOpen = () => ev(`Boolean(${CALENDAR})`);

  // Where the calendar and its Close lie, each edge scrolled into view
  // and hit-tested, so a part clipped by the dialog or drawn under
  // something else fails.
  const geometry = () => ev(`(() => {
    const cal = ${CALENDAR};
    const dialog = [...document.querySelectorAll('.dialog')].pop();
    if (!cal) return { open: false };
    const close = [...cal.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close');
    const inside = (node) => {
      const r = node.getBoundingClientRect();
      const d = dialog.getBoundingClientRect();
      return r.left >= d.left - 0.5 && r.right <= d.right + 0.5 && r.top >= d.top - 0.5 && r.bottom <= d.bottom + 0.5 &&
        r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5;
    };
    const hits = (node, points) => points.every(([x, y]) => {
      const h = document.elementFromPoint(x, y);
      return Boolean(h) && node.contains(h);
    });
    const edge = (node, block) => {
      node.scrollIntoView({ block, inline: 'nearest' });
      const r = node.getBoundingClientRect();
      const d = dialog.getBoundingClientRect();
      const y = block === 'start' ? r.top + 8 : r.bottom - 8;
      return {
        hit: hits(node, [[r.left + 8, y], [r.right - 8, y]]),
        within: r.left >= d.left - 0.5 && r.right <= d.right + 0.5 &&
          (block === 'start' ? r.top >= d.top - 0.5 : r.bottom <= d.bottom + 0.5),
      };
    };
    const top = edge(cal, 'start');
    const bottom = edge(cal, 'end');
    let closeShown = null;
    if (close) {
      close.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const c = close.getBoundingClientRect();
      closeShown = {
        inside: inside(close),
        hit: hits(close, [[c.left + 2, c.top + 2], [c.right - 2, c.top + 2], [c.left + 2, c.bottom - 2], [c.right - 2, c.bottom - 2], [c.left + c.width / 2, c.top + c.height / 2]]),
      };
    }
    const shadows = [cal, ...cal.querySelectorAll('*')]
      .map((n) => getComputedStyle(n))
      .filter((s) => s.boxShadow !== 'none' || s.filter.includes('drop-shadow'))
      .map((s) => s.boxShadow + ' ' + s.filter);
    const s = getComputedStyle(cal);
    const hairline = ['Top', 'Right', 'Bottom', 'Left'].every((side) => s['border' + side + 'Width'] === '1px' && s['border' + side + 'Style'] === 'solid');
    // Nothing else in the dialog lies under or over the calendar.
    const cr = cal.getBoundingClientRect();
    const overlapped = [...dialog.querySelectorAll('input, select, textarea, button, label, summary, a')]
      .filter((n) => !cal.contains(n) && n.getClientRects().length)
      .filter((n) => {
        const o = n.getBoundingClientRect();
        return o.width > 0 && o.height > 0 && o.left < cr.right - 0.5 && o.right > cr.left + 0.5 && o.top < cr.bottom - 0.5 && o.bottom > cr.top + 0.5;
      })
      .map((n) => n.id || n.textContent.trim().slice(0, 30) || n.tagName);
    const field = document.querySelector('#snapshot-date').getBoundingClientRect();
    return {
      open: true,
      top, bottom, closeShown, shadows, hairline, overlapped,
      belowField: cr.top >= field.bottom - 0.5,
    };
  })()`);
  const focusInGrid = () => ev(`(() => {
    const a = document.activeElement;
    const cal = ${CALENDAR};
    return Boolean(cal && a && cal.contains(a) && (a.closest('[role=grid]') || a.classList.contains('date-day')));
  })()`);
  const focusOnToggle = () => ev('document.activeElement === window.__toggle');

  const SIZES = [
    ['at desktop width', 1280, 900],
    ['at phone width', 375, 740],
    ['in a short window', 1280, 420],
  ];

  for (const [where, width, height] of SIZES) {
    await size(width, height);
    await openForm('Savings');
    const found = await findToggle();
    const before = await ev("document.querySelector('#snapshot-date').value");

    // Desktop opens from the keyboard, the rest by a real click.
    if (width === 1280 && height === 900) {
      await ev('window.__toggle.focus()');
      await rec.key('Enter');
    } else {
      const at = await ev(`(() => {
        window.__toggle.scrollIntoView({ block: 'center' });
        const b = window.__toggle.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      })()`);
      await rec.mouseClick(at.x, at.y);
    }
    await rec.frames();
    await quiet();
    const focused = await focusInGrid();
    const g = await geometry();
    check(
      `review 101 ${where}: the calendar opens and moves focus into its grid`,
      found && g.open && focused,
      JSON.stringify({ found, open: g.open, active: await ev('document.activeElement && document.activeElement.outerHTML.slice(0, 120)') }),
    );
    check(
      `review 101 ${where}: the opened calendar lies inside the Dialog, every edge visible and uncovered`,
      g.open && g.top.hit && g.top.within && g.bottom.hit && g.bottom.within,
      JSON.stringify(g),
    );
    check(
      `review 101 ${where}: the calendar's Close lies wholly inside the Dialog and nothing covers or cuts it`,
      g.open && g.closeShown && g.closeShown.inside && g.closeShown.hit,
      JSON.stringify(g.closeShown),
    );
    check(
      `review 101 ${where}: the calendar and everything in it cast no shadow`,
      g.open && g.shadows.length === 0,
      JSON.stringify(g.shadows),
    );
    check(
      `review design-system ${where}: the calendar carries a hairline, opens below the field and lies over no other control`,
      g.open && g.hairline && g.belowField && g.overlapped.length === 0,
      JSON.stringify({ hairline: g.hairline, belowField: g.belowField, overlapped: g.overlapped }),
    );

    // Arrow keys move focus within the grid, and Escape from there
    // closes the calendar alone.
    await rec.key('ArrowLeft');
    await rec.frames();
    const stillInGrid = await focusInGrid();
    traffic.length = 0;
    await escape();
    const first = {
      calendar: await calendarOpen(),
      dialogs: await dialogs(),
      onToggle: await focusOnToggle(),
      value: await ev("document.querySelector('#snapshot-date').value"),
    };
    check(
      `review 101 ${where}: one Escape from the grid closes only the calendar, with focus on its button`,
      stillInGrid && !first.calendar && first.dialogs === 1 && first.onToggle,
      JSON.stringify({ stillInGrid, ...first }),
    );
    check(
      `review design-system ${where}: Escape picks nothing, leaving the typed date as it was`,
      first.value === before,
      JSON.stringify({ before, after: first.value }),
    );
    await escape();
    const second = {
      dialogs: await dialogs(),
      onOpener: await ev("document.activeElement && document.activeElement.textContent.trim() === 'Record a value'"),
    };
    check(
      `review 101 ${where}: a second Escape closes the Dialog, focus back on what opened it, and nothing is written`,
      second.dialogs === 0 && second.onOpener && writesSent().length === 0,
      JSON.stringify({ ...second, writes: writesSent().map((t) => t.method) }),
    );
    while (await dialogs()) await escape();
  }
  await size(1280, 900);

  // ---- Escape from another control of the calendar, and its Close -----

  await openForm('Savings');
  await findToggle();
  await ev('window.__toggle.click()');
  await rec.frames();
  await quiet();
  const otherControl = await ev(`(() => {
    const cal = ${CALENDAR};
    if (!cal) return false;
    const b = [...cal.querySelectorAll('button')].find((n) => !n.closest('[role=grid]') && !n.classList.contains('date-day') && n.textContent.trim() !== 'Close' && !n.disabled);
    if (!b) return false;
    b.focus();
    return document.activeElement === b;
  })()`);
  await escape();
  const fromNav = { calendar: await calendarOpen(), dialogs: await dialogs(), onToggle: await focusOnToggle() };
  check(
    'review design-system: Escape from the calendar\'s month buttons closes the calendar alone, focus on its button',
    otherControl && !fromNav.calendar && fromNav.dialogs === 1 && fromNav.onToggle,
    JSON.stringify({ otherControl, ...fromNav }),
  );
  await ev('window.__toggle.click()');
  await rec.frames();
  await quiet();
  const at = await ev(`(() => {
    const cal = ${CALENDAR};
    const close = cal && [...cal.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close');
    if (!close) return null;
    close.scrollIntoView({ block: 'nearest' });
    const c = close.getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  })()`);
  if (at) await rec.mouseClick(at.x, at.y);
  await rec.frames();
  await quiet();
  check(
    'review 101: pressing the calendar\'s Close closes the calendar and leaves the Dialog open',
    at && !(await calendarOpen()) && (await dialogs()) === 1,
    JSON.stringify({ at, calendar: await calendarOpen(), dialogs: await dialogs() }),
  );
  while (await dialogs()) await escape();

  // ---- The grid refuses the future ---------------------------------

  await openForm('Savings');
  await findToggle();
  await ev('window.__toggle.click()');
  await rec.frames();
  await quiet();
  const tomorrow = ago(-1);
  const future = await ev(`(() => {
    const cal = ${CALENDAR};
    const cell = cal && cal.querySelector('[data-date="${tomorrow}"]');
    const next = cal && [...cal.querySelectorAll('[data-date]')].filter((n) => n.dataset.date > '${r.T}');
    return { cell: Boolean(cell), disabled: cell ? (cell.disabled || cell.getAttribute('aria-disabled') === 'true') : null,
      later: next ? next.filter((n) => !(n.disabled || n.getAttribute('aria-disabled') === 'true')).map((n) => n.dataset.date) : null };
  })()`);
  check(
    'review design-system: every day after today in the calendar is disabled',
    future.later !== null && future.later.length === 0 && (!future.cell || future.disabled),
    JSON.stringify(future),
  );
  while (await dialogs()) await escape();

  // ---- app-shell 17: Escape over the replace confirmation on this form --

  await openForm('Current account');
  await set('#snapshot-date', await format('date', D1));
  await set('#snapshot-value', '1234');
  await quiet();
  await ev("window.__save = [...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save'); window.__save.focus(); window.__save.click()");
  await quiet();
  const confirmUp = await dialogs();
  traffic.length = 0;
  await escape();
  const afterOne = {
    dialogs: await dialogs(),
    onSave: await ev('document.activeElement === window.__save'),
    form: await ev("Boolean(document.querySelector('#snapshot-value'))"),
  };
  check(
    'review app-shell 17: Escape over the replace confirmation closes it alone, focus back on Save',
    confirmUp === 2 && afterOne.dialogs === 1 && afterOne.form && afterOne.onSave,
    JSON.stringify({ confirmUp, ...afterOne }),
  );
  await escape();
  check(
    'review app-shell 17: a second Escape closes the form, and nothing is written',
    (await dialogs()) === 0 && writesSent().length === 0,
    JSON.stringify({ dialogs: await dialogs(), writes: writesSent().map((t) => t.method) }),
  );
}, { signsIn: false });
