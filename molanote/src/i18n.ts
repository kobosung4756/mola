/**
 * The app's language: Korean (default) or English, chosen in the left bar's settings. Every piece
 * of text is written as tr('한국어', 'English'); switching reloads the page so all of it follows.
 */
export type Lang = 'ko' | 'en';

const KEY = 'board-studio:lang';

function stored(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
}

export const lang: Lang = stored();

/** The text in the chosen language. */
export const tr = (ko: string, en: string): string => (lang === 'en' ? en : ko);

/** Switches the language (the page reloads; boards are saved before that). */
export function setLang(next: Lang) {
  if (next === lang) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Without storage the choice cannot be kept.
    return;
  }
  location.reload();
}

if (typeof document !== 'undefined') document.documentElement.lang = lang;
