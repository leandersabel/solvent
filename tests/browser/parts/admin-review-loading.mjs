// Reviewer's part for issue #491, written from spec/features/admin-invites.md
// (Admin, States, and criterion 64) and design-system.md (States,
// Loading), blind to the change. While its list is on its way, each of
// Invites, Accounts and Units shows skeleton rows in petrol-100 and no
// word, with no table drawn, then its table. The create card and the
// password card fetch nothing, so they render at once with no skeleton.
import { administrator, check, click, expectedFailures, intercept, mintInvite, page, run } from '../harness.mjs';

// petrol-100 (spec/design-system.md, Tokens).
const PETROL_100 = 'rgb(224, 238, 242)';
const CARD = 'same bar as anybody';
const LISTS = ['invites', 'accounts', 'symbols'];

// A skeleton block is an empty petrol-100 box at least a line of text
// tall, which the password card's strength gauge segments are not.
const LINE = 8;

// What the content region shows: the skeleton blocks drawn, those inside
// the create card or the password card, any table cell drawn, and
// whether a loading word is on screen.
const state = () =>
  page.call((fill, passwordWords, line) => {
    const app = document.querySelector('#app');
    const drawn = (node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (node.checkVisibility ? node.checkVisibility() : true);
    };
    const blocks = [...app.querySelectorAll('*')].filter(
      (node) => getComputedStyle(node).backgroundColor === fill && !node.textContent.trim() && drawn(node) && node.getBoundingClientRect().height >= line,
    );
    const cardOf = (test) => [...app.querySelectorAll('.card')].find(test);
    const create = cardOf((c) => [...c.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create invite link'));
    const password = cardOf((c) => c.textContent.includes(passwordWords));
    return {
      skeletons: blocks.length,
      inCreate: create ? blocks.filter((b) => create.contains(b)).length : null,
      createDrawn: Boolean(create && drawn(create)),
      inPassword: password ? blocks.filter((b) => password.contains(b)).length : null,
      passwordDrawn: Boolean(password && drawn(password)),
      cells: [...app.querySelectorAll('th, td')].filter(drawn).length,
      word: /loading/i.test(app.innerText),
    };
  }, PETROL_100, CARD, LINE);

const showsSkeleton = (label) =>
  page.holds(
    (fill, line) => [...document.querySelectorAll('#app *')].filter((node) => {
      const box = node.getBoundingClientRect();
      return getComputedStyle(node).backgroundColor === fill && !node.textContent.trim() && box.width > 0 && box.height >= line;
    }).length >= 2,
    { args: [PETROL_100, LINE], timeout: 30000, label },
  );

const showsCell = (words, label) =>
  page.holds(
    (needle) => [...document.querySelectorAll('#app td')].some((td) => td.textContent.includes(needle) && td.getBoundingClientRect().height > 0),
    { args: [words], timeout: 30000, label },
  );

await run(async () => {
  mintInvite('vault-owner');
  await administrator();
  expectedFailures.add('/api/admin/');

  // Each list is held until its section has been looked at, and passes
  // straight through once released, however often it is asked for.
  const gates = new Map(LISTS.map((name) => {
    let open;
    const opened = new Promise((resolve) => { open = resolve; });
    return [name, { asked: 0, open, opened }];
  }));
  const stop = await intercept(page, '*/api/admin/*', async (request) => {
    if (request.method !== 'GET') return null;
    const path = new URL(request.url).pathname;
    const gate = gates.get(LISTS.find((name) => path === `/api/admin/${name}`));
    if (!gate) return null;
    gate.asked += 1;
    await gate.opened;
    return null;
  });

  try {
    await page.eval('location.reload()');
    await page.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", {
      timeout: 90000,
      label: 'the admin area',
    });
    // Notes any loading word that appears while sections switch.
    await page.call(() => {
      window.__loadingWord = false;
      new MutationObserver(() => {
        if (/loading/i.test(document.querySelector('#app').innerText)) window.__loadingWord = true;
      }).observe(document.querySelector('#app'), { subtree: true, childList: true, characterData: true });
    });

    // The password card fetches nothing, so it draws at once while every
    // list is still on its way.
    await click('Your password');
    const password = await page.holds(
      (words) => [...document.querySelectorAll('#app .card')].some((c) => c.textContent.includes(words)),
      { args: [CARD], timeout: 30000, label: 'the password card' },
    );
    const shown = await state();
    check('the password card is drawn at once, with no skeleton in it', password && shown.passwordDrawn && shown.inPassword === 0, JSON.stringify(shown));

    const sections = [
      ['Invites', 'invites', 'Waiting'],
      ['Accounts', 'accounts', 'ops.leander'],
      ['Units', 'symbols', 'CHF'],
    ];
    for (const [section, list, row] of sections) {
      await click(section);
      const skeleton = await showsSkeleton(`${section} skeleton rows`);
      const held = await state();
      check(`${section} asked for its list, which is held`, gates.get(list).asked > 0, `${gates.get(list).asked} asks`);
      check(`while its list loads, ${section} shows skeleton rows in petrol-100`, skeleton, JSON.stringify(held));
      check(`and no loading word`, !held.word, JSON.stringify(held));
      check(`and no table yet`, held.cells === 0, JSON.stringify(held));
      if (section === 'Invites') {
        check('the create card is drawn at once, with no skeleton in it', held.createDrawn && held.inCreate === 0, JSON.stringify(held));
      }
      gates.get(list).open();
      check(`once its list arrives, ${section} shows its table`, await showsCell(row, `the ${section} table`));
      const loaded = await state();
      check(`and its skeleton rows are gone`, loaded.skeletons === 0, JSON.stringify(loaded));
    }
    check('no loading word appeared while switching sections', !(await page.eval('window.__loadingWord')));
  } finally {
    for (const gate of gates.values()) gate.open();
    await stop();
  }
}, { signsIn: false });
