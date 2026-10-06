// The way from Group by to the Dimensions screen, written from
// spec/features/net-worth-view.md (Trend chart card, Group by; At phone
// width; States, No dimensions configured; acceptance criterion 78) and
// spec/features/account-settings.md (Dimensions) without reading how it
// is built: while no dimension is active, a "Create a dimension" link
// sits beside Group by, which offers only "Total", and opens the
// Dimensions screen in the same document, so the password is not asked
// for. A dimension created there takes the link away, archiving it
// brings the link back, and an active dimension whose values are all
// archived is still active.
import {
  check, markDocument, page, reloadModel, run, setProfile, sitting, story, unlockDashboard, vaultOwner,
} from '../harness.mjs';

const LINK = 'Create a dimension';

// Group by as shown: its options, and the link beside it with where it
// lies against the select.
const groupBy = () =>
  page.call((wanted) => {
    const named = (s) => (s.labels?.[0]?.textContent || s.getAttribute('aria-label') || '').trim();
    const select = [...document.querySelectorAll('select')].find((s) => named(s).startsWith('Group by'));
    const shown = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const links = [...document.querySelectorAll('.dashboard a, .dashboard button')]
      .filter((n) => n.textContent.trim() === wanted && shown(n));
    const link = links[0];
    const s = select?.getBoundingClientRect();
    const l = link?.getBoundingClientRect();
    return {
      select: Boolean(select),
      options: select ? [...select.options].map((o) => o.textContent.trim()) : [],
      links: links.length,
      mentions: document.querySelector('.dashboard')?.innerText.split(wanted).length - 1,
      anchor: Boolean(link && link.tagName === 'A' && link.getAttribute('href') && link.tabIndex >= 0),
      inBanner: Boolean(link?.closest('[role=alert], [role=status], .banner')),
      // Beside: on the select's line, with no other control between them.
      beside: Boolean(s && l && l.top < s.bottom && l.bottom > s.top && l.left >= s.right &&
        ![...document.querySelectorAll('select, button, input, a')].some((n) => {
          const r = n.getBoundingClientRect();
          return n !== link && n !== select && shown(n) && r.top < s.bottom && r.bottom > s.top && r.left >= s.right && r.right <= l.left;
        })),
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  }, LINK);

const home = async () => {
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('svg.trend')", { label: 'the dashboard chart' });
  await page.idle();
};

const LIQUIDITY = {
  id: 'liq00001', label: 'Liquidity', archivedAt: null,
  values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }],
};
const ARCHIVED_AT = '2026-01-01T00:00:00.000Z';

await run(async () => {
  await vaultOwner();
  await story();
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await unlockDashboard('the dashboard with no dimension');

  const none = await groupBy();
  check('net-worth-view 78: with no dimension Group by offers only Total', none.options.join(',') === 'Total', JSON.stringify(none));
  check('net-worth-view 78: with no dimension one "Create a dimension" link shows on the dashboard',
    none.links === 1 && none.mentions === 1, JSON.stringify(none));
  check('net-worth-view 78: "Create a dimension" is a link a keyboard reaches, not a banner',
    none.anchor && !none.inBanner, JSON.stringify(none));
  check('net-worth-view 78: "Create a dimension" sits beside Group by', none.beside, JSON.stringify(none));

  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
  await home();
  const phone = await groupBy();
  check('net-worth-view At phone width: the link stays beside Group by and the page does not scroll sideways',
    phone.links === 1 && phone.beside && !phone.sideways, JSON.stringify(phone));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await home();

  await markDocument(page, 'dashboard');
  await page.call((wanted) => {
    [...document.querySelectorAll('.dashboard a')].find((a) => a.textContent.trim() === wanted).click();
  }, LINK);
  const opened = await page
    .waitUntil("document.body.innerText.includes('Dimensions are how') || document.querySelector('#unlock-password')", {
      timeout: 20000, label: 'the dimensions screen',
    })
    .then(() => true, () => false);
  const there = await sitting(page, 'dashboard');
  check('net-worth-view 78: the link opens the Dimensions screen, at its empty state',
    opened && (await page.eval("document.body.innerText.includes('Dimensions are how')")), JSON.stringify(there));
  check('net-worth-view 78: the Dimensions screen opens without asking for the password',
    there.sameDocument && there.keys && !there.card && there.passwordFields === 0, JSON.stringify(there));

  // A dimension made where the link leads, as a person makes one.
  await page.call((wanted) => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === wanted).click();
  }, LINK);
  await page.waitUntil("document.querySelector('.dialog input')", { label: 'the create dialog' });
  await page.call(() => {
    const inputs = document.querySelectorAll('.dialog input');
    for (const [i, value] of [[0, 'Liquidity'], [1, 'Cash']]) {
      inputs[i].value = value;
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    }
    [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Create').click();
  });
  await page.waitUntil("!document.querySelector('.dialog') && document.body.innerText.includes('holdings assigned')", {
    label: 'the created dimension',
  });
  await page.idle();
  await page.eval("[...document.querySelectorAll('.topbar nav a')].find((a) => a.textContent.trim() === 'Dashboard').click()");
  await page.waitUntil("document.querySelector('svg.trend')", { label: 'the dashboard after creating' });
  await page.idle();
  const created = await groupBy();
  check('net-worth-view 78: once a dimension is active the link is gone and Group by offers it',
    created.links === 0 && created.mentions === 0 && created.options.join(',') === 'Total,Liquidity', JSON.stringify(created));

  // Every dimension archived counts as none.
  await setProfile({ dimensions: [{ ...LIQUIDITY, archivedAt: ARCHIVED_AT }] });
  await home();
  const archived = await groupBy();
  check('net-worth-view No dimensions configured: with every dimension archived Group by offers only Total and the link is back',
    archived.options.join(',') === 'Total' && archived.links === 1 && archived.beside, JSON.stringify(archived));

  // A dimension stays active when its last value is archived.
  await setProfile({ dimensions: [{ ...LIQUIDITY, values: [{ ...LIQUIDITY.values[0], archivedAt: ARCHIVED_AT }] }] });
  await home();
  const valueless = await groupBy();
  check('net-worth-view 78: an active dimension with every value archived is active, so the link is gone',
    valueless.links === 0 && valueless.options.join(',') === 'Total,Liquidity', JSON.stringify(valueless));

  // account-settings 21: the other way in, from the top bar.
  await markDocument(page, 'top bar');
  await page.eval("[...document.querySelectorAll('.topbar nav a')].find((a) => a.textContent.trim() === 'Settings').click()");
  await page.waitUntil("document.querySelector('.link-row[href=\"/settings/dimensions\"]')", { label: 'settings' });
  await page.eval("document.querySelector('.link-row[href=\"/settings/dimensions\"]').click()");
  await page.waitUntil("document.querySelector('.dimension-card') || document.querySelector('#unlock-password')", {
    timeout: 20000, label: 'the dimensions screen from settings',
  });
  const fromBar = await sitting(page, 'top bar');
  check('account-settings 21: reaching Dimensions from the top bar does not ask for the password',
    fromBar.sameDocument && fromBar.keys && !fromBar.card && fromBar.hash === '#/settings/dimensions', JSON.stringify(fromBar));
});
