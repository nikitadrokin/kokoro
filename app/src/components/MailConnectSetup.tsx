import { Check, Copy, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  GMAIL_OAUTH_LOOPBACK_PORT,
  GMAIL_OAUTH_REDIRECT_URI,
} from '@/lib/gmail';

const SETUP_STEPS = [
  {
    title: 'Create (or open) the OAuth client you will paste below',
    body: 'Use APIs & Services → Credentials. Prefer a new Desktop app client for Kokoro — do not reuse Zero’s Web client unless you add Kokoro’s redirect URI to that same client.',
  },
  {
    title: 'Enable the Gmail API',
    body: 'APIs & Services → Library → enable Gmail API for this project.',
  },
  {
    title: 'Register this exact redirect URI',
    body: `On that client’s edit page, under Authorized redirect URIs, add exactly: ${GMAIL_OAUTH_REDIRECT_URI}. Save. A mismatch here causes Error 400: redirect_uri_mismatch.`,
  },
  {
    title: 'Paste that client’s ID/secret here and sign in',
    body: 'Client ID must belong to the client where you just saved the redirect URI. Web clients also need the client secret. Credentials stay in localStorage on this device.',
  },
] as const;

type MailConnectSetupProps = {
  /** Client ID from the local credentials store. */
  clientId: string;
  /** Client secret from the local credentials store. */
  clientSecret: string;
  /** Error message to show above the setup card, if any. */
  error: string;
  /** Whether a sign-in request is in flight. */
  isLoggingIn: boolean;
  /** Persists the client ID as the user types. */
  onClientIdChange: (value: string) => void;
  /** Persists the client secret as the user types. */
  onClientSecretChange: (value: string) => void;
  /** Starts the Google OAuth sign-in flow. */
  onLogin: () => void;
  /** Reports clipboard or other setup failures to the parent. */
  onError: (message: string) => void;
};

/**
 * OAuth setup screen shown when Gmail is not yet connected.
 */
export function MailConnectSetup({
  clientId,
  clientSecret,
  error,
  isLoggingIn,
  onClientIdChange,
  onClientSecretChange,
  onLogin,
  onError,
}: MailConnectSetupProps) {
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const handleCopyRedirectUri = async () => {
    try {
      await navigator.clipboard.writeText(GMAIL_OAUTH_REDIRECT_URI);
      setCopiedRedirect(true);
      window.setTimeout(() => setCopiedRedirect(false), 2000);
    } catch (caughtError) {
      onError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
    }
  };

  return (
    <main className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6'>
      <div className='flex flex-col gap-2'>
        <div className='flex items-center gap-2'>
          <Mail className='size-5 text-primary' aria-hidden='true' />
          <h1 className='font-semibold text-2xl tracking-tight'>Mail listen</h1>
          <Badge variant='secondary' className='rounded-full'>
            PoC
          </Badge>
        </div>
        <p className='max-w-2xl text-muted-foreground text-sm leading-6'>
          Connect Gmail once. Credentials stay in localStorage on this device;
          speech is generated on-device.
        </p>
      </div>

      {error ? (
        <div
          role='alert'
          className='rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm'
        >
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <ShieldCheck className='size-4 text-muted-foreground' />
            Google OAuth setup
          </CardTitle>
        </CardHeader>
        <CardContent className='grid gap-5'>
          <ol className='grid gap-3'>
            {SETUP_STEPS.map((step, index) => (
              <li
                key={step.title}
                className='grid grid-cols-[auto_1fr] gap-3 rounded-2xl border px-3 py-3'
              >
                <span className='grid size-7 place-items-center rounded-full bg-muted font-medium text-xs'>
                  {index + 1}
                </span>
                <div className='grid gap-1'>
                  <p className='font-medium text-sm'>{step.title}</p>
                  <p className='text-muted-foreground text-xs leading-5'>
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className='grid gap-2 rounded-2xl border bg-muted/30 px-3 py-3'>
            <Label htmlFor='gmail-redirect-uri'>
              Authorized redirect URI (port {GMAIL_OAUTH_LOOPBACK_PORT})
            </Label>
            <div className='flex flex-col gap-2 sm:flex-row'>
              <Input
                id='gmail-redirect-uri'
                value={GMAIL_OAUTH_REDIRECT_URI}
                readOnly
                className='font-mono text-xs'
              />
              <Button
                type='button'
                variant='outline'
                className='shrink-0'
                onClick={() => void handleCopyRedirectUri()}
              >
                {copiedRedirect ? (
                  <Check className='size-4' />
                ) : (
                  <Copy className='size-4' />
                )}
                {copiedRedirect ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className='text-muted-foreground text-xs leading-5'>
              Copy this into Authorized redirect URIs for the same Client ID you
              paste below, then click Save in Google Cloud. Use `127.0.0.1`, not
              `localhost`.
            </p>
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='grid gap-2'>
              <Label htmlFor='gmail-client-id'>Client ID</Label>
              <Input
                id='gmail-client-id'
                value={clientId}
                onChange={(event) => onClientIdChange(event.target.value)}
                placeholder='xxxxx.apps.googleusercontent.com'
                autoComplete='off'
                disabled={isLoggingIn}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='gmail-client-secret'>
                Client secret (required for Web clients)
              </Label>
              <Input
                id='gmail-client-secret'
                type='password'
                value={clientSecret}
                onChange={(event) => onClientSecretChange(event.target.value)}
                placeholder='Optional for some Desktop clients'
                autoComplete='off'
                disabled={isLoggingIn}
              />
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              onClick={onLogin}
              disabled={isLoggingIn || !clientId.trim()}
            >
              {isLoggingIn ? (
                <LoaderCircle className='size-4 animate-spin' />
              ) : (
                <Mail className='size-4' />
              )}
              Sign in with Google
            </Button>
            <p className='text-muted-foreground text-xs'>
              Client ID and secret save automatically in localStorage.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
