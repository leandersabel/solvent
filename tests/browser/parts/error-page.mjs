// The page served wherever no screen can be (spec/ui/error-page.md), and
// the app shell's rule that every page declares its icon.
// Templates: error.html, shell/. Modules: app.js, shell.js.
import {
  ADMIN_PASSWORD, BASE, VAULT_PASSWORD, administrator, check, openBrowser, problems, run, signInOn, vaultOwner,
} from '../harness.mjs';

await run(async () => {
  // The two accounts a refusal is told apart for.
  await administrator();
  await vaultOwner();

  // ---- App shell: no console error on a page reached by navigation -----
  //
  // app-shell.md: every page declares its icon, so the browser never asks
  // for /favicon.ico, which the gate refuses. A fresh browser with no
  // session reaches a shell page, a Not Found (the administration area
  // answers a caller with no session as an unknown path) and a Forbidden
  // (the export, navigated to without its header). Nothing here is
  // filtered but the browser's own note that the page it was asked for
  // answered 4xx; any other error it logs is a problem.
  {
    const bare = await openBrowser();
    const logged = [];
    const asked = new Set();
    bare.session.on((message) => {
      if (
        message.method === 'Log.entryAdded' &&
        message.params.entry.level === 'error' &&
        !asked.has(message.params.entry.url)
      ) {
        logged.push(`${message.params.entry.url || ''} ${message.params.entry.text}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        logged.push(`console.error ${JSON.stringify(message.params.args.map((a) => a.value))}`);
      }
      if (message.method === 'Runtime.exceptionThrown') logged.push('exception');
    });
    await bare.session.send('Log.enable');
    try {
      for (const [name, path, status] of [
        ['a shell page', '/login', 200],
        ['a Not Found page', '/admin', 404],
        ['a Forbidden page', '/api/export', 403],
      ]) {
        asked.add(`${BASE}${path}`);
        await bare.session.goto(`${BASE}${path}`);
        await bare.session.idle();
        const answered = await bare.session.eval("performance.getEntriesByType('navigation')[0].responseStatus");
        const icon = await bare.session.eval(
          "document.querySelector('link[rel=icon]')?.getAttribute('href') + ' ' + document.querySelector('link[rel=icon]')?.getAttribute('type')",
        );
        check(`${name} answers ${status}`, answered === status, answered);
        check(`${name} declares the app icon from the static endpoint`, icon === '/static/icon.png image/png', icon);
      }
      check('no page reached by navigation logs an error in the console', logged.length === 0, logged.join(' | '));
      for (const entry of logged) problems.push(entry);
    } finally {
      bare.close();
    }
  }

  // ---- App shell: one Not Found, whoever navigates to it ----------------
  //
  // app-shell.md, Refusals: a page refusal is the same page whatever the
  // session, the kind or the header, so a navigation to /admin cannot be
  // told apart from one to an address that was never there. Each is a
  // real top-level navigation, in a browser holding the session it names.
  // `//admin` is left to tests/test_guard.py: the development server
  // collapses the leading slashes before the app sees them.
  {
    const signedOut = await openBrowser();
    const owner = await openBrowser(`${BASE}/login`);
    const administrator = await openBrowser(`${BASE}/login`);
    try {
      await signInOn(administrator.session, ADMIN_PASSWORD, 'ops.leander');
      await administrator.session.waitUntil("location.pathname === '/admin'", { timeout: 90000, label: 'the admin area for the Not Found check' });
      await signInOn(owner.session, VAULT_PASSWORD, 'leander');
      await owner.session.waitUntil("location.pathname === '/dashboard' && document.querySelector('.topbar nav a')", { timeout: 90000, label: 'the dashboard for the Not Found check' });

      const answers = {};
      for (const [name, who, path] of [
        ['/admin signed out', signedOut, '/admin'],
        ['/admin as a vault owner', owner, '/admin'],
        ['/settings as an administrator', administrator, '/settings'],
        ['an invented page path', signedOut, '/some-invented-page'],
        ['/favicon.ico signed out', signedOut, '/favicon.ico'],
      ]) {
        await who.session.goto(`${BASE}${path}`);
        answers[name] = {
          status: await who.session.eval("performance.getEntriesByType('navigation')[0].responseStatus"),
          path: await who.session.eval('location.pathname'),
          html: await who.session.eval('document.documentElement.outerHTML'),
        };
      }
      const names = Object.keys(answers);
      for (const name of names) {
        check(`${name} answers Not Found without redirecting`, answers[name].status === 404, answers[name].status);
      }
      check(
        'every address that is not served renders the identical Not Found page',
        names.every((name) => answers[name].html === answers[names[0]].html),
        names.filter((name) => answers[name].html !== answers[names[0]].html).join(', '),
      );
      check(
        'no refused navigation is sent anywhere else',
        names.every((name, i) => answers[name].path === ['/admin', '/admin', '/settings', '/some-invented-page', '/favicon.ico'][i]),
        names.map((name) => answers[name].path).join(' '),
      );

      // The page is drawn from the design system's tokens, at any depth
      // of invented path, and fits a phone. The sign-in card is the
      // reference for the typeface.
      await signedOut.session.goto(`${BASE}/login`);
      await signedOut.session.waitUntil("document.querySelector('.signin-card')", { timeout: 30000, label: 'the sign-in card' });
      const signInFont = await signedOut.session.eval("getComputedStyle(document.querySelector('.signin-card')).fontFamily");
      // Every resource the page asks for answers OK and nothing is
      // logged but the browser's note on the page's own 404.
      const answered = [];
      const logged = [];
      signedOut.session.on((message) => {
        if (message.method === 'Network.responseReceived' && message.params.type !== 'Document') {
          answered.push(`${message.params.response.url} ${message.params.response.status}`);
        }
        if (
          message.method === 'Log.entryAdded' &&
          message.params.entry.level === 'error' &&
          message.params.entry.url !== `${BASE}/a/b/c/`
        ) {
          logged.push(`${message.params.entry.url || ''} ${message.params.entry.text}`);
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') logged.push('console.error');
      });
      await signedOut.session.send('Log.enable');
      await signedOut.session.goto(`${BASE}/a/b/c/`);
      await signedOut.session.idle();
      const drawn = await signedOut.session.eval(`(() => {
        const ground = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
        const rgb = [1, 3, 5].map((i) => parseInt(ground.slice(i, i + 2), 16)).join(', ');
        return {
          ground: 'rgb(' + rgb + ')',
          background: getComputedStyle(document.body).backgroundColor,
          font: getComputedStyle(document.querySelector('.card h1')).fontFamily,
          padding: getComputedStyle(document.querySelector('.card')).paddingLeft,
          bottom: getComputedStyle(document.querySelector('.card')).marginBottom,
        };
      })()`);
      check('the Not Found page is on the ground colour', drawn.background === drawn.ground, `${drawn.background} vs ${drawn.ground}`);
      check('the Not Found page is set in the sign-in card typeface', drawn.font === signInFont && !/^["']?Times/.test(drawn.font), `${drawn.font} vs ${signInFont}`);
      check('at desktop width the card pads 32px and has no bottom margin', drawn.padding === '32px' && drawn.bottom === '0px', `${drawn.padding}, ${drawn.bottom}`);
      check(
        'the stylesheet of a deep invented path loads from /static/ and every resource answers OK (a revalidated 304 included)',
        answered.some((entry) => entry.startsWith(`${BASE}/static/css/tokens.css `)) &&
          answered.every((entry) => Number(entry.split(' ').at(-1)) < 400),
        answered.join(' | '),
      );
      check('the deep invented path logs no console error', logged.length === 0, logged.join(' | '));
      await signedOut.session.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
      await signedOut.session.frames();
      const phone = await signedOut.session.eval(`(() => {
        const button = document.querySelector('a[href="/"]').getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          padding: getComputedStyle(document.querySelector('.card')).paddingLeft,
          button: button.height,
        };
      })()`);
      check('the Not Found page has no horizontal overflow at 390px', phone.overflow <= 0, phone.overflow);
      check('at 390px the card pads 16px and the button is 44px tall at least', phone.padding === '16px' && phone.button >= 44, `${phone.padding}, ${phone.button}px`);
      await signedOut.session.send('Emulation.clearDeviceMetricsOverride');

      // Go to Solvent, activated by a click on it, goes where `/` goes
      // for whoever is asking.
      for (const [name, who, to] of [
        ['signed out', signedOut, '/dashboard'],
        ['a vault owner', owner, '/dashboard'],
        ['an administrator', administrator, '/admin'],
      ]) {
        await who.session.goto(`${BASE}/some-invented-page`);
        const at = await who.session.eval(`(() => {
          const box = document.querySelector('a[href="/"]').getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        })()`);
        await who.session.mouseClick(at.x, at.y);
        await who.session.waitUntil((path) => location.pathname === path, { args: [to], timeout: 30000, label: `Go to Solvent for ${name}` });
        check(`Go to Solvent leads ${name} to ${to}`, true);
      }
    } finally {
      signedOut.close();
      owner.close();
      administrator.close();
    }
  }
});
