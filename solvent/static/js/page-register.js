// An administrator's registration page (spec/ui/register.md).
//
// An administrator holds no keys, so nothing has to survive the move to
// the admin area and it is an ordinary page load. A vault owner's
// invite is served the vault page instead (register-form.js).
import { mount } from './dom.js';
import { registerForm } from './register-form.js';

const container = document.getElementById('app');
const kdf = JSON.parse(document.getElementById('kdf-envelope').textContent);

// The form holds the token, so the address bar drops it: a bookmark,
// a shared screen or a synced history afterwards carries nothing
// (admin-invites.md, Rules).
const token = container.dataset.token;
history.replaceState(null, '', window.location.pathname);

mount(
  container,
  registerForm({
    kind: container.dataset.kind,
    token,
    currencies: JSON.parse(container.dataset.currencies || '[]'),
    kdf,
    onCreated: (created) => {
      window.location.href = created.kind === 'administrator' ? '/admin' : '/dashboard';
    },
  }),
);
