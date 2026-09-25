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

  it('reads compact recurring currency amounts naturally', () => {
    expect(
      optimizeMarkdownForSpeech(
        "You don't need to know whether it'll become a $10k/month app before building it.",
      ),
    ).toBe(
      "You don't need to know whether it'll become a 10 thousand dollars per month app before building it.",
    );
    expect(
      optimizeMarkdownForSpeech('Plans range from $1.5K/year to $2m.'),
    ).toBe(
      'Plans range from 1.5 thousand dollars per year to 2 million dollars.',
    );
  });

  it('turns sequencing arrows into spoken transitions', () => {
    expect(
      optimizeMarkdownForSpeech(
        'one audience → one problem → one promise → one core loop.',
      ),
    ).toBe(
      'one audience, then one problem, then one promise, then one core loop.',
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

  it('removes standalone citation artifacts without leaving extra breaks', () => {
    const extracted = `First paragraph.[1]

1 2.

Second paragraph.

4 5.`;

    expect(optimizePlainTextForSpeech(extracted)).toBe(`First paragraph.

Second paragraph.`);
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
