// Dimensions (spec/ui/dimensions.md): creating, renaming, reordering,
// archiving and restoring the axes holdings are classified along, and
// what each operation writes.
// Templates: dashboard.html. Modules: view-dimensions.js, view-settings.js,
// view-dashboard.js, writes.js, model.js, dom.js.
import {
  check, click, expectedFailures, intercept, labels, page, run, setValue, sql, story, text, unlockDashboard,
  vaultOwner,
} from '../harness.mjs';

await run(async () => {
  await vaultOwner();
  await story();
  await unlockDashboard('the dashboard of the story');

  // ---- Dimensions ---------------------------------------------------------

  // A profile as registration writes it, with no dimensions key at all.
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('svg.trend') && document.querySelector('.chart-controls select')", { label: 'the dashboard before any dimension' });
  const ungrouped = JSON.parse(await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    return JSON.stringify({
      key: 'dimensions' in v.profile,
      options: [...document.querySelectorAll('.chart-controls select option')].map((o) => o.textContent),
      chart: Boolean(document.querySelector('svg.trend')),
    });
  })()`));
  check(
    'a profile with no dimensions key draws the dashboard with Total as the only grouping',
    !ungrouped.key && ungrouped.chart && ungrouped.options.join(',') === 'Total',
    JSON.stringify(ungrouped),
  );
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { label: 'settings for dimensions' });

  await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Dimensions are how')", {
    timeout: 20000,
    label: 'the dimensions empty state',
  });
  check(
    'opening dimensions does not ask for the password again',
    !(await page.eval("Boolean(document.querySelector('#unlock-password'))")),
  );
  check('the empty state explains what a dimension is', true);
  const createActions = await labels('button');
  check(
    'the empty state carries one action, to create a dimension',
    createActions.filter((label) => label.includes('Create a dimension')).length === 1,
    createActions.join(','),
  );

  await click('Create a dimension');
  await page.waitUntil("document.querySelector('.dialog input')");
  await page.eval(`(() => {
    const inputs = document.querySelectorAll('.dialog input');
    inputs[0].value = 'Liquidity';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'Cash';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Create').click();
  })()`);
  await page.waitUntil("document.body.innerText.includes('holdings assigned')", { label: 'the coverage line' });
  await page.frames();
  const coverage = await page.eval("[...document.querySelectorAll('.hint')].find(n => n.textContent.includes('assigned')).textContent");
  const model = await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const v = s.currentVault();
    return JSON.stringify({ holdings: v.holdings.size, unreadable: v.unreadable.length });
  })()`);
  check('coverage counts the active holdings', coverage === '0 of 4 holdings assigned', `${coverage} with ${model}`);

  // An inline rename writes only on Save (design-system.md, Components).
  // Every PUT the page sends from here on is counted.
  await page.eval(`(() => {
    const send = window.fetch;
    window.__puts = 0;
    window.fetch = (path, init) => {
      if (init && init.method === 'PUT') window.__puts += 1;
      return send(path, init);
    };
  })()`);
  const renameField = "document.querySelector('.card-head input')";
  const renameButton = (label) =>
    page.eval(
      `[...document.querySelectorAll('.card-head button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`,
    );
  await renameButton('Edit');
  await setValue('.card-head input', 'Liquid assets');
  await page.eval(`${renameField}.blur(); document.body.click()`);
  await page.idle();
  check(
    'clicking away from a rename writes nothing and leaves it open',
    (await page.eval('window.__puts')) === 0 && !(await page.eval(`Boolean(${renameField}.closest('[hidden]'))`)),
  );
  await setValue('.card-head input', '   ');
  await renameButton('Save');
  await page.holds("document.body.innerText.includes('A name cannot be blank.')");
  check(
    'a blank rename is refused and keeps what was typed',
    (await page.eval('window.__puts')) === 0 &&
      (await page.eval(`${renameField}.value`)) === '   ' &&
      (await text()).includes('A name cannot be blank.'),
  );
  await setValue('.card-head input', 'Liquid assets');
  await renameButton('Save');
  await page.waitUntil("document.body.innerText.includes('Liquid assets')", { label: 'the renamed dimension' });
  await page.idle();
  check('saving a rename writes one record', (await page.eval('window.__puts')) === 1);

  // ---- Account settings: every dimension operation writes one record --

  // What the screen and the chart read, and every account record as the
  // database holds it, byte for byte.
  const dims = () =>
    page.eval("(async () => JSON.stringify((await import('/static/js/session.js')).currentVault().dimensions))()").then(JSON.parse);
  const accountRecords = () =>
    JSON.stringify(sql("SELECT record_id, version, nonce, ciphertext FROM records WHERE record_type = 'account' ORDER BY record_id"));
  const bandsOf = (dimensionId) =>
    page.call(async (id) => {
      const v = (await import('/static/js/session.js')).currentVault();
      const d = v.dimensions.find((x) => x.id === id);
      return JSON.stringify(Object.fromEntries(v.activeHoldings().map((h) => [h.payload.name, v.bandOf(h, d).label])));
    }, dimensionId).then(JSON.parse);
  const settled = "!document.querySelector('.dimension-list[aria-busy]') && !document.querySelector('.dialog')";
  // One operation, and the PUTs it sent.
  const writesOf = async (label, act) => {
    const before = await page.eval('window.__puts');
    await act();
    // The write is sent, the screen is done with it, and nothing else follows.
    await page.holds((n) => window.__puts > n, { args: [before], timeout: 10000, label: 'the write to be sent' });
    await page.waitUntil(settled, { label });
    await page.idle();
    return (await page.eval('window.__puts')) - before;
  };
  const inCard = (dimension, button) =>
    page.call((name, label) => {
      const card = [...document.querySelectorAll('.dimension-card')]
        .find((c) => c.querySelector('.card-head .strong').textContent === name);
      [...card.querySelector('.card-head').querySelectorAll('button')]
        .find((b) => b.textContent === label || b.getAttribute('aria-label') === label)
        .click();
    }, dimension, button);
  const inRow = (value, button) =>
    page.call((name, label) => {
      const row = [...document.querySelectorAll('li.value-row')]
        .find((r) => r.querySelector('.strong').textContent === name);
      [...row.querySelectorAll('button')].find((b) => b.textContent === label).click();
    }, value, button);
  const inDialog = async (fields, button) => {
    await page.waitUntil("document.querySelector('.dialog button')");
    for (const [index, value] of fields.entries()) await setValue('.dialog input', value, index);
    await page.call((label) => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === label).click(), button);
  };
  const restore = (label) =>
    page.call((name) => {
      document.querySelectorAll('#app details').forEach((d) => (d.open = true));
      const row = [...document.querySelectorAll('.settings-row')].find((r) => r.firstChild.textContent === name);
      row.querySelector('button').click();
    }, label);
  // The first dimension's card is the one every value below belongs to; the
  // page functions find it by the id they are handed.
  const liveValues = () =>
    page.call((id) => {
      const card = [...document.querySelectorAll('.dimension-card')].find((c) => c.dataset.dimension === id);
      return [...card.querySelectorAll('li.value-row .strong')].map((n) => n.textContent);
    }, liquidity.id);

  const addValue = (label) =>
    writesOf(`the value ${label}`, async () => {
      await click('+ Add value');
      await inDialog([label], 'Add');
    });
  const writeCounts = {
    'add a value': await addValue('Investments'),
    'add another value': await addValue('Retirement'),
  };

  // Holdings filed under the values, which is the holding form's write
  // and not this screen's.
  const [liquidity] = await dims();
  await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const writes = await import('/static/js/writes.js');
    const v = s.currentVault();
    const d = v.dimensions.find((x) => x.id === ${JSON.stringify(liquidity.id)});
    const valueOf = (label) => d.values.find((x) => x.label === label).id;
    const filing = { 'Cantonal account': 'Cash', 'UBS dollar account': 'Investments', 'Gold bars': 'Investments', Mortgage: 'Retirement' };
    for (const h of v.activeHoldings()) {
      await writes.saveHolding(v, h, { ...h.payload, dims: { ...h.payload.dims, [d.id]: valueOf(filing[h.payload.name]) } });
    }
  })()`);
  const holdingsBefore = accountRecords();

  writeCounts['reorder a value'] = await writesOf('the reorder', () => inRow('Cash', 'Move down'));
  const reordered = await liveValues();
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.chart-controls select')", { label: 'the dashboard to group' });
  await page.eval(`(() => {
    const select = document.querySelector('.chart-controls select');
    select.value = ${JSON.stringify(liquidity.id)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.frames();
  const bandOrder = await labels('.legend-name');
  check(
    "reordering a dimension's values reorders the chart's bands",
    reordered.join(',') === 'Investments,Cash,Retirement' && bandOrder.join(',') === reordered.join(','),
    `${reordered.join(',')} against the legend ${bandOrder.join(',')}`,
  );
  await page.eval(`(() => {
    const select = document.querySelector('.chart-controls select');
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.eval("location.hash = '#/settings/dimensions'");
  await page.waitUntil("document.querySelector('.dimension-card')", { label: 'the dimensions screen again' });

  writeCounts['rename a value'] = await writesOf('the value rename', async () => {
    await inRow('Retirement', 'Edit');
    await page.eval(`(() => {
      const input = [...document.querySelectorAll('li.value-row input')].find((i) => !i.closest('[hidden]'));
      input.value = 'Pension';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...input.parentElement.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
    })()`);
  });
  check('a renamed value keeps its place', (await liveValues()).join(',') === 'Investments,Cash,Pension');

  // Bytes of 36 or more are discarded, not folded onto the alphabet.
  const minted = await page.call(async (batches) => {
    const { newId } = await import('/static/js/view-dimensions.js');
    const real = crypto.getRandomValues;
    crypto.getRandomValues = (array) => {
      array.set(batches.shift());
      return array;
    };
    try {
      return newId({ dimensions: [] });
    } finally {
      crypto.getRandomValues = real;
    }
  }, [[36, 63, 255, 0, 1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12]]);
  check('an id is drawn uniformly, discarding bytes outside the 36 characters', minted === '01234567', minted);

  // The next id the page mints is made to collide with one the profile
  // already holds, which the uniqueness check has to catch.
  await page.eval(`(() => {
    const real = crypto.getRandomValues.bind(crypto);
    const taken = ${JSON.stringify(liquidity.id)};
    let armed = true;
    crypto.getRandomValues = (array) => {
      if (armed && array.length === 8) {
        armed = false;
        [...taken].forEach((c, i) => (array[i] = parseInt(c, 36)));
        return array;
      }
      return real(array);
    };
  })()`);
  writeCounts['create a flag'] = await writesOf('the flag', async () => {
    await click('+ Create a dimension');
    await inDialog(['Emergency fund'], 'Create a flag');
  });
  const afterFlag = await dims();
  const ids = afterFlag.flatMap((d) => [d.id, ...d.values.map((v) => v.id)]);
  const words = afterFlag.flatMap((d) => [d.label, ...d.values.map((v) => v.label)]);
  const flag = afterFlag.find((d) => d.label === 'Emergency fund');
  check(
    'two dimensions created in one session hold different ids, and no id is a label',
    new Set(ids).size === ids.length && ids.every((id) => /^[a-z0-9]{8}$/.test(id) && !words.includes(id)),
    JSON.stringify(afterFlag.map((d) => [d.id, d.values.map((v) => v.id)])),
  );
  check(
    'a flag is one field and one button, a dimension with one value',
    flag && flag.values.length === 1 && flag.values[0].label === 'Emergency fund',
    JSON.stringify(flag),
  );

  writeCounts['reorder a dimension'] = await writesOf('the dimension reorder', () => inCard('Emergency fund', 'Move up'));
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.chart-controls select')", { label: 'the dashboard after the reorder' });
  await page.frames();
  const groupings = await labels('.chart-controls select option');
  check(
    'the order of dimensions is the order of the Group by select',
    groupings.join(',') === 'Total,Emergency fund,Liquid assets',
    groupings.join(','),
  );
  await page.eval("location.hash = '#/settings/dimensions'");
  await page.waitUntil("document.querySelector('.dimension-card')", { label: 'the dimensions screen once more' });

  const filed = await bandsOf(liquidity.id);
  writeCounts['archive a value'] = await writesOf('the value archive', () => inRow('Cash', 'Archive'));
  const whileArchived = await bandsOf(liquidity.id);
  check(
    'archiving a value moves its holdings to Unassigned',
    whileArchived['Cantonal account'] === 'Unassigned' && whileArchived['Gold bars'] === 'Investments',
    JSON.stringify(whileArchived),
  );
  const archivedLabel = await page.eval("[...document.querySelectorAll('summary')].map((n) => n.textContent).join(',')");
  check('an archived section counts what it hides', archivedLabel.includes('Archived values (1)'), archivedLabel);

  // With the archived value between them, a move is still a visible one.
  writeCounts['reorder past an archived value'] = await writesOf('the move past an archived value', () => inRow('Investments', 'Move down'));
  check(
    'a move among live values skips an archived one',
    (await liveValues()).join(',') === 'Pension,Investments',
    (await liveValues()).join(','),
  );
  writeCounts['restore a value'] = await writesOf('the value restore', () => restore('Cash'));
  check(
    'restoring a value moves its holdings back',
    JSON.stringify(await bandsOf(liquidity.id)) === JSON.stringify(filed),
    JSON.stringify(await bandsOf(liquidity.id)),
  );

  writeCounts['archive a dimension'] = await writesOf('the dimension archive', async () => {
    await inCard('Liquid assets', 'Actions for Liquid assets');
    await inCard('Liquid assets', 'Archive dimension');
    await inDialog([], 'Archive');
  });
  const hidden = await page.eval("[...document.querySelectorAll('summary')].map((n) => n.textContent).join(',')");
  check('an archived dimension is listed under Archived with its count', hidden.includes('Archived (1)'), hidden);
  writeCounts['restore a dimension'] = await writesOf('the dimension restore', () => restore('Liquid assets'));
  check(
    'archiving a dimension and restoring it returns every holding to its band',
    JSON.stringify(await bandsOf(liquidity.id)) === JSON.stringify(filed),
    JSON.stringify(await bandsOf(liquidity.id)),
  );

  // The drag handle, the reorder control's other route.
  writeCounts['drag a value'] = await writesOf('the drag', () =>
    page.call((id) => {
      const card = [...document.querySelectorAll('.dimension-card')].find((c) => c.dataset.dimension === id);
      const rows = [...card.querySelectorAll('li.value-row')];
      const from = rows.find((r) => r.querySelector('.strong').textContent === 'Investments');
      const transfer = new DataTransfer();
      from.querySelector('.drag-handle').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
      rows[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      rows[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, liquidity.id),
  );
  const announced = await page.eval("document.querySelector('[aria-live]').textContent");
  check(
    'dragging a value moves it and says where it went',
    (await liveValues()).join(',') === 'Investments,Pension,Cash' && announced === 'Moved to position 1 of 3.',
    `${(await liveValues()).join(',')}: ${announced}`,
  );

  check(
    'no operation on the dimensions screen writes more than one record',
    Object.values(writeCounts).every((count) => count === 1),
    JSON.stringify(writeCounts),
  );
  check(
    'no dimension operation touches an account record',
    accountRecords() === holdingsBefore,
  );

  // A write shown at once and held: the controls wait for it, and a
  // failure puts the stored order back and says so on the card.
  let answer;
  const answered = new Promise((resolve) => (answer = resolve));
  expectedFailures.add('/api/records/');
  let reachWrite;
  const heldWrite = new Promise((resolve) => (reachWrite = resolve));
  const releaseWrites = await intercept(page, '*/api/records/*', (request) => {
    if (request.method !== 'PUT') return null;
    reachWrite();
    return answered.then(() => ({ status: 500 }));
  });
  const storedOrder = await liveValues();
  await inRow('Investments', 'Move down');
  await heldWrite;
  await page.frames();
  const whileSaving = await page.call((id) => {
    const card = [...document.querySelectorAll('.dimension-card')].find((c) => c.dataset.dimension === id);
    return {
      order: [...card.querySelectorAll('li.value-row .strong')].map((n) => n.textContent),
      disabled: [...card.querySelectorAll('li.value-row button')].filter((b) => /Move|Archive/.test(b.textContent)).every((b) => b.disabled),
    };
  }, liquidity.id);
  check(
    'a move is shown at once, with the controls disabled until it answers',
    whileSaving.order.join(',') === 'Pension,Investments,Cash' && whileSaving.disabled,
    JSON.stringify(whileSaving),
  );
  answer();
  await page.waitUntil(settled, { label: 'the failed move to answer' });
  await page.idle();
  const afterFailure = await text();
  check(
    'a write that fails says so on its card and shows the stored order',
    afterFailure.includes('That did not save. Nothing changed.') && (await liveValues()).join(',') === storedOrder.join(','),
    `${(await liveValues()).join(',')}`,
  );
  await releaseWrites();
  expectedFailures.delete('/api/records/');

  // Another tab writes the profile first, with the dimension renamed.
  const relabelElsewhere = (label) =>
    page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      const api = await import('/static/js/api.js');
      const c = await import('/static/js/crypto.js');
      const { SCHEMA_VERSION } = await import('/static/js/model.js');
      const record = v.profileRecord;
      const payload = { ...v.profile, dimensions: v.dimensions.map((d) => (d.id === ${JSON.stringify(liquidity.id)} ? { ...d, label: ${JSON.stringify(label)} } : d)) };
      const slot = { recordId: record.recordId, recordType: 'profile', accountId: null, schemaVersion: SCHEMA_VERSION, version: record.version + 1 };
      await api.put('/api/records/' + slot.recordId, { recordType: 'profile', accountId: null, schemaVersion: slot.schemaVersion, version: slot.version, ...(await c.encryptRecord(v.dek, slot, payload)) });
    })()`);
  const otherTab = 'Liquidity, from another tab';
  await relabelElsewhere(otherTab);
  expectedFailures.add('/api/records/');
  await inRow('Pension', 'Edit');
  await page.eval(`(() => {
    const input = [...document.querySelectorAll('li.value-row input')].find((i) => !i.closest('[hidden]'));
    input.value = 'Retirement';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...input.parentElement.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
  })()`);
  await page.waitUntil("document.body.innerText.includes('Your settings were changed in another tab.')", { label: 'the conflict' });
  await page.idle();
  check(
    'a conflict names the other tab and reloads the profile',
    (await labels('.dimension-card .card-head .strong')).includes(otherTab),
    (await labels('.dimension-card .card-head .strong')).join(','),
  );
  expectedFailures.delete('/api/records/');
  // The other tab's name goes back.
  await relabelElsewhere('Liquid assets');
  await page.eval("(async () => { await (await import('/static/js/session.js')).currentVault().load(); })()");


});
