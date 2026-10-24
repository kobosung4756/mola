import { useState } from 'react';
import { lang, setLang, tr } from '../i18n';
import type { Lang } from '../i18n';
import { setTheme, themeChoice } from '../theme';
import type { ThemeChoice } from '../theme';

/** Language and light/dark look, as a section of the top bar's ⋯ menu. */
export function MenuPrefs() {
  const [theme, setThemeState] = useState<ThemeChoice>(themeChoice());
  const langs: [Lang, string][] = [
    ['ko', '한국어'],
    ['en', 'English'],
  ];
  const themes: [ThemeChoice, string][] = [
    ['light', tr('라이트', 'Light')],
    ['dark', tr('다크', 'Dark')],
    ['system', tr('시스템', 'System')],
  ];
  return (
    <div className="menu-prefs" data-settings>
      <div className="menu-pref-row">
        <span className="menu-folder-label">{tr('언어', 'Language')}</span>
        <div className="settings-langs" role="radiogroup" aria-label={tr('언어', 'Language')}>
          {langs.map(([l, name]) => (
            <button key={l} role="radio" aria-checked={lang === l} className={lang === l ? 'on' : ''} data-lang={l} onClick={() => setLang(l)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="menu-pref-row">
        <span className="menu-folder-label">{tr('화면', 'Theme')}</span>
        <div className="settings-langs settings-themes" role="radiogroup" aria-label={tr('화면', 'Theme')}>
          {themes.map(([t, name]) => (
            <button
              key={t}
              role="radio"
              aria-checked={theme === t}
              className={theme === t ? 'on' : ''}
              data-theme-choice={t}
              onClick={() => {
                setTheme(t);
                setThemeState(t);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
