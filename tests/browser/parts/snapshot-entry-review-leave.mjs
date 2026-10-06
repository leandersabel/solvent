// Reviewer's checks of Snapshot entry, Closing with changes unsaved
// (spec/features/record-snapshot.md, criterion 91), and of the sweep's
// leave notice beside it (criterion 37, record-rate.md criterion 29),
// written from the feature pages alone.
import { RECORDER_PASSWORD, check, enterPasswordOn, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const {
    rec, ago, D1, id, traffic, faults, writesSent, bodyOf, ev, text, quiet, set, press, stored, on,
    go, format, line, typeLine, home, newRecording,
  } = r;

  const LEFT = 'with changes that were not saved';
  // The critical notices on screen, and whether each is the first thing
  // in the region the screen draws into.
  const notices = () => ev(`[...document.querySelectorAll('.banner-critical')].map((n) => ({
    text: n.textContent.trim(),
    head: n.parentElement.firstElementChild === n,
  }))`);
  const leftNotice = async () => (await notices()).filter((n) => n.text.includes(LEFT));
  const noWrites = () => writesSent().length === 0;
  const dialogButton = (label) =>
    rec.call((name) => [...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')]
      .find((b) => b.textContent.trim() === name).click(), label);
  const cancel = async () => {
    await dialogButton('Cancel');
    await quiet();
  };
  const escape = async () => {
    await rec.key('Escape');
    await rec.frames();
    await quiet();
  };
  const openForm = async (name) => {
    await go(`#/holding/${id[name]}`);
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the form for ${name}` });
    await quiet();
  };
  const editEntry = async (name, iso) => {
    await go(`#/holding/${id[name]}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the entry at ${iso}` });
    await quiet();
  };
  const openPrices = async () => {
    await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
    await quiet();
  };
  const setDate = async (iso) => {
    await set('#snapshot-date', await format('date', iso));
    await ev('document.activeElement && document.activeElement.blur()');
    await quiet();
  };
  const writeNote = async (note) => {
    await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
    await set('.dialog textarea', note);
  };
  const on91 = (expected) => async () => {
    const shown = await leftNotice();
    return { ok: shown.length === 1 && shown[0].text === expected && shown[0].head, shown };
  };

  // ---- record-snapshot 37: Look it up on a reopened recording saves, so
  // leaving at once names nothing.

  await go(`#/recording/${D1}`);
  await press('Update');
  await rec.waitUntil("document.querySelector('.sweep-row')", { label: 'the sweep at the first recording' });
  await quiet();
  await rec.call((query) => document.querySelector(query).querySelector('.btn-inline:not([hidden])').click(), line('USD'));
  await quiet();
  const looked = on(await stored('rate'), D1).find((e) => e.payload.symbol === 'USD');
  await home();
  check(
    'review 37: Look it up saved the dollar as proposed, and leaving at once names no unit as unsaved',
    looked && looked.payload.rateSource === 'proposed' && !(await text()).includes(LEFT),
    JSON.stringify({ looked: looked && looked.payload, notices: await notices() }),
  );

  // ---- record-rate 29: a price typed on a sweep at a date holding no
  // record, then left, writes nothing and is named.

  const DR = ago(33);
  await newRecording(DR);
  await rec.waitUntil((query) => document.querySelector(query) !== null, { args: [line('PAINT')], label: 'the PAINT line' });
  await typeLine('PAINT', '3.5');
  traffic.length = 0;
  await home();
  const ratesLeft = await leftNotice();
  check(
    'review rate 29: leaving the sweep with a price typed writes nothing and names the unit',
    noWrites() && on(await stored('rate'), DR).length === 0 && ratesLeft.length === 1 &&
      ratesLeft[0].text === `You left the recording for ${await format('longDate', DR)} ${LEFT}: the PAINT rate.`,
    JSON.stringify({ writes: writesSent().map((t) => t.method), ratesLeft }),
  );

  // ---- 91: a figure typed on a new entry, closed by Cancel --------------

  const DA = ago(37);
  await openForm('Current account');
  await setDate(DA);
  await set('#snapshot-value', '4242');
  traffic.length = 0;
  await cancel();
  const byCancel = await on91(`You left the entry for ${await format('longDate', DA)} ${LEFT}: Current account.`)();
  check(
    'review 91: Cancel with a figure typed writes nothing, and the holding screen names the holding at its head, critical',
    noWrites() && on(await stored('snapshot'), DA).length === 0 && byCancel.ok &&
      (await ev('location.hash')) === `#/holding/${id['Current account']}`,
    JSON.stringify({ writes: writesSent().map((t) => t.method), byCancel }),
  );
  await go('#/');
  await go(`#/holding/${id['Current account']}`);
  check('review 91: the notice is shown once', (await leftNotice()).length === 0, JSON.stringify(await notices()));

  // ---- 91: a price and a figure typed, closed by Escape ----------------

  await openForm('Current account');
  await setDate(DA);
  await openPrices();
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input'); }, { args: [line('USD')], label: 'the form USD line' });
  await typeLine('USD', '0.7777');
  await set('#snapshot-value', '4243');
  traffic.length = 0;
  await escape();
  const byEscape = await on91(`You left the entry for ${await format('longDate', DA)} ${LEFT}: Current account, the USD rate.`)();
  check(
    'review 91: Escape with a figure and a price typed writes nothing and names the holding and the unit',
    noWrites() && on(await stored('rate'), DA).length === 0 && byEscape.ok,
    JSON.stringify({ writes: writesSent().map((t) => t.method), byEscape }),
  );

  // ---- 91: a price alone names the unit alone --------------------------

  await openForm('Savings');
  await setDate(DA);
  await openPrices();
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input'); }, { args: [line('XAU-ozt')], label: 'the form gold line' });
  await typeLine('XAU-ozt', '2111');
  traffic.length = 0;
  await cancel();
  const priceOnly = await on91(`You left the entry for ${await format('longDate', DA)} ${LEFT}: the Gold, troy ounce rate.`)();
  check('review 91: a price typed with no figure writes nothing and names only its unit', noWrites() && priceOnly.ok, JSON.stringify(priceOnly));

  // ---- 91: nothing changed, or changed back, names nothing -------------

  await openForm('Savings');
  await cancel();
  const untouched = await notices();
  await openForm('Savings');
  await set('#snapshot-value', '12');
  await set('#snapshot-value', '');
  await escape();
  const reverted = await notices();
  await openForm('Savings');
  await setDate(ago(38));
  await cancel();
  const dateOnly = await notices();
  check(
    'review 91: closing an untouched form, one typed back to how it opened, or a new one with only its date changed, names nothing',
    [untouched, reverted, dateOnly].every((shown) => !shown.some((n) => n.text.includes(LEFT))),
    JSON.stringify({ untouched, reverted, dateOnly }),
  );

  // ---- 91: a note typed names the holding ------------------------------

  await openForm('Savings');
  await setDate(DA);
  await writeNote('from the statement');
  traffic.length = 0;
  await cancel();
  const noted = await on91(`You left the entry for ${await format('longDate', DA)} ${LEFT}: Savings.`)();
  check('review 91: a note typed and left names the holding', noWrites() && noted.ok, JSON.stringify(noted));

  // ---- 91: an existing entry, its value changed, then its date ---------

  const d1 = await format('longDate', D1);
  await editEntry('Current account', D1);
  await set('#snapshot-value', '1001');
  traffic.length = 0;
  await cancel();
  const edited = await on91(`You left the entry for ${d1} ${LEFT}: Current account.`)();
  const keptValue = on(await stored('snapshot'), D1).find((s) => s.accountId === id['Current account']);
  check(
    'review 91: an existing entry with its value changed and left keeps its figure and is named with its stored date',
    noWrites() && keptValue.payload.value === '1000' && edited.ok,
    JSON.stringify({ edited, kept: keptValue.payload }),
  );
  await editEntry('Current account', D1);
  await setDate(ago(39));
  traffic.length = 0;
  await escape();
  const moved = await on91(`You left the entry for ${d1} ${LEFT}: Current account.`)();
  check(
    'review 91: an existing entry with its date changed and left is not moved and is named with its stored date',
    noWrites() && on(await stored('snapshot'), D1).some((s) => s.accountId === id['Current account']) && moved.ok,
    JSON.stringify(moved),
  );

  await editEntry('Brokerage', D1);
  await ev("document.querySelector('#snapshot-value').focus()");
  await ev("document.querySelector('.dialog textarea')?.focus()");
  await ev("document.querySelector('#snapshot-date').focus()");
  await ev('document.activeElement.blur()');
  await quiet();
  await escape();
  const untouchedEntry = await notices();
  check(
    'review 91: an existing entry opened, its fields entered and left unchanged, then closed, names nothing',
    !untouchedEntry.some((n) => n.text.includes(LEFT)),
    JSON.stringify(untouchedEntry),
  );

  // ---- 91: a date that does not read ------------------------------------

  await openForm('Savings');
  await set('#snapshot-value', '77');
  await set('#snapshot-date', 'not a date');
  traffic.length = 0;
  await cancel();
  const unread = await on91(`You left the entry ${LEFT}: Savings.`)();
  check('review 91: a new figure whose date does not read is named without a date', noWrites() && unread.ok, JSON.stringify(unread));

  // ---- 91: a link that opens a recording --------------------------------

  await openForm('Savings');
  await setDate(D1);
  await set('#snapshot-value', '5050');
  await openPrices();
  traffic.length = 0;
  const linked = await ev(`(() => {
    const a = [...document.querySelectorAll('.dialog a, .dialog button')].find((n) => n.textContent.trim().startsWith('Open the recording'));
    if (!a) return false;
    a.click();
    return true;
  })()`);
  await rec.waitUntil("location.hash.startsWith('#/recording/') && !document.querySelector('.dialog')", { timeout: 10000, label: 'the recording the form links to' })
    .catch(() => {});
  await quiet();
  const opened = await on91(`You left the entry for ${d1} ${LEFT}: Savings.`)();
  check(
    'review 91: leaving by the link to the date\'s recording writes nothing and the recording names what was left',
    linked && noWrites() && (await ev('location.hash')) === `#/recording/${D1}` && opened.ok,
    JSON.stringify({ linked, opened, hash: await ev('location.hash'), dialogs: await ev("document.querySelectorAll('.dialog').length"), writes: writesSent().map((t) => t.method) }),
  );

  for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) await escape();

  // ---- 91: a holding name is shown as text --------------------------------

  const script = '<script>alert(1)</script>';
  await openForm(script);
  await setDate(DA);
  await set('#snapshot-value', '9');
  await cancel();
  const named = await on91(`You left the entry for ${await format('longDate', DA)} ${LEFT}: ${script}.`)();
  check(
    'review 91: a holding named like markup is named as text, adding no element',
    named.ok && (await ev("document.querySelectorAll('.banner-critical script').length")) === 0,
    JSON.stringify(named),
  );

  // ---- 91: once a save writes the figure, closing names nothing --------

  const DS = ago(41);
  faults.push((q) => (q.method === 'PUT' && bodyOf(q).recordType === 'rate' ? 500 : null));
  await openForm('Savings');
  await setDate(DS);
  await openPrices();
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input') && l.querySelector('input').value !== ''; }, { args: [line('USD')], label: 'the form proposals at the failing date' });
  await set('#snapshot-value', '5500');
  await dialogButton('Save');
  await quiet();
  faults.length = 0;
  const saved = on(await stored('snapshot'), DS).some((s) => s.accountId === id.Savings);
  const stillOpen = await ev("Boolean(document.querySelector('.dialog'))");
  if (stillOpen) await escape();
  const afterSave = await notices();
  check(
    'review 91: a figure saved whose prices failed, then closed, names nothing as left',
    saved && !afterSave.some((n) => n.text.includes(LEFT)),
    JSON.stringify({ saved, stillOpen, afterSave }),
  );

  // ---- 91: a lock and unlock in between shows no notice ---------------

  await openForm('Savings');
  await setDate(DA);
  await set('#snapshot-value', '6006');
  traffic.length = 0;
  await ev("document.querySelector('.btn-lock').click()");
  await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card' });
  const whileLocked = await text();
  await enterPasswordOn(rec, RECORDER_PASSWORD);
  await rec.waitUntil("!document.querySelector('#unlock-password') && document.querySelector('#snapshot-value')", { timeout: 90000, label: 'the form after unlocking' });
  await quiet();
  const back = await ev("document.querySelector('#snapshot-value').value");
  const afterUnlock = await notices();
  check(
    'review 91: a lock and unlock brings the form back with the figure and shows no notice, then or while locked',
    noWrites() && back === '6006' && !whileLocked.includes(LEFT) && !afterUnlock.some((n) => n.text.includes(LEFT)),
    JSON.stringify({ back, afterUnlock, writes: writesSent().map((t) => t.method) }),
  );
  await cancel();
  const afterLockClose = await on91(`You left the entry for ${await format('longDate', DA)} ${LEFT}: Savings.`)();
  check(
    'review 91: closing the form after the unlock still names the figure typed before the lock',
    noWrites() && afterLockClose.ok,
    JSON.stringify(afterLockClose),
  );
});
