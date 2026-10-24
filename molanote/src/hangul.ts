/*
 * Finding Korean by its first consonants (초성 검색): "ㅎㅇ" finds 회의 and 학원, and the two can
 * be mixed ("회ㅇ" finds 회의). Used by the search (Ctrl+Space), the board finder (Ctrl+O) and the
 * [[ block finder.
 */

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/**
 * Consonants typed one after another can be joined by the Korean keyboard into one (ㄱ+ㅅ → ㄳ,
 * ㄹ+ㄱ → ㄺ …): taken apart again, as the two first consonants they were meant as.
 */
const JOINED: Record<string, string> = {
  ㄳ: 'ㄱㅅ',
  ㄵ: 'ㄴㅈ',
  ㄶ: 'ㄴㅎ',
  ㄺ: 'ㄹㄱ',
  ㄻ: 'ㄹㅁ',
  ㄼ: 'ㄹㅂ',
  ㄽ: 'ㄹㅅ',
  ㄾ: 'ㄹㅌ',
  ㄿ: 'ㄹㅍ',
  ㅀ: 'ㄹㅎ',
  ㅄ: 'ㅂㅅ',
};

/** The leading consonants of the Hangul Jamo block (as some systems type them), as the usual ones. */
const LEAD = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const fromLead = (c: string) => {
  const n = c.charCodeAt(0) - 0x1100;
  return n >= 0 && n < 19 ? LEAD[n] : c;
};

/** Whether a character is a lone first consonant (as typed for 초성 search). */
const isCho = (c: string) => CHO.includes(c);

/** The first consonant of a Hangul syllable (the character itself for anything else). */
export function choOf(c: string): string {
  const n = c.charCodeAt(0) - 0xac00;
  return n >= 0 && n < 11172 ? CHO[Math.floor(n / 588)] : c;
}

/** What is typed, made ready for 초성 matching: joined consonants taken apart, odd forms made the usual ones. */
const prepare = (needle: string) =>
  Array.from(needle.normalize('NFC'))
    .map((c) => JOINED[c] ?? fromLead(c))
    .join('');

/**
 * Whether `text` has `needle` in it (both already lower-cased): as it is, or with any lone first
 * consonant in the needle standing for a syllable that starts with it.
 */
export function textHas(text: string, needle: string): boolean {
  if (!needle || text.includes(needle)) return true;
  const q = Array.from(prepare(needle));
  if (!q.some(isCho)) return text.normalize('NFC').includes(needle.normalize('NFC'));
  const t = Array.from(text.normalize('NFC'));
  outer: for (let i = 0; i + q.length <= t.length; i++) {
    for (let j = 0; j < q.length; j++) {
      const qc = q[j];
      const tc = t[i + j];
      if (qc === tc || (isCho(qc) && choOf(tc) === qc)) continue;
      continue outer;
    }
    return true;
  }
  return false;
}
