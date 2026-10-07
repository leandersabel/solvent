// Reviewer's checks of the names a screen reader gives the fields of the
// admin area, written from spec/features/admin-invites.md (Admin: Invites,
// Accounts and its Remove dialog, Units' Add a unit, Your password;
// criterion 59) and spec/design-system.md (Accessibility: a form
// control's visible label is its accessible name) without reading how
// the screen is built. The name is read from the browser's accessibility
// tree, which is what a screen reader hears.
import { administrator, check, openBrowser, run, vaultOwner } from '../harness.mjs';

// The containers a part of the screen may sit in. The innermost visible
// one showing the marker is the part's scope.
const SCOPES = 'form, details, .card, section, dialog, [role="dialog"], .dialog';
const CONTROLS = 'input, select, textarea, [role=switch], [role=radio], [role=checkbox], [role=combobox], [role=textbox]';
const GROUPS = 'fieldset, [role=radiogroup], [role=group]';
const NOT_FIELDS = ['button', 'submit', 'reset', 'image', 'hidden'];

// Every control and group in the scope, each with the accessibility
// tree's name for it, and the lines of the scope's visible text.
const fields = async (session, marker) => {
  const { result: global } = await session.send('Runtime.evaluate', { expression: 'globalThis' });
  const { result: list } = await session.send('Runtime.callFunctionOn', {
    objectId: global.objectId,
    functionDeclaration: ((scopes, mark, controls, groups) => {
      const scope = [...document.querySelectorAll(scopes)].filter((e) => e.checkVisibility() && e.innerText.includes(mark)).at(-1);
      return scope ? [...scope.querySelectorAll(`${controls}, ${groups}`)] : [];
    }).toString(),
    arguments: [{ value: SCOPES }, { value: marker }, { value: CONTROLS }, { value: GROUPS }],
  });
  const { result: props } = await session.send('Runtime.getProperties', { objectId: list.objectId, ownProperties: true });
  const out = [];
  for (const prop of props.filter((p) => /^\d+$/.test(p.name))) {
    const { objectId } = prop.value;
    const { nodes } = await session.send('Accessibility.getPartialAXTree', { objectId, fetchRelatives: false });
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: function (scopes, mark, groups) {
        const scope = [...document.querySelectorAll(scopes)].filter((e) => e.checkVisibility() && e.innerText.includes(mark)).at(-1);
        return {
          lines: scope.innerText.split('\n').map((l) => l.trim()).filter(Boolean),
          kind: this.matches(groups) ? 'group' : this.tagName === 'INPUT' ? this.type : this.getAttribute('role') || this.tagName.toLowerCase(),
          holdsField: this.matches(groups) && this.querySelector('input, select, textarea, [role]') !== null,
        };
      }.toString(),
      arguments: [{ value: SCOPES }, { value: marker }, { value: GROUPS }],
      returnByValue: true,
    });
    out.push({ ...result.value, ignored: nodes[0].ignored, name: (nodes[0].name?.value ?? '').trim() });
  }
  return out;
};

// A field a person types into, as opposed to a choice between options.
const typed = (c) => !['radio', 'checkbox', 'switch', 'group', ...NOT_FIELDS].includes(c.kind);
// Every control a screen reader meets: a hidden one it never reaches is
// none of its business.
const met = (list) => list.filter((c) => c.kind !== 'group' && !NOT_FIELDS.includes(c.kind) && !c.ignored);
// The name is one whole line of the visible text, so a name the eye
// cannot see, or one with other words run into it, fails.
const beside = (c) => !c.ignored && c.name !== '' && c.lines.includes(c.name);
// A choice's label may carry a line of explanation, so its name need
// only be text the screen shows.
const shown = (c) => !c.ignored && c.name !== '' && c.lines.join('\n').includes(c.name);
// The spec's copy may end a label on a full stop.
const bare = (name) => name.replace(/[.:]$/, '');

const expect = (where, list, wanted) => {
  for (const name of wanted) {
    const found = list.filter((c) => !c.ignored && bare(c.name) === name && (c.kind !== 'group' || c.holdsField));
    check(`review 59: ${where} has one field a screen reader names "${name}"`, found.length === 1,
      JSON.stringify(list.map((c) => [c.kind, c.name, c.ignored])));
    check(`review 59: ${where}'s "${name}" field is named by the label shown beside it`, found.length === 1 && beside(found[0]),
      JSON.stringify(found));
  }
  const reached = met(list);
  check(`review 59: every field typed into on ${where} is named by the label shown beside it`,
    reached.filter(typed).length >= wanted.length && reached.filter(typed).every(beside),
    JSON.stringify(reached.filter((c) => typed(c) && !beside(c))));
  check(`design-system: every choice on ${where} is named by text it shows`,
    reached.filter((c) => !typed(c)).every(shown), JSON.stringify(reached.filter((c) => !typed(c) && !shown(c))));
};

const press = (session, label) =>
  session.waitUntil(
    (name) => {
      const found = [...document.querySelectorAll('button, a, summary')].find((b) => b.textContent.trim() === name && b.checkVisibility());
      if (found) found.click();
      return Boolean(found);
    },
    { args: [label], label: `the ${label} control` },
  );
const showing = (session, marker, label) =>
  session.waitUntil(
    (scopes, mark) => [...document.querySelectorAll(scopes)].some((e) => e.checkVisibility() && e.innerText.includes(mark)),
    { args: [SCOPES, marker], timeout: 30000, label },
  );

await run(async () => {
  // A vault owner, so the administrator's Accounts has a row to remove.
  await vaultOwner();
  const { session, close } = await openBrowser();
  try {
    await administrator(session);
    await session.send('Accessibility.enable');
    const cancelRemove = async () => {
      await press(session, 'Cancel');
      await session.waitUntil(
        (scopes, mark) => ![...document.querySelectorAll(scopes)].some((e) => e.checkVisibility() && e.innerText.includes(mark)),
        { args: [SCOPES, 'Type the username to confirm'], label: 'the Remove dialog closed' },
      );
    };

    // ---- Invites ------------------------------------------------------------
    await showing(session, 'A note to yourself', 'the create card');
    await session.idle();
    expect('the create card', await fields(session, 'A note to yourself'), ['A note to yourself', 'This link stops working after']);
    // Create another draws the card again, which must name its fields as the first did.
    await press(session, 'Create invite link');
    await session.waitUntil("document.body.innerText.includes('Copy this now')", { timeout: 30000, label: 'the one-time link' });
    await press(session, 'Create another');
    await showing(session, 'A note to yourself', 'the create card again');
    await session.idle();
    expect('the create card after Create another', await fields(session, 'A note to yourself'),
      ['A note to yourself', 'This link stops working after']);

    // ---- Accounts: the Remove dialog -----------------------------------------
    await press(session, 'Accounts');
    await press(session, 'Remove');
    await showing(session, 'Type the username to confirm', 'the Remove dialog');
    await session.idle();
    expect('the Remove dialog', await fields(session, 'Type the username to confirm'), ['Type the username to confirm']);
    // A dialog opened a second time names its field as the first did.
    await cancelRemove();
    await press(session, 'Remove');
    await showing(session, 'Type the username to confirm', 'the Remove dialog again');
    await session.idle();
    expect('the Remove dialog opened again', await fields(session, 'Type the username to confirm'), ['Type the username to confirm']);
    await cancelRemove();

    // ---- Units: Add a unit ---------------------------------------------------
    await press(session, 'Units');
    await session.waitUntil("document.body.innerText.includes('Add a unit')", { timeout: 30000, label: 'the units card' });
    const folded = await session.eval("!document.body.innerText.includes('A code is permanent')");
    if (folded) await press(session, 'Add a unit');
    await showing(session, 'A code is permanent', 'the add form');
    await session.idle();
    expect('Add a unit', await fields(session, 'A code is permanent'), ['Code', 'Name', 'Kind', 'Rate lookup']);

    // review 59: each row's own Rate lookup is named by its column's
    // heading and the row's code, so no two rows sound alike.
    const column = (heading, controls) => {
      const table = [...document.querySelectorAll('table')].find((t) => t.innerText.includes('Swiss Franc'));
      const at = [...table.querySelectorAll('th')].findIndex((th) => th.textContent.trim() === heading);
      return [...table.querySelectorAll('tbody tr')].map((r) => (controls ? r.children[at].querySelector(controls) : r.children[at].innerText.split('\n')[0].trim()));
    };
    const codes = await session.call(column, 'Code', null);
    const { result: global } = await session.send('Runtime.evaluate', { expression: 'globalThis' });
    const { result: list } = await session.send('Runtime.callFunctionOn', {
      objectId: global.objectId,
      functionDeclaration: column.toString(),
      arguments: [{ value: 'Rate lookup' }, { value: CONTROLS }],
    });
    const { result: props } = await session.send('Runtime.getProperties', { objectId: list.objectId, ownProperties: true });
    const rows = [];
    for (const prop of props.filter((p) => /^\d+$/.test(p.name))) {
      const { nodes: [node] } = await session.send('Accessibility.getPartialAXTree', { objectId: prop.value.objectId, fetchRelatives: false });
      rows.push({ code: codes[Number(prop.name)], ignored: node.ignored, name: node.name?.value ?? '' });
    }
    const misnamed = rows.filter((r) => r.ignored || r.name !== `Rate lookup, ${r.code}`);
    check("review 59: a screen reader names each unit row's Rate lookup by its column's heading and the unit's code",
      rows.length === codes.length && rows.some((r) => r.code === 'CHF') && misnamed.length === 0,
      JSON.stringify(misnamed.length ? misnamed : rows.length));

    // ---- Your password -------------------------------------------------------
    await press(session, 'Your password');
    await showing(session, 'same bar as anybody', 'the password card');
    await session.idle();
    const card = await fields(session, 'same bar as anybody');
    expect('the password card', card, []);
    const passwords = met(card).filter((c) => c.kind === 'password');
    check('review 59: the password card has three password fields a screen reader meets',
      passwords.length === 3, JSON.stringify(card.map((c) => [c.kind, c.name, c.ignored])));
    check('review 59: each password field of the card has a name of its own',
      new Set(passwords.map((c) => c.name)).size === passwords.length, JSON.stringify(passwords.map((c) => c.name)));
  } finally {
    await close();
  }
}, { signsIn: false });
