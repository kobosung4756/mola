/**
 * Light or dark look, chosen in the left bar's settings (or following the system). The choice is
 * kept in this browser and applied as <html data-theme="light|dark"> before anything is drawn.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'board-studio:theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

let choice: ThemeChoice = stored();

export const themeChoice = () => choice;

function apply() {
  const dark = choice === 'dark' || (choice === 'system' && !!media?.matches);
  const root = document.documentElement;
  // Switch at once: without this, every block would fade its colours separately.
  root.classList.add('theme-switching');
  root.dataset.theme = dark ? 'dark' : 'light';
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Without storage it lasts until the page is closed.
  }
  apply();
}

if (typeof document !== 'undefined') {
  apply();
  // Following the system: switch when the system does.
  media?.addEventListener?.('change', () => choice === 'system' && apply());
}
