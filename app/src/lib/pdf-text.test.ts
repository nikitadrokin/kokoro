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
  height = 12,
): PdfTextItemLike {
  return {
    str,
    transform: [1, 0, 0, 1, x, y],
    width,
    height,
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

  it('uses visual order and removes superscript citation items', () => {
    const text = extractPdfPageText([
      item('The first sentence continues', 40, 680, 180, true, 10.5),
      item('onto its next visual line.', 40, 664, 150, false, 10.5),
      item('\u0000', 192, 668, 3, false, 7.9),
      item('1', 195, 668, 5, false, 7.9),
      item('\u0000', 200, 668, 3, false, 7.9),
      item('A visually earlier heading', 40, 720, 250, false, 20),
    ]);

    expect(text).toBe(
      'A visually earlier heading\n\nThe first sentence continues\nonto its next visual line.',
    );
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

  it('drops orphaned citation lines before speech optimization', () => {
    const speech = buildPdfSpeechText([
      `A claim wraps before the sentence
ends on the next line.

1 2.

Another paragraph has a citation.[3]

4.

The final paragraph.`,
    ]);

    expect(speech).toBe(
      `A claim wraps before the sentence ends on the next line.

Another paragraph has a citation.

The final paragraph.`,
    );
  });
});
