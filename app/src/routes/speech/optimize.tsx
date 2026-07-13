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
    <main className='min-h-[calc(100vh-4.5rem)] @3xl/content:p-6 p-4'>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
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

        <div className='grid min-w-0 grid-cols-1 gap-4 @7xl/content:grid-cols-2'>
          <Card className='min-w-0 shadow-sm backdrop-blur'>
            <CardHeader>
              <CardTitle>Markdown</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='space-y-2'>
                <Label htmlFor='speech-markdown'>Source text</Label>
                <Textarea
                  id='speech-markdown'
                  aria-label='Markdown source text'
                  className='min-h-[min(56dvh,34rem)] resize-y font-mono text-sm leading-6'
                  value={sourceText}
                  onChange={handleSourceChange}
                  onPaste={handleSourcePaste}
                  placeholder='Paste markdown here.'
                />
              </div>
              <p className='text-muted-foreground text-xs'>
                {stats.inputCharacters} characters
              </p>
            </CardContent>
          </Card>

          <Card className='min-w-0 shadow-sm backdrop-blur'>
            <CardHeader className='flex flex-row items-center justify-between gap-3'>
              <CardTitle>Speech-ready script</CardTitle>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={handleCopy}
                disabled={!optimizedText}
                aria-label='Copy optimized text'
              >
                {copied ? (
                  <Check className='size-4' />
                ) : (
                  <Clipboard className='size-4' />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='space-y-2'>
                <Label htmlFor='speech-output'>Optimized text</Label>
                <Textarea
                  id='speech-output'
                  aria-label='Optimized text for speech synthesis'
                  className='min-h-[min(56dvh,34rem)] resize-y text-sm leading-6'
                  value={optimizedText}
                  onChange={(event) => {
                    setOptimizedText(event.target.value);
                    setCopied(false);
                  }}
                  placeholder='Optimized text appears here.'
                />
              </div>
              <p className='text-muted-foreground text-xs'>
                {stats.outputCharacters} characters
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
