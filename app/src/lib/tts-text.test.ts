import { describe, expect, it } from 'vitest';
import {
  optimizeMarkdownForSpeech,
  optimizePlainTextForSpeech,
  reflowWrappedText,
} from './tts-text';

describe('optimizeMarkdownForSpeech', () => {
  it('adds audible punctuation to markdown headings, lines, and lists', () => {
    const result = optimizeMarkdownForSpeech(`# Launch notes
One sentence without punctuation
- first item
- second item`);

    expect(result).toBe(`Launch notes:
One sentence without punctuation.
first item;
second item;`);
  });

  it('normalizes common markdown syntax without using the link URL', () => {
    const result = optimizeMarkdownForSpeech(
      'Read **the [guide](https://example.com/docs)** before `launch`',
    );

    expect(result).toBe('Read the guide before launch.');
  });

  it('converts dollars, cents, percentages, and ampersands to spoken words', () => {
    const result = optimizeMarkdownForSpeech(
      'Revenue was $40.50 & margin was 12%',
    );

    expect(result).toBe(
      'Revenue was 40 dollars and 50 cents and margin was 12 percent.',
    );
  });

  it('removes markdown table dividers and makes table cells pauseable', () => {
    const result = optimizeMarkdownForSpeech(`| Name | Price |
| --- | --- |
| Basic | $9 |`);

    expect(result).toBe(`Name, Price.
Basic, 9 dollars.`);
  });
});

describe('optimizePlainTextForSpeech', () => {
  it('expands common abbreviations to spoken form', () => {
    expect(optimizePlainTextForSpeech('Bring snacks, drinks, etc.')).toBe(
      'Bring snacks, drinks, et cetera.',
    );
    expect(
      optimizePlainTextForSpeech('Use a fruit, e.g. an apple, i.e. produce.'),
    ).toBe('Use a fruit, for example an apple, that is produce.');
    expect(optimizePlainTextForSpeech('See Dr. Smith vs. the others.')).toBe(
      'See Doctor Smith versus the others.',
    );
    expect(optimizePlainTextForSpeech('Read No. 5 on p. 12.')).toBe(
      'Read number 5 on page 12.',
    );
  });

  it('reads numeric ranges with "to"', () => {
    expect(optimizePlainTextForSpeech('The years 1990–1995 were busy')).toBe(
      'The years 1990 to 1995 were busy.',
    );
  });

  it('joins PDF soft-wrapped lines into a single spoken sentence', () => {
    const pasted = `Multitasking means that
multiple processes can simultaneously reside in memory and each
may receive use of the CPU.`;

    expect(optimizePlainTextForSpeech(pasted)).toBe(
      'Multitasking means that multiple processes can simultaneously reside in memory and each may receive use of the CPU.',
    );
  });
});

describe('reflowWrappedText', () => {
  it('rejoins wrapped lines while preserving paragraph breaks', () => {
    const input = `The kernel performs the following tasks. A computer has
one or more central processing units which execute the
instructions of programs.

Memory management shares physical memory among
processes in an equitable fashion.`;

    expect(reflowWrappedText(input)).toBe(
      `The kernel performs the following tasks. A computer has one or more central processing units which execute the instructions of programs.

Memory management shares physical memory among processes in an equitable fashion.`,
    );
  });

  it('stitches hyphenated word breaks back together', () => {
    const input = `the rules are deter-
mined by the kernel and by the processes them-
selves.`;

    expect(reflowWrappedText(input)).toBe(
      'the rules are determined by the kernel and by the processes themselves.',
    );
  });

  it('keeps list items and headings on their own lines', () => {
    const input = `# Tasks performed by the kernel
Among other things the kernel performs
the following tasks:
- Process scheduling picks which
  process runs next
- Memory management`;

    expect(reflowWrappedText(input)).toBe(
      `# Tasks performed by the kernel
Among other things the kernel performs the following tasks:
- Process scheduling picks which process runs next
- Memory management`,
    );
  });
});
