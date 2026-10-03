// The recording screens, driven in a second browser with a vault of its
// own (record-rate.md, record-snapshot.md and net-worth-view.md, through
// the sweep, the single-holding form, a recording's own screen and the
// dashboard). Every figure and date is the test's. The rate proxy is
// answered here rather than by a provider, so a proposal, No Content and
// an outage are each chosen, and every request the page sends is seen
// whole, headers and body included.
import { BASE, RECORDER_PASSWORD, Session, launch, mintInvite, problems, watch, watched } from './harness.mjs';

export async function startRecorder() {
  const recorder = await launch();
  const rec = await Session.connect(recorder.target);
  await rec.send('Page.enable');
  await rec.send('Runtime.enable');
  watched.push(await watch(rec));
  rec.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      problems.push(message.params.exceptionDetails.exception?.description || 'exception');
    }
  });

  const DAY = 86400000;
  const dayOf = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
  const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10);
  const T = new Date().toISOString().slice(0, 10);
  const ago = (days) => isoOf(dayOf(T) - days);
  const D1 = ago(200);
  const D2 = ago(100);
  const D5 = ago(30);
  const D6 = ago(20);
  const D7 = ago(25);
  const D8 = ago(26);
  const D9 = ago(27);
  const D10 = ago(10);
  const D11 = ago(40);

  // What the page's rate proxy answers: its figures, nothing, or an outage; or a held
  // answer, released by calling what `holdRates` returns.
  const proxy = { mode: 'answer', gate: null };
  const holdRates = () => {
    let release;
    proxy.gate = new Promise((resolve) => { release = resolve; });
    return () => { proxy.gate = null; release(); };
  };
  // What the proxy answers. Each date's figures differ from its
  // neighbors', so the two pricing modes and every stretch between
  // entries read differently.
  const proposalsFor = (date) => {
    const d = dayOf(date);
    const revised = proxy.mode === 'revised' ? 0.5 : 0;
    return {
      USD: { rate: (0.85 + (d % 7) / 100 + revised).toFixed(2), asOf: date },
      'XAU-ozt': { rate: String(2600 + (d % 50) + revised * 100), asOf: isoOf(d - 1) },
    };
  };
  const traffic = [];
  const faults = [];
  let muted = false;
  await rec.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
  rec.on(async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const entry = { method: request.method, url: request.url, headers: request.headers, body: request.postData || '' };
    if (!muted) traffic.push(entry);
    try {
      if (request.url.includes('/api/rates?')) {
        if (proxy.gate) await proxy.gate;
        if (proxy.mode === 'down') return await rec.send('Fetch.fulfillRequest', { requestId, responseCode: 503, body: '' });
        if (proxy.mode === 'none') return await rec.send('Fetch.fulfillRequest', { requestId, responseCode: 204, body: '' });
        const query = Object.fromEntries(new URL(request.url).searchParams);
        const body = JSON.stringify({ date: query.date, quote: query.quote, rates: proposalsFor(query.date) });
        return await rec.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(body).toString('base64'),
        });
      }
      for (const fault of faults) {
        const status = fault(entry);
        if (status) return await rec.send('Fetch.fulfillRequest', { requestId, responseCode: status, body: '' });
      }
      await rec.send('Fetch.continueRequest', { requestId });
    } catch {
      /* the page went away mid-request */
    }
  });
  const writesSent = () => traffic.filter((r) => r.method === 'PUT' || r.method === 'DELETE');
  const rateAsks = () => traffic.filter((r) => r.url.includes('/api/rates?'));
  const typeReads = (type) => traffic.filter((r) => r.method === 'GET' && r.url.endsWith(`/api/records?type=${type}`));
  // Runs what the page's own requests should not show up in `traffic` for.
  const unwatched = async (action) => {
    muted = true;
    try {
      return await action();
    } finally {
      muted = false;
    }
  };
  const bodyOf = (r) => (r.body ? JSON.parse(r.body) : null);

  const ev = (expression) => rec.eval(expression);
  const text = () => ev('document.body.innerText');
  // The page has finished what it was doing, its requests included.
  const quiet = () => rec.idle();
  const set = (selector, value, index = 0) =>
    ev(`(() => {
      const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      node.value = ${JSON.stringify(value)};
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  const press = async (label, scope = '') => {
    await ev(`[...document.querySelectorAll(${JSON.stringify(`${scope} button, ${scope} a`)})]
      .find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
    await quiet();
  };
  // What a person does, through the protocol. element.click() ignores
  // whatever is drawn over a control, so a control a popup covers passes
  // every check made with it. A real mouse event lands on whatever is
  // painted at the point, which is the only way to test "can be pressed".
  const centerOf = (selector, label = null) =>
    ev(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const node = ${label === null ? 'nodes[0]' : `nodes.find(n => n.textContent.trim() === ${JSON.stringify(label)})`};
      if (!node) return null;
      node.scrollIntoView({ block: 'center' });
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  const realClickAt = async ({ x, y }) => {
    await rec.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await rec.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await rec.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await quiet();
  };
  const realClick = async (selector, label = null) => {
    const at = await centerOf(selector, label);
    if (!at) throw new Error(`nothing to click for ${selector} ${label ?? ''}`);
    await realClickAt(at);
  };
  // The element painted at a control's own centre is that control (or
  // part of it), so nothing covers it.
  const uncovered = (selector, label = null) =>
    ev(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const node = ${label === null ? 'nodes[0]' : `nodes.find(n => n.textContent.trim() === ${JSON.stringify(label)})`};
      if (!node) return false;
      node.scrollIntoView({ block: 'center' });
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit) && node.contains(hit);
    })()`);
  const realKey = async (key, code, keyCode) => {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await rec.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode });
    }
    await quiet();
  };
  // The vault as the page's own crypto reads it back from the server,
  // each record with its bytes and its decrypted payload.
  const stored = async (type) => {
    await quiet();
    muted = true;
    try {
      return JSON.parse(await ev(`(async () => {
        const api = await import('/static/js/api.js');
        const c = await import('/static/js/crypto.js');
        const dek = (await import('/static/js/session.js')).currentVault().dek;
        const out = [];
        for (const r of await api.get('/api/records?type=${type}')) {
          let payload = null;
          try { payload = await c.decryptRecord(dek, r); } catch {}
          out.push({ ...r, payload });
        }
        return JSON.stringify(out);
      })()`));
    } finally {
      muted = false;
    }
  };
  const on = (rows, date) => rows.filter((r) => r.payload && r.payload.date === date);
  const bytes = (rows) =>
    JSON.stringify(rows.map(({ recordId, version, nonce, ciphertext }) => ({ recordId, version, nonce, ciphertext })));
  // Records the client would never write itself, or writes another
  // window made, encrypted with the page's own crypto and PUT straight
  // to the record API behind the model on screen.
  const plantHere = async (list) => {
    await quiet();
    muted = true;
    try {
      return await ev(`(async () => {
        const api = await import('/static/js/api.js');
        const c = await import('/static/js/crypto.js');
        const { SCHEMA_VERSION } = await import('/static/js/model.js');
        const dek = (await import('/static/js/session.js')).currentVault().dek;
        const ids = [];
        for (const r of ${JSON.stringify(list)}) {
          const slot = {
            recordId: r.recordId || c.uuid4(), recordType: r.type, accountId: r.accountId ?? null,
            schemaVersion: SCHEMA_VERSION, version: r.version || 1,
          };
          // A blob sealed for another version is one no key opens.
          const blob = await c.encryptRecord(dek, r.corrupt ? { ...slot, version: slot.version + 1 } : slot, r.payload);
          await api.put('/api/records/' + slot.recordId, {
            recordType: slot.recordType, accountId: slot.accountId,
            schemaVersion: slot.schemaVersion, version: slot.version, ...blob,
          });
          ids.push(slot.recordId);
        }
        return ids;
      })()`);
    } finally {
      muted = false;
    }
  };
  // Read the whole vault again, as a fresh unlock would.
  const reread = async () => {
    muted = true;
    try {
      await ev("(async () => { await (await import('/static/js/session.js')).currentVault().load(); })()");
    } finally {
      muted = false;
    }
  };
  // A hash the page already shows is left through the dashboard, so
  // the screen is drawn afresh from the model.
  const go = async (hash) => {
    if ((await ev('location.hash')) === hash) await ev(`location.hash = '#/unassigned/none'`);
    await ev(`location.hash = ${JSON.stringify(hash)}`);
    await quiet();
  };
  const format = (method, iso) =>
    ev(`(async () => (await import('/static/js/session.js')).currentVault().format.${method}('${iso}'))()`);
  const model = (body) =>
    ev(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      const decimal = await import('/static/js/decimal.js');
      const { dayNumber } = await import('/static/js/model.js');
      return JSON.stringify(${body});
    })()`).then(JSON.parse);

  // The sweep's rows and rate lines.
  // A row is found by its holding's name, which reaches the page as data.
  const typeRow = (name, value) =>
    rec.call((holding, text) => {
      const r = [...document.querySelectorAll('.sweep-row')].find(r => r.querySelector('.holding-name').textContent === holding);
      const field = r.querySelector('input');
      field.value = text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, name, value);
  const clickRow = (name, selector) =>
    rec.call((holding, target) =>
      [...document.querySelectorAll('.sweep-row')].find(r => r.querySelector('.holding-name').textContent === holding)
        .querySelector(target).click(), name, selector);
  const pressRow = async (name) => {
    await clickRow(name, ':scope > button');
    await quiet();
  };
  // Undefined when the sweep has no such row.
  const rowState = (name) =>
    rec.call((holding) => {
      const r = [...document.querySelectorAll('.sweep-row')].find(r => r.querySelector('.holding-name').textContent === holding);
      return r && {
        state: r.querySelector('.row-state').textContent,
        field: r.querySelector('input').value,
        error: r.querySelector('.field-error').hidden ? '' : r.querySelector('.field-error').textContent,
        label: r.querySelector(':scope > button').textContent,
        disabled: r.querySelector(':scope > button').disabled,
        saved: r.querySelector('.row-saved').textContent,
        keeps: r.querySelectorAll('.sweep-pair button').length,
      };
    }, name);
  const line = (unit) => `document.querySelector('.rate-line[data-unit="${unit}"]')`;
  const lineState = (unit) =>
    ev(`JSON.stringify((() => { const l = ${line(unit)}; return l && {
      value: l.querySelector('input') ? l.querySelector('input').value : null,
      chip: l.querySelector('.chip').textContent,
      says: l.querySelector(':scope > .hint').textContent,
      error: l.querySelector('.field-error').hidden ? '' : l.querySelector('.field-error').textContent,
      lookup: Boolean(l.querySelector('.btn-inline:not([hidden])')),
    }; })())`).then(JSON.parse);
  const typeLine = (unit, value) =>
    ev(`(() => {
      const field = ${line(unit)}.querySelector('input');
      field.value = ${JSON.stringify(value)};
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  const figure = (shown) => Number(String(shown).replace(/[^\d.-]/g, ''));

  // Measured on boxes, not class names: every piece of a line inside
  // its block, none overlapping another, nothing scrolled past its box.
  // `stacked` is whether the field sits beneath the unit's name.
  const layout = (scope) =>
    ev(`JSON.stringify((() => {
      const root = document.querySelector(${JSON.stringify(scope)});
      const box = root.getBoundingClientRect();
      const problems = [];
      const lines = [...root.querySelectorAll('.rate-line')];
      const seen = [];
      for (const l of lines) {
        const parts = [...l.querySelectorAll('.rate-unit, .row-status, input, .chip, .btn-inline')]
          .filter((n) => n.getClientRects().length);
        const named = (n) => n.className.split(' ')[0] || n.tagName;
        for (const n of parts) {
          const r = n.getBoundingClientRect();
          if (r.left < box.left - 0.5 || r.right > box.right + 0.5) problems.push('outside the block: ' + named(n) + ' ' + n.textContent);
          if (n.scrollWidth > n.clientWidth + 0.5 && n.tagName !== 'INPUT') problems.push('clipped: ' + named(n) + ' ' + n.textContent);
        }
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 1; j < parts.length; j++) {
            const a = parts[i].getBoundingClientRect();
            const b = parts[j].getBoundingClientRect();
            if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) {
              problems.push('overlap: ' + named(parts[i]) + ' and ' + named(parts[j]));
            }
          }
        }
        const unit = l.querySelector('.rate-unit').getBoundingClientRect();
        const field = l.querySelector('input');
        const chip = [...l.querySelectorAll('.chip')].find((c) => c.textContent);
        seen.push({
          unit: l.querySelector('.rate-unit').textContent,
          one: l.querySelector('.row-status').textContent,
          chip: chip ? chip.textContent : '',
          stacked: field ? field.getBoundingClientRect().top >= unit.bottom - 0.5 : null,
          chipBelow: field && chip ? chip.getBoundingClientRect().top >= field.getBoundingClientRect().bottom - 0.5 : null,
          fieldLeft: field ? Math.round(field.getBoundingClientRect().left) : null,
        });
      }
      for (let n = root; n; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 0.5 && getComputedStyle(n).overflowX !== 'visible') problems.push('scrolls sideways: ' + n.className);
      }
      return { width: Math.round(box.width), problems, seen };
    })())`).then(JSON.parse);
  const viewport = (width) =>
    rec.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });

  // The dashboard's table.
  const tableRow = (name) =>
    ev(`JSON.stringify((() => {
      const r = [...document.querySelectorAll('.holdings-table tbody tr')]
        .find(tr => tr.querySelector('.row-name').textContent === ${JSON.stringify(name)});
      return r ? { converted: r.querySelector('.cell-converted').textContent, asOf: r.querySelector('.cell-asof').textContent, text: r.textContent } : null;
    })())`).then(JSON.parse);
  const group = (title) =>
    ev(`JSON.stringify((() => {
      const g = [...document.querySelectorAll('.table-group')].find(g => g.querySelector('.group-heading').textContent === ${JSON.stringify(title)});
      return g ? [...g.querySelectorAll('.link-button')].map(b => b.textContent) : [];
    })())`).then(JSON.parse);
  const hero = () => ev("document.querySelector('.hero-figure').textContent");
  const home = async () => {
    await ev(`document.querySelector('.topbar nav a[href="#/"]').click()`);
    await quiet();
  };
  // Opens the picker, steps back to the month holding `iso`, and picks
  // the day with a real click. Says what the day's mark and accessible
  // name were, which is how the picker tells a recorded date from a free one.
  const pickerDay = (iso) => `.dialog .date-day[data-date="${iso}"]`;
  const newRecording = async (iso, { wait = true } = {}) => {
    await press('New recording');
    for (let step = 0; step < 400 && !(await ev(`Boolean(document.querySelector('${pickerDay(iso)}'))`)); step += 1) {
      await ev(`document.querySelector('.dialog [aria-label="Previous month"]').click()`);
    }
    const day = JSON.parse(await ev(`(() => {
      const d = document.querySelector('${pickerDay(iso)}');
      return JSON.stringify({ name: d.getAttribute('aria-label'), dotted: d.classList.contains('has-recording') });
    })()`));
    if (wait) await realClick(pickerDay(iso));
    else {
      // Without waiting for the network to go quiet, for a step that
      // looks at the screen while a request is still pending.
      const at = await centerOf(pickerDay(iso));
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await rec.send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
      }
    }
    if (wait) await quiet();
    return { marked: day.dotted && day.name === `${await format('dayMonth', iso)}, has a recording`, name: day.name, dotted: day.dotted };
  };
  const sweepToday = async () => {
    await ev("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Update values').click()");
    await rec.waitUntil("location.hash.startsWith('#/sweep/')", { label: "today's sweep" });
    await quiet();
  };
  // ---- The vault, and what every part of it starts from ---------------

  const script = '<script>alert(1)</script>';
  const HOLDINGS = [
    ['Current account', 'CHF', { liq: 'cash' }],
    ['Savings', 'CHF', { liq: 'cash' }],
    ['Brokerage', 'USD', { liq: 'cash' }],
    ['Dollar cash', 'USD'],
    ['Gold bars', 'XAU-ozt'],
    ['Silver coins', 'XAG-ozt'],
    ['Flat', 'm2'],
    ['Mortgage', 'CHF'],
    ['Fund 1', 'CHF'],
    ['Fund 2', 'CHF'],
    ['Fund 3', 'CHF'],
    ['Fund 4', 'CHF'],
    ['Fund 5', 'CHF'],
    [script, 'CHF', { liq: 'odd' }],
    ['Art', 'PAINT'],
  ];
  // Filled in by `seed`.
  const id = {};
  const accountIds = [];
  const snap = (name, date, value) => ({ type: 'snapshot', accountId: id[name], payload: { date, value, note: null } });
  const price = (symbol, date, rate, rateSource = 'manual') => ({
    type: 'rate',
    payload: { symbol, date, rate, rateTarget: 'CHF', rateSource, rateAsOf: rateSource === 'manual' ? null : date, proposedRate: null },
  });
  const FIRST = {
    'Current account': '1000', Savings: '5000', Brokerage: '2000', 'Dollar cash': '300', 'Gold bars': '12.5',
    'Silver coins': '100.10', Flat: '95', Mortgage: '-400000', 'Fund 1': '100', 'Fund 2': '101', 'Fund 3': '102',
    'Fund 4': '103', 'Fund 5': '104', [script]: '105',
  };

  // The vault owner `recorder`, registered through the form and showing
  // an empty vault.
  const register = async () => {
    await rec.goto(`${BASE}/register?invite=${mintInvite('vault-owner')}`);
    await set('input[type=text]', 'recorder');
    await set('input[type=password]', RECORDER_PASSWORD, 0);
    await set('input[type=password]', RECORDER_PASSWORD, 1);
    await set('select', 'CHF');
    await ev(`(() => {
      const box = document.querySelector('input[type=checkbox]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await rec.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the registration button' });
    await ev("document.querySelector('button[type=submit]').click()");
    await rec.waitUntil("location.pathname === '/dashboard'", { timeout: 90000, label: 'the recorder dashboard' });
    await rec.waitUntil("!document.querySelector('#unlock-password') && document.body.innerText.includes('Add your first holding')", { timeout: 90000, label: 'the recorder vault' });
    await quiet();
  };

  // Fifteen holdings, a recording at the first date with prices for gold,
  // silver and the flat, and a second with the dollar's alone.
  const seed = async () => {
    accountIds.push(...await plantHere(
      HOLDINGS.map(([name, unit, dims = {}], i) => ({
        type: 'account',
        payload: { name, unit, dims, note: null, archivedAt: null, createdAt: `2020-01-01T00:00:${String(i).padStart(2, '0')}Z` },
      })),
    ));
    Object.assign(id, Object.fromEntries(HOLDINGS.map(([name], i) => [name, accountIds[i]])));
    await plantHere([
      ...Object.entries(FIRST).map(([name, value]) => snap(name, D1, value)),
      // The first recording priced gold, silver and the flat, and not
      // the dollar, and the second priced the dollar alone.
      price('XAU-ozt', D1, '2500', 'proposed'),
      price('XAG-ozt', D1, '25'),
      price('m2', D1, '10000'),
      snap('Current account', D2, '1100'),
      snap('Brokerage', D2, '2100'),
      price('USD', D2, '0.92', 'proposed'),
    ]);
    const profile = await model('{ recordId: v.profileRecord.recordId, version: v.profileRecord.version, payload: v.profile }');
    await plantHere([{
      type: 'profile',
      recordId: profile.recordId,
      version: profile.version + 1,
      payload: {
        ...profile.payload,
        dimensions: [{
          id: 'liq', label: 'Liquidity', archivedAt: null,
          values: [{ id: 'cash', label: 'Cash', archivedAt: null }, { id: 'odd', label: script, archivedAt: null }],
        }],
      },
    }]);
    await reread();
    await go('#/');
    await home();
  };


  return {
    rec,
    dayOf,
    isoOf,
    T,
    ago,
    D1,
    D2,
    D5,
    D6,
    D7,
    D8,
    D9,
    D10,
    D11,
    proxy,
    holdRates,
    proposalsFor,
    traffic,
    faults,
    writesSent,
    rateAsks,
    typeReads,
    bodyOf,
    unwatched,
    ev,
    text,
    quiet,
    set,
    press,
    realClick,
    uncovered,
    realKey,
    stored,
    on,
    bytes,
    plantHere,
    reread,
    go,
    format,
    model,
    typeRow,
    clickRow,
    pressRow,
    rowState,
    line,
    lineState,
    typeLine,
    figure,
    layout,
    viewport,
    tableRow,
    group,
    hero,
    home,
    newRecording,
    sweepToday,
    script,
    HOLDINGS,
    id,
    accountIds,
    snap,
    price,
    FIRST,
    register,
    seed,
  };
}
