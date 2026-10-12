// Reviewer's checks of Snapshot entry, Closing with changes unsaved, by
// Back, Forward or an address changed by hand
// (spec/features/record-snapshot.md, criterion 91), and of the Dialog
// rule that a dialog belongs to the screen it was opened on
// (spec/design-system.md, Components, Dialog), written from the pages
// alone.
import { RECORDER_PASSWORD, check, enterPasswordOn, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, D1, id, traffic, writesSent, ev, quiet, set, press, stored, on, go, format, line, typeLine } = r;

  const LEFT = 'with changes that were not saved';
  const notices = () => ev(`[...document.querySelectorAll('.banner-critical')].map((n) => ({
    text: n.textContent.trim(),
    head: n.parentElement.firstElementChild === n,
  }))`);
  const leftNotice = async () => (await notices()).filter((n) => n.text.includes(LEFT));
  const named = async (expected) => {
    const shown = await leftNotice();
    return { ok: shown.length === 1 && shown[0].text === expected && shown[0].head, shown };
  };
  const dialogs = () => ev("document.querySelectorAll('.dialog').length");
  const hash = () => ev('location.hash');
  // What a dialog leaves behind on the page if it is not closed properly:
  // inert or hidden background, and where focus sits.
  const residue = () => ev(`JSON.stringify({
    inert: document.querySelectorAll('[inert]').length,
    hiddenMain: [...document.querySelectorAll('main, #app, .topbar')].filter((n) => n.getAttribute('aria-hidden') === 'true').length,
    bodyClass: document.body.className,
    bodyStyle: document.body.getAttribute('style') || '',
    focus: document.activeElement && document.activeElement.isConnected && !document.activeElement.closest('.dialog')
      ? (document.activeElement.tagName + '#' + document.activeElement.id + ':' + (document.activeElement.textContent || '').trim().slice(0, 40))
      : 'detached',
  })`).then(JSON.parse);
  const historyStep = async (delta) => {
    const { currentIndex, entries } = await rec.send('Page.getNavigationHistory');
    await rec.send('Page.navigateToHistoryEntry', { entryId: entries[currentIndex + delta].id });
    await rec.frames();
    await quiet();
  };
  const back = () => historyStep(-1);
  const forward = () => historyStep(1);
  const typeAddress = async (next) => {
    await rec.send('Page.navigate', { url: `${await ev('location.origin + location.pathname')}${next}` });
    await rec.frames();
    await quiet();
  };
  const openForm = async () => {
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the form' });
    await quiet();
  };
  const setDate = async (iso) => {
    await set('#snapshot-date', await format('date', iso));
    await ev('document.activeElement && document.activeElement.blur()');
    await quiet();
  };
  const cleanUp = async () => {
    for (let n = 0; n < 5 && (await dialogs()) > 0; n++) {
      await rec.key('Escape');
      await rec.frames();
      await quiet();
    }
  };

  const DA = ago(37);
  const dA = await format('longDate', DA);
  const CA = `#/holding/${id['Current account']}`;

  // ---- The baseline: Back from the holding screen with no dialog --------

  await go('#/');
  await go(CA);
  await back();
  const plain = await residue();

  // ---- 91: Back with a figure typed ------------------------------------

  await go('#/');
  await go(CA);
  await openForm();
  await setDate(DA);
  await set('#snapshot-value', '4242');
  traffic.length = 0;
  await back();
  const byBack = await named(`You left the entry for ${dA} ${LEFT}: Current account.`);
  const afterBack = await residue();
  check(
    'review 91: Back with a figure typed closes the form, writes nothing, and the screen Back lands on names the holding at its head',
    (await dialogs()) === 0 && (await hash()) === '#/' && writesSent().length === 0 &&
      on(await stored('snapshot'), DA).length === 0 && byBack.ok,
    JSON.stringify({ dialogs: await dialogs(), hash: await hash(), writes: writesSent().map((t) => t.method), byBack }),
  );
  check(
    'review Dialog: after Back closes the form, the page is left as Back with no dialog leaves it, focus included',
    JSON.stringify(afterBack) === JSON.stringify(plain),
    JSON.stringify({ afterBack, plain }),
  );
  await quiet();
  check('review 91: closing by Back moves no further through history', (await hash()) === '#/', await hash());
  await go(CA);
  check('review 91: the notice after Back is shown once', (await leftNotice()).length === 0, JSON.stringify(await notices()));

  // ---- 91: an address changed by hand, with a price and a figure typed --

  await go(CA);
  await openForm();
  await setDate(DA);
  await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
  await quiet();
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input'); }, { args: [line('USD')], label: 'the form USD line' });
  await typeLine('USD', '0.7777');
  await set('#snapshot-value', '4243');
  traffic.length = 0;
  const SAV = `#/holding/${id.Savings}`;
  await typeAddress(SAV);
  const byAddress = await named(`You left the entry for ${dA} ${LEFT}: Current account and the USD rate.`);
  check(
    'review 91: an address changed by hand closes the form, writes nothing, and the screen it names names the holding and the unit',
    (await dialogs()) === 0 && (await hash()) === SAV && writesSent().length === 0 &&
      on(await stored('rate'), DA).length === 0 && byAddress.ok,
    JSON.stringify({ dialogs: await dialogs(), hash: await hash(), writes: writesSent().map((t) => t.method), byAddress }),
  );
  await cleanUp();

  // ---- 91: Forward, with a figure typed ---------------------------------

  await go(CA);
  await go(SAV);
  await back();
  check('review 91: Back returns to the holding screen with Savings ahead', (await hash()) === CA, await hash());
  await openForm();
  await setDate(DA);
  await set('#snapshot-value', '4245');
  traffic.length = 0;
  await forward();
  const byForward = await named(`You left the entry for ${dA} ${LEFT}: Current account.`);
  check(
    'review 91: Forward closes the form, writes nothing, and the screen it lands on names the holding',
    (await dialogs()) === 0 && (await hash()) === SAV && writesSent().length === 0 && byForward.ok,
    JSON.stringify({ dialogs: await dialogs(), hash: await hash(), writes: writesSent().map((t) => t.method), byForward }),
  );
  await cleanUp();

  // ---- 91: an untouched form left by Back names nothing ----------------

  await go('#/');
  await go(CA);
  await openForm();
  await back();
  check(
    'review 91: an untouched form left by Back closes and names nothing',
    (await dialogs()) === 0 && (await hash()) === '#/' && (await leftNotice()).length === 0,
    JSON.stringify({ dialogs: await dialogs(), notices: await notices() }),
  );
  await cleanUp();

  // ---- Dialog: Back closes every open dialog, the confirm over the form -

  await go('#/');
  await go(CA);
  await openForm();
  await setDate(D1);
  await set('#snapshot-value', '4246');
  await press('Save', '.dialog');
  await rec.waitUntil("document.body.innerText.includes('Replace it?')", { label: 'the replace confirm' });
  await quiet();
  const stacked = await dialogs();
  traffic.length = 0;
  await back();
  const kept = on(await stored('snapshot'), D1).find((s) => s.accountId === id['Current account']);
  const overConfirm = await named(`You left the entry for ${await format('longDate', D1)} ${LEFT}: Current account.`);
  check(
    'review Dialog: Back with the replace confirm open over the form closes both, replaces nothing, and names the holding',
    (await dialogs()) === 0 && (await hash()) === '#/' && writesSent().length === 0 &&
      kept && kept.payload.value === '1000' && overConfirm.ok,
    JSON.stringify({ stacked, dialogs: await dialogs(), hash: await hash(), kept: kept && kept.payload, overConfirm }),
  );
  await cleanUp();

  // ---- Dialog: a dialog of another screen, the New recording picker ----

  await go(CA);
  await go('#/');
  await press('New recording');
  await rec.waitUntil("document.querySelector('.dialog')", { label: 'the New recording picker' });
  await back();
  check(
    'review Dialog: Back with the New recording picker open closes it on the screen Back lands on',
    (await dialogs()) === 0 && (await hash()) === CA,
    JSON.stringify({ dialogs: await dialogs(), hash: await hash() }),
  );
  // ---- Dialog: Back while locked, so the unlock lands on another screen -

  await go('#/');
  await go(CA);
  await openForm();
  await setDate(DA);
  await set('#snapshot-value', '4247');
  traffic.length = 0;
  await ev("document.querySelector('.btn-lock').click()");
  await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card' });
  await back();
  await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card after Back' });
  await enterPasswordOn(rec, RECORDER_PASSWORD);
  await rec.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label: 'the vault after unlocking' });
  await rec.frames();
  await quiet();
  const over = await ev(`JSON.stringify({ dialogs: document.querySelectorAll('.dialog').length, hash: location.hash,
    form: Boolean(document.querySelector('#snapshot-value')) })`).then(JSON.parse);
  check(
    'review Dialog: a form a lock kept, with Back pressed on the card, does not come back over the screen Back landed on',
    writesSent().length === 0 && over.hash === '#/' && over.dialogs === 0,
    JSON.stringify({ over, notices: await notices(), writes: writesSent().map((t) => t.method) }),
  );
  const byLockedBack = await named(`You left the entry for ${dA} ${LEFT}: Current account.`);
  check(
    'review 91: the screen the unlock lands on after Back on the card names the holding at its head',
    byLockedBack.ok,
    JSON.stringify(byLockedBack),
  );
  await go(CA);
  check('review 91: the notice after a locked Back is shown once', (await leftNotice()).length === 0, JSON.stringify(await notices()));

  // ---- 91: an address changed by hand while locked, a price and a figure typed

  await go(CA);
  await openForm();
  await setDate(DA);
  await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
  await quiet();
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input'); }, { args: [line('USD')], label: 'the form USD line' });
  await typeLine('USD', '0.7779');
  await set('#snapshot-value', '4248');
  traffic.length = 0;
  await ev("document.querySelector('.btn-lock').click()");
  await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card' });
  await rec.call((next) => { location.hash = next; }, SAV);
  await rec.waitUntil((to) => location.hash === to, { args: [SAV], label: SAV });
  await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card at Savings' });
  await enterPasswordOn(rec, RECORDER_PASSWORD);
  await rec.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label: 'the vault after unlocking' });
  await rec.frames();
  await quiet();
  const byLockedAddress = await named(`You left the entry for ${dA} ${LEFT}: Current account and the USD rate.`);
  check(
    'review 91: an address changed while locked closes the kept form, writes nothing, and the screen the unlock lands on names the holding and the unit',
    (await dialogs()) === 0 && (await hash()) === SAV && writesSent().length === 0 &&
      on(await stored('rate'), DA).length === 0 && byLockedAddress.ok,
    JSON.stringify({ dialogs: await dialogs(), hash: await hash(), writes: writesSent().map((t) => t.method), byLockedAddress }),
  );
}, { signsIn: true });
