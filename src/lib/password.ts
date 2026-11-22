/**
 * Password strength estimation (client-side guidance; never sent anywhere).
 * Combines a guess-space estimate with penalties for the patterns attackers try first:
 * common/breached passwords, keyboard runs, sequences, repeats, dates and personal details.
 */
const COMMON = new Set(`password password1 password123 passw0rd p@ssw0rd p@ssword 123456 1234567 12345678 123456789 1234567890 qwerty qwerty123
qwertyuiop asdfgh asdfghjkl zxcvbnm 111111 000000 123123 654321 abc123 iloveyou admin admin123 administrator welcome welcome1 welcome123
letmein monkey dragon master sunshine princess football baseball shadow superman trustno1 login changeme default secret
ghana ghana123 ghana2024 ghana2025 ghana2026 accra accra123 kumasi tema blackstars blackstar osagyefo nkrumah akwaaba medaase
immigration gis123 gis2026 police police123 eagle eagle360 eagleeye atlip infinity techub`.split(/\s+/));
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];

export interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; bits: number; warnings: string[]; tips: string[]; acceptable: boolean }
export const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
export const MIN_LENGTH = 12;

function longestRun(pw: string, seqs: string[]) {
  const s = pw.toLowerCase(); let best = 0;
  for (const row of seqs) for (const r of [row, [...row].reverse().join('')]) {
    for (let len = Math.min(r.length, s.length); len >= 3; len--) {
      let hit = false;
      for (let i = 0; i + len <= r.length; i++) if (s.includes(r.slice(i, i + len))) { hit = true; break; }
      if (hit) { best = Math.max(best, len); break; }
    }
  }
  return best;
}

export function passwordStrength(pw: string, personal: string[] = []): Strength {
  const warnings: string[] = []; const tips: string[] = [];
  if (!pw) return { score: 0, label: LABELS[0], bits: 0, warnings, tips: [`Use at least ${MIN_LENGTH} characters — a short phrase of unrelated words works well.`], acceptable: false };
  const lower = /[a-z]/.test(pw), upper = /[A-Z]/.test(pw), digit = /\d/.test(pw), symbol = /[^A-Za-z0-9]/.test(pw);
  const pool = (lower ? 26 : 0) + (upper ? 26 : 0) + (digit ? 10 : 0) + (symbol ? 33 : 0);
  const unique = new Set(pw).size;
  let bits = pw.length * Math.log2(Math.max(pool, 1)) * Math.min(1, 0.45 + unique / Math.max(pw.length, 1));

  const plain = pw.toLowerCase().replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/\$/g, 's').replace(/7/g, 't');
  const core = plain.replace(/[^a-z]/g, '');
  if (COMMON.has(pw.toLowerCase()) || COMMON.has(plain) || COMMON.has(core)) { bits = Math.min(bits, 10); warnings.push('This is a very common password.'); }
  let commonWords = 0;
  if (!warnings.length) for (const w of COMMON) {
    if (w.length >= 5 && !/^\d+$/.test(w) && (plain.includes(w) || core.includes(w))) {
      commonWords++; bits -= 14;
      if (commonWords === 1) warnings.push(`Contains a common word (“${w}”).`);
      if (commonWords >= 3) break;
    }
  }

  const kb = longestRun(pw, KEYBOARD_ROWS); if (kb >= 4) { bits -= kb * 3; warnings.push('Avoid keyboard patterns like “qwerty” or “1234”.'); }
  const ab = longestRun(pw, ['abcdefghijklmnopqrstuvwxyz']); if (ab >= 4) { bits -= ab * 3; warnings.push('Avoid alphabetical sequences.'); }
  if (/(.)\1{2,}/.test(pw)) { bits -= 8; warnings.push('Avoid repeated characters (“aaa”).'); }
  const hasYear = /(19|20)\d{2}/.test(pw);
  if (hasYear) { bits -= 6; warnings.push('Years and dates are easy to guess.'); }
  for (const p of personal.map((x) => x.toLowerCase()).filter((x) => x.length >= 3)) {
    if (plain.includes(p)) { bits -= 15; warnings.push('Do not include your name or email address.'); break; }
  }

  if (pw.length < MIN_LENGTH) tips.push(`Use at least ${MIN_LENGTH} characters (currently ${pw.length}).`);
  if ([lower, upper, digit, symbol].filter(Boolean).length < 3) tips.push('Mix upper- and lower-case letters, numbers and symbols — or use a longer passphrase.');
  if (pw.length < 16) tips.push('Longer is stronger: four or more unrelated words make an excellent passphrase.');

  bits = Math.max(0, bits);
  let score: Strength['score'] = bits < 28 ? 0 : bits < 40 ? 1 : bits < 55 ? 2 : bits < 75 ? 3 : 4;
  if (pw.length < MIN_LENGTH && score > 2) score = 2;
  // attackers try the user's own name/email first: never rate those as acceptable
  if (warnings.some((w) => w.startsWith('Do not include your name'))) score = Math.min(score, 1) as Strength['score'];
  // short passwords built around a dictionary/common word are guessable; long passphrases are fine
  if (commonWords > 0 && pw.length < 16) score = Math.min(score, 2) as Strength['score'];
  // predictable building blocks (several common words, or a common word + a year) need real length to compensate
  if ((commonWords >= 2 && pw.length < 24) || (commonWords >= 1 && hasYear && pw.length < 20)) {
    score = Math.min(score, 2) as Strength['score'];
    tips.unshift('Words like place names, teams and years are the first things attackers try — add unrelated words or random characters.');
  }
  if (warnings.some((w) => w.startsWith('This is a very common'))) score = 0;
  return { score, label: LABELS[score], bits: Math.round(bits), warnings: [...new Set(warnings)], tips, acceptable: score >= 3 && pw.length >= MIN_LENGTH };
}
