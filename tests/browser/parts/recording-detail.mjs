// A recording's own screen (spec/ui/recording-detail.md): one date and
// everything recorded at it, the way back into a sitting, and deleting
// the recording, whole or partway.
// Templates: dashboard.html. Modules: view-recording.js, view-sweep.js,
// writes.js, model.js, datepicker.js, view-dashboard.js.
import { BACKDATE, check, click, labels, page, proxyAsks, recording, run, story, text, unlockDashboard, vaultOwner } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  await vaultOwner();
  await story({ backdated: false });
  await unlockDashboard('the dashboard of the story');
  const asksBefore = proxyAsks.length;
  const rateCalls = () => proxyAsks.length - asksBefore;

  // ---- The recording's own screen -------------------------------------

  await page.eval("document.querySelector('.entry-mark').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.waitUntil("location.hash.startsWith('#/recording/')", { label: "the recording's screen" });
  await page.idle();
  check('the recording lists what went in that day', (await page.eval("document.querySelectorAll('.card tbody tr').length")) >= 4);
  const chips = await labels('.chip');
  check('each price says where it came from', chips.some((chip) => chip.startsWith('Market rate')), chips.join(','));
  check('the recording offers Update and Delete', (await labels('.form-actions button')).join(',') === 'Update,Delete');
  const beforeOpen = rateCalls();
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.entry-mark')", { label: 'the dashboard' });
  await page.eval("document.querySelector('.entry-mark').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.waitUntil("location.hash.startsWith('#/recording/')", { label: "the recording's screen again" });
  await page.idle();
  check('opening a recording asks the source nothing', rateCalls() === beforeOpen);


  // A second recording, earlier than the first.
  await recording(BACKDATE, { 'Cantonal account': '11000.00' });
  await unlockDashboard('the dashboard with its two recordings');

  // ---- Deleting a recording ---------------------------------------------

  const marksBefore = await page.eval("document.querySelectorAll('.entry-mark').length");
  await page.eval("document.querySelectorAll('.entry-mark')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.waitUntil("location.hash.startsWith('#/recording/')", { label: 'a recording to delete' });
  await page.frames();
  await click('Delete');
  await page.waitUntil("document.body.innerText.includes('Delete the recording for')", { label: 'the delete dialog' });
  check('the confirmation says the prices go too', (await text()).includes('every price captured with it'));
  check('it names how many holdings move', /\d+ holdings measured in/.test(await text()));
  check('it says there is no way back', (await text()).includes('cannot be undone'));
  await click('Delete the recording');
  await page.waitUntil("location.hash === '#/'", { timeout: 60000, label: 'the dashboard after deleting' });
  await page.idle();
  check(
    'the date is gone from the chart',
    (await page.eval("document.querySelectorAll('.entry-mark').length")) === marksBefore - 1,
  );


  // ---- A recording that stops partway, in a vault of its own --------

  const r = await startRecorder();
  await r.register();
  await r.seed();
  // The date a recording is picked at, which holds figures and prices.
  await r.plantHere([
    r.snap('Current account', r.D10, '1100'),
    r.snap('Brokerage', r.D10, '2100'),
    r.price('USD', r.D10, r.proposalsFor(r.D10).USD.rate, 'proposed'),
    r.price('XAU-ozt', r.D10, r.proposalsFor(r.D10)['XAU-ozt'].rate, 'proposed'),
  ]);
  await r.reread();
  await r.home();
  const {
    rec, D1, D10, traffic, faults, ev, press, stored,
    on, go, figure, home, newRecording, price,
  } = r;

  // ---- record-snapshot: the date picker and deleting a recording ----------

  await home();
  traffic.length = 0;
  const saidMarked = await newRecording(D10);
  check(
    'record-snapshot: picking a date that holds a recording opens it, with no request and no create',
    saidMarked.marked && (await ev('location.hash')) === `#/recording/${D10}` && traffic.length === 0,
    JSON.stringify(saidMarked),
  );
  await go(`#/recording/${D1}`);
  let deletes = 0;
  faults.push((r) => (r.method === 'DELETE' && (deletes += 1) === 3 ? 500 : null));
  await press('Delete');
  await press('Delete the recording', '.dialog');
  faults.length = 0;
  const partial = await ev("document.querySelector('.recording .field-error').textContent");
  const leftAtFirst = on(await stored('snapshot'), D1).concat(on(await stored('rate'), D1));
  check(
    'record-snapshot: a delete that stops partway rolls nothing back, and says what is left',
    partial.startsWith('Part of the recording is still there:') && leftAtFirst.length === 1 && leftAtFirst.every((r) => r.payload),
    partial,
  );
  await press('Delete');
  await press('Delete the recording', '.dialog');
  const goneAtFirst = on(await stored('snapshot'), D1).length + on(await stored('rate'), D1).length;
  const freeAgain = await newRecording(D1);
  check(
    'record-snapshot: deleting a recording removes every figure and price at the date, and the date is new again',
    goneAtFirst === 0 && !freeAgain.marked && !freeAgain.dotted,
    JSON.stringify(freeAgain),
  );
});
