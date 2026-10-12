// Snapshot entry, Closing with changes unsaved
// (spec/features/record-snapshot.md, criterion 91): Back, or an address
// changed by hand, leaves the single-holding form as a link would, also
// while locked. The form closes, writes nothing, and the screen arrived
// at names what was left.
import { RECORDER_PASSWORD, check, enterPasswordOn, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, D1, id, traffic, writesSent, ev, set, press, quiet, go, format } = r;

  const LEFT = 'with changes that were not saved';
  const leftNotices = () => rec.call((left) => [...document.querySelectorAll('.banner-critical')]
    .map((n) => n.textContent.trim()).filter((t) => t.includes(left)), LEFT);
  const openForm = async (name) => {
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the form for ${name}` });
    await quiet();
  };
  const setDate = async (iso) => {
    await set('#snapshot-date', await format('date', iso));
    await ev('document.activeElement && document.activeElement.blur()');
    await quiet();
  };
  const leave = async (how, hash) => {
    await ev(how);
    await rec.waitUntil((to) => location.hash === to, { args: [hash], label: hash });
    await quiet();
  };
  const DA = ago(37);
  const expected = `You left the entry for ${await format('longDate', DA)} ${LEFT}: Current account.`;

  const backLocked = async () => {
    await ev("document.querySelector('.btn-lock').click()");
    await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card' });
    await leave('history.back()', `#/recording/${D1}`);
    await enterPasswordOn(rec, RECORDER_PASSWORD);
    await rec.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label: 'the vault after unlocking' });
    await rec.frames();
    await quiet();
  };

  const cases = [
    ['Back', () => leave('history.back()', `#/recording/${D1}`)],
    ['an address typed by hand', () => leave(`location.hash = '#/recording/${D1}'`, `#/recording/${D1}`)],
    ['Back while locked', backLocked],
  ];
  for (const [name, how] of cases) {
    await go(`#/recording/${D1}`);
    await go(`#/holding/${id['Current account']}`);
    await openForm('Current account');
    await setDate(DA);
    await set('#snapshot-value', '123');
    traffic.length = 0;
    await how();
    const dialogs = await ev("document.querySelectorAll('.dialog').length");
    const shown = await leftNotices();
    check(
      `91: ${name} with a figure typed closes the form, writes nothing, and the screen arrived at names the holding`,
      dialogs === 0 && writesSent().length === 0 && shown.length === 1 && shown[0] === expected,
      JSON.stringify({ dialogs, shown, writes: writesSent().map((t) => t.method) }),
    );
  }
});
