import { describe, expect, it } from 'vitest';
import {
  buildPdfSpeechText,
  extractPdfPageText,
  hasExtractablePdfText,
  type PdfTextItemLike,
} from './pdf-text';

function item(
  str: string,
  x: number,
  y: number,
  width: number,
  hasEOL = false,
): PdfTextItemLike {
  return {
    str,
    transform: [1, 0, 0, 1, x, y],
    width,
    height: 12,
    hasEOL,
  };
}

describe('extractPdfPageText', () => {
  it('reconstructs lines and spacing from positioned text items', () => {
    const text = extractPdfPageText([
      item('A computer', 40, 700, 62),
      item('has memory.', 106, 700, 70, true),
      item('The kernel', 40, 684, 58),
      item('shares it.', 102, 684, 52),
    ]);

    expect(text).toBe('A computer has memory.\nThe kernel shares it.');
  });

  it('preserves a blank line for a large vertical paragraph gap', () => {
    const text = extractPdfPageText([
      item('First paragraph.', 40, 700, 90, true),
      item('Second paragraph.', 40, 660, 100),
    ]);

    expect(text).toBe('First paragraph.\n\nSecond paragraph.');
  });
});

describe('buildPdfSpeechText', () => {
  it('uses shared reflow rules for wraps and page-spanning hyphenation', () => {
    expect(
      buildPdfSpeechText([
        'Multitasking means that\nmultiple processes can reside in mem-',
        'ory and each may use the CPU.\n2',
      ]),
    ).toBe(
      'Multitasking means that multiple processes can reside in memory and each may use the CPU.',
    );
  });

  it('removes repeated running headers and footers', () => {
    const speech = buildPdfSpeechText([
      'Operating Systems\nFirst page text.\n1',
      'Operating Systems\nSecond page text.\n2',
      'Operating Systems\nThird page text.\n3',
    ]);

    expect(speech).toBe('First page text. Second page text. Third page text.');
  });

  it('distinguishes image-only pages from text-layer pages', () => {
    expect(hasExtractablePdfText(['', '  '])).toBe(false);
    expect(hasExtractablePdfText(['A short text layer.'])).toBe(true);
  });
});
