// Snapshot entry's message for a holding archived in another window,
// naming a holding with no space in it (record-snapshot.md, Snapshot
// entry, States, and acceptance criterion 108). The name wraps inside
// the Dialog and nothing pans sideways.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

// Wider than the Dialog at a phone's width, with no point a line may
// break at.
const NAME = 'Unterschleissheimerstrassenverkehrsgesellschaftsbeteiligungsanteil_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const WIDTHS = [320, 375];

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, go, press, set, quiet, plantHere, reread, stored, viewport } = r;
  const [id] = await plantHere([
    { type: 'account', payload: { name: NAME, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-02T00:00:00Z' } },
  ]);
  await reread();

  await viewport(WIDTHS[0]);
  await go(`#/holding/${id}`);
  await press('Record a value', '.form-actions');
  await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  await set('#snapshot-value', '5');
  // Archived after the form opened, as another window would.
  const account = (await stored('account')).find((a) => a.recordId === id);
  await plantHere([
    { type: 'snapshot', accountId: id, payload: { date: T, value: '0', note: null } },
    { type: 'account', recordId: id, version: account.version + 1, payload: { ...account.payload, archivedAt: T } },
  ]);
  await rec.call(() => [...document.querySelector('.dialog').querySelectorAll('button')].find((b) => b.textContent === 'Save').click());
  await quiet();

  for (const width of WIDTHS) {
    await viewport(width);
    const seen = await rec.call((name) => {
      const html = document.documentElement;
      const message = [...document.querySelectorAll('.dialog .field-error')].find((m) => m.textContent.includes(name));
      if (!message) return JSON.stringify({ message: false });
      const box = message.closest('.dialog');
      const dialog = box.getBoundingClientRect();
      const b = message.getBoundingClientRect();
      return JSON.stringify({
        message: true,
        width: html.clientWidth,
        scrollWidth: html.scrollWidth,
        dialogPans: box.scrollWidth > box.clientWidth + 0.5,
        dialog: { left: dialog.left, right: dialog.right },
        box: { left: b.left, right: b.right },
        spill: message.scrollWidth > message.clientWidth + 0.5,
      });
    }, NAME).then(JSON.parse);
    const where = `at ${width}px`;
    check(`snapshot-entry: the archived-elsewhere message names the holding ${where}`, seen.message, JSON.stringify(seen));
    if (!seen.message) continue;
    check(`snapshot-entry: nothing pans sideways ${where}`, seen.scrollWidth <= seen.width && !seen.dialogPans, JSON.stringify(seen));
    check(
      `snapshot-entry: a long holding name wraps inside the Dialog ${where}`,
      !seen.spill && seen.box.left >= seen.dialog.left - 0.5 && seen.box.right <= seen.dialog.right + 0.5,
      JSON.stringify(seen),
    );
  }
  await rec.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
