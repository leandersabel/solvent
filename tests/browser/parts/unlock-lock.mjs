// The bar above a dialog (spec/features/login.md, Unlock, and
// spec/features/app-shell.md, The bar above a dialog): Lock stays
// pressable over any open dialog, by mouse, by touch and by key, and one
// press leaves nothing of the vault behind.
// Templates: dashboard.html, shell/. Modules: dom.js, shell.js, app.js,
// session.js, view-holding.js, view-forms.js.
import {
  VAULT_PASSWORD, check, click, enterPassword, occurring, page, run, setValue, story, text, unlockDashboard, vaultOwner,
} from '../harness.mjs';

await run(async () => {
  await vaultOwner();
  await story();
  await unlockDashboard('the dashboard to lock over');
  // The strings a devtools user would look for: every holding name and
  // every figure distinctive enough not to occur by chance.
  const probes = JSON.parse(await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    const names = [...v.holdings.values()].map(h => h.payload.name);
    const values = [...v.snapshots.values()].flat().map(s => s.payload.value).filter(x => x.length >= 7);
    return JSON.stringify([...new Set([...names, ...values])]);
  })()`));

  // ---- App shell: Lock above an open dialog -----------------------------

  // app-shell.md, The bar above a dialog. Every press of Lock here is real
  // input at its coordinates, a mouse click or a touch tap or key presses,
  // never an element.click(), which skips hit-testing and passes with the
  // scrim over the bar.
  {
    const FIGURE = '654.32';
    const geometry = () =>
      page.eval(`(() => {
        const lock = document.querySelector('.btn-lock');
        const bar = document.querySelector('.topbar');
        const box = lock.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        const barBox = bar.getBoundingClientRect();
        const covering = [...document.querySelectorAll('.scrim, .dialog')].filter((n) => {
          const b = n.getBoundingClientRect();
          return b.top < barBox.bottom - 0.5 && b.bottom > barBox.top + 0.5;
        }).length;
        const sheet = document.querySelector('.dialog').getBoundingClientRect();
        return JSON.stringify({
          x, y, onLock: lock === hit || lock.contains(hit), covering,
          barHeight: barBox.height, barBottom: barBox.bottom,
          chromeHeight: parseFloat(document.documentElement.style.getPropertyValue('--chrome-height')),
          scrimTop: document.querySelector('.scrim').getBoundingClientRect().top,
          sheetTop: sheet.top, innerWidth,
        });
      })()`).then(JSON.parse);
    const openRecordDialog = async () => {
      await page.eval("location.hash = '#/'");
      await page.waitUntil("document.querySelector('.data-table tbody .link-button')", { label: 'the dashboard to open a dialog from' });
      await page.eval("document.querySelector('.data-table tbody .link-button').click()");
      await page.waitUntil("location.hash.startsWith('#/holding/')", { label: 'a holding to record a value for' });
      await page.waitUntil("document.querySelector('.detail-header')", { label: 'the holding to record a value for' });
      await click('Record a value');
      await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
      await setValue('#snapshot-value', FIGURE);
    };
    const nothingLeft = async () => {
      const html = await page.eval('document.documentElement.outerHTML');
      const shown = await text();
      return {
        dialogs: await page.eval("document.querySelectorAll('.dialog, .scrim').length"),
        figure: await page.call((typed) => [...document.querySelectorAll('input, textarea')].filter((f) => f.value === typed).length, FIGURE),
        plaintext: occurring(probes, (probe) => html.includes(probe) || shown.includes(probe)),
        password: await page.eval("Boolean(document.querySelector('#unlock-password'))"),
      };
    };
    const comesBack = async (label) => {
      await enterPassword(VAULT_PASSWORD);
      await page.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label });
      await page.holds("document.querySelector('.dialog-heading')", { timeout: 10000 });
      await page.frames();
      return JSON.parse(await page.eval(`JSON.stringify({
        headings: [...document.querySelectorAll('.dialog-heading')].map((h) => h.textContent),
        figure: document.querySelector('#snapshot-value')?.value,
      })`));
    };

    for (const [name, press] of [
      ['at desktop width, with a mouse click', ({ x, y }) => page.mouseClick(x, y)],
      ['at phone width, with a touch tap', ({ x, y }) => page.tap(x, y)],
    ]) {
      const phone = name.includes('phone');
      await page.send('Emulation.setDeviceMetricsOverride', phone
        ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: false }
        : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: phone });
      await page.frames();
      await openRecordDialog();
      const before = await geometry();
      check(
        `with a Record a value dialog open ${name}, the element at Lock's centre is Lock and no scrim or sheet touches the bar`,
        before.onLock && before.covering === 0,
        JSON.stringify(before),
      );
      await press(before);
      await page.waitUntil("document.querySelector('#unlock-password')", { timeout: 20000, label: `the password screen after Lock ${name}` })
        .catch(() => {});
      const left = await nothingLeft();
      check(
        `one press on Lock ${name} leaves no dialog, no figure and no vault plaintext, and shows the password screen`,
        left.password && left.dialogs === 0 && left.figure === 0 && left.plaintext === 0,
        JSON.stringify(left),
      );
      const after = left.password ? await comesBack(`the vault after Lock ${name}`) : { headings: [] };
      check(
        `unlocking after Lock ${name} reopens the dialog with the typed figure`,
        after.headings.length === 1 && after.headings[0].startsWith('Record a value') && after.figure === FIGURE,
        JSON.stringify(after),
      );

      if (phone) {
        // The sheet starts at the bar's lower edge, and the scrim at it once
        // the turned phone is wide enough for a centred box.
        const sizes = [];
        for (const [width, height] of [[390, 844], [844, 390]]) {
          await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
          await page.waitUntil("document.documentElement.style.getPropertyValue('--chrome-height') !== ''", { label: 'the bar height' });
          await page.frames();
          sizes.push(await geometry());
        }
        check(
          '--chrome-height equals the bar height and the sheet starts at its bottom, before and after rotating',
          sizes.every((g) => Math.abs(g.chromeHeight - g.barHeight) < 0.5 && Math.abs(g.scrimTop - g.barBottom) < 0.5 && g.onLock && g.covering === 0) &&
            Math.abs(sizes[0].sheetTop - sizes[0].barBottom) < 0.5 && sizes[0].barHeight <= 64 && sizes[0].innerWidth !== sizes[1].innerWidth,
          JSON.stringify(sizes),
        );
        await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
        await page.frames();
      }
      await page.key('Escape');
      await page.holds("!document.querySelector('.scrim')");
    }
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.frames();

    // Open, the bar carries the wordmark and Lock alone, the page behind
    // is inert and the bar is not, and Lock is what a screen reader finds.
    await openRecordDialog();
    const heading = await page.eval("document.querySelector('.screen-heading').textContent");
    const open = JSON.parse(await page.eval(`(() => {
      const shown = (n) => n.getClientRects().length > 0;
      const bar = document.querySelector('.topbar');
      const inert = (n) => Boolean(n.closest('[inert]'));
      const update = [...bar.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Update values');
      return JSON.stringify({
        navHidden: !shown(bar.querySelector('nav')) && bar.querySelector('nav').hidden,
        updateHidden: !shown(update) && update.hidden,
        wordmark: shown(bar.querySelector('.wordmark')),
        lock: shown(bar.querySelector('.btn-lock')),
        sticky: getComputedStyle(bar).position,
        barInert: inert(bar),
        mainInert: document.querySelector('main').inert,
        dialogInert: inert(document.querySelector('.dialog')),
        modal: document.querySelectorAll('[aria-modal]').length,
        role: document.querySelector('.dialog').getAttribute('role'),
      });
    })()`));
    await page.send('Accessibility.enable');
    const { nodes } = await page.send('Accessibility.getFullAXTree');
    const exposed = (role, name) => nodes.some((n) => !n.ignored && n.role?.value === role && n.name?.value === name);
    check(
      'with a dialog open, the nav and Update values are hidden and the wordmark and Lock show',
      open.navHidden && open.updateHidden && open.wordmark && open.lock && open.sticky === 'sticky',
      JSON.stringify(open),
    );
    check(
      'with a dialog open, the content is inert and the bar and dialog are not, and no dialog is aria-modal',
      open.mainInert && !open.barInert && !open.dialogInert && open.modal === 0 && open.role === 'dialog',
      JSON.stringify(open),
    );
    check(
      'with a dialog open, Lock is in the accessibility tree and the content region is not',
      exposed('button', 'Lock') && !exposed('heading', heading),
      JSON.stringify({ lock: exposed('button', 'Lock'), content: exposed('heading', heading) }),
    );

    // Tab and Shift+Tab visit Lock and the dialog and nothing else.
    // What the dialog offers, leaving out what a closed disclosure hides.
    const DIALOG_CONTROLS = '.dialog button, .dialog input, .dialog select, .dialog textarea, .dialog summary, .dialog [href]';
    const where = () =>
      page.call((controls) => {
        const lock = document.querySelector('.btn-lock');
        const list = [...document.querySelectorAll(controls)].filter((n) => !n.disabled && n.checkVisibility());
        const at = document.activeElement;
        return at === lock ? 'lock' : list.includes(at) ? 'dialog' + list.indexOf(at) : 'outside';
      }, DIALOG_CONTROLS);
    const cycleSize = 1 + await page.call(
      (controls) => [...document.querySelectorAll(controls)].filter((n) => !n.disabled && n.checkVisibility()).length,
      DIALOG_CONTROLS,
    );
    const visited = {};
    for (const shift of [false, true]) {
      const seen = new Set();
      for (let n = 0; n < cycleSize * 2 + 2; n++) {
        await page.key('Tab', { shift });
        seen.add(await where());
      }
      visited[shift ? 'back' : 'forward'] = [...seen];
    }
    check(
      'Tab and Shift+Tab visit only Lock and the dialog, every one of them, in both directions',
      Object.values(visited).every((seen) => !seen.includes('outside') && seen.includes('lock') && seen.length === cycleSize),
      JSON.stringify({ visited, cycleSize }),
    );
    // Tab to Lock and Enter locks as a click does.
    for (let n = 0; n < cycleSize && (await where()) !== 'lock'; n++) await page.key('Tab');
    await page.key('Enter');
    await page.waitUntil("document.querySelector('#unlock-password')", { timeout: 20000, label: 'the password screen after Enter on Lock' })
      .catch(() => {});
    const byKey = await nothingLeft();
    check(
      'Tab to Lock and Enter locks with the dialog open, as a click does',
      byKey.password && byKey.dialogs === 0 && byKey.figure === 0 && byKey.plaintext === 0,
      JSON.stringify(byKey),
    );
    await comesBack('the vault after Enter on Lock');

    // A confirmation over the form: Escape closes the top one only, and
    // a press on Lock closes both and brings back the form alone.
    const confirmOver = () =>
      page.eval(`(async () => {
        const { dialog, el } = await import('/static/js/dom.js');
        document.querySelector('.dialog .btn-primary').focus();
        const close = dialog({
          heading: 'Replace the figure already recorded?',
          body: [el('p', { text: 'Replace it?' })],
          actions: [el('button', { type: 'button', class: 'btn-secondary', text: 'Keep what is there', onclick: () => close() })],
        });
      })()`);
    await confirmOver();
    const stacked = JSON.parse(await page.eval(`JSON.stringify({
      form: document.querySelectorAll('.scrim')[0].inert,
      confirmation: document.querySelectorAll('.scrim')[1].inert,
      main: document.querySelector('main').inert,
      bar: Boolean(document.querySelector('.topbar').closest('[inert]')),
    })`));
    await page.key('Escape');
    await page.holds("document.querySelectorAll('.dialog-heading').length === 1");
    const afterEscape = JSON.parse(await page.eval(`JSON.stringify({
      headings: [...document.querySelectorAll('.dialog-heading')].map((h) => h.textContent),
      focused: document.activeElement.textContent,
      formInert: document.querySelector('.scrim').inert,
      main: document.querySelector('main').inert,
    })`));
    await confirmOver();
    const lockAt = await geometry();
    await page.mouseClick(lockAt.x, lockAt.y);
    await page.waitUntil("document.querySelector('#unlock-password')", { timeout: 20000, label: 'the password screen with a confirmation open' })
      .catch(() => {});
    const bothGone = await nothingLeft();
    const restored = bothGone.password ? await comesBack('the vault after locking over a confirmation') : { headings: [] };
    check(
      'a confirmation over a form: the form beneath is inert while it is open, and Escape closes it alone with focus back on what opened it',
      stacked.form && !stacked.confirmation && stacked.main && !stacked.bar &&
        afterEscape.headings.length === 1 && afterEscape.headings[0].startsWith('Record a value') &&
        afterEscape.focused === 'Save' && !afterEscape.formInert && afterEscape.main,
      JSON.stringify({ stacked, afterEscape }),
    );
    check(
      'one press on Lock over a confirmation closes both, and unlocking brings back the form alone',
      bothGone.password && bothGone.dialogs === 0 && bothGone.figure === 0 &&
        restored.headings.length === 1 && restored.headings[0].startsWith('Record a value') && restored.figure === FIGURE,
      JSON.stringify({ bothGone, restored }),
    );
    await page.key('Escape');
    await page.holds("!document.querySelector('.scrim')");
    await page.frames();
    const closed = JSON.parse(await page.eval(`JSON.stringify({
      dialogs: document.querySelectorAll('.dialog').length,
      inert: document.querySelectorAll('[inert]').length,
      hidden: document.querySelectorAll('.topbar [hidden]').length,
      height: document.documentElement.style.getPropertyValue('--chrome-height'),
      sticky: getComputedStyle(document.querySelector('.topbar')).position,
      nav: document.querySelector('.topbar nav').getClientRects().length > 0,
    })`));
    check(
      'closing the last dialog shows the nav and Update values again and removes every inert',
      closed.dialogs === 0 && closed.inert === 0 && closed.hidden === 0 && closed.height === '' && closed.sticky !== 'sticky' && closed.nav,
      JSON.stringify(closed),
    );
  }
});
