// The sign-in page. Nothing here but the card
// (spec/ui/unlock.md).
import { mount } from './dom.js';
import { unlockCard } from './unlock.js';

mount(
  document.getElementById('app'),
  unlockCard({
    onUnlocked: (result) => {
      window.location.href = result.kind === 'administrator' ? '/admin' : '/dashboard';
    },
  }),
);
