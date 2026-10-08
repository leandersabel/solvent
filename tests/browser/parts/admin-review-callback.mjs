// Reviewer's part for issue #451, written from
// spec/features/admin-invites.md (Admin, Invites: the Status and action
// cell bullets; States: "Error, call back failed" and "Error, the link
// was used while the table was open"; criteria 9 and 61), blind to the
// change. A link used in another browser while Invites is open, then
// called back, turns its row to Used with the username and the day,
// drops Call back, and reads the used-meanwhile copy, with no uncaught
// error. A call back the server fails or never answers reads its error
// on that row alone, which stays Waiting, and a later call back that
// succeeds clears it.
import {
  BASE, REGISTRANT_PASSWORD, administrator, check, expectedFailures, intercept, openBrowser, page, register, run, sql,
} from '../harness.mjs';

const USED_MEANWHILE = 'This link has already been used. Remove the account instead.';
const NOT_CALLED_BACK = 'The link was not called back. Try again.';
// design-system.md, Ink and line: ink-secondary #4d575a.
const INK_SECONDARY = 'rgb(77, 87, 90)';
const DIALOG = 'dialog[open], [role=dialog], [role=alertdialog]';
const USER = 'sarah.race';

const api = (method, path, body) =>
  page.call(async (m, p, b) => {
    const response = await fetch(p, {
      method: m,
      headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: b === null ? undefined : JSON.stringify(b),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, method, path, body ?? null);

const invite = async (label) => {
  const made = await api('POST', '/api/admin/invites', { expiresInDays: 7, label, kind: 'vault_owner' });
  if (made.status >= 300) throw new Error(`invite: ${JSON.stringify(made)}`);
  return made.body;
};

const statusIn = (label) => sql('SELECT status, used_by FROM invites WHERE label = ?', label)[0];

// The invites table, each row by its note: the Created cell, the Status
// cell's text and buttons, the action cell's text and buttons, the
// whole row's text, and the Note cell's ink.
const invites = () =>
  page.call(() => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Stops working'));
    if (!table) return {};
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const flat = (n) => (n ? n.innerText.replace(/\s+/g, ' ').trim() : null);
    const out = {};
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.querySelectorAll('td, th')];
      if (cells.length < heads.length) continue;
      const note = cells[heads.indexOf('Note')];
      const status = cells[heads.indexOf('Status')];
      const action = cells[cells.length - 1];
      out[flat(note)] = {
        created: flat(cells[heads.indexOf('Created')]),
        status: flat(status),
        statusButtons: [...status.querySelectorAll('button')].map((b) => b.textContent.trim()),
        action: flat(action),
        actionButtons: [...action.querySelectorAll('button')].map((b) => b.textContent.trim()),
        row: flat(tr),
        ink: getComputedStyle(note).color,
      };
    }
    return out;
  });

const openInvites = async (needle) => {
  await page.goto(`${BASE}/admin`);
  await page.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", {
    timeout: 90000,
    label: 'the admin area',
  });
  await page.waitUntil(
    (n) => [...document.querySelectorAll('table')].some((t) =>
      [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Stops working') && t.innerText.includes(n)),
    { args: [needle], timeout: 60000, label: `the invites table showing ${needle}` },
  );
};

// Presses Call back on the row noted `label` and confirms it in its
// dialog with whatever the dialog's button other than Cancel reads.
const callBack = async (label) => {
  await page.call((note) => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(note));
    [...tr.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Call back').click();
  }, label);
  await page.waitUntil((sel) => [...document.querySelectorAll(`${sel.split(', ').join(' button, ')} button`)]
    .some((b) => b.textContent.trim() && b.textContent.trim() !== 'Cancel'), { args: [DIALOG], label: `the call back dialog for ${label}` });
  await page.call((sel) => [...document.querySelectorAll(`${sel.split(', ').join(' button, ')} button`)]
    .find((b) => b.textContent.trim() && b.textContent.trim() !== 'Cancel').click(), DIALOG);
};

const rowReads = (label, words) =>
  page.waitUntil(
    (note, w) => [...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes(note) && r.innerText.includes(w)),
    { args: [label, words], timeout: 30000, label: `"${words}" on the ${label} row` },
  ).catch(() => {});

await run(async () => {
  await administrator();
  const used = await invite('race-used');
  await invite('race-failing');
  await invite('race-quiet');
  await openInvites('race-quiet');

  const before = await invites();
  check(
    'with Invites open, every new link reads Waiting and offers Call back',
    ['race-used', 'race-failing', 'race-quiet'].every((n) => before[n] && before[n].status === 'Waiting' && before[n].actionButtons.includes('Call back')),
    JSON.stringify(before),
  );

  // Someone registers from the link in another browser while the table
  // stays open.
  const other = await openBrowser();
  try {
    await register(other.session, used.token, USER, REGISTRANT_PASSWORD);
    await other.session.waitUntil("!location.pathname.startsWith('/register')", { timeout: 90000, label: `${USER} registered` });
  } finally {
    other.close();
  }
  check('the link is used in the database before it is called back', statusIn('race-used').status === 'used');

  // The server answers the call back with its Conflict, which the
  // browser logs as a failed load. An uncaught error is still reported.
  expectedFailures.add('/revoke');
  try {
    await callBack('race-used');
    await rowReads('race-used', USED_MEANWHILE);
  } finally {
    expectedFailures.delete('/revoke');
  }
  const raced = (await invites())['race-used'];
  check(`the raced row reads "${USED_MEANWHILE}"`, raced && raced.row.includes(USED_MEANWHILE), JSON.stringify(raced));
  check(
    'the raced row refreshes to Used, naming the username and the day it was used in the Created format',
    raced && raced.status.startsWith('Used') && raced.status.includes(`Used ${USER} on ${raced.created}`),
    JSON.stringify(raced),
  );
  check('the raced row\'s username is a link button', raced && raced.statusButtons.includes(USER), JSON.stringify(raced));
  check('the raced row no longer offers Call back', raced && !raced.actionButtons.includes('Call back'), JSON.stringify(raced));
  check('the raced row does not read the call back failure', raced && !raced.row.includes(NOT_CALLED_BACK), JSON.stringify(raced));
  check('the raced row, no longer Waiting, is set in ink-secondary', raced && raced.ink === INK_SECONDARY, raced && raced.ink);
  const raceAfter = statusIn('race-used');
  check('the link stays used and keeps its username', raceAfter.status === 'used' && raceAfter.used_by === USER, JSON.stringify(raceAfter));
  const others = await invites();
  check(
    'the other rows stay Waiting with Call back and read neither error',
    ['race-failing', 'race-quiet'].every((n) => others[n].status === 'Waiting' && others[n].actionButtons.includes('Call back')
      && !others[n].row.includes(USED_MEANWHILE) && !others[n].row.includes(NOT_CALLED_BACK)),
    JSON.stringify(others),
  );

  // A call back the server fails, or that never reaches it.
  for (const [how, answer] of [['a 500', { status: 500, body: '{}' }], ['a dropped connection', { drop: true }]]) {
    await openInvites('race-quiet');
    expectedFailures.add('/revoke');
    const stop = await intercept(page, '*/api/admin/invites/*/revoke', (request) => (request.method === 'POST' ? answer : null));
    try {
      await callBack('race-failing');
      await rowReads('race-failing', NOT_CALLED_BACK);
    } finally {
      await stop();
      expectedFailures.delete('/revoke');
    }
    const rows = await invites();
    const failed = rows['race-failing'];
    check(`a call back failed with ${how} reads "${NOT_CALLED_BACK}" on its row`, failed && failed.row.includes(NOT_CALLED_BACK), JSON.stringify(failed));
    check(
      `after a call back failed with ${how}, the row's status is still Waiting and it still offers Call back`,
      failed && failed.status === 'Waiting' && failed.actionButtons.includes('Call back'),
      JSON.stringify(failed),
    );
    check(`after a call back failed with ${how}, the link is still pending`, statusIn('race-failing').status === 'pending');
    check(
      `after a call back failed with ${how}, no other row reads it`,
      Object.entries(rows).every(([n, r]) => n === 'race-failing' || !r.row.includes(NOT_CALLED_BACK)),
      JSON.stringify(rows),
    );
  }

  // design-system.md, States, Error: an error that is not a field's sits
  // above the control it concerns, in critical text.
  const placed = await page.call((words) => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('race-failing'));
    const button = [...tr.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Call back');
    const line = [...tr.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.includes(words));
    const b = button.getBoundingClientRect();
    const l = line.getBoundingClientRect();
    return { lineBottom: l.bottom, buttonTop: b.top, color: getComputedStyle(line).color };
  }, NOT_CALLED_BACK);
  check('the call back error sits above the Call back button', placed.lineBottom <= placed.buttonTop, JSON.stringify(placed));
  // design-system.md: critical #ac312c.
  check('the call back error is critical text', placed.color === 'rgb(172, 49, 44)', placed.color);

  // Criterion 53: with the used-meanwhile line and the error both shown,
  // nothing scrolls sideways at any width it names.
  for (const width of [320, 390, 768, 901, 1280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: width < 900 });
    await page.frames();
    const over = await page.call(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`at ${width}px, with both lines shown, the page does not scroll sideways`, over <= 0, `${over}px over`);
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
  await page.frames();

  // Trying again, with the server answering, calls it back.
  await callBack('race-failing');
  await rowReads('race-failing', 'Called back');
  const retried = (await invites())['race-failing'];
  check(
    'trying again calls the link back and clears the error',
    retried && retried.status === 'Called back' && !retried.row.includes(NOT_CALLED_BACK) && statusIn('race-failing').status === 'revoked',
    JSON.stringify(retried),
  );
}, { signsIn: false });
