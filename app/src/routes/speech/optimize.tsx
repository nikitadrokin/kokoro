import { createFileRoute } from '@tanstack/react-router';
import { Check, Clipboard, RotateCcw, WandSparkles } from 'lucide-react';
import type { ChangeEvent, ClipboardEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getSpeechTextStats, optimizeMarkdownForSpeech } from '@/lib/tts-text';

export const Route = createFileRoute('/speech/optimize')({
  component: SpeechTextOptimizerPage,
});

const SAMPLE_MARKDOWN = `# Launch notes
Kokoro can read pasted markdown

- Convert $40 into spoken currency
- Add pauses when lines end without punctuation
- Keep links like [docs](https://example.com) readable`;

function SpeechTextOptimizerPage() {
  const [sourceText, setSourceText] = useState(SAMPLE_MARKDOWN);
  const [optimizedText, setOptimizedText] = useState(() =>
    optimizeMarkdownForSpeech(SAMPLE_MARKDOWN),
  );
  const [copied, setCopied] = useState(false);

  const stats = useMemo(
    () => getSpeechTextStats(sourceText, optimizedText),
    [sourceText, optimizedText],
  );

  const optimizeText = useCallback(
    (nextText = sourceText) => {
      setOptimizedText(optimizeMarkdownForSpeech(nextText));
      setCopied(false);
    },
    [sourceText],
  );

  const handleSourceChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = event.target.value;
    setSourceText(nextText);
    optimizeText(nextText);
  };

  const handleSourcePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = event.clipboardData.getData('text');
    if (!pastedText) {
      return;
    }

    const field = event.currentTarget;
    const nextText = `${sourceText.slice(0, field.selectionStart)}${pastedText}${sourceText.slice(field.selectionEnd)}`;

    event.preventDefault();
    setSourceText(nextText);
    optimizeText(nextText);
  };

  const handleCopy = async () => {
    if (!optimizedText) {
      return;
    }

    await navigator.clipboard.writeText(optimizedText);
    setCopied(true);
  };

  const handleReset = () => {
    setSourceText('');
    setOptimizedText('');
    setCopied(false);
  };

  return (
    <main className='flex h-[calc(100vh-3.5rem)] flex-col p-4 @3xl/content:p-6'>
      <div className='mx-auto flex h-full w-full max-w-6xl flex-col gap-4'>
        <div className='flex flex-col gap-3 pb-2 @xl/content:flex-row @xl/content:items-end @xl/content:justify-between'>
          <div className='space-y-1'>
            <h1 className='font-semibold text-2xl tracking-tight'>
              Speech text optimizer
            </h1>
            <div className='flex flex-wrap gap-2'>
              <Badge variant='outline'>{stats.inputWords} input words</Badge>
              <Badge variant='outline'>{stats.outputWords} output words</Badge>
            </div>
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              variant='secondary'
              onClick={handleReset}
              aria-label='Clear markdown and optimized text'
            >
              <RotateCcw className='size-4' />
              Clear
            </Button>
            <Button
              type='button'
              onClick={() => optimizeText()}
              aria-label='Optimize markdown for speech'
            >
              <WandSparkles className='size-4' />
              Optimize script
            </Button>
          </div>
        </div>

        <div className='grid min-w-0 flex-1 grid-cols-1 gap-4 @5xl/content:grid-cols-2'>
          <div className='flex flex-col rounded-2xl border bg-card shadow-sm'>
            <div className='border-b p-4'>
              <h2 className='font-semibold text-sm'>Markdown</h2>
            </div>
            <div className='flex flex-1 flex-col p-4'>
              <Label htmlFor='speech-markdown' className='sr-only'>Source text</Label>
              <Textarea
                id='speech-markdown'
                aria-label='Markdown source text'
                className='flex-1 resize-none border-0 bg-transparent p-4 font-mono text-sm leading-6 shadow-none focus-visible:ring-0 focus-visible:bg-muted/30 transition-colors rounded-lg'
                value={sourceText}
                onChange={handleSourceChange}
                onPaste={handleSourcePaste}
                placeholder='Paste markdown here.'
              />
              <p className='mt-2 text-muted-foreground text-xs'>
                {stats.inputCharacters} characters
              </p>
            </div>
          </div>

          <div className='flex flex-col rounded-2xl border bg-card shadow-sm'>
            <div className='flex items-center justify-between border-b p-4'>
              <h2 className='font-semibold text-sm'>Speech-ready script</h2>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-8'
                onClick={handleCopy}
                disabled={!optimizedText}
                aria-label='Copy optimized text'
              >
                {copied ? (
                  <Check className='size-4 text-green-500' />
                ) : (
                  <Clipboard className='size-4' />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className='flex flex-1 flex-col p-4'>
              <Label htmlFor='speech-output' className='sr-only'>Optimized text</Label>
              <Textarea
                id='speech-output'
                aria-label='Optimized text for speech synthesis'
                className='flex-1 resize-none border-0 bg-transparent p-4 text-sm leading-6 shadow-none focus-visible:ring-0 focus-visible:bg-muted/30 transition-colors rounded-lg'
                value={optimizedText}
                onChange={(event) => {
                  setOptimizedText(event.target.value);
                  setCopied(false);
                }}
                placeholder='Optimized text appears here.'
              />
              <p className='mt-2 text-muted-foreground text-xs'>
                {stats.outputCharacters} characters
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
