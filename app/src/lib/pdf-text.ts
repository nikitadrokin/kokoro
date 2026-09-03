import { optimizePlainTextForSpeech } from './tts-text';

export type PdfTextItemLike = {
  str: string;
  transform: ArrayLike<number>;
  width: number;
  height: number;
  hasEOL?: boolean;
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
};

const PAGE_NUMBER_PATTERN = /^(?:page\s+)?\d+(?:\s+(?:of|\/)\s*\d+)?$/i;
const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}]/u;
const CITATION_NUMBER_PATTERN = /^\d{1,3}$/;
const NO_SPACE_BEFORE_PATTERN = /^[,.;:!?%)\]}]/;
const NO_SPACE_AFTER_CHARACTERS = '([{/$';

function normalizeItem(item: PdfTextItemLike): PositionedText | null {
  const text = item.str.replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ');
  if (!text.trim()) {
    return null;
  }

  return {
    text,
    x: Number(item.transform[4] ?? 0),
    y: Number(item.transform[5] ?? 0),
    width: Math.abs(item.width),
    height: Math.max(Math.abs(item.height), 1),
    hasEOL: item.hasEOL ?? false,
  };
}

function isLikelySuperscriptCitation(
  candidate: PositionedText,
  items: PositionedText[],
): boolean {
  if (!CITATION_NUMBER_PATTERN.test(candidate.text.trim())) {
    return false;
  }

  return items.some(
    (item) =>
      item !== candidate &&
      item.height >= candidate.height * 1.2 &&
      Math.abs(item.y - candidate.y) <= item.height * 0.6,
  );
}

function visualReadingOrder(a: PositionedText, b: PositionedText): number {
  const verticalDistance = b.y - a.y;
  const sameLineTolerance = Math.min(a.height, b.height) * 0.45;
  if (Math.abs(verticalDistance) <= sameLineTolerance) {
    return a.x - b.x;
  }
  return verticalDistance;
}

function shouldInsertSpace(
  current: string,
  next: PositionedText,
  previousEndX: number,
  lineHeight: number,
): boolean {
  if (
    /\s$/.test(current) ||
    /^\s/.test(next.text) ||
    NO_SPACE_BEFORE_PATTERN.test(next.text) ||
    NO_SPACE_AFTER_CHARACTERS.includes(current.at(-1) ?? '')
  ) {
    return false;
  }

  const horizontalGap = next.x - previousEndX;
  return horizontalGap > Math.max(0.75, lineHeight * 0.08);
}

/**
 * Reconstructs the visual text lines returned by PDF.js without deciding which
 * line breaks are sentence boundaries. That decision stays in the shared TTS
 * normalization path, where soft wraps and split hyphenated words are repaired.
 */
export function extractPdfPageText(items: PdfTextItemLike[]): string {
  const normalized = items
    .map(normalizeItem)
    .filter((item): item is PositionedText => item !== null);
  const positioned = normalized
    .filter((item) => !isLikelySuperscriptCitation(item, normalized))
    .sort(visualReadingOrder);
  const lines: string[] = [];
  let current = '';
  let baseline = 0;
  let lineHeight = 1;
  let previousEndX = 0;
  let previousBaseline: number | null = null;
  let previousLineHeight = 1;

  const flush = () => {
    const line = current.trim();
    if (line) {
      lines.push(line);
      previousBaseline = baseline;
      previousLineHeight = lineHeight;
    }
    current = '';
  };

  for (const item of positioned) {
    let addedParagraphBreak = false;
    const startsNewLine =
      current.length > 0 &&
      Math.abs(item.y - baseline) >
        Math.max(2, Math.max(lineHeight, item.height) * 0.45);

    if (startsNewLine) {
      flush();
      if (
        previousBaseline !== null &&
        Math.abs(item.y - previousBaseline) >
          Math.min(previousLineHeight, item.height) * 1.65
      ) {
        lines.push('');
        addedParagraphBreak = true;
      }
    }

    if (!current) {
      if (
        !addedParagraphBreak &&
        previousBaseline !== null &&
        lines.at(-1) !== '' &&
        Math.abs(item.y - previousBaseline) >
          Math.min(previousLineHeight, item.height) * 1.65
      ) {
        lines.push('');
      }
      current = item.text;
      baseline = item.y;
      lineHeight = item.height;
    } else {
      if (shouldInsertSpace(current, item, previousEndX, lineHeight)) {
        current += ' ';
      }
      current += item.text;
      lineHeight = Math.max(lineHeight, item.height);
    }

    previousEndX = item.x + item.width;

    if (item.hasEOL) {
      flush();
    }
  }

  flush();
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizedMarginLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function pageLines(page: string): string[] {
  const lines = page.split('\n').map((line) => line.trim());
  while (lines[0] === '') lines.shift();
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

function repeatedMarginLines(pages: string[][]): Set<string> {
  if (pages.length < 3) {
    return new Set();
  }

  const counts = new Map<string, number>();
  for (const lines of pages) {
    const margins = new Set(
      [lines[0], lines.at(-1)]
        .filter((line): line is string => Boolean(line))
        .map(normalizedMarginLine),
    );
    for (const margin of margins) {
      counts.set(margin, (counts.get(margin) ?? 0) + 1);
    }
  }

  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([line]) => line),
  );
}

/** Builds speech-ready text for one page or a complete text-layer PDF. */
export function buildPdfSpeechText(pageTexts: string[]): string {
  const pages = pageTexts.map(pageLines);
  const repeatedMargins = repeatedMarginLines(pages);
  const cleanedPages = pages.map((lines) =>
    lines.filter((line, index) => {
      if (!line) return true;
      const isMargin = index === 0 || index === lines.length - 1;
      if (!isMargin) return true;
      return (
        !PAGE_NUMBER_PATTERN.test(line) &&
        !repeatedMargins.has(normalizedMarginLine(line))
      );
    }),
  );

  // A single newline between pages lets reflowWrappedText repair sentences
  // which continue across a page boundary.
  return optimizePlainTextForSpeech(
    cleanedPages.map((lines) => lines.join('\n')).join('\n'),
  );
}

export function hasExtractablePdfText(pageTexts: string[]): boolean {
  return WORD_CHARACTER_PATTERN.test(buildPdfSpeechText(pageTexts));
}
