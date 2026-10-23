export type TimestampRow = {
  word: string;
  startSec: number;
  endSec: number;
};

export type TranscriptWord = {
  id: string;
  index: number;
  text: string;
  startSec: number;
  endSec: number;
};

export type TranscriptParagraph = {
  id: string;
  words: TranscriptWord[];
};

const PUNCTUATION = new Set(['.', ',', '!', '?', ':', ';']);

function isPunctuation(word: string): boolean {
  return word.length === 1 && PUNCTUATION.has(word);
}

function endsSentence(text: string): boolean {
  return /[.!?]["')\]]*$/.test(text);
}

function splitSpeechTokens(text: string): string[] {
  const tokens: string[] = [];

  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;

    const chars = [...raw];
    let start = 0;
    let end = chars.length;

    while (start < end && PUNCTUATION.has(chars[start])) {
      tokens.push(chars[start]);
      start += 1;
    }

    while (end > start && PUNCTUATION.has(chars[end - 1])) {
      end -= 1;
    }

    if (start < end) {
      tokens.push(chars.slice(start, end).join(''));
    }

    for (let index = end; index < chars.length; index += 1) {
      tokens.push(chars[index]);
    }
  }

  return tokens;
}

type PlannedWord = {
  word: string;
  paragraphIndex: number;
};

function planWords(sourceText: string): PlannedWord[] {
  const lines = sourceText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const planned: PlannedWord[] = [];

  for (const [paragraphIndex, line] of lines.entries()) {
    for (const word of splitSpeechTokens(line)) {
      planned.push({ word, paragraphIndex });
    }
  }

  return planned;
}

/**
 * Timings use the same whitespace-and-punctuation split as the spoken text.
 * A streamed result is a prefix of that split. If it isn't, fall back to
 * sentence breaks so a mismatched script can't invent paragraph boundaries.
 */
export function layoutTranscript(
  rows: TimestampRow[],
  sourceText = '',
): TranscriptParagraph[] {
  const plan = sourceText ? planWords(sourceText) : null;
  const usePlan =
    plan !== null &&
    plan.length >= rows.length &&
    rows.every((row, index) => plan[index].word === row.word);

  const paragraphs: TranscriptParagraph[] = [];
  let words: TranscriptWord[] = [];
  let pending = '';
  let lastRowIndex = -1;
  let flatIndex = 0;

  const commit = () => {
    if (words.length === 0) return;
    paragraphs.push({ id: words[0].id, words });
    words = [];
  };

  for (const [rowIndex, row] of rows.entries()) {
    if (isPunctuation(row.word)) {
      const last = words[words.length - 1];
      if (last) {
        last.text += row.word;
        last.endSec = row.endSec;
      } else {
        pending += row.word;
      }
      continue;
    }

    if (words.length > 0) {
      const last = words[words.length - 1];
      const nextParagraph =
        usePlan && plan
          ? plan[rowIndex].paragraphIndex !== plan[lastRowIndex].paragraphIndex
          : endsSentence(last.text);
      if (nextParagraph) commit();
    }

    words.push({
      id: String(rowIndex),
      index: flatIndex,
      text: pending + row.word,
      startSec: row.startSec,
      endSec: row.endSec,
    });
    pending = '';
    lastRowIndex = rowIndex;
    flatIndex += 1;
  }

  if (pending) {
    const last = words[words.length - 1];
    if (last) {
      last.text += pending;
    } else if (rows.length > 0) {
      words.push({
        id: '0',
        index: 0,
        text: pending,
        startSec: rows[0].startSec,
        endSec: rows[rows.length - 1].endSec,
      });
    }
  }

  commit();
  return paragraphs;
}

export function findActiveWordIndex(
  words: TranscriptWord[],
  timeSec: number,
): number {
  if (words.length === 0 || !(timeSec >= words[0].startSec)) return -1;

  let low = 0;
  let high = words.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (words[mid].startSec <= timeSec) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const secondText = String(secs).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secondText}`;
  }

  return `${minutes}:${secondText}`;
}
