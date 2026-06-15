import { optimizePlainTextForSpeech } from './tts-text';

const SPEECH_BLOCK_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'blockquote',
  'dd',
  'dt',
  'figcaption',
].join(',');

const SKIP_SELECTOR = [
  'script',
  'style',
  'svg',
  'canvas',
  'audio',
  'video',
  'pre',
  'code',
  'nav',
  'aside',
  '[hidden]',
  '[aria-hidden="true"]',
  '[role="doc-pagebreak"]',
  '[role="navigation"]',
  '[role="doc-toc"]',
  '.pagebreak',
  '.page-number',
  '.pagenum',
].join(',');

/** epub:type values that indicate navigational / non-prose content. */
const SKIP_EPUB_TYPES =
  /\b(pagebreak|noteref|footnote|endnote|rearnote|toc|landmarks|lot|loi|loa|lov|index|bibliography|glossary)\b/i;

export type EpubSpeechScope = {
  startSelector?: string;
  endSelector?: string;
};

/**
 * Extract speech text from a live Document (e.g. an iframe's contentDocument).
 * Preferred over the HTML-string variant because it reflects exactly what is
 * rendered — including any CSS-hidden elements that the parser would miss.
 */
export function extractSpeechTextFromDocument(
  doc: Document,
  scope: EpubSpeechScope = {},
): string {
  return extractSpeechTextFromRoot(doc.body ?? doc.documentElement, doc, scope);
}

export function extractSpeechTextFromChapterHtml(
  html: string,
  scope: EpubSpeechScope = {},
): string {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html',
  );
  return extractSpeechTextFromRoot(doc.body, doc, scope);
}

function extractSpeechTextFromRoot(
  body: Element,
  doc: Document,
  scope: EpubSpeechScope,
): string {
  const startNode = scope.startSelector
    ? body.querySelector(scope.startSelector)
    : null;
  const endNode = scope.endSelector
    ? body.querySelector(scope.endSelector)
    : null;
  const lines: string[] = [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  let started = !startNode;
  let lastAddedBlock: Element | null = null;

  while (walker.nextNode()) {
    const element = walker.currentNode as Element;

    if (endNode && (element === endNode || element.contains(endNode))) {
      break;
    }

    if (!started) {
      if (!startNode) {
        started = true;
      } else if (element === startNode || element.contains(startNode)) {
        started = true;
      } else {
        continue;
      }
    }

    // Skip everything inside a table (cells, nested tables, captions). The
    // grid itself is replaced by a short caption announcement, if present.
    if (element.parentElement?.closest('table')) {
      continue;
    }

    if (element.matches('table')) {
      if (!shouldSkipElement(element)) {
        const tableLine = tableSpeechLine(element);
        if (tableLine) {
          lines.push(tableLine);
          lastAddedBlock = element;
        }
      }
      continue;
    }

    if (!element.matches(SPEECH_BLOCK_SELECTOR) || shouldSkipElement(element)) {
      continue;
    }

    if (lastAddedBlock?.contains(element)) {
      continue;
    }

    const text = element.textContent?.replace(/\s+/g, ' ').trim();
    if (!text) {
      continue;
    }

    lines.push(text);
    lastAddedBlock = element;
  }

  return optimizePlainTextForSpeech(lines.join('\n\n'));
}

export function extractSelectedSpeechText(
  doc: Document | null | undefined,
): string {
  const selection = doc?.getSelection();
  const text = selection?.toString().trim() ?? '';
  return optimizePlainTextForSpeech(text);
}

/**
 * Tables read poorly cell-by-cell, so the grid is omitted from narration. If
 * the table has a caption/title we announce it so the listener knows a table
 * was skipped; otherwise the table is dropped entirely.
 */
function tableSpeechLine(table: Element): string {
  const caption = table
    .querySelector('caption')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();
  if (!caption) {
    return '';
  }
  return /^table\b/i.test(caption) ? caption : `Table: ${caption}`;
}

function shouldSkipElement(element: Element): boolean {
  if (element.closest(SKIP_SELECTOR)) {
    return true;
  }

  const epubType = element.getAttribute('epub:type') ?? '';
  if (SKIP_EPUB_TYPES.test(epubType)) {
    return true;
  }

  // Also check ancestors for epub:type navigation markers
  let ancestor = element.parentElement;
  while (ancestor) {
    const ancestorType = ancestor.getAttribute('epub:type') ?? '';
    if (SKIP_EPUB_TYPES.test(ancestorType)) {
      return true;
    }
    ancestor = ancestor.parentElement;
  }

  return false;
}
