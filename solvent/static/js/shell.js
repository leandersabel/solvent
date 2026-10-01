// Solvent app shell: the global Alpine wiring every screen sits inside
// (spec/ui/design-system.md, App shell).
//
// Uses only the CSP-safe build (spec/architecture.md, Application
// hardening), whose parser accepts property access and method calls
// but no arbitrary expressions. Every piece of state and behavior is
// registered here and reached from HTML by name (`x-data="shell"`,
// `$store.shell.lock()`).
document.addEventListener('alpine:init', () => {
  Alpine.data('shell', shellComponent);
  Alpine.store('shell', shellStore());
});

// The component root that makes the shell subtree Alpine-managed. It
// holds no state of its own: the lock is shared, so it lives in the
// store below.
function shellComponent() {
  return {};
}

function shellStore() {
  return {
    // One click discards the keys and all decrypted state and shows
    // the re-unlock screen, with no confirmation dialog
    // (design-system.md, App shell). It makes no request, so the
    // server session is left exactly as it was (login.md, Rules).
    //
    // The keys and decrypted state belong to each screen's
    // client-side data layer (architecture.md, Components), so a
    // screen holding any registers its own `Alpine.store('vault')`
    // and this reaches it without knowing what it holds.
    lock() {
      Alpine.store('vault')?.clear();
    },

    // Straight into editing today, with no screen in between, which
    // is what makes the sweep reachable while the user is deep in one
    // holding (design-system.md, App shell).
    update() {
      Alpine.store('vault')?.updateValues();
    },
  };
}
