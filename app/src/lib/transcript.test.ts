import { describe, expect, it } from 'vitest';
import {
  findActiveWordIndex,
  formatPlaybackTime,
  layoutTranscript,
  type TimestampRow,
} from './transcript';

const spoken = [
  row('Hello', 0, 0.4),
  row(',', 0.4, 0.55),
  row('world', 0.55, 1),
  row('.', 1, 1.3),
  row('This', 1.3, 1.6),
  row('is', 1.6, 1.9),
  row('next', 1.9, 2.3),
  row('.', 2.3, 2.6),
];

function row(word: string, startSec: number, endSec: number): TimestampRow {
  return { word, startSec, endSec };
}

function texts(source = ''): string[][] {
  return layoutTranscript(spoken, source).map((paragraph) =>
    paragraph.words.map((word) => word.text),
  );
}

describe('layoutTranscript', () => {
  it('glues punctuation to the preceding word', () => {
    const [paragraph] = layoutTranscript(spoken.slice(0, 4));

    expect(paragraph.words.map((word) => word.text)).toEqual([
      'Hello,',
      'world.',
    ]);
    expect(paragraph.words[0]).toMatchObject({
      startSec: 0,
      endSec: 0.55,
    });
    expect(paragraph.words[1]).toMatchObject({
      startSec: 0.55,
      endSec: 1.3,
    });
  });

  it('breaks sentences when the spoken text is unavailable', () => {
    expect(texts()).toEqual([
      ['Hello,', 'world.'],
      ['This', 'is', 'next.'],
    ]);
  });

  it('keeps a single spoken paragraph together', () => {
    expect(texts('Hello, world. This is next.')).toEqual([
      ['Hello,', 'world.', 'This', 'is', 'next.'],
    ]);
  });

  it('restores paragraph breaks from the spoken text', () => {
    expect(texts('Hello, world.\n\nThis is next.')).toEqual([
      ['Hello,', 'world.'],
      ['This', 'is', 'next.'],
    ]);
  });

  it('aligns a streamed prefix with the spoken text', () => {
    expect(
      layoutTranscript(
        spoken.slice(0, 4),
        'Hello, world.\n\nThis is next.',
      ).map((paragraph) => paragraph.words.map((word) => word.text)),
    ).toEqual([['Hello,', 'world.']]);
  });

  it('falls back to sentences when the spoken text does not match', () => {
    expect(texts('A completely different script.')).toEqual([
      ['Hello,', 'world.'],
      ['This', 'is', 'next.'],
    ]);
  });

  it('does not treat a colon as a sentence break', () => {
    const rows = [
      row('Notes', 0, 0.3),
      row(':', 0.3, 0.5),
      row('bring', 0.5, 0.8),
      row('water', 0.8, 1.1),
    ];

    expect(
      layoutTranscript(rows).map((paragraph) =>
        paragraph.words.map((word) => word.text),
      ),
    ).toEqual([['Notes:', 'bring', 'water']]);
  });
});

describe('findActiveWordIndex', () => {
  const words = layoutTranscript(spoken).flatMap(
    (paragraph) => paragraph.words,
  );

  it('returns the last word that has already started', () => {
    expect(findActiveWordIndex(words, -0.1)).toBe(-1);
    expect(findActiveWordIndex(words, 0)).toBe(0);
    expect(findActiveWordIndex(words, 0.5)).toBe(0);
    expect(findActiveWordIndex(words, 0.55)).toBe(1);
    expect(findActiveWordIndex(words, 1.2)).toBe(1);
    expect(findActiveWordIndex(words, 9)).toBe(words.length - 1);
  });
});

describe('formatPlaybackTime', () => {
  it('formats minutes and hours with a stable width', () => {
    expect(formatPlaybackTime(0)).toBe('0:00');
    expect(formatPlaybackTime(65.9)).toBe('1:05');
    expect(formatPlaybackTime(3661)).toBe('1:01:01');
    expect(formatPlaybackTime(Number.NaN)).toBe('0:00');
  });
});
