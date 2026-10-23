import {
  type KeyboardEvent,
  type RefObject,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  findActiveWordIndex,
  formatPlaybackTime,
  layoutTranscript,
  type TimestampRow,
  type TranscriptWord,
} from '@/lib/transcript';
import { cn } from '@/lib/utils';

type SpeechTranscriptProps = {
  rows: TimestampRow[];
  sourceText: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  className?: string;
};

function paintWords(
  nodes: Array<HTMLElement | null>,
  previousIndex: number,
  nextIndex: number,
) {
  const start =
    previousIndex < -1 ? 0 : Math.max(0, Math.min(previousIndex, nextIndex));
  const end =
    previousIndex < -1 ? nodes.length - 1 : Math.max(previousIndex, nextIndex);
  const tabStop = nextIndex >= 0 ? nextIndex : 0;

  for (let index = start; index <= end && index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;

    const state =
      nextIndex >= 0 && index < nextIndex
        ? 'spoken'
        : index === nextIndex
          ? 'active'
          : 'upcoming';
    node.dataset.state = state;
    node.tabIndex = index === tabStop ? 0 : -1;

    if (index === nextIndex) node.setAttribute('aria-current', 'true');
    else node.removeAttribute('aria-current');
  }
}

export function SpeechTranscript({
  rows,
  sourceText,
  audioRef,
  className,
}: SpeechTranscriptProps) {
  const headingId = useId();
  const timeRef = useRef<HTMLSpanElement>(null);
  const wordRefs = useRef<Array<HTMLElement | null>>([]);
  const wordsRef = useRef<TranscriptWord[]>([]);
  const previousIndexRef = useRef(-2);
  const paragraphs = useMemo(
    () => layoutTranscript(rows, sourceText),
    [rows, sourceText],
  );
  const words = useMemo(
    () => paragraphs.flatMap((paragraph) => paragraph.words),
    [paragraphs],
  );
  wordsRef.current = words;

  useLayoutEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    wordRefs.current.length = words.length;
    let primed = false;

    const apply = () => {
      const nextIndex = findActiveWordIndex(
        wordsRef.current,
        audio.currentTime,
      );
      const previousIndex = previousIndexRef.current;
      paintWords(wordRefs.current, primed ? previousIndex : -2, nextIndex);

      if (timeRef.current) {
        timeRef.current.textContent = formatPlaybackTime(audio.currentTime);
      }

      if (primed && nextIndex >= 0 && nextIndex !== previousIndex) {
        const reduceMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches;
        wordRefs.current[nextIndex]?.scrollIntoView({
          block: 'nearest',
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      }

      previousIndexRef.current = nextIndex;
      primed = true;
    };

    apply();
    audio.addEventListener('timeupdate', apply);
    audio.addEventListener('seeked', apply);

    return () => {
      audio.removeEventListener('timeupdate', apply);
      audio.removeEventListener('seeked', apply);
    };
  }, [audioRef, words]);

  const seek = (startSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = startSec;
    void audio.play().catch(() => undefined);
  };

  const onWordKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const word = wordsRef.current[index];
      if (word) seek(word.startSec);
      return;
    }

    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    event.preventDefault();
    const nextIndex = index + (event.key === 'ArrowRight' ? 1 : -1);
    const word = wordsRef.current[nextIndex];
    if (!word) return;
    seek(word.startSec);
    wordRefs.current[nextIndex]?.focus();
  };

  const onWordClick = (startSec: number) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    seek(startSec);
  };

  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex min-h-0 flex-1 flex-col', className)}
    >
      <div className="flex items-baseline justify-between gap-3 px-6 pt-5">
        <h2
          id={headingId}
          className="font-medium text-muted-foreground text-sm"
        >
          Transcript
        </h2>
        <span
          ref={timeRef}
          className="font-medium text-muted-foreground text-sm tabular-nums"
        >
          0:00
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-6">
        {words.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Words show up here as they are spoken.
          </p>
        ) : (
          <div className="flex max-w-[65ch] flex-col gap-[1.6em] text-lg leading-[1.6]">
            {paragraphs.map((paragraph) => (
              <p key={paragraph.id} className="break-words">
                {paragraph.words.map((word, wordIndex) => (
                  <span key={word.id}>
                    {wordIndex > 0 ? ' ' : null}
                    <button
                      type="button"
                      ref={(node) => {
                        wordRefs.current[word.index] = node;
                      }}
                      data-index={word.index}
                      className="inline cursor-pointer touch-manipulation scroll-my-4 rounded-sm border-0 bg-transparent px-0.5 py-0 align-baseline font-normal text-muted-foreground leading-[inherit] outline-none transition-[color,background-color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground data-[state=spoken]:text-foreground motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:hover:bg-foreground/10"
                      onClick={() => onWordClick(word.startSec)}
                      onKeyDown={onWordKeyDown}
                    >
                      {word.text}
                    </button>
                  </span>
                ))}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
