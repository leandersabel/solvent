// Reviewer's checks of Update values against an archive made in another
// window (spec/features/record-snapshot.md, Update values, States, and
// Creating and reopening are distinct acts; manage-accounts.md, While
// archived), written from the acceptance criteria alone: a row of a
// holding archived or deleted since the sweep was drawn writes nothing,
// says so and leaves, before and after the sitting claims its date, on
// Record and on Confirm, and an archived holding has no row to record in.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, ago, D1, D2, id, traffic, writesSent, typeReads, bodyOf, ev, text, quiet, stored, on, bytes, go, model, typeRow, pressRow, rowState, home, newRecording, sweepToday } = r;

  const kindOf = (t) => (t.method === 'DELETE' ? 'DELETE' : `${t.method} ${(bodyOf(t) || {}).recordType || ''}`.trim());
  const sent = () => writesSent().map(kindOf);
  const holdingOf = (accountId) =>
    model(({ v }, at) => { const h = v.holdings.get(at); return h ? { version: h.version, payload: h.payload } : null; }, accountId);
  const archiveElsewhere = async (name, D) => {
    const h = await holdingOf(id[name]);
    await r.plantHere([
      r.snap(name, D, '0'),
      { type: 'account', recordId: id[name], version: h.version + 1, payload: { ...h.payload, archivedAt: D } },
    ]);
  };
  const purgeElsewhere = (name) =>
    r.unwatched(() => rec.call(async (at) => (await import('/static/js/api.js')).del(`/api/accounts/${at}?mode=purge`), id[name]));
  const everythingAt = async (date) => bytes([...on(await stored('snapshot'), date), ...on(await stored('rate'), date)]);
  const sweepAt = async (iso) => {
    await home();
    await newRecording(iso);
  };
  const archivedMessage = (name) => `${name} was archived in another window. Nothing was saved.`;

  // ---- 89: after the sitting claimed its date ------------------------------

  const CLAIMED = ago(50);
  await sweepAt(CLAIMED);
  traffic.length = 0;
  await typeRow('Fund 1', '11');
  await pressRow('Fund 1');
  const claimOrder = traffic
    .filter((t) => (t.method === 'GET' && /\/api\/records\?type=(account|snapshot|rate)$/.test(t.url)) || t.method === 'PUT')
    .map((t) => (t.method === 'GET' ? `GET ${t.url.split('type=')[1]}` : kindOf(t)));
  check(
    'review: the first row at a new date reads the holdings before the date\'s reload and before any write',
    claimOrder.indexOf('GET account') >= 0 && claimOrder.indexOf('GET account') < claimOrder.indexOf('GET snapshot') &&
      claimOrder.indexOf('GET snapshot') < claimOrder.indexOf('PUT snapshot'),
    claimOrder.join(', '),
  );
  await archiveElsewhere('Fund 2', T);
  const claimedBefore = await everythingAt(CLAIMED);
  traffic.length = 0;
  await typeRow('Fund 2', '22');
  await pressRow('Fund 2');
  check(
    'review 89: a row of a holding archived after the claim writes nothing',
    sent().length === 0 && (await everythingAt(CLAIMED)) === claimedBefore,
    sent().join(', '),
  );
  check('review 89: the sweep says the holding was archived in another window', (await text()).includes(archivedMessage('Fund 2')));
  check('review 89: the row leaves the screen', (await rowState('Fund 2')) === undefined, JSON.stringify(await rowState('Fund 2')));
  check('review 89: the row recorded before stays', Boolean(await rowState('Fund 1')));
  check('review 89: the holdings were read afresh after the claim', typeReads('account').length >= 1, String(typeReads('account').length));
  const fund2Now = await holdingOf(id['Fund 2']);
  check('review 89: the model takes the holding as it now stands', fund2Now && fund2Now.payload.archivedAt === T, JSON.stringify(fund2Now));

  // ---- 89: the first row of a new sitting, so not even the prices go in ----

  const UNCLAIMED = ago(60);
  await sweepAt(UNCLAIMED);
  await archiveElsewhere('Fund 3', T);
  traffic.length = 0;
  await typeRow('Fund 3', '33');
  await pressRow('Fund 3');
  check(
    'review 89: a refused first row leaves the date with no record of any kind, prices included',
    sent().length === 0 && (await everythingAt(UNCLAIMED)) === '[]',
    sent().join(', '),
  );
  check('review 89: the refused first row says so and leaves', (await text()).includes(archivedMessage('Fund 3')) && (await rowState('Fund 3')) === undefined);

  // ---- 89: Confirm is a figure created too -----------------------------------

  const CONFIRMED = ago(70);
  await sweepAt(CONFIRMED);
  await archiveElsewhere('Fund 4', T);
  const confirmLabel = (await rowState('Fund 4')).label;
  traffic.length = 0;
  await pressRow('Fund 4');
  check(
    'review 89: Confirm on a holding archived since writes nothing, says so and leaves',
    confirmLabel === 'Confirm' && sent().length === 0 && (await everythingAt(CONFIRMED)) === '[]' &&
      (await text()).includes(archivedMessage('Fund 4')) && (await rowState('Fund 4')) === undefined,
    `${confirmLabel} | ${sent().join(', ')}`,
  );

  // ---- 89: a figure added inside a reopened recording -----------------------

  await go(`#/sweep/${D2}`);
  await archiveElsewhere('Fund 5', T);
  const reopenedBefore = await everythingAt(D2);
  traffic.length = 0;
  await typeRow('Fund 5', '55');
  await pressRow('Fund 5');
  check(
    'review 89: adding a figure on a reopened recording for a holding archived since writes nothing, says so and leaves',
    sent().length === 0 && (await everythingAt(D2)) === reopenedBefore &&
      (await text()).includes(archivedMessage('Fund 5')) && (await rowState('Fund 5')) === undefined,
    sent().join(', '),
  );

  // ---- A holding deleted in another window ------------------------------------

  const DELETED = ago(80);
  await sweepAt(DELETED);
  await purgeElsewhere('Mortgage');
  traffic.length = 0;
  await typeRow('Mortgage', '-1');
  await pressRow('Mortgage');
  check(
    'review: a row of a holding deleted in another window writes nothing, says deleted and leaves',
    sent().length === 0 && (await everythingAt(DELETED)) === '[]' &&
      (await text()).includes('Mortgage was deleted in another window. Nothing was saved.') && (await rowState('Mortgage')) === undefined,
    sent().join(', '),
  );

  // A holding deleted in another window whose row is still drawn after
  // another row's create read the holdings afresh, so the model here no
  // longer holds it.
  const STALE = ago(85);
  await sweepAt(STALE);
  await purgeElsewhere('Fund 1');
  await typeRow('Current account', '1');
  await pressRow('Current account');
  traffic.length = 0;
  await typeRow('Fund 1', '1');
  await pressRow('Fund 1');
  const staleRow = await rowState('Fund 1');
  check(
    'review: a deleted holding\'s row recorded after another row read the holdings writes nothing, says deleted and leaves',
    sent().length === 0 && (await text()).includes('Fund 1 was deleted in another window. Nothing was saved.') && staleRow === undefined,
    `${sent().join(', ')} | ${JSON.stringify(staleRow)}`,
  );

  // ---- 59: a sitting that only changes existing figures reloads nothing ------

  await go(`#/sweep/${D1}`);
  traffic.length = 0;
  await typeRow('Savings', '5001');
  await pressRow('Savings');
  const reloads = ['account', 'snapshot', 'rate'].map((type) => typeReads(type).length);
  check(
    'review 59: changing an existing figure issues no type read, the holdings included, and writes version + 1',
    reloads.every((n) => n === 0) && sent().join() === 'PUT snapshot' && bodyOf(writesSent()[0]).version === 2,
    `${reloads.join('/')} | ${sent().join(', ')}`,
  );

  // ---- manage-accounts 41: an archived holding has no row to record in ------

  const archived = ['Fund 2', 'Fund 3', 'Fund 4', 'Fund 5'];
  const controlsFor = (names) => rec.call((list) => [...document.querySelectorAll('.sweep-row')]
    .filter((row) => list.includes(row.querySelector('.holding-name').textContent))
    .map((row) => ({
      name: row.querySelector('.holding-name').textContent,
      controls: [...row.querySelectorAll('button, input, textarea, select')].filter((n) => n.getClientRects().length).length,
      says: row.textContent,
    })), names);
  await sweepToday();
  const today = await controlsFor(archived);
  check(
    'review manage-accounts 41: on today\'s sweep each archive\'s zero is text with no control',
    today.length === archived.length && today.every((row) => row.controls === 0 && row.says.includes('Archived at zero on this date.')),
    JSON.stringify(today),
  );
  // An archived holding's figure cleared on a reopened recording leaves
  // a row that must not take a new figure.
  await go(`#/sweep/${D1}`);
  await typeRow('Fund 2', '');
  await pressRow('Fund 2');
  await typeRow('Fund 2', '50');
  await quiet();
  const cleared = await rowState('Fund 2');
  check(
    'review manage-accounts 41: an archived holding\'s row, its figure cleared, offers no Record or Confirm for a figure typed into it',
    !cleared || !['Record', 'Confirm'].includes(cleared.label) || cleared.disabled,
    JSON.stringify(cleared),
  );
  await go('#/');

  const FREE = ago(90);
  await sweepAt(FREE);
  const earlier = await controlsFor(archived);
  check('review 84: a sweep at an earlier free date has no row for an archived holding', earlier.length === 0, JSON.stringify(earlier));
  await go(`#/sweep/${D2}`);
  const reopened = await controlsFor(archived);
  check('review 84: a reopened recording where an archived holding is silent has no row for it', reopened.length === 0, JSON.stringify(reopened));
}, { signsIn: false });
