import { createFileRoute } from '@tanstack/react-router';
import { Check, Clipboard, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const Route = createFileRoute('/troubleshoot')({
  component: TroubleshootPage,
});

const APP_PATH = '/Applications/Kokoro.app';

const FIX_SCRIPT = `APP="${APP_PATH}"

# Drop the quarantine flag Gatekeeper adds to downloaded apps.
xattr -cr "$APP"

# Re-sign every binary inside the app (including the "koko" CLI sidecar),
# then re-sign the app bundle itself so macOS trusts it again.
for bin in "$APP/Contents/MacOS/"*; do
  codesign --force --sign - --timestamp=none "$bin"
done
codesign --force --sign - --timestamp=none "$APP"

# Confirm it took effect.
codesign --verify --deep --strict "$APP" && echo "Kokoro is verified. You can reopen it now."`;

function TroubleshootPage() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(FIX_SCRIPT);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className='min-h-[calc(100vh-4.5rem)] p-4 md:p-6'>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-4'>
        <div className='space-y-1 pb-2'>
          <h1 className='flex items-center gap-2 font-semibold text-2xl tracking-tight'>
            <ShieldAlert className='size-6 text-muted-foreground' aria-hidden='true' />
            Fix "not verified" / codesign errors
          </h1>
          <p className='max-w-2xl text-muted-foreground text-sm'>
            On some macOS versions, Gatekeeper can flag Kokoro or its bundled{' '}
            <code className='rounded bg-muted px-1 py-0.5 font-mono text-xs'>
              koko
            </code>{' '}
            command-line tool as "not verified" or "cannot be opened because
            the developer cannot be verified," even though the app is
            unmodified. Kokoro isn't notarized by Apple, so macOS sometimes
            needs a nudge to trust the copy already on your Mac.
          </p>
        </div>

        <Card className='shadow-sm backdrop-blur'>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2 text-sm'>
            <ol className='list-decimal space-y-1 pl-5 text-muted-foreground'>
              <li>Quit Kokoro completely.</li>
              <li>Open the macOS Terminal app.</li>
              <li>Copy the script below and paste it into Terminal, then press Return.</li>
              <li>Reopen Kokoro from {APP_PATH.replace('.app', '')}.</li>
            </ol>
            <p className='text-muted-foreground text-xs'>
              This only re-signs the local copy of the app with an ad-hoc
              signature so your Mac trusts it — it doesn't need sudo and
              doesn't download or change anything else.
            </p>
          </CardContent>
        </Card>

        <Card className='shadow-sm backdrop-blur'>
          <CardHeader className='flex flex-row items-center justify-between gap-3'>
            <CardTitle>Terminal script</CardTitle>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => void handleCopy()}
              aria-label='Copy fix script'
            >
              {copied ? (
                <Check className='size-4' />
              ) : (
                <Clipboard className='size-4' />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </CardHeader>
          <CardContent>
            <pre className='overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-6'>
              <code>{FIX_SCRIPT}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
