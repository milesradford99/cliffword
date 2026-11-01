// Answer checking for the recall modes. Pure functions, no DOM.

import { meaningTerms } from '../scripts/lib/wordlist.mjs';

const ZH_NOISE = /[\s\p{P}\p{S}]/gu;

export function normalizeZh(text) {
  return String(text ?? '').replace(ZH_NOISE, '');
}

// EN→ZH: any accepted meaning (default: the contextual gloss) counts.
export function checkMeaning(answer, seg) {
  const given = normalizeZh(answer);
  if (!given) return false;
  return (seg.accept ?? [seg.gloss]).some((a) => normalizeZh(a) === given);
}

// EN→ZH with the word's dictionary lines: any real meaning is correct.
// other: right, but not the meaning in this sentence, so feedback can say so.
export function gradeMeaning(answer, seg, lines = []) {
  if (checkMeaning(answer, seg)) return { correct: true, other: false };
  const given = normalizeZh(answer);
  const other = Boolean(given) && meaningTerms(lines).includes(given);
  return { correct: other, other };
}

// Which dictionary line holds this sentence's gloss, to mark it in the list.
export function lineHasGloss(line, gloss) {
  const g = normalizeZh(gloss);
  return Boolean(g) && meaningTerms([line]).some((t) => t === g || (t.length >= 2 && g.includes(t)) || (g.length >= 2 && t.includes(g)));
}

// ZH→EN: the form as it appears in the sentence, ignoring case.
export function checkSpelling(answer, seg) {
  return String(answer ?? '').trim().toLowerCase() === seg.form.toLowerCase();
}

// "suspected" → "s________": first letter, then one blank per letter.
export function hintFor(form) {
  return [...form].map((ch, i) => (i === 0 || !/\p{L}/u.test(ch) ? ch : '_')).join('');
}

// Transfer: blank the target word in the vocab entry's own English example.
export function transferPrompt(word, forms = []) {
  const candidates = [...new Set([...forms, word.lemma])].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const form of candidates) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`\\b${escaped}\\b`, 'i').exec(word.example ?? '');
    if (m) {
      return {
        before: word.example.slice(0, m.index),
        answer: m[0],
        after: word.example.slice(m.index + m[0].length),
      };
    }
  }
  return null;
}
