// The Import file picker's button, written from
// spec/features/export-import.md (Import, step 1, and acceptance
// criterion 59) and spec/design-system.md (Components, Button,
// secondary; Spacing, radius and phone-width height; Accessibility,
// focus ring and keyboard) without reading how the screen is built.
// The picker's button is the file input's own button while the input
// shows, or else the shown control labelling it.
import { check, page, run, vaultOwner } from '../harness.mjs';

const SECONDARY = {
  background: 'rgba(0, 0, 0, 0)',
  color: 'rgb(24, 77, 89)', // petrol-700
  border: 'rgb(196, 204, 207)', // rule
  radius: '6px',
};

const look = () => page.call(() => {
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const input = document.querySelector('#app input[type=file]');
  if (!input) return { found: false };
  const own = shown(input);
  const target = own ? input : [...input.labels].find(shown) || null;
  if (!target) return { found: true, own, target: null };
  target.scrollIntoView({ block: 'center' });
  const s = getComputedStyle(target, own ? '::file-selector-button' : null);
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const box = target.getBoundingClientRect();
  return {
    found: true,
    own,
    target: own ? 'input::file-selector-button' : `${target.tagName.toLowerCase()}#${target.id}`,
    background: s.backgroundColor,
    backgroundImage: s.backgroundImage,
    color: s.color,
    borders: sides.map((side) => `${s[`border${side}Style`]} ${s[`border${side}Width`]} ${s[`border${side}Color`]}`),
    radii: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((c) => s[`border${c}Radius`]),
    height: box.height,
    ownHeight: s.height,
    center: [box.left + box.width / 2, box.top + box.height / 2],
  };
});

const matches = (seen) => seen.target
  && seen.background === SECONDARY.background
  && seen.backgroundImage === 'none'
  && seen.color === SECONDARY.color
  && seen.borders.every((b) => b.startsWith('solid') && parseFloat(b.split(' ')[1]) >= 1 && b.endsWith(SECONDARY.border))
  && seen.radii.every((r) => r === SECONDARY.radius);

const space = async () => {
  const key = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ' ', ...key });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
};

// Opens the chooser by `act`, answering whether the browser offered one.
const opensChooser = async (act) => {
  const opened = page.waitFor('Page.fileChooserOpened', 5000).then(() => true, () => false);
  await act();
  return opened;
};

await run(async () => {
  await vaultOwner();
  await page.eval("location.hash = '#/settings/export-import'");
  await page.waitUntil("document.querySelector('#app input[type=file]')", { label: 'the import file picker' });
  await page.idle();

  const wide = await look();
  check('the import step has a file picker with a shown button', wide.found && wide.target, JSON.stringify(wide));
  check("the picker's button is Button, secondary: transparent, petrol-700 text, rule border, 6px radius", matches(wide), JSON.stringify(wide));

  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  await page.frames();
  const phone = await look();
  check("the picker's button is Button, secondary at phone width", matches(phone), JSON.stringify(phone));
  check("the picker's button is at least 44px tall at phone width", phone.height >= 44, JSON.stringify(phone));
  await page.send('Emulation.clearDeviceMetricsOverride');
  await page.frames();

  await page.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const at = (await look()).center;
  check("pressing the picker's button opens the file chooser", at && await opensChooser(() => page.mouseClick(...at)), JSON.stringify(at));

  // Keyboard: Tab reaches the file input, it shows a focus ring, and Space opens the chooser.
  await page.eval('document.activeElement && document.activeElement.blur(); document.body.focus()');
  let reached = false;
  for (let i = 0; i < 40 && !reached; i += 1) {
    await page.key('Tab');
    reached = await page.eval("document.activeElement && document.activeElement.matches('#app input[type=file]')");
  }
  check('Tab reaches the file picker', reached);
  if (reached) {
    const ring = await page.call(() => {
      const input = document.activeElement;
      const own = getComputedStyle(input);
      const visible = (s) => s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const label = [...input.labels].find((l) => visible(getComputedStyle(l)));
      return { input: visible(own), label: Boolean(label), outline: `${own.outlineStyle} ${own.outlineWidth} ${own.outlineColor}`, shadow: own.boxShadow };
    });
    check('the focused file picker shows a visible focus ring', ring.input || ring.label || ring.shadow !== 'none', JSON.stringify(ring));
    check('Space on the focused file picker opens the file chooser', await opensChooser(space));
  }
  await page.send('Page.setInterceptFileChooserDialog', { enabled: false });
}, { signsIn: false });
