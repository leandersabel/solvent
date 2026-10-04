// The holding form (spec/ui/account-form.md): creating a holding, editing
// it, and the archive or delete decision, with what each writes and
// what a name, a note or a label carrying markup does on every screen.
// Templates: dashboard.html. Modules: view-holding-form.js, view-holding.js,
// view-forms.js, view-dimensions.js, view-dashboard.js, writes.js, model.js.
import {
  accountRows, BACKDATE, BASE, check, choose, click, enterPassword, failing, idNamed, inDatabase, inDialog, labels,
  landing, openHolding, OWN, page, payloadOf, plant, provoked, recording, recordReads, recordWrites, reloadModel,
  rowOf, run, setProfile, setValue, sql, text, TODAY_FIGURES, unlockDashboard, VAULT_PASSWORD, vaultOwner,
  vaultValue, writesSeen, writing,
} from '../harness.mjs';

await run(async () => {
  await vaultOwner();

  // A manager that fills one of these writes a stored login into an
  // encrypted record, and its inline button invites exactly that.
  const fieldsOffered = [];
  const addHolding = async (name, unit) => {
    await click('Add a holding');
    await page.waitUntil("document.querySelector('.dialog #holding-name')", { label: 'the holding form' });
    fieldsOffered.push(await page.eval(`(() => {
      const credential = ['username', 'current-password', 'new-password'];
      return [...document.querySelectorAll('.dialog input, .dialog textarea, .dialog select')]
        .filter((f) => !credential.includes(f.getAttribute('autocomplete')))
        .filter((f) => !f.hasAttribute('data-1p-ignore'))
        .map((f) => f.id || f.type)
        .join(',');
    })()`));
    await setValue('#holding-name', name);
    const option = `#holding-unit-list [data-symbol="${unit}"]`;
    await page.waitUntil((query) => document.querySelector(query), { args: [option], label: `the ${unit} option` });
    await page.call((query) => document.querySelector(query).click(), option);
    await page.eval("document.querySelector('.dialog button[type=submit]').click()");
    await page.waitUntil('!document.querySelector(".dialog")', { label: `${name} to save` });
    await page.idle();
  };
  await addHolding('Cantonal account', 'CHF');
  await addHolding('UBS dollar account', 'USD');
  await addHolding('Gold bars', 'XAU-ozt');
  check(
    'no vault field offers itself to a password manager',
    fieldsOffered.every((f) => f === ''),
    fieldsOffered.join(' | '),
  );
  await addHolding('Mortgage', 'CHF');

  check('every holding is listed as not yet valued', (await text()).includes('Not yet valued'));
  check(
    'with no holding valued, the groups stand under the head row with no table and no column heading',
    await page.eval("!document.querySelector('.holdings-table') && !document.querySelector('.holdings-card th') && document.querySelector('.holdings-card .card-head + .table-group .group-heading')?.textContent === 'Not yet valued'"),
  );
  check(
    'a holding reads back the name it was given',
    (await labels('.plain-list .link-button')).join(',') ===
      'Cantonal account,UBS dollar account,Gold bars,Mortgage',
    (await labels('.plain-list .link-button')).join(','),
  );
  check('four holdings, none of them valued', (await page.eval("document.querySelectorAll('.plain-list li').length")) === 4);
  check('the total reads a dash rather than zero', (await page.eval("document.querySelector('.hero-figure').textContent")) === '—');

  // What a first sitting records, and the dimension a holding is filed
  // along, which the form offers.
  await recording(new Date().toISOString().slice(0, 10), TODAY_FIGURES);
  await recording(BACKDATE, { 'Cantonal account': '11000.00' });
  await setProfile({
    dimensions: [{
      id: 'liqd0001', label: 'Liquid assets', archivedAt: null, values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }],
    }],
  });
  await unlockDashboard('the dashboard of the story');
  check(
    'once a holding is valued the table renders, with its column headings above the valued rows',
    await page.eval("document.querySelectorAll('.holdings-table th').length > 0 && document.querySelectorAll('.holdings-table tbody tr').length > 0"),
  );

  {
    await recordWrites();

    // A second value on the existing dimension and a second dimension,
    // written to the profile as the dimensions screen would.
    const profile = await vaultValue((v) => ({ recordId: v.profileRecord.recordId, version: v.profileRecord.version, profile: v.profile }));
    const liquid = profile.profile.dimensions.find((d) => d.label === 'Liquid assets');
    await plant([{
      type: 'profile',
      recordId: profile.recordId,
      version: profile.version + 1,
      payload: {
        ...profile.profile,
        dimensions: [
          { ...liquid, values: [...liquid.values, { id: 'retire01', label: 'Retirement', archivedAt: null }] },
          {
            id: 'region01',
            label: 'Region',
            archivedAt: null,
            values: [
              { id: 'home0001', label: 'Home', archivedAt: null },
              { id: 'abroad01', label: 'Abroad', archivedAt: null },
            ],
          },
        ],
      },
    }]);
    await reloadModel();
    await writesSeen();

    // -- The form: the unit list ------------------------------------------

    const XSS = '<img src=x onerror=alert(1)>';
    const NAME = `Name ${XSS}`;
    const NOTE = `Note ${XSS}`;
    const AXIS = `Axis ${XSS}`;
    const BAND = `Band ${XSS}`;
    const accountsBefore = sql(`SELECT record_id FROM records ${OWN} AND record_type = 'account'`).length;

    await click('Add a holding');
    await page.waitUntil("document.querySelector('#holding-unit-list [data-symbol]')", { label: 'the unit list' });
    const unitList = JSON.parse(await page.eval(`JSON.stringify({
      options: [...document.querySelectorAll('#holding-unit-list [role=option]')].map(o => o.dataset.symbol || o.textContent),
      texts: [...document.querySelectorAll('#holding-unit-list [role=option]')].map(o => o.textContent),
      groups: [...document.querySelectorAll('#holding-unit-list .unit-group-label')].map(g => g.textContent),
    })`));
    check(
      'the unit list offers the main currency first, then currencies, then metals, then Something else',
      unitList.options[0] === 'CHF' &&
        unitList.groups.join(',') === 'Currencies,Metals' &&
        unitList.options[unitList.options.length - 1] === 'Something else…' &&
        unitList.options.indexOf('XAU-ozt') > unitList.options.indexOf('USD'),
      JSON.stringify(unitList.options),
    );
    check(
      'a metal reads as its label, once per unit',
      unitList.texts.some((t) => t.startsWith('Gold, gram')) && unitList.texts.some((t) => t.startsWith('Gold, troy ounce')),
      unitList.texts.join(' | '),
    );
    check(
      'a unit with no lookup is listed and marked rate entered by hand',
      unitList.texts.some((t) => t.includes('XAG-ozt') && t.endsWith('rate entered by hand')),
    );
    check('the form says what the unit commits you to', (await text()).includes('After that it is fixed'));
    check('the form offers no price, rate or symbol field', !(await page.eval("Boolean(document.querySelector('.dialog').textContent.match(/\\bRate\\b|Rate symbol|No price source/))")));

    await setValue('#holding-unit', 'troy');
    await page.frames();
    const filtered = await page.eval(
      "[...document.querySelectorAll('#holding-unit-list [data-symbol]')].map(o => o.textContent)",
    );
    check(
      'typing narrows the list and never becomes the unit',
      filtered.length > 0 && filtered.every((t) => t.toLowerCase().includes('troy')) &&
        (await page.eval("document.querySelector('.unit-chosen').value")) === 'CHF',
      filtered.join(' | '),
    );
    await setValue('#holding-unit', '');

    // Nothing saves without a name, and a free-text unit that is a
    // listed symbol in another case is refused in favour of the symbol.
    await page.eval("document.querySelector('.dialog button[type=submit]').click()");
    await page.holds("document.body.innerText.includes('Give the holding a name.')");
    check('a missing name is refused inline and writes nothing', (await text()).includes('Give the holding a name.') && (await writesSeen()).length === 0);
    await setValue('#holding-name', NAME);
    await page.eval("document.querySelector('#holding-unit-list .unit-other').click()");
    await setValue('#holding-unit-other', 'usd');
    await page.frames();
    check('typed text matching a listed symbol offers that symbol', (await text()).includes('USD is on the list'));
    await page.eval("document.querySelector('.dialog button[type=submit]').click()");
    await page.holds("document.body.innerText.includes('Use it from there')");
    check('and that free text is not accepted', (await writesSeen()).length === 0 && (await text()).includes('Use it from there'));
    await page.eval("document.querySelector('#holding-unit-list [data-symbol=\"CHF\"]').click()");

    await page.eval("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
    await setValue('.dialog textarea', NOTE);
    // A value made inline, then a dimension made inline: each writes the
    // profile first, and the holding is written once, last.
    await choose('.dialog select[aria-label="Region"]', '__new__');
    await setValue('.dialog .inline-create input', 'Offshore');
    await inDialog('Add');
    await page.waitUntil("[...document.querySelectorAll('.dialog select[aria-label=\"Region\"] option')].some(o => o.textContent === 'Offshore' && o.selected)", { label: 'the new value, selected' });
    await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === '+ New dimension').click()");
    await page.call((axisLabel, bandLabel) => {
      const inputs = document.querySelectorAll('.dialog .new-dimension input');
      inputs[0].value = axisLabel;
      inputs[1].value = bandLabel;
    }, AXIS, BAND);
    await inDialog('Add');
    await page.waitUntil((axisLabel) => [...document.querySelectorAll('.dialog .checkbox')].some((l) => l.textContent === axisLabel && l.querySelector('input').checked), { args: [AXIS], label: 'the new dimension, set' });
    await choose('.dialog select[aria-label="Liquid assets"]', 'retire01');
    const readsBeforeSave = await recordReads();
    await page.eval("document.querySelector('.dialog button[type=submit]').click()");
    await page.waitUntil('!document.querySelector(".dialog")', { label: 'the new holding to save' });
    await page.idle();
    const written = await writesSeen();
    check('inline creation writes the profile before the holding', written.join(',') === 'profile,profile,account', written.join(','));
    check('the saved holding shows at once, with no refetch', (await recordReads()) === readsBeforeSave && (await text()).includes(NAME));

    const [probeId] = await idNamed(NAME);
    const saved = await payloadOf(probeId);
    const axis = await vaultValue((v, value) => v.dimensions.find(d => d.label === value), AXIS);
    const offshore = await vaultValue((v) => v.dimensions.find(d => d.id === 'region01').values.find(x => x.label === 'Offshore').id);
    check(
      'creating a holding stores exactly one account record',
      sql(`SELECT record_id FROM records ${OWN} AND record_type = 'account'`).length === accountsBefore + 1 && Boolean(rowOf(probeId)),
    );
    check(
      'the form writes ids for every assignment, never a label',
      JSON.stringify(saved.dims) === JSON.stringify({ region01: offshore, [axis.id]: axis.values[0].id, [liquid.id]: 'retire01' }) ||
        (Object.keys(saved.dims).length === 3 && saved.dims.region01 === offshore && saved.dims[liquid.id] === 'retire01' && saved.dims[axis.id] === axis.values[0].id),
      JSON.stringify(saved.dims),
    );

    // A free-text unit, twice under one name: names are not unique.
    const addFreeText = async (name, unit) => {
      await click('Add a holding');
      await page.waitUntil("document.querySelector('#holding-unit-list .unit-other')", { label: 'the unit list' });
      await setValue('#holding-name', name);
      await page.eval("document.querySelector('#holding-unit-list .unit-other').click()");
      await setValue('#holding-unit-other', unit);
      await page.eval("document.querySelector('.dialog button[type=submit]').click()");
      await page.waitUntil('!document.querySelector(".dialog")', { label: `${name} to save` });
      await page.frames();
    };
    await addFreeText('Parking space', 'm²');
    await addFreeText('Parking space', 'm²');
    const parking = await idNamed('Parking space');
    check('two holdings may share a name', parking.length === 2, parking.join(','));
    check('a free-text unit is stored as typed, case kept', (await payloadOf(parking[0])).unit === 'm²');

    const leaks = inDatabase([
      NAME, NOTE, AXIS, BAND, 'Offshore', 'Parking space', 'm²', 'Liquid assets', 'Retirement', 'Region',
      offshore, axis.id, axis.values[0].id, 'region01', 'retire01', 'home0001',
    ]);
    check('no name, unit, note, label or assignment is in the database in plaintext', leaks.length === 0, leaks.join(' | '));
    const shapes = await page.eval(`(async () => {
      const api = await import('/static/js/api.js');
      const c = await import('/static/js/crypto.js');
      const v = (await import('/static/js/session.js')).currentVault();
      const shapes = [];
      for (const row of await api.get('/api/records?type=account')) {
        const payload = await c.decryptRecord(v.dek, row);
        shapes.push(Object.keys(payload).sort().join(',') + (payload.dims && !Array.isArray(payload.dims) && typeof payload.dims === 'object' ? '' : ' dims-not-a-map'));
      }
      return JSON.stringify([...new Set(shapes)]);
    })()`);
    check(
      'every account record has exactly the documented fields, no rate symbol beside the unit',
      shapes === JSON.stringify(['archivedAt,createdAt,dims,name,note,unit']),
      shapes,
    );

    // -- Read back after a fresh unlock ---------------------------------------

    await page.goto(`${BASE}/dashboard`);
    await enterPassword(VAULT_PASSWORD);
    await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the dashboard after a fresh unlock' });
    await page.idle();
    check('a holding reads back whole after a fresh unlock', JSON.stringify(await payloadOf(probeId)) === JSON.stringify(saved));
    await recordWrites();

    // The unit list alone waits on the symbol table, and a table that
    // cannot be fetched leaves free text, a retry, and the cost named.
    await failing((request) => request.url.includes('/api/rates/symbols'), async () => {
      await click('Add a holding');
      await page.waitUntil("document.body.innerText.includes('The unit list could not be loaded')", { label: 'the degraded unit control' });
      check(
        'a symbol table that cannot load degrades to free text with a retry',
        await page.eval("!document.querySelector('#holding-unit-other').hidden && [...document.querySelectorAll('.dialog button')].some(b => b.textContent === 'Try again')"),
      );
    });
    await inDialog('Try again');
    await page.waitUntil("document.querySelector('#holding-unit-list [data-symbol]')", { label: 'the list after a retry' });
    check('trying again brings the list back', true);
    await inDialog('Cancel');
    await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });
    // -- The holding's own screen ---------------------------------------------

    await openHolding(probeId);
    check('an unvalued holding says so rather than 0', (await text()).includes('Not yet valued'));
    check('with no values, one sentence and the primary action', (await text()).includes('No snapshots yet. Record what this holding is worth.'));
    await click('Record a value');
    await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
    const pastDay = await page.call(async (day) => {
      const v = (await import('/static/js/session.js')).currentVault();
      return v.format.date(day);
    }, BACKDATE);
    await setValue('#snapshot-date', pastDay);
    await setValue('#snapshot-value', '5000');
    await page.eval("document.querySelector('.dialog textarea').value = 'kept in the safe'; document.querySelector('.dialog textarea').dispatchEvent(new Event('input', { bubbles: true }))");
    await inDialog('Save');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the value to save' });
    await page.holds("document.querySelector('.note-toggle')");
    const noteRow = JSON.parse(await page.eval(`JSON.stringify({
      toggles: document.querySelectorAll('.note-toggle').length,
      hiddenBefore: document.querySelector('.note-row').hidden,
    })`));
    await page.eval("document.querySelector('.note-toggle').click()");
    await page.frames();
    check(
      "an entry's note is behind an icon that expands its row, in full",
      noteRow.toggles === 1 && noteRow.hiddenBefore &&
        !(await page.eval("document.querySelector('.note-row').hidden")) &&
        (await page.eval("document.querySelector('.note-row').textContent")) === 'kept in the safe',
    );
    await writesSeen();

    // Editing: Cancel writes nothing. A save re-encrypts under a fresh
    // nonce at version + 1, the dimension carries one entry, and the
    // unit of a holding with a value is refused whatever the controls
    // are made to hold.
    await click('Edit');
    await page.waitUntil("document.querySelector('#holding-name')", { label: 'the holding editor' });
    await page.eval("[...document.querySelectorAll('#app .panel-form button')].find(b => b.textContent === 'Cancel').click()");
    await page.holds("!document.querySelector('#holding-name')");
    check('Cancel closes the editor and writes nothing', !(await page.eval("Boolean(document.querySelector('#holding-name'))")) && (await writesSeen()).length === 0);

    await click('Edit');
    await page.waitUntil("document.querySelector('#holding-name')", { label: 'the holding editor again' });
    await page.frames();
    const lock = JSON.parse(await page.eval(`JSON.stringify({
      disabled: document.querySelector('#holding-unit').disabled,
      readable: document.querySelector('#holding-unit').value,
      listShown: !document.querySelector('#holding-unit-list').hidden,
    })`));
    check(
      'the unit of a holding with a value is disabled, readable, and explained',
      lock.disabled && lock.readable.includes('CHF') && !lock.listShown &&
        (await text()).includes('The unit cannot change once a value is recorded here, including the zero an archive records.'),
      JSON.stringify(lock),
    );
    const rowBefore = rowOf(probeId);
    await page.eval(`(() => {
      const kept = document.querySelector('.unit-chosen');
      kept.value = 'USD';
      kept.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await page.eval("document.querySelectorAll('#app details').forEach(d => (d.open = true))");
    await setValue('#app textarea', `${NOTE} edited`);
    await choose('#app select[aria-label="Region"]', 'home0001');
    await page.eval("document.querySelector('#app .panel-form button[type=submit]').click()");
    await page.waitUntil("!document.querySelector('#holding-name')", { label: 'the edit to save' });
    await page.frames();
    const rowAfter = rowOf(probeId);
    const edited = await payloadOf(probeId);
    check(
      'an edit increments the version and writes a different nonce',
      rowAfter.version === rowBefore.version + 1 && rowAfter.nonce !== rowBefore.nonce,
      `${rowBefore.version}/${rowBefore.nonce} then ${rowAfter.version}/${rowAfter.nonce}`,
    );
    check(
      're-saving a dimension with another value leaves one entry for it',
      edited.dims.region01 === 'home0001' && Object.keys(edited.dims).length === Object.keys(saved.dims).length &&
        Object.keys(edited.dims).filter((key) => key === 'region01').length === 1,
      JSON.stringify(edited.dims),
    );
    check('the UI refuses to change the unit of a holding with a value', edited.unit === 'CHF', edited.unit);

    // A Conflict: the record is changed behind this tab, the save is
    // refused, the editor shows what the other tab wrote, and the edit
    // is redone against it.
    await click('Edit');
    await page.waitUntil("document.querySelector('#holding-name')", { label: 'the editor before the conflict' });
    const current = await vaultValue((v, id) => ({ version: v.holdings.get(id).version, payload: v.holdings.get(id).payload }), probeId);
    provoked.push(`/api/records/${probeId}`);
    await plant([{ type: 'account', recordId: probeId, version: current.version + 1, payload: { ...current.payload, name: 'Changed in another tab' } }]);
    await page.eval("document.querySelectorAll('#app details').forEach(d => (d.open = true))");
    await setValue('#app textarea', 'typed in this tab');
    await page.eval("document.querySelector('#app .panel-form button[type=submit]').click()");
    await page.waitUntil("document.body.innerText.includes('This holding was changed in another tab.')", { label: 'the conflict message' });
    await page.idle();
    check(
      'a Conflict reloads the record into the editor and changes nothing stored',
      (await page.eval("document.querySelector('#holding-name').value")) === 'Changed in another tab' &&
        rowOf(probeId).version === current.version + 1,
      await page.eval("document.querySelector('#holding-name').value"),
    );
    await setValue('#holding-name', NAME);
    await page.eval("document.querySelector('#app .panel-form button[type=submit]').click()");
    await page.waitUntil("!document.querySelector('#holding-name')", { label: 'the redone edit' });
    await page.frames();
    check('the redone edit saves at the next version', rowOf(probeId).version === current.version + 2 && (await payloadOf(probeId)).name === NAME);
    // -- Decrypted strings reach the page as text, everywhere -----------------

    check(
      'a name and a note carrying markup render as literal text on the holding screen',
      (await page.eval("document.querySelector('.screen-heading').textContent")) === NAME &&
        (await page.eval("document.querySelector('.detail-header .note').textContent")) === (await payloadOf(probeId)).note &&
        (await page.eval("[...document.querySelectorAll('.detail-header .chip')].map(c => c.textContent)")).includes(`${AXIS}: ${BAND}`),
    );
    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.chart-controls select')", { label: 'the dashboard' });
    await choose('.chart-controls select', axis.id);
    await page.frames();
    await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
    await page.frames();
    await page.eval(`(() => {
      const chart = document.querySelector('svg.trend');
      const box = chart.getBoundingClientRect();
      chart.dispatchEvent(new PointerEvent('pointermove', { clientX: box.right - 30, clientY: box.top + box.height / 2, bubbles: true }));
    })()`);
    await page.frames();
    const places = JSON.parse(await page.call((holding) => JSON.stringify({
      row: [...document.querySelectorAll('.holdings-table .row-name')].some(b => b.textContent === holding),
      legend: [...document.querySelectorAll('.legend-name')].map(n => n.textContent),
      grouping: [...document.querySelectorAll('.chart-controls select option')].map(o => o.textContent),
      heading: document.querySelector('.chart-card .section-heading').textContent,
      readout: document.querySelector('.chart-readout').textContent,
      chips: [...document.querySelectorAll('.holdings-table .chip')].map(c => c.textContent),
    }), NAME));
    check(
      'markup in a name, a note and a label is literal in the list, the legend, the heading and the tooltip',
      places.row && places.legend.includes(BAND) && places.grouping.includes(AXIS) &&
        places.heading === `Net worth by ${AXIS}` && places.readout.includes(BAND) && places.chips.includes(`${AXIS}: ${BAND}`),
      JSON.stringify(places),
    );
    check(
      'no markup from the vault became an element, and nothing ran',
      (await page.eval("document.querySelectorAll('img').length")) === 0 && !(await page.eval('window.__alerted')),
    );
    await choose('.chart-controls select', '');
    // -- Renaming and archiving dimensions writes the profile alone ----------

    const accountsAtRename = accountRows();
    await writesSeen();
    await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
    await page.waitUntil("document.querySelector('.link-row[href=\"/settings/dimensions\"]')", { label: 'settings' });
    await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
    await page.waitUntil("document.body.innerText.includes('Region')", { label: 'the dimensions screen' });
    await page.frames();
    // A dimension's card is found by its label, in one place, which the
    // dimensions screen's own document keeps for the checks below.
    await page.call(() => {
      window.cardOf = (label) => [...document.querySelectorAll('section.card')]
        .find((c) => c.querySelector('.card-head .strong')?.textContent === label);
    });
    // A button on a dimension's card, both named as data.
    const inCard = (label, button) =>
      page.call((wanted, name) => [...window.cardOf(wanted).querySelectorAll('button')]
        .find((b) => b.textContent === name).click(), label, button);
    await page.call(() => window.cardOf('Region').querySelector('.card-head .btn-inline').click());
    await page.call(() => {
      const input = window.cardOf('Region').querySelector('.card-head input');
      input.value = 'Area';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.call(() => [...window.cardOf('Region').querySelectorAll('.card-head button')]
      .find((b) => b.textContent === 'Save').click());
    await page.waitUntil((label) => window.cardOf(label), { args: ['Area'], label: 'the renamed dimension' });
    await page.idle();
    check(
      "renaming a dimension's label writes the profile alone and leaves every account record byte-identical",
      (await writesSeen()).join(',') === 'profile' && accountRows() === accountsAtRename,
    );

    // An archived value reads as Unassigned, and restoring it brings the
    // assignment back, with no account record written either way.
    await landing(() => page.call(() => [...[...window.cardOf('Area').querySelectorAll('li.value-row')]
      .find(r => r.querySelector('.strong').textContent === 'Home').querySelectorAll(':scope > button')]
      .find(b => b.textContent === 'Archive').click()));
    const bandWhileArchived = await vaultValue((v, id) => v.bandOf(v.holdings.get(id), v.dimensions.find(d => d.id === 'region01')).label, probeId);
    await landing(() => inCard('Area', 'Restore'));
    const bandRestored = await vaultValue((v, id) => v.bandOf(v.holdings.get(id), v.dimensions.find(d => d.id === 'region01')).label, probeId);
    check(
      'a holding whose value is archived reads Unassigned, and restoring it restores the assignment with no account write',
      bandWhileArchived === 'Unassigned' && bandRestored === 'Home' && accountRows() === accountsAtRename &&
        (await writesSeen()).every((type) => type === 'profile'),
      `${bandWhileArchived} then ${bandRestored}`,
    );

    await inCard(AXIS, 'Archive dimension');
    await page.waitUntil("document.querySelector('.dialog')", { label: 'the archive dimension dialog' });
    await inDialog('Archive');
    await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dimension to be archived' });
    await page.idle();
    await openHolding(probeId);
    check(
      'a holding whose dimension is archived shows no assignment for it, and no account record was written',
      !(await page.eval("document.querySelector('.detail-header').textContent")).includes('Axis') &&
        accountRows() === accountsAtRename && (await writesSeen()).every((type) => type === 'profile'),
    );
    // Saving the holding meanwhile keeps the entry the form cannot show.
    await click('Edit');
    await page.waitUntil("document.querySelector('#holding-name')", { label: 'the editor over an archived dimension' });
    await page.eval("document.querySelectorAll('#app details').forEach(d => (d.open = true))");
    await setValue('#app textarea', NOTE);
    await page.eval("document.querySelector('#app .panel-form button[type=submit]').click()");
    await page.waitUntil("!document.querySelector('#holding-name')", { label: 'the save over an archived dimension' });
    await page.frames();
    check(
      'saving a holding keeps the entry for an archived dimension untouched',
      (await payloadOf(probeId)).dims[axis.id] === axis.values[0].id,
      JSON.stringify((await payloadOf(probeId)).dims),
    );
    await writesSeen();
    const accountsBeforeRestore = accountRows();
    await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
    await page.waitUntil("document.querySelector('.link-row[href=\"/settings/dimensions\"]')", { label: 'settings again' });
    await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
    await page.waitUntil("document.body.innerText.includes('Area')", { label: 'the dimensions screen again' });
    await landing(() => page.call((label) => [...document.querySelectorAll('.settings-row')].find(r => r.querySelector('span').textContent === label).querySelector('button').click(), AXIS));
    await openHolding(probeId);
    check(
      'restoring the dimension restores the assignment without writing an account record',
      (await page.eval("[...document.querySelectorAll('.detail-header .chip')].map(c => c.textContent)")).includes(`${AXIS}: ${BAND}`) &&
        accountRows() === accountsBeforeRestore && (await writesSeen()).every((type) => type === 'profile'),
    );
    // -- Deleting ---------------------------------------------------------------

    await click('Delete');
    await page.waitUntil("document.querySelector('.dialog')", { label: 'the delete dialog' });
    await page.frames();
    const offered = JSON.parse(await page.eval(`JSON.stringify({
      archive: document.querySelector('.dialog input[value=archive]').checked,
      both: document.querySelectorAll('.dialog input[type=radio]').length,
    })`));
    await page.eval("document.querySelector('.dialog input[value=delete]').click()");
    await page.frames();
    const permanently = () => [...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Delete permanently').disabled;
    const confirmLook = () => {
      const button = [...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Delete permanently');
      const probe = document.createElement('div');
      probe.style.background = 'var(--status-critical)';
      document.body.append(probe);
      const critical = getComputedStyle(probe).backgroundColor;
      probe.remove();
      // Ends the 150ms color transition, so the computed fill is the settled one.
      button.style.transition = 'none';
      const style = getComputedStyle(button);
      return { cursor: style.cursor, red: style.backgroundColor === critical };
    };
    const deleteCopy = (await text()).includes('This also deletes 1 recorded values. Your past net worth figures will change.');
    await setValue('#delete-name', 'Not the name');
    const wrongName = await page.call(permanently);
    const wrongLook = await page.call(confirmLook);
    await setValue('#delete-name', NAME);
    const rightName = await page.call(permanently);
    const rightLook = await page.call(confirmLook);
    check(
      'Delete on a holding with values offers archive, preselected, and permanent delete behind the typed name',
      offered.archive && offered.both === 2 && deleteCopy && wrongName && !rightName,
      JSON.stringify({ offered, deleteCopy, wrongName, rightName }),
    );
    check(
      'a disabled Delete permanently reads as disabled, no red and a default cursor, and turns red once the name matches',
      wrongLook.cursor === 'default' && !wrongLook.red && rightLook.red,
      JSON.stringify({ wrongLook, rightLook }),
    );
    await inDialog('Cancel');
    await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });

    await openHolding(parking[1]);
    await click('Delete');
    await page.waitUntil("location.hash === '#/'", { label: 'the dashboard after deleting outright' });
    check(
      'a holding with no values is deleted outright, with no dialog',
      !(await page.eval("Boolean(document.querySelector('.dialog'))")) && !rowOf(parking[1]) && Boolean(rowOf(parking[0])),
    );
  }
});
