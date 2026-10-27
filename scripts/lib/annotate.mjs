// Turns untouched source paragraphs plus an annotation list into chapter
// paragraphs in the content format. The source text is never rewritten:
// each annotation names a Chinese anchor and which occurrence of it (nth,
// counted across the whole chapter) becomes a target word.

export function splitParagraphs(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function applyAnnotations(paragraphTexts, occurrences = []) {
  const errors = [];
  const hits = [];

  for (const occ of occurrences) {
    const nth = occ.nth ?? 1;
    const label = `anchor "${occ.anchor}" #${nth}`;
    if (!occ.anchor) { errors.push(`"${occ.w}": missing anchor`); continue; }
    let seen = 0;
    let found = null;
    paragraphTexts.some((text, p) => {
      for (let i = text.indexOf(occ.anchor); i !== -1; i = text.indexOf(occ.anchor, i + 1)) {
        if (++seen === nth) { found = { p, start: i, end: i + occ.anchor.length }; return true; }
      }
      return false;
    });
    if (!found) { errors.push(`${label} not found`); continue; }
    hits.push({ ...found, occ, label });
  }

  hits.sort((a, b) => a.p - b.p || a.start - b.start);
  const kept = [];
  for (const hit of hits) {
    const prev = kept.at(-1);
    if (prev && prev.p === hit.p && hit.start < prev.end) {
      errors.push(`${hit.label} overlaps ${prev.label}`);
      continue;
    }
    kept.push(hit);
  }

  const paragraphs = paragraphTexts.map((text, p) => {
    const segments = [];
    let pos = 0;
    for (const { start, end, occ } of kept.filter((h) => h.p === p)) {
      if (start > pos) segments.push(text.slice(pos, start));
      const seg = { w: occ.w, form: occ.form, gloss: occ.gloss };
      if (occ.accept) seg.accept = occ.accept;
      if (occ.glossNote) seg.glossNote = occ.glossNote;
      segments.push(seg);
      pos = end;
    }
    if (pos < text.length) segments.push(text.slice(pos));
    return { segments };
  });

  return { paragraphs, errors, spans: kept.map(({ p, start, end }) => ({ p, start, end })) };
}

// Sentence ends: Chinese or Western terminal punctuation, with any closing
// quotes or brackets after it. A paragraph break also ends a sentence.
const SENTENCE_END = /[。！？!?…]+[”’」』）)"']*/;
const HAS_TEXT = /[\p{L}\p{N}]/u;
const TEXT_CHAR = /[\p{L}\p{N}]/gu;

// Each sentence with its paragraph, character range and how many letters
// or digits it has (punctuation and quotes don't count).
export function splitSentences(paragraphTexts) {
  const out = [];
  paragraphTexts.forEach((text, p) => {
    const ends = new RegExp(SENTENCE_END.source, 'g');
    let start = 0;
    const push = (end) => {
      const t = text.slice(start, end);
      if (HAS_TEXT.test(t)) out.push({ p, start, end, text: t, chars: t.match(TEXT_CHAR).length });
      start = end;
    };
    for (let m = ends.exec(text); m; m = ends.exec(text)) push(m.index + m[0].length);
    push(text.length);
  });
  return out;
}

export function countSentences(paragraphTexts) {
  return splitSentences(paragraphTexts).length;
}
