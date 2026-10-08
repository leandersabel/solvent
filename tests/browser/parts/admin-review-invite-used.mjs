// Reviewer's part for issue #456, written from
// spec/features/admin-invites.md (Endpoints, the revoke route: a used
// link is a Conflict naming `invite-used`, "and the reason lets the
// screen say so"; States: "Error, call back failed"; criteria 9 and 61)
// and architecture.md (Status codes: a Conflict without a `refused`
// member is never mistaken for one with it), blind to the change. A
// Conflict that does not name `invite-used`, answered for a link that is
// still waiting, reads the call back failure on a row still Waiting and
// never the used-meanwhile copy.
import { BASE, administrator, check, expectedFailures, intercept, page, run, sql } from '../harness.mjs';

const USED_MEANWHILE = 'This link has already been used. Remove the account instead.';
const NOT_CALLED_BACK = 'The link was not called back. Try again.';
const DIALOG = 'dialog[open], [role=dialog], [role=alertdialog]';
const LABEL = 'conflict-unnamed';

const row = () =>
  page.call((note) => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(note));
    if (!tr) return null;
    const cells = [...tr.querySelectorAll('td, th')];
    return {
      text: tr.innerText.replace(/\s+/g, ' ').trim(),
      buttons: [...cells[cells.length - 1].querySelectorAll('button')].map((b) => b.textContent.trim()),
    };
  }, LABEL);

const openInvites = async () => {
  await page.goto(`${BASE}/admin`);
  await page.waitUntil(
    (n) => [...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes(n) && r.innerText.includes('Call back')),
    { args: [LABEL], timeout: 90000, label: `the ${LABEL} row offering Call back` },
  );
};

const callBack = async () => {
  await page.call((note) => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(note));
    [...tr.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Call back').click();
  }, LABEL);
  const buttons = `${DIALOG.split(', ').join(' button, ')} button`;
  await page.waitUntil((sel) => [...document.querySelectorAll(sel)].some((b) => b.textContent.trim() && b.textContent.trim() !== 'Cancel'),
    { args: [buttons], label: 'the call back dialog' });
  await page.call((sel) => [...document.querySelectorAll(sel)]
    .find((b) => b.textContent.trim() && b.textContent.trim() !== 'Cancel').click(), buttons);
};

await run(async () => {
  await administrator();
  const made = await page.call(async (label) => {
    const response = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresInDays: 7, label, kind: 'vault_owner' }),
    });
    return response.status;
  }, LABEL);
  check('the waiting link is made', made === 200, String(made));

  for (const [how, body] of [['no reason', '{}'], ['another reason', '{"refused":"something-else"}']]) {
    await openInvites();
    expectedFailures.add('/revoke');
    const stop = await intercept(page, '*/api/admin/invites/*/revoke',
      (request) => (request.method === 'POST' ? { status: 409, body } : null));
    try {
      await callBack();
      await page.waitUntil(
        (note, a, b) => [...document.querySelectorAll('tbody tr')]
          .some((r) => r.innerText.includes(note) && (r.innerText.includes(a) || r.innerText.includes(b))),
        { args: [LABEL, NOT_CALLED_BACK, USED_MEANWHILE], timeout: 30000, label: 'an outcome on the row' },
      ).catch(() => {});
    } finally {
      await stop();
      expectedFailures.delete('/revoke');
    }
    const after = await row();
    check(`a Conflict with ${how} reads "${NOT_CALLED_BACK}"`, after && after.text.includes(NOT_CALLED_BACK), JSON.stringify(after));
    check(`a Conflict with ${how} never reads "${USED_MEANWHILE}"`, after && !after.text.includes(USED_MEANWHILE), JSON.stringify(after));
    check(`after a Conflict with ${how} the row is still Waiting with Call back`,
      after && after.text.includes('Waiting') && after.buttons.includes('Call back'), JSON.stringify(after));
    check(`after a Conflict with ${how} the link is still pending`,
      sql('SELECT status FROM invites WHERE label = ?', LABEL)[0].status === 'pending');
  }
}, { signsIn: false });
