// Reviewer's checks of Snapshot entry against an archive made in another
// window (spec/features/record-snapshot.md, Creating and reopening are
// distinct acts, and manage-accounts.md, While archived), written from
// the acceptance criteria alone: a form open since before the archive
// records nothing at any date, a move onto or past it moves nothing, a
// move before it and a value edit still go through, and an archived
// holding offers no way in.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, ago, D1, D2, id, traffic, writesSent, typeReads, bodyOf, ev, quiet, set, press, stored, on, bytes, go, format, model, home } = r;

  const kindOf = (t) => (t.method === 'DELETE' ? 'DELETE' : `${t.method} ${(bodyOf(t) || {}).recordType || ''}`.trim());
  const sent = () => writesSent().map(kindOf);
  const dialogText = () => ev("[...document.querySelectorAll('.dialog')].map(d => d.innerText).join(' | ')");
  const dialogButtons = () => ev(`[...document.querySelectorAll('.dialog button')]
    .filter((b) => b.getClientRects().length && !b.closest('details:not([open])')).map((b) => b.textContent.trim())`);
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
  const openForm = async (accountId) => {
    await go(`#/holding/${accountId}`);
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  };
  const editEntry = async (accountId, iso) => {
    await go(`#/holding/${accountId}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the entry at ${iso}` });
    await quiet();
  };
  const holdingOf = (accountId) =>
    model(({ v }, at) => { const h = v.holdings.get(at); return h ? { version: h.version, payload: h.payload } : null; }, accountId);
  // What another window's archive leaves on the server: the zero at D,
  // then the account record with `archivedAt` D, behind the model here.
  const archiveElsewhere = async (name, D) => {
    const h = await holdingOf(id[name]);
    await r.plantHere([
      r.snap(name, D, '0'),
      { type: 'account', recordId: id[name], version: h.version + 1, payload: { ...h.payload, archivedAt: D } },
    ]);
  };
  // What another window's purge leaves: no account record and no snapshot.
  const purgeElsewhere = (name) =>
    r.unwatched(() => rec.call(async (at) => (await import('/static/js/api.js')).del(`/api/accounts/${at}?mode=purge`), id[name]));
  const holdingSnapshots = async (name) => (await stored('snapshot')).filter((s) => s.accountId === id[name]);
  const hasRecordAction = async (accountId) => {
    await go(`#/holding/${accountId}`);
    return ev("[...document.querySelectorAll('button, a')].some((b) => b.textContent.trim() === 'Record a value')");
  };

  // ---- 87: the reported case, a form open since before the archive, at an earlier date

  const EARLY = ago(45);
  await openForm(id['Fund 2']);
  await set('#snapshot-date', await format('date', EARLY));
  await set('#snapshot-value', '7');
  await archiveElsewhere('Fund 2', T);
  const fund2Before = bytes(await holdingSnapshots('Fund 2'));
  traffic.length = 0;
  await save();
  const said = await dialogText();
  const buttons = await dialogButtons();
  check(
    'review 87: a form open since before the archive writes nothing at an earlier date, prices included',
    sent().length === 0 && bytes(await holdingSnapshots('Fund 2')) === fund2Before && on(await stored('rate'), EARLY).length === 0,
    sent().join(', '),
  );
  check(
    'review 87: it says the holding was archived in another window and nothing was saved',
    said.includes('Fund 2 was archived in another window. Nothing was saved.'),
    said,
  );
  check('review 87: the refused form offers Done alone, no Save', buttons.includes('Done') && !buttons.includes('Save'), JSON.stringify(buttons));
  check('review 87: the refusal read the holdings afresh', typeReads('account').length >= 1, String(typeReads('account').length));
  await press('Done', '.dialog');
  check('review 87: Done closes the Dialog', !(await ev("Boolean(document.querySelector('.dialog'))")));
  const fund2Now = await holdingOf(id['Fund 2']);
  check('review 87: the model takes the holding as it now stands, archived', fund2Now && fund2Now.payload.archivedAt === T, JSON.stringify(fund2Now));
  check('review 84: the archived holding no longer offers Record a value on its page', !(await hasRecordAction(id['Fund 2'])));

  // A date that already holds a recording, where the holding is silent.
  await openForm(id['Fund 3']);
  await set('#snapshot-date', await format('date', D2));
  await set('#snapshot-value', '9');
  await archiveElsewhere('Fund 3', T);
  const atD2 = bytes([...on(await stored('snapshot'), D2), ...on(await stored('rate'), D2)]);
  traffic.length = 0;
  await save();
  const saidD2 = await dialogText();
  check(
    'review 87: at a date holding a recording, nothing is written and the archive is named',
    sent().length === 0 && bytes([...on(await stored('snapshot'), D2), ...on(await stored('rate'), D2)]) === atD2 &&
      saidD2.includes('Fund 3 was archived in another window. Nothing was saved.'),
    `${sent().join(', ')} | ${saidD2}`,
  );
  await closeDialogs();

  // Today, the archive's own date, where the zero now holds the slot.
  await openForm(id['Fund 4']);
  await set('#snapshot-value', '4');
  await archiveElsewhere('Fund 4', T);
  const fund4Before = bytes(await holdingSnapshots('Fund 4'));
  traffic.length = 0;
  await save();
  const saidToday = await dialogText();
  check(
    'review 87: on the archive date itself nothing is written, the zero is untouched, and the archive is named',
    sent().length === 0 && bytes(await holdingSnapshots('Fund 4')) === fund4Before &&
      saidToday.includes('Fund 4 was archived in another window. Nothing was saved.'),
    `${sent().join(', ')} | ${saidToday}`,
  );
  await closeDialogs();

  // A holding deleted in another window.
  await openForm(id['Fund 5']);
  await set('#snapshot-date', await format('date', EARLY));
  await set('#snapshot-value', '3');
  await purgeElsewhere('Fund 5');
  traffic.length = 0;
  await save();
  const saidGone = await dialogText();
  check(
    'review 87: a holding deleted in another window gets nothing written and is named deleted',
    sent().length === 0 && (await holdingSnapshots('Fund 5')).length === 0 &&
      saidGone.includes('Fund 5 was deleted in another window. Nothing was saved.'),
    `${sent().join(', ')} | ${saidGone}`,
  );
  await closeDialogs();

  // ---- 88: moves onto and past an archive made since the form opened -----

  await editEntry(id.Savings, D1);
  await set('#snapshot-date', await format('date', T));
  await quiet();
  await archiveElsewhere('Savings', T);
  const savingsBefore = bytes(await holdingSnapshots('Savings'));
  traffic.length = 0;
  await save();
  const saidOnto = await dialogText();
  check(
    'review 88: a move onto the archive date moves nothing and says nothing was moved',
    sent().length === 0 && bytes(await holdingSnapshots('Savings')) === savingsBefore &&
      saidOnto.includes('Savings was archived in another window. Nothing was moved.'),
    `${sent().join(', ')} | ${saidOnto}`,
  );
  await closeDialogs();

  const PAST_D = ago(10);
  const PAST_TO = ago(5);
  await editEntry(id.Mortgage, D1);
  await set('#snapshot-date', await format('date', PAST_TO));
  await quiet();
  await archiveElsewhere('Mortgage', PAST_D);
  const mortgageBefore = bytes(await holdingSnapshots('Mortgage'));
  traffic.length = 0;
  await save();
  const saidPast = await dialogText();
  check(
    'review 88: a move past the archive date moves nothing and says nothing was moved',
    sent().length === 0 && bytes(await holdingSnapshots('Mortgage')) === mortgageBefore && on(await stored('rate'), PAST_TO).length === 0 &&
      saidPast.includes('Mortgage was archived in another window. Nothing was moved.'),
    `${sent().join(', ')} | ${saidPast}`,
  );
  await closeDialogs();

  // A move to before an archive made since is a move the archive allows.
  const BEFORE_ARCHIVE = ago(150);
  await editEntry(id['Current account'], D2);
  await set('#snapshot-date', await format('date', BEFORE_ARCHIVE));
  await quiet();
  await archiveElsewhere('Current account', T);
  traffic.length = 0;
  await save();
  await closeDialogs();
  const current = await holdingSnapshots('Current account');
  check(
    'review 88: a move to a date before an archive made since still moves the entry',
    on(current, BEFORE_ARCHIVE).length === 1 && on(current, D2).length === 0,
    `${sent().join(', ')} | ${JSON.stringify(current.map((s) => s.payload))}`,
  );

  // A value edit is no new figure, archived or not.
  await editEntry(id.Brokerage, D1);
  await set('#snapshot-value', '2001');
  await archiveElsewhere('Brokerage', T);
  traffic.length = 0;
  await save();
  await closeDialogs();
  const brokerage = on(await holdingSnapshots('Brokerage'), D1);
  check(
    'review: a value edit of an earlier entry still saves after an archive made since',
    brokerage.length === 1 && brokerage[0].payload.value === '2001',
    `${sent().join(', ')} | ${JSON.stringify(brokerage.map((s) => s.payload))}`,
  );

  // ---- The order: the holdings read before the date's reload ------------

  const FRESH = ago(55);
  await openForm(id['Fund 1']);
  await set('#snapshot-date', await format('date', FRESH));
  await set('#snapshot-value', '12');
  traffic.length = 0;
  await save();
  const order = traffic
    .filter((t) => (t.method === 'GET' && /\/api\/records\?type=(account|snapshot|rate)$/.test(t.url)) || t.method === 'PUT')
    .map((t) => (t.method === 'GET' ? `GET ${t.url.split('type=')[1]}` : kindOf(t)));
  check(
    'review: an active holding at a fresh date records, reading the holdings before the date\'s reload and before any write',
    on(await holdingSnapshots('Fund 1'), FRESH).length === 1 &&
      order.indexOf('GET account') >= 0 && order.indexOf('GET account') < order.indexOf('GET snapshot') &&
      order.indexOf('GET snapshot') < order.indexOf('PUT snapshot'),
    order.join(', '),
  );
  await closeDialogs();

  // ---- 84 and manage-accounts 41: no way in once archived -----------------

  await home();
  const dashboardOffers = await rec.call((names) => [...document.querySelectorAll('tr')]
    .filter((row) => names.some((n) => row.textContent.includes(n)))
    .some((row) => [...row.querySelectorAll('button, a')].some((b) => b.textContent.trim() === 'Record a value')), ['Fund 2', 'Fund 3', 'Fund 4']);
  check('review 84: no archived row on the dashboard offers Record a value', !dashboardOffers);
  await go(`#/holding/${id['Fund 2']}`);
  const zeroRow = await rec.call((day) => {
    const row = [...document.querySelectorAll('.card .data-table tbody tr')].find((tr) => tr.cells[0].textContent.startsWith(day));
    // The date opens its recording, which is no edit of the zero.
    return row ? [...row.querySelectorAll('button, input')].map((b) => b.textContent.trim() || b.tagName).filter((t) => t !== row.cells[0].textContent.trim()) : null;
  }, await format('longDate', T));
  check('review manage-accounts 41: the archive\'s zero on Account detail offers no edit, clear or delete', Array.isArray(zeroRow) && zeroRow.length === 0, JSON.stringify(zeroRow));
}, { signsIn: false });
