// The name a screen reader gives each field of both registration forms,
// written from spec/features/register.md (Register, Create your vault,
// Create an administrator account; acceptance criterion 51) without
// reading how the forms are built.
//
// Each field is found as a person finds it, by what it is, and its name
// is read from the browser's accessibility tree, which is what a screen
// reader hears. The name must be the label shown beside the field,
// exactly, so a placeholder or a neighbor's text standing in fails.
import { BASE, check, mintInvite, page, run } from '../harness.mjs';

// What each field is, by what the feature page says of it rather than by
// how it is marked up: the username's and the new password's
// autocomplete, the password fields in order, the currency's search.
const FIELDS = {
  Username: 'input[autocomplete="username"]',
  Password: 'input[type="password"]',
  'Confirm password': 'input[type="password"]',
  'Main currency': 'input[placeholder="Search by code or name"]',
};
const NTH = { Username: 0, Password: 0, 'Confirm password': 1, 'Main currency': 0 };

// The accessible name of the field `label` stands for, or why there is
// none to read.
const nameOf = async (label) => {
  const { root } = await page.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await page.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: FIELDS[label] });
  if (nodeIds.length <= NTH[label]) return { found: false };
  const { nodes } = await page.send('Accessibility.getPartialAXTree', { nodeId: nodeIds[NTH[label]], fetchRelatives: false });
  const node = nodes[0];
  return { found: true, ignored: Boolean(node.ignored), name: node.name?.value ?? '' };
};

// Whether the page shows `label` as a text of its own, the label a
// sighted person reads beside the field.
const shownAsLabel = (label) =>
  page.call((wanted) => [...document.querySelectorAll('body *')].some(
    (n) => n.checkVisibility() && n.children.length === 0 && n.textContent.trim() === wanted,
  ), label);

const form = async (title, kind, labels) => {
  await page.goto(`${BASE}/register?invite=${mintInvite(kind)}`);
  await page.idle();
  await page.send('Accessibility.enable');
  for (const label of labels) {
    const field = await nameOf(label);
    const shown = await shownAsLabel(label);
    check(
      `review 51: on ${title}, a screen reader names the ${label} field "${label}", the label shown beside it`,
      field.found && !field.ignored && field.name === label && shown,
      JSON.stringify({ ...field, shown }),
    );
  }
};

await run(async () => {
  await form('Create your vault', 'vault-owner', ['Username', 'Password', 'Confirm password', 'Main currency']);
  await form('Create an administrator account', 'administrator', ['Username', 'Password', 'Confirm password']);
}, { signsIn: false });
