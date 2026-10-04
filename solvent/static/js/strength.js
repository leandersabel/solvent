// The password bar: at least twelve characters and a zxcvbn score of
// at least three (spec/features/register.md, Register, The strength gauge).
//
// Both are enforced in the browser, because the server never sees the
// password and cannot check it. The bar reads as a magnitude rather
// than a verdict: it fills, it does not run red to green. A password
// that is not there yet is a distance left to cover, not a mistake.
import { el } from './dom.js';

export const MIN_LENGTH = 12;
const MIN_SCORE = 3;

const RATINGS = ['very weak', 'weak', 'fair', 'strong', 'very strong'];

// The path and hash of the pinned zxcvbn (ZXCVBN_VERSION and ZXCVBN_SRI
// in solvent/crypto.py, which a test holds this to). They live here and
// not in the page's markup, because markup could plant a source of its
// own.
const ZXCVBN_URL = new URL('../vendor/zxcvbn/4.4.2/zxcvbn.js', import.meta.url);
const ZXCVBN_SRI = 'sha384-LXuP8lknSGBOLVn4fwVOl+rWR+zOEtZx6CF9ZLaN6gKBgLByU4D79VWWjV4/gefq';

/** Load zxcvbn unless the page already has it. A function is the test,
 *  because an element with id="zxcvbn" also answers to window.zxcvbn. Resolves
 *  either way: a gauge that cannot score still enforces the length
 *  floor, and the submit rule below refuses anything it could not
 *  score. */
let fetching = null;
function ensureZxcvbn() {
  if (typeof window.zxcvbn === 'function') return Promise.resolve();
  if (fetching) return fetching;
  fetching = new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = ZXCVBN_URL.href;
    tag.integrity = ZXCVBN_SRI;
    tag.crossOrigin = 'anonymous';
    tag.addEventListener('load', resolve);
    tag.addEventListener('error', resolve);
    document.head.append(tag);
  });
  return fetching;
}

export function strengthGauge(input, onChange) {
  const segments = [0, 1, 2, 3].map(() => el('span', { class: 'gauge-segment' }));
  const label = el('span', { class: 'gauge-label' });
  const unmet = el('p', { class: 'field-error', hidden: true });

  const evaluate = () => {
    const value = input.value;
    const result = typeof window.zxcvbn === 'function' ? window.zxcvbn(value) : { score: 0 };
    segments.forEach((segment, index) => {
      segment.classList.toggle('filled', value.length > 0 && index < result.score + 1);
    });
    label.textContent = value
      ? `${RATINGS[result.score]}, ${result.crack_times_display ? result.crack_times_display.offline_slow_hashing_1e4_per_second : ''}`.replace(/, $/, '')
      : '';

    // Whichever condition is unmet is named, never a bare "password
    // too weak".
    let problem = null;
    if (value && value.length < MIN_LENGTH) {
      problem = `Use at least ${MIN_LENGTH} characters. This one has ${value.length}.`;
    } else if (value && result.score < MIN_SCORE) {
      problem = 'This is a common pattern. A longer phrase of ordinary words is stronger.';
    }
    if (problem) {
      unmet.textContent = problem;
      unmet.hidden = false;
    } else {
      unmet.hidden = true;
    }
    onChange(!problem && value.length > 0);
  };

  input.addEventListener('input', evaluate);
  ensureZxcvbn().then(evaluate);

  return {
    element: el('div', { class: 'gauge' }, [
      el('div', { class: 'gauge-track' }, segments),
      label,
      el('p', {
        class: 'hint',
        text: 'Length beats symbols. A four-word phrase you can remember is stronger than P@ssw0rd!.',
      }),
      unmet,
    ]),
    evaluate,
  };
}
