// One holding (spec/features/manage-accounts.md, Account detail):
// everything about it, its own list of values, and the archive lifecycle:
// the zero an archive records, the flag, the refusals and conflicts on the
// way, and unarchiving.
// Templates: dashboard.html. Modules: view-holding.js, view-forms.js,
// writes.js, model.js, view-dashboard.js, chart.js, decimal.js.
import {
  BACKDATE, check, choose, click, failing, idNamed, inDialog, labels, landing, openHolding, OWN, page, plant,
  provoked, recording, recordWrites, reloadModel, rowOf, run, setProfile, setValue, sql, story, text,
  unlockDashboard, vaultOwner, vaultValue, writesSeen, writing,
} from '../harness.mjs';

await run(async () => {
  await vaultOwner();
  await story({ backdated: false });
  await unlockDashboard('the dashboard of the story');

  // ---- A holding's own screen ------------------------------------------

  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.data-table tbody .link-button')", { label: 'the dashboard' });
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.card .data-table tbody tr') && document.querySelector('.hero-age')", { label: "the holding's screen" });
  check('the holding lists its own values', (await page.eval("document.querySelectorAll('.card .data-table tbody tr').length")) === 1);
  check(
    'the holding offers its four actions',
    (await labels('.form-actions button')).join(',') === 'Record a value,Edit,Archive,Delete',
  );
  check('there is no rate column on a holding', !(await text()).includes('Source'));
  // design-system.md, Units: no header names a unit, and each value
  // carries its own.
  const values = await page.call(async () => {
    const vault = (await import('/static/js/session.js')).currentVault();
    const holding = vault.holdings.get(location.hash.split('/')[2]);
    const table = document.querySelector('.values-table');
    return {
      headers: [...table.querySelectorAll('th')].map((th) => th.textContent),
      shown: table.querySelector('tbody td.numeric').textContent,
      expected: vault.amount(vault.snapshotsFor(holding.recordId)[0].payload.value, holding.payload.unit),
    };
  });
  check(
    "no header on the holding's values names a unit, and each value carries it",
    values.headers[1] === 'Value' && values.shown === values.expected,
    JSON.stringify(values),
  );
  // design-system.md, Typography: the screen heading is 32px/600, 26px
  // at phone width.
  const nameFont = await page.eval(
    "(() => { const s = getComputedStyle(document.querySelector('.detail-header h1')); return `${s.fontSize}/${s.fontWeight}`; })()",
  );
  const headingFont = (await page.eval('innerWidth')) <= 600 ? '26px/600' : '32px/600';
  check("the holding's name is drawn as the screen heading", nameFont === headingFont, nameFont);
  check(
    'a figure recorded for today is aged "today" on the holding',
    (await labels('.hero-age')).some((age) => age.startsWith('as of ') && age.endsWith(', today')),
    (await labels('.hero-age')).join(','),
  );


  // A second figure for the first holding, earlier than any other.
  await recording(BACKDATE, { 'Cantonal account': '11000.00' });
  await unlockDashboard('the dashboard with its two recordings');
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.detail-header')", { label: 'the holding to archive' });
  const archiving = await page.eval("document.querySelector('.screen-heading').textContent");

  // ---- Archiving records the zero ---------------------------------------

  // manage-accounts.md: archiving onto a date that already holds this
  // holding's figure says the zero replaces it before the confirm,
  // shows no replace prompt, and leaves exactly one figure there at
  // version + 1, valued zero with a fresh nonce. No snapshot is
  // deleted, and the chart before the archive date is unchanged.
  const archivingId = (await page.eval('location.hash')).split('/')[2];
  const archiveDay = await page.eval('new Date().toISOString().slice(0, 10)');
  const snapshotState = () =>
    page.call(async (holdingId, day) => {
      const api = await import('/static/js/api.js');
      const decimal = await import('/static/js/decimal.js');
      const v = (await import('/static/js/session.js')).currentVault();
      const rows = await api.get('/api/records?type=snapshot');
      const here = v.snapshotsFor(holdingId).filter((s) => s.payload.date === day);
      return JSON.stringify({
        stored: rows.length,
        here: here.map((s) => ({
          id: s.recordId,
          version: s.version,
          value: s.payload.value,
          note: s.payload.note,
          nonce: rows.find((r) => r.recordId === s.recordId)?.nonce,
          figure: String(decimal.parse(s.payload.value)),
        })),
      });
    }, archivingId, archiveDay).then(JSON.parse);
  // The chart's own table, every row but the archive date's.
  const chartOffArchiveDay = async () => {
    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.chart-card details table')", { label: 'the chart table' });
    await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
    await page.frames();
    return page.call(async (archived) => {
      const v = (await import('/static/js/session.js')).currentVault();
      const day = v.format.longDate(archived);
      return JSON.stringify([...document.querySelectorAll('.chart-card details table tbody tr')]
        .filter((r) => r.cells[0].textContent !== day).map((r) => r.textContent));
    }, archiveDay);
  };
  const chartBeforeArchive = await chartOffArchiveDay();
  await page.call((id) => { location.hash = `#/holding/${id}`; }, archivingId);
  await page.waitUntil("document.querySelector('.detail-header')", { label: 'the holding to archive' });
  await page.frames();
  const beforeArchive = await snapshotState();

  await click('Archive');
  await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", {
    label: 'the archive dialog',
  });
  check('archive is offered before deleting', (await text()).includes('You can undo this'));
  check(
    'the archive dialog says it records zero on the day it is made',
    (await text()).includes(`Records zero for this holding on ${await page.call(async (day) => (await import('/static/js/session.js')).currentVault().format.longDate(day), archiveDay)}`),
  );
  check(
    'the archive dialog offers no value field and no way to archive without the zero',
    await page.eval(`(() => {
      const open = [...document.querySelectorAll('.dialog input:not([type=radio]), .dialog textarea')].filter((i) => !i.closest('[hidden]'));
      const buttons = [...document.querySelectorAll('.dialog button')].map((b) => b.textContent);
      return open.length === 0 && !document.querySelector('#closing-value') && !buttons.some((b) => /skip/i.test(b)) &&
        !/closing value/i.test(document.querySelector('.dialog').textContent);
    })()`),
  );
  check(
    'archive is the preselected choice, and permanent delete waits behind its own',
    await page.eval(`(() => {
      const choice = document.querySelector('.dialog input[value=archive]');
      const button = [...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Delete permanently');
      return choice.checked && button.hidden && !document.querySelector('.dialog input[value=delete]').checked;
    })()`),
  );
  const named = await page.call(async (value, id) => {
    const v = (await import('/static/js/session.js')).currentVault();
    return v.amount(value, v.holdings.get(id).payload.unit);
  }, beforeArchive.here[0]?.value, archivingId);
  check(
    'an occupied archive date names the figure the zero replaces, above the confirm',
    beforeArchive.here.length === 1 && (await text()).includes(`This replaces the ${named} `),
    `${named} against ${JSON.stringify(beforeArchive.here)}`,
  );

  // Every dialog heading that appears from here to the archive landing.
  await page.eval(`(() => {
    window.__headings = [];
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('.dialog-heading')) window.__headings.push(node.textContent);
    }).observe(document.body, { childList: true, subtree: true });
  })()`);
  await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Archive').click()");
  await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive to land' });
  await page.idle();
  const headings = await page.eval('window.__headings');
  check(
    'archiving onto an occupied date shows no replace prompt',
    !headings.some((heading) => heading.startsWith('Replace')),
    headings.join(' | '),
  );
  const afterArchive = await snapshotState();
  check(
    'it leaves exactly one figure at that date: the same record at version + 1, a fresh nonce, zero, the note kept',
    afterArchive.here.length === 1 &&
      afterArchive.here[0].id === beforeArchive.here[0].id &&
      afterArchive.here[0].version === beforeArchive.here[0].version + 1 &&
      afterArchive.here[0].nonce !== beforeArchive.here[0].nonce &&
      afterArchive.here[0].value === '0' &&
      afterArchive.here[0].note === beforeArchive.here[0].note,
    `${JSON.stringify(beforeArchive.here)} then ${JSON.stringify(afterArchive.here)}`,
  );
  check('archiving deletes no snapshot', afterArchive.stored === beforeArchive.stored, `${beforeArchive.stored} then ${afterArchive.stored}`);
  const archivedRecord = await page.call(async (id) => {
    const v = (await import('/static/js/session.js')).currentVault();
    return v.holdings.get(id).payload.archivedAt;
  }, archivingId);
  check('the account record gains archivedAt', archivedRecord === archiveDay, archivedRecord);
  check('an archived holding carries its chip', (await text()).includes('Archived'));
  check('it offers Unarchive rather than Archive', (await labels('.form-actions button')).includes('Unarchive'));
  check('an archived holding takes no new value', !(await labels('.form-actions button')).includes('Record a value'));
  check(
    "the archive's zero offers no edit, clear or delete on the holding's page",
    await page.call(async (day) => {
      const v = (await import('/static/js/session.js')).currentVault();
      const row = [...document.querySelectorAll('.card .data-table tbody tr')]
        .find((r) => r.cells[0] && r.cells[0].textContent.includes(v.format.longDate(day)));
      return Boolean(row) && row.querySelectorAll('.btn-inline').length === 0 && row.cells[1].textContent.length > 0;
    }, archiveDay),
  );

  const chartAfterArchive = await chartOffArchiveDay();
  check('the chart before the archive date is unchanged', chartAfterArchive === chartBeforeArchive, `${chartBeforeArchive} then ${chartAfterArchive}`);
  const listed = await page.eval(
    "[...document.querySelectorAll('.data-table tbody .link-button')].map(b => b.textContent)",
  );
  check('an archived holding leaves the current total', !listed.includes(archiving), `${archiving} in ${listed.join(',')}`);

  // net-worth-view.md, Archived holdings: a holding archived on the newest
  // recorded date is in no total from that date on, so the headline, the
  // chart's last point, the table's last row and the change over the
  // range all agree.
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.detail-header')", { label: 'a second holding to archive' });
  const skippedId = (await page.eval('location.hash')).split('/')[2];
  await click('Archive');
  await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", { label: 'the second archive dialog' });
  await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Archive').click()");
  await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the second archive to land' });
  await page.idle();
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.chart-card details table')", { label: 'the chart after a skipped archive' });
  await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
  await page.frames();
  const skippedArchive = await page.call(async (holdingId) => {
    const v = (await import('/static/js/session.js')).currentVault();
    const { dayNumber } = await import('/static/js/model.js');
    const total = v.totals('latest').net;
    const rows = [...document.querySelectorAll('.chart-card details table tbody tr')];
    const first = v.series(null, dayNumber(v.recordingDates()[0]), dayNumber(v.chartLastDate())).bands[0].points[0];
    const edge = document.querySelector('.net-line').getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
    const [x, y] = edge.at(-1);
    return JSON.stringify({
      headline: document.querySelector('.hero-amount').textContent === v.format.money(total),
      lastRow: rows.at(-1).cells[1].textContent === v.format.money(total),
      lastDate: rows.at(-1).cells[0].textContent === v.format.longDate(v.chartLastDate()),
      change: document.querySelector('.hero-delta').textContent.startsWith('CHF ' + (total - first > 0n ? '+' : '') + v.format.money(total - first)),
      edgeDot: Number(document.querySelector('.net-end').getAttribute('cy')) === y,
      // The zero is recorded at the archive date, so the holding is on neither side of it.
      zeroRecorded: v.snapshotsFor(holdingId).some((s) => s.payload.value === '0' && s.payload.date === v.holdings.get(holdingId).payload.archivedAt),
    });
  }, skippedId).then(JSON.parse);
  for (const [name, held] of Object.entries(skippedArchive)) {
    check(`archived on the newest date: ${name}`, held, JSON.stringify(skippedArchive));
  }
  // Back to active, so what follows reads the vault as it was.
  await page.call((id) => { location.hash = `#/holding/${id}`; }, skippedId);
  await page.waitUntil("document.querySelector('.detail-header')", { label: 'the holding to unarchive' });
  await page.frames();
  await click('Unarchive');
  await page.waitUntil("[...document.querySelectorAll('.form-actions button')].some(b => b.textContent === 'Archive')", { label: 'the holding active again' });
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.entry-mark')", { label: 'the dashboard after unarchiving' });
  await page.frames();


  {
    await recordWrites();

    // What creating a holding with markup in every string leaves, which
    // the form's own part makes through the form.
    const XSS = '<img src=x onerror=alert(1)>';
    const NAME = `Name ${XSS}`;
    const NOTE = `Note ${XSS}`;
    const AXIS = `Axis ${XSS}`;
    const BAND = `Band ${XSS}`;
    await setProfile({
      dimensions: [
        {
          id: 'liqd0001', label: 'Liquid assets', archivedAt: null,
          values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }, { id: 'retire01', label: 'Retirement', archivedAt: null }],
        },
        {
          id: 'region01', label: 'Region', archivedAt: null,
          values: [{ id: 'home0001', label: 'Home', archivedAt: null }, { id: 'abroad01', label: 'Abroad', archivedAt: null }],
        },
        { id: 'axis0001', label: AXIS, archivedAt: null, values: [{ id: 'band0001', label: BAND, archivedAt: null }] },
      ],
    });
    const [probeId] = await plant([{
      type: 'account',
      payload: {
        name: NAME, unit: 'CHF', dims: { region01: 'home0001', axis0001: 'band0001', liqd0001: 'retire01' }, note: NOTE,
        archivedAt: null, createdAt: new Date().toISOString(),
      },
    }]);
    await plant([{ type: 'snapshot', accountId: probeId, payload: { date: BACKDATE, value: '5000', note: 'kept in the safe' } }]);
    const axis = await vaultValue((v, label) => v.dimensions.find((d) => d.label === label), AXIS);
    await reloadModel();
    await writesSeen();

    // -- Archiving writes the zero, whatever the holding held --------------------

    const today = await page.eval('new Date().toISOString().slice(0, 10)');
    const [skipId] = await plant([{
      type: 'account',
      payload: { name: 'Probe zero', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() },
    }]);
    await plant([{ type: 'snapshot', accountId: skipId, payload: { date: BACKDATE, value: '700', note: null } }]);
    await reloadModel();

    await openHolding(probeId);
    await click('Archive');
    await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", { label: 'the archive dialog' });
    check(
      'a free archive date states no replacement and offers no value to give',
      !(await text()).includes('This replaces') && !(await page.eval("Boolean(document.querySelector('#closing-value'))")),
    );
    await inDialog('Archive');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive' });
    await page.idle();
    const closing = await vaultValue((v, id, day) => v.snapshotsFor(id).filter((s) => s.payload.date === day).map((s) => s.payload.value), probeId, today);
    check('archiving writes one zero dated the archive date', closing.join(',') === '0', closing.join(','));

    await openHolding(skipId);
    await click('Archive');
    await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", { label: 'the second archive dialog' });
    await inDialog('Archive');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the second archive' });
    await page.idle();
    const zeroed = await vaultValue((v, id) => ({ archivedAt: v.holdings.get(id).payload.archivedAt, figures: v.snapshotsFor(id).map((s) => s.payload.date + ':' + s.payload.value + ':' + s.version) }), skipId);
    check(
      'archiving a holding with an earlier figure adds the zero and leaves that figure as it was',
      zeroed.archivedAt === today && zeroed.figures.join(',') === `${BACKDATE}:700:1,${today}:0:1`,
      JSON.stringify(zeroed),
    );

    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.chart-controls select')", { label: 'the dashboard after archiving' });
    await choose('.chart-controls select', axis.id);
    await page.frames();
    await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
    await page.frames();
    const band = JSON.parse(await page.call(async (bandLabel, axisId, day) => {
      const v = (await import('/static/js/session.js')).currentVault();
      const table = document.querySelector('.chart-card details table');
      const column = [...table.querySelectorAll('thead th')].findIndex(th => th.textContent === bandLabel);
      const row = [...table.querySelectorAll('tbody tr')].find(r => r.cells[0].textContent === v.format.longDate(day));
      const decimal = await import('/static/js/decimal.js');
      const { dayNumber } = await import('/static/js/model.js');
      // The side just before the archive date is the zero.
      const { days, bands } = v.series(v.dimensions.find((d) => d.id === axisId), dayNumber(v.recordingDates()[0]), dayNumber(day));
      const before = bands.find((b) => b.label === bandLabel).before;
      const index = days.indexOf(dayNumber(day));
      return JSON.stringify({
        shown: row && column > 0 ? row.cells[column].textContent : null,
        expected: v.format.money(decimal.ZERO),
        before: String(before.assets[index] + before.liabilities[index]),
        zero: String(decimal.ZERO),
      });
    }, BAND, axis.id, today));
    check("the band's value on the archive date leaves the archived holding out", band.shown === band.expected, JSON.stringify(band));
    check("the band's side just before the archive date is the zero: no edge", band.before === band.zero, JSON.stringify(band));
    const annotations = await page.eval("[...document.querySelectorAll('.archive-annotation title')].map(t => t.textContent)");
    check(
      'both archive dates are annotated, naming the holding as literal text',
      annotations.includes(`${NAME} archived`) && annotations.includes('Probe zero archived'),
      annotations.join(' | '),
    );
    await choose('.chart-controls select', '');

    // -- When another window got to the archive date first ---------------------

    const [raceId, conflictId] = await plant([
      { type: 'account', payload: { name: 'Probe race', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
      { type: 'account', payload: { name: 'Probe conflict', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
    ]);
    const [heldId] = await plant([{ type: 'snapshot', accountId: conflictId, payload: { date: today, value: '321', note: 'kept' } }]);
    await reloadModel();

    // The model says the date is free; another window records the holding there.
    await openHolding(raceId);
    await click('Archive');
    await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", { label: 'the race archive dialog' });
    await plant([{ type: 'snapshot', accountId: raceId, payload: { date: today, value: '55', note: null } }]);
    await writesSeen();
    await inDialog('Archive');
    await page.waitUntil("document.body.innerText.includes('Nothing was archived.')", { label: 'the refusal' });
    check(
      "a date another window recorded for this holding refuses the archive, writes nothing, and reopens on what it now holds",
      (await text()).includes('now holds a figure for this holding, recorded in another window') &&
        (await text()).includes('This replaces the') && (await text()).includes('55') &&
        (await writesSeen()).length === 0 && !(await vaultValue((v, id) => v.holdings.get(id).payload.archivedAt, raceId)),
    );
    await inDialog('Archive');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive after the refusal' });
    await page.idle();
    check(
      'archiving again replaces that figure in place with the zero',
      JSON.stringify(await vaultValue((v, id) => v.snapshotsFor(id).map(s => s.payload.value + ':' + s.version), raceId)) === JSON.stringify(['0:2']),
    );

    // The stated figure changed in another window: the replacement is stated again.
    await openHolding(conflictId);
    await click('Archive');
    await page.waitUntil("document.body.innerText.includes('This replaces the')", { label: 'the conflict archive dialog' });
    await plant([{ type: 'snapshot', recordId: heldId, version: 2, accountId: conflictId, payload: { date: today, value: '999', note: 'kept' } }]);
    await writesSeen();
    provoked.push(`/api/records/${heldId}`);
    await inDialog('Archive');
    await page.waitUntil("document.body.innerText.includes('This figure was changed in another window.')", { label: 'the conflict' });
    check(
      'a replacement that met a Conflict is not retried, and states the figure now stored',
      (await text()).includes('999') && (await writesSeen()).length === 1 &&
        !(await vaultValue((v, id) => v.holdings.get(id).payload.archivedAt, conflictId)),
    );
    await inDialog('Cancel');
    await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });

    // -- When a write in the archive or delete flow fails -----------------------

    const [euroId, poundId] = await plant([
      { type: 'account', payload: { name: 'Probe euro', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
      { type: 'account', payload: { name: 'Probe pound', unit: 'GBP', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
    ]);
    await plant([
      { type: 'snapshot', accountId: euroId, payload: { date: BACKDATE, value: '100', note: null } },
      { type: 'snapshot', accountId: poundId, payload: { date: BACKDATE, value: '200', note: null } },
    ]);
    await reloadModel();

    await openHolding(euroId);
    await failing(writing(null, 'DELETE'), async () => {
      await page.eval("[...document.querySelectorAll('.card .data-table button')].find(b => b.textContent === 'Delete').click()");
      await page.waitUntil("document.querySelector('.dialog')", { label: 'the delete snapshot dialog' });
      await inDialog('Delete');
      await page.waitUntil("document.querySelector('.card .data-table .field-error:not([hidden])')", { label: 'the failed delete' });
    });
    check(
      'a failed delete is reported on its row, and the row stays',
      (await page.eval("document.querySelector('.card .data-table .field-error:not([hidden])').closest('tr').textContent")).includes('Nothing was deleted.') &&
        (await vaultValue((v, id) => v.snapshotsFor(id).length, euroId)) === 1,
    );

    await click('Archive');
    await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", { label: 'the euro archive dialog' });
    await failing(writing('snapshot'), async () => {
      await inDialog('Archive');
      await page.waitUntil("document.body.innerText.includes('did not save, so nothing was archived')", { label: 'the zero failure' });
    });
    check(
      'a zero that does not save archives nothing, writes no price, and leaves the dialog open',
      Boolean(await page.eval("document.querySelector('.dialog')")) &&
        !(await vaultValue((v, id) => v.holdings.get(id).payload.archivedAt, euroId)) &&
        (await vaultValue((v, id) => v.snapshotsFor(id).length, euroId)) === 1 &&
        (await vaultValue((v, day) => v.recording(day).prices.some(p => p.payload.symbol === 'EUR'), today)) === false,
    );
    await failing(writing('rate'), async () => {
      await inDialog('Archive');
      await page.waitUntil("document.body.innerText.includes('Add them in the recording for that date')", { timeout: 60000, label: 'the price failure' });
    });
    const priceMessage = await text();
    check(
      'a zero whose prices do not save still archives, naming the units and linking the recording',
      priceMessage.includes('Archived. The prices for EUR') &&
        (await labels('.dialog button')).includes('Open the recording') &&
        (await vaultValue((v, id) => v.holdings.get(id).payload.archivedAt, euroId)) === today &&
        (await vaultValue((v, id, day) => v.snapshotsFor(id).filter(s => s.payload.date === day).length, euroId, today)) === 1,
      priceMessage.slice(0, 400),
    );
    await inDialog('Close');
    await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });

    // The date field's own message line, whether the input names it, and
    // whatever the dialog's general line says: a date refusal belongs on
    // the first and never on the last.
    const dateState = () => page.eval(`(() => {
      const input = document.querySelector('#snapshot-date');
      const line = document.querySelector('#snapshot-date-line');
      const general = [...document.querySelectorAll('.dialog .field-error:not([hidden])')].filter((n) => n !== line);
      return {
        line: line ? line.textContent : null,
        linked: Boolean(line) && (input.getAttribute('aria-describedby') || '').split(' ').includes(line.id),
        invalid: input.getAttribute('aria-invalid'),
        general: general.map((n) => n.textContent).join(''),
      };
    })()`);
    const typeDay = async (day) =>
      setValue('#snapshot-date', await page.call(async (d) => (await import('/static/js/session.js')).currentVault().format.date(d), day));
    const fullDay = (day) =>
      page.call(async (d) => (await import('/static/js/session.js')).currentVault().format.fullDate(d), day);
    const shiftDay = (day, by) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86400000).toISOString().slice(0, 10);

    // An archived holding's earlier figure still takes a new value, and its
    // date picker offers nothing from the archive date on.
    await page.eval("[...document.querySelectorAll('.card .data-table button')].find(b => b.textContent === 'Edit').click()");
    await page.waitUntil("document.querySelector('#snapshot-value')", { label: "an archived holding's earlier entry" });
    const archivedHint = `Archived on ${await fullDay(today)}.`;
    const opened = await dateState();
    check(
      "an archived holding's entry carries the archive on the date field's line from the moment the dialog opens",
      opened.line === archivedHint && opened.invalid === null && opened.general === '',
      JSON.stringify(opened),
    );
    const dateText = await page.call(async (day) => (await import('/static/js/session.js')).currentVault().format.date(day), today);
    await setValue('#snapshot-date', dateText);
    await writesSeen();
    await inDialog('Save');
    await page.idle();
    check(
      "an archived holding's earlier entry cannot be moved onto the archive date",
      Boolean(await page.eval("document.querySelector('.dialog')")) && (await writesSeen()).length === 0 &&
        (await vaultValue((v, id) => v.snapshotsFor(id).map(s => s.payload.date).sort().join(','), euroId)) === `${BACKDATE},${today}`,
    );
    const refused = await dateState();
    check(
      "the archive date typed into an archived holding's entry is refused on the date field's own line with the archive's reason",
      refused.line === `${archivedHint.slice(0, -1)}. Enter an earlier date.` && refused.linked && refused.invalid === 'true',
      JSON.stringify(refused),
    );
    check(
      'a refused archive date puts nothing in the dialog general line, and never the future wording',
      refused.general === '' && !(await page.eval("document.querySelector('.dialog').textContent")).includes('future'),
      JSON.stringify(refused),
    );
    await typeDay(shiftDay(today, 1));
    await inDialog('Save');
    await page.idle();
    const after = await dateState();
    check(
      "a date after today is refused with the archive's reason on an archived holding, not the future one",
      after.line === refused.line && after.general === '' && (await writesSeen()).length === 0,
      JSON.stringify(after),
    );
    await typeDay(BACKDATE);
    const fits = await dateState();
    check(
      'the refusal clears as soon as an earlier date is typed back, before Save, and the line returns to the hint',
      fits.line === archivedHint && fits.invalid === null && fits.general === '',
      JSON.stringify(fits),
    );
    const earlierText = await page.call(async (day) => (await import('/static/js/session.js')).currentVault().format.date(day), BACKDATE);
    await setValue('#snapshot-date', earlierText);
    await setValue('#snapshot-value', '110');
    await inDialog('Save');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the earlier entry to save' });
    check(
      "an archived holding's earlier value can still be edited",
      JSON.stringify(await vaultValue((v, id, day) => v.snapshotsFor(id).filter(s => s.payload.date === day).map(s => s.payload.value + ':' + s.version), euroId, BACKDATE)) === JSON.stringify(['110:2']),
    );

    // A holding archived on a past date: every date from it up to today, and
    // after today, is refused with the archive as the reason.
    const archivedDay = shiftDay(today, -10);
    const [pastId] = await plant([
      { type: 'account', payload: { name: 'Probe past archive', unit: 'CHF', dims: {}, note: null, archivedAt: archivedDay, createdAt: new Date().toISOString() } },
    ]);
    await plant([
      { type: 'snapshot', accountId: pastId, payload: { date: shiftDay(today, -20), value: '40', note: null } },
      { type: 'snapshot', accountId: pastId, payload: { date: archivedDay, value: '0', note: null } },
    ]);
    await reloadModel();
    await openHolding(pastId);
    await page.eval("[...document.querySelectorAll('.card .data-table button')].find(b => b.textContent === 'Edit').click()");
    await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the entry before a past archive' });
    const pastReason = `Archived on ${await fullDay(archivedDay)}. Enter an earlier date.`;
    await writesSeen();
    for (const day of [archivedDay, shiftDay(archivedDay, 3), today, shiftDay(today, 1)]) {
      await typeDay(day);
      await inDialog('Save');
      await page.idle();
      const state = await dateState();
      check(
        `${day} is refused on the entry of a holding archived on ${archivedDay}, with the archive as the reason`,
        state.line === pastReason && state.linked && state.invalid === 'true' && state.general === '' && (await writesSeen()).length === 0,
        JSON.stringify(state),
      );
    }
    await typeDay(shiftDay(archivedDay, -1));
    const cleared = await dateState();
    check(
      'the day before the archive fits, and the refusal is gone before Save',
      cleared.line === `Archived on ${await fullDay(archivedDay)}.` && cleared.invalid === null,
      JSON.stringify(cleared),
    );
    await inDialog('Cancel');
    await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });

    // A figure sitting on the archive date, planted as a stale session leaves
    // it, keeps its own date when edited, and becomes the archive's zero when
    // edited to zero. It still cannot move to another date from D on.
    const [staleId] = await plant([
      { type: 'account', payload: { name: 'Probe stale figure', unit: 'CHF', dims: {}, note: null, archivedAt: archivedDay, createdAt: new Date().toISOString() } },
    ]);
    await plant([
      { type: 'snapshot', accountId: staleId, payload: { date: shiftDay(today, -20), value: '40', note: null } },
      { type: 'snapshot', accountId: staleId, payload: { date: archivedDay, value: '7', note: null } },
    ]);
    await reloadModel();
    await openHolding(staleId);
    await page.eval("[...document.querySelectorAll('.card .data-table button')].find(b => b.textContent === 'Edit').click()");
    await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the figure on the archive date' });
    await writesSeen();
    await typeDay(shiftDay(archivedDay, 2));
    await inDialog('Save');
    await page.idle();
    const offArchive = await dateState();
    check(
      'a figure on the archive date cannot move to a later date, and the archive is the reason',
      offArchive.line === pastReason && offArchive.invalid === 'true' && (await writesSeen()).length === 0,
      JSON.stringify(offArchive),
    );
    await typeDay(archivedDay);
    await setValue('#snapshot-value', '0');
    await inDialog('Save');
    await page.waitUntil("!document.querySelector('.dialog')", { label: 'the figure on the archive date to save' });
    check(
      'a figure on the archive date saves under its own date, edited to zero',
      (await vaultValue((v, id, day) => v.snapshotsFor(id).filter((s) => s.payload.date === day).map((s) => s.payload.value).join(','), staleId, archivedDay)) === '0',
    );

    await openHolding(poundId);
    await click('Archive');
    await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", { label: 'the pound archive dialog' });
    await failing(writing('account'), async () => {
      await inDialog('Archive');
      await page.waitUntil("document.body.innerText.includes('but the holding was not archived')", { timeout: 60000, label: 'the flag failure' });
    });
    check(
      'a zero saved without the archive flag says both halves, keeps the holding active at zero, and offers the archive again',
      (await text()).includes('It is still in your total, at zero.') &&
        !(await vaultValue((v, id) => v.holdings.get(id).payload.archivedAt, poundId)) &&
        (await vaultValue((v, id) => v.valueOf(v.holdings.get(id)).stored, poundId)) === '0' &&
        (await vaultValue((v, id) => v.activeHoldings().some(h => h.recordId === id), poundId)) &&
        (await labels('.dialog button')).includes('Archive'),
    );
    await writesSeen();
    await inDialog('Archive');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive offered again' });
    await page.idle();
    check(
      'the archive offered again writes only the flag, with one zero at the date',
      JSON.stringify(await writesSeen()) === JSON.stringify(['account']) &&
        (await vaultValue((v, id) => v.holdings.get(id).payload.archivedAt, poundId)) === today &&
        (await vaultValue((v, id, day) => v.snapshotsFor(id).filter(s => s.payload.date === day).length, poundId, today)) === 1,
    );

    // The account record changed in another tab while the dialog was open: the
    // flag meets a Conflict, the record is read back, and the archive is offered
    // again against it.
    const [tabId] = await plant([
      { type: 'account', payload: { name: 'Probe tab', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
    ]);
    await plant([{ type: 'snapshot', accountId: tabId, payload: { date: BACKDATE, value: '30', note: null } }]);
    await reloadModel();
    await openHolding(tabId);
    await click('Archive');
    await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", { label: 'the tab archive dialog' });
    await plant([{ type: 'account', recordId: tabId, version: 2, payload: { name: 'Probe tab renamed', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } }]);
    provoked.push(`/api/records/${tabId}`);
    await inDialog('Archive');
    await page.waitUntil("document.body.innerText.includes('This holding was changed in another tab.')", { timeout: 60000, label: 'the flag conflict' });
    check(
      'a Conflict on the archive flag says the holding changed in another tab, reloads it, and keeps the zero',
      (await text()).includes('Archive or delete Probe tab renamed?') &&
        (await vaultValue((v, id) => v.holdings.get(id).version, tabId)) === 2 &&
        !(await vaultValue((v, id) => v.holdings.get(id).payload.archivedAt, tabId)) &&
        (await vaultValue((v, id, day) => v.snapshotsFor(id).filter(s => s.payload.date === day).length, tabId, today)) === 1,
    );
    await inDialog('Archive');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive after the conflict' });
    await page.idle();
    check(
      'archiving again after that Conflict archives against the reloaded record',
      (await vaultValue((v, id) => v.holdings.get(id).payload.archivedAt, tabId)) === today &&
        (await vaultValue((v, id) => v.holdings.get(id).version, tabId)) === 3,
    );

    // -- The zero is read-only; deleting its recording keeps it; purge takes it -----

    const zeroDay = new Date(Date.parse(BACKDATE) - 86400000).toISOString().slice(0, 10);
    const earlyDay = new Date(Date.parse(BACKDATE) - 5 * 86400000).toISOString().slice(0, 10);
    const [zeroedId, sittingId] = await plant([
      { type: 'account', payload: { name: 'Probe zeroed', unit: 'CHF', dims: {}, note: null, archivedAt: zeroDay, createdAt: new Date().toISOString() } },
      { type: 'account', payload: { name: 'Probe sitting', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
    ]);
    const [zeroRecordId] = await plant([
      { type: 'snapshot', accountId: zeroedId, payload: { date: zeroDay, value: '0.00', note: null } },
      { type: 'snapshot', accountId: zeroedId, payload: { date: earlyDay, value: '50', note: null } },
      { type: 'snapshot', accountId: sittingId, payload: { date: zeroDay, value: '10', note: null } },
      { type: 'rate', payload: { symbol: 'USD', date: zeroDay, rate: '0.9', rateTarget: 'CHF', rateSource: 'manual', rateAsOf: null, proposedRate: null } },
    ]);
    await reloadModel(`#/recording/${zeroDay}`);
    const zeroRow = () => JSON.stringify(sql('SELECT records.* FROM records ' + OWN + ' AND record_id = ?', zeroRecordId));
    const zeroKept = zeroRow();
    await page.waitUntil("document.querySelector('.recording')", { label: 'the recording at the archive date' });
    check(
      "the archive's zero is listed in its recording like any other figure",
      (await page.eval("[...document.querySelectorAll('.recording tbody tr')].map(r => r.textContent).join('|')")).includes('Probe zeroed'),
    );
    await click('Delete');
    await page.waitUntil("document.body.innerText.includes('Delete the recording for')", { label: 'the delete dialog at the archive date' });
    check(
      "the confirmation says the archive's zero stays",
      (await text()).includes('The zero recorded when you archived Probe zeroed stays, and so does this recording, holding it.'),
    );
    await click('Delete the recording');
    await page.waitUntil("!document.querySelector('.dialog')", { label: 'the recording to be deleted' });
    await page.idle();
    check(
      "deleting the recording at the archive date keeps the zero byte-identical, and the date still opens holding it",
      zeroRow() === zeroKept && (await page.eval('location.hash')) === `#/recording/${zeroDay}` &&
        (await page.eval("document.querySelector('.recording tbody').textContent")).includes('Probe zeroed') &&
        !(await page.eval("document.querySelector('.recording tbody').textContent")).includes('Probe sitting') &&
        (await vaultValue((v, day) => v.recording(day).prices.length, zeroDay)) === 0 &&
        !(await labels('.form-actions button')).includes('Delete'),
    );

    await click('Update');
    await page.waitUntil("document.querySelector('.sweep-row')", { label: 'the sweep at the archive date' });
    await page.idle();
    const sweepRow = JSON.parse(await page.call((id) => JSON.stringify((() => {
      const row = document.querySelector(`.sweep-row[data-holding="${id}"]`);
      const visible = (n) => !n.closest('[hidden]');
      return {
        sentence: row.querySelector('.row-status').textContent,
        fields: [...row.querySelectorAll('input')].filter(visible).length,
        buttons: [...row.querySelectorAll('button')].filter(visible).length,
        text: row.querySelector('.archive-zero').textContent,
      };
    })()), zeroedId));
    check(
      "the update row for the archive's zero is text with no control",
      sweepRow.sentence.includes('Archived at zero on this date.') && sweepRow.fields === 0 && sweepRow.buttons === 0 && sweepRow.text.length > 0,
      JSON.stringify(sweepRow),
    );

    await openHolding(zeroedId);
    check(
      "the archive's zero has no row action while an earlier figure keeps both",
      JSON.stringify(await page.eval(`[...document.querySelectorAll('.card .data-table tbody tr')].map(r => r.querySelectorAll('.btn-inline').length)`)) === JSON.stringify([0, 2]),
    );

    await click('Delete');
    await page.waitUntil("document.querySelector('.dialog')", { label: 'the purge dialog' });
    await page.frames();
    check(
      'Delete on an archived holding offers permanent delete alone, never Archive',
      await page.eval(`(() => {
        const visible = (n) => !n.closest('[hidden]') && !n.hidden;
        const buttons = [...document.querySelectorAll('.dialog button')].filter(visible).map((b) => b.textContent);
        return buttons.includes('Delete permanently') && !buttons.includes('Archive') &&
          ![...document.querySelectorAll('.dialog input[type=radio]')].some(visible) &&
          document.querySelector('.dialog-heading').textContent === 'Delete Probe zeroed?';
      })()`),
    );
    await setValue('#delete-name', 'Probe zeroed');
    await inDialog('Delete permanently');
    await page.waitUntil("location.hash === '#/'", { label: 'the dashboard after the purge' });
    await page.idle();
    check(
      "purging an archived holding deletes its zero with every other snapshot",
      sql('SELECT 1 FROM records ' + OWN + ' AND records.account_id = ?', zeroedId).length === 0 && !rowOf(zeroRecordId),
    );

    // A holding with no values reaches the archive dialog from its own Archive
    // action, gets the zero as its only figure, and keeps its unit locked once
    // unarchived.
    const [emptyId] = await plant([
      { type: 'account', payload: { name: 'Probe empty', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
    ]);
    await reloadModel();
    await openHolding(emptyId);
    await click('Archive');
    await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", { label: 'the archive dialog of a holding with no values' });
    await page.eval("document.querySelector('.dialog input[value=delete]').click()");
    await page.frames();
    check(
      'a holding with no values says its delete takes no values and changes no past figure',
      (await text()).includes('There are no recorded values to delete. Your past net worth figures stay as they are.') &&
        !(await text()).includes('will change'),
    );
    await page.eval("document.querySelector('.dialog input[value=archive]').click()");
    await page.frames();
    await inDialog('Archive');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the empty holding to archive' });
    await page.idle();
    check(
      'a holding with no values archives to a zero at version 1 as its only figure',
      JSON.stringify(await vaultValue((v, id) => v.snapshotsFor(id).map(s => s.payload.date + ':' + s.payload.value + ':' + s.version), emptyId)) === JSON.stringify([`${today}:0:1`]) &&
        (await vaultValue((v, id) => v.holdings.get(id).payload.archivedAt, emptyId)) === today,
    );
    await click('Delete');
    await page.waitUntil("document.querySelector('.dialog')", { label: 'the purge dialog of a holding with only its zero' });
    await page.frames();
    check(
      'a holding whose only figure is its zero deletes 1 recorded value and changes no past figure',
      (await text()).includes('This also deletes 1 recorded value. Your past net worth figures stay as they are.'),
    );
    await inDialog('Cancel');
    await page.waitUntil('!document.querySelector(".dialog")', { label: 'the purge dialog to close' });
    await click('Unarchive');
    await page.waitUntil("[...document.querySelectorAll('.form-actions button')].some(b => b.textContent === 'Archive')", { label: 'the empty holding active again' });
    check('unarchived, it reads zero, not not yet valued', (await page.eval("document.querySelector('.hero-figure').textContent")).trim() !== 'Not yet valued');
    await click('Edit');
    await page.waitUntil("document.querySelector('#holding-unit')", { label: 'the editor of the unarchived holding' });
    await page.frames();
    check('its unit stays locked, because the zero is a recorded figure', await page.eval("document.querySelector('#holding-unit').disabled"));
    await page.eval("[...document.querySelectorAll('#app .panel-form button')].find(b => b.textContent === 'Cancel').click()");
    await page.waitUntil("!document.querySelector('#holding-unit')", { label: 'the editor to close' });
    // -- Unarchiving, from the dashboard's archived rows ------------------------

    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard to unarchive from' });
    await page.eval("[...document.querySelectorAll('.holdings-card .checkbox input')][0].click()");
    await page.frames();
    const rowActions = await page.call((name) => [...[...document.querySelectorAll('.holdings-table tbody tr')]
      .find((r) => r.querySelector('.row-name').textContent === name).querySelectorAll('.cell-action button')]
      .map((b) => b.textContent), archiving);
    check('an archived row offers Unarchive and no new value', rowActions.join(',') === 'Unarchive', rowActions.join(','));
    const heroBeforeUnarchive = await page.eval("document.querySelector('.hero-figure').textContent");
    const archivedId = (await idNamed(archiving))[0];
    const zeroBytes = () => JSON.stringify(sql(`SELECT records.* FROM records ${OWN} AND record_type = 'snapshot' AND records.account_id = ? ORDER BY record_id`, archivedId));
    const zeroBefore = await zeroBytes();
    await writesSeen();
    await landing(() => page.call((name) => [...document.querySelectorAll('.holdings-table tbody tr')]
      .find((r) => r.querySelector('.row-name').textContent === name).querySelector('.cell-action button').click(), archiving));
    check(
      'unarchiving writes the account record alone and leaves every snapshot, the zero included, byte-identical',
      JSON.stringify(await writesSeen()) === JSON.stringify(['account']) && (await zeroBytes()) === zeroBefore,
    );
    await page.eval("[...document.querySelectorAll('.holdings-card .checkbox input')][0].checked && [...document.querySelectorAll('.holdings-card .checkbox input')][0].click()");
    await page.frames();
    const back = await page.eval(`[...document.querySelectorAll('.holdings-table .row-name')].map(b => b.textContent)`);
    const heroNow = await page.eval("document.querySelector('.hero-figure').textContent");
    check(
      'unarchiving returns the holding to the active list and to the current total, at zero',
      back.includes(archiving) && heroNow === heroBeforeUnarchive,
      `${back.join(',')}: ${heroNow} against ${heroBeforeUnarchive}`,
    );
    // -- On a phone ----------------------------------------------------------------

    // app-shell.md, On a phone, and manage-accounts.md, Account detail, At
    // phone width: with the widest rows the list can hold, a long figure
    // with a note and two entries sharing a date, nothing pans sideways,
    // no box scrolls sideways, every control lies on the screen where a
    // tap at its center lands on it, and no date wraps. Its name has no
    // point a line may break at and is wider than a phone.
    const goldId = (await idNamed('Gold bars'))[0];
    await page.call(async (id, day, name) => {
      const writes = await import('/static/js/writes.js');
      const v = (await import('/static/js/session.js')).currentVault();
      const h = v.holdings.get(id);
      await writes.saveHolding(v, h, { ...h.payload, name });
      await writes.saveSnapshot(v, id, null, { date: day, value: '1234567.125', note: 'Counted at the bank vault' });
      await writes.saveSnapshot(v, id, null, { date: day, value: '1234567.250', note: null });
    }, goldId, BACKDATE, 'ZKB_Vorsorgekonto_3a_CH9300762011623852957');
    await openHolding(goldId);
    await page.waitUntil("document.querySelectorAll('.values-table tbody tr.flagged').length === 2", { label: 'the gold with its widest rows' });
    for (const width of [320, 375, 601, 901]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: width < 600 });
      await page.eval("document.querySelectorAll('.note-toggle[aria-expanded=\"false\"]').forEach((b) => b.click())");
      await page.frames();
      const fit = await page.eval(`(() => {
        const problems = [];
        const doc = document.documentElement;
        if (doc.scrollWidth > doc.clientWidth) problems.push('the page pans: ' + doc.scrollWidth);
        for (const n of document.querySelectorAll('#app *')) {
          if (getComputedStyle(n).overflowX !== 'visible' && n.scrollWidth > n.clientWidth + 0.5) problems.push('scrolls sideways: ' + n.className);
        }
        for (const n of document.querySelectorAll('#app button, #app a')) {
          n.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = n.getBoundingClientRect();
          if (!r.width) continue;
          const name = n.textContent || n.getAttribute('aria-label');
          if (r.left < -0.5 || r.right > innerWidth + 0.5) problems.push('off the screen: ' + name);
          else if (!n.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2))) problems.push('covered: ' + name);
          if (innerWidth < 600 && n.closest('.values-table') && r.height < 44) problems.push('under 44px: ' + name);
        }
        for (const n of document.querySelectorAll('.values-table tbody .link-button')) {
          const range = document.createRange();
          range.selectNodeContents(n);
          if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) problems.push('the date wraps: ' + n.textContent);
        }
        return problems;
      })()`);
      check(`at ${width}px the holding's values fit the screen, each control tappable, no date wrapped`, fit.length === 0, fit.join(' | '));
    }
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.frames();

    // -- What the page asked the server for ---------------------------------------

    const requested = JSON.parse(await page.eval(`JSON.stringify(performance.getEntriesByType('resource')
      .map(e => new URL(e.name)).filter(u => u.pathname.startsWith('/api/')).map(u => u.pathname + u.search))`));
    const rateRequests = requested.filter((path) => path.startsWith('/api/rates?'));
    check(
      'no rate request names a symbol: each asks for the whole table at a date',
      rateRequests.length > 0 &&
        rateRequests.every((path) => [...new URLSearchParams(path.split('?')[1]).keys()].sort().join(',') === 'date,quote'),
      rateRequests.join(' | '),
    );
    check(
      'no request returns dimensions, labels or values: none names them',
      requested.every((path) => !/dimension|label|value/i.test(path)),
      [...new Set(requested.map((path) => path.split('?')[0]))].join(' | '),
    );
    check('no markup from the vault ran anywhere along the way', !(await page.eval('window.__alerted')));
  }
});
