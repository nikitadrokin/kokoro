import { createFileRoute } from '@tanstack/react-router';
import { isTauri } from '@tauri-apps/api/core';
import {
  AudioLinesIcon,
  Check,
  Copy,
  LoaderCircle,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSpeechStreamGeneration } from '@/hooks/use-speech-stream-generation';
import {
  GMAIL_OAUTH_LOOPBACK_PORT,
  GMAIL_OAUTH_REDIRECT_URI,
  type GmailAuthStatus,
  type GmailMessageForSpeech,
  type GmailThreadSummary,
  getGmailAuthStatus,
  getGmailClientConfig,
  getThreadMessageForSpeech,
  listMailboxThreads,
  loginToGmail,
  logoutFromGmail,
  type MailMailbox,
  saveGmailClientConfig,
} from '@/lib/gmail';
import { estimateAudioDurationSec, formatDuration } from '@/lib/speech-audio';
import { VOICE_OPTIONS } from '@/lib/voice-options';
import { useGmailCredentialsStore } from '@/stores/gmail-credentials-store';
import { useSettingsStore } from '@/stores/settings-store';

export const Route = createFileRoute('/mail')({ component: MailListenPage });

const MAILBOX_OPTIONS: Array<{ value: MailMailbox; label: string }> = [
  { value: 'important', label: 'Important' },
  { value: 'updates', label: 'Updates' },
  { value: 'promotions', label: 'Promotions / newsletters' },
  { value: 'inbox', label: 'Inbox' },
];

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

function MailListenPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackMode = useSettingsStore((state) => state.playbackMode);
  const clientId = useGmailCredentialsStore((state) => state.clientId);
  const clientSecret = useGmailCredentialsStore((state) => state.clientSecret);
  const setClientId = useGmailCredentialsStore((state) => state.setClientId);
  const setClientSecret = useGmailCredentialsStore(
    (state) => state.setClientSecret,
  );

  const [authStatus, setAuthStatus] = useState<GmailAuthStatus | null>(null);
  const [mailbox, setMailbox] = useState<MailMailbox>('important');
  const [threads, setThreads] = useState<GmailThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [selectedMessage, setSelectedMessage] =
    useState<GmailMessageForSpeech | null>(null);
  const [style, setStyle] = useState('af_heart');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingMessage, setIsLoadingMessage] = useState(false);
  const [pageError, setPageError] = useState('');
  const [estimatedDurationSec, setEstimatedDurationSec] = useState(0);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const {
    audioUrl,
    error: speechError,
    generateStream,
    generatedDurationSec,
    isGenerating,
    play: handlePlay,
    savedOutputPath,
    setError: setSpeechError,
  } = useSpeechStreamGeneration({ audioRef });

  const refreshAuth = useCallback(async () => {
    const status = await getGmailAuthStatus();
    setAuthStatus(status);
    return status;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setPageError('');
      setIsBootstrapping(true);
      try {
        if (!isTauri()) {
          setPageError(
            'Gmail listen mode needs the Tauri desktop app (not the browser-only Vite preview).',
          );
          return;
        }

        // One-time migrate credentials from the older Tauri file store.
        const stored = useGmailCredentialsStore.getState();
        if (!stored.clientId.trim()) {
          const config = await getGmailClientConfig();
          if (!cancelled && config?.clientId) {
            setClientId(config.clientId);
            setClientSecret(config.clientSecret ?? '');
          }
        }

        if (!cancelled) {
          await refreshAuth();
        }
      } catch (caughtError) {
        if (!cancelled) {
          setPageError(
            caughtError instanceof Error
              ? caughtError.message
              : String(caughtError),
          );
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [refreshAuth, setClientId, setClientSecret]);

  const handleLogin = async () => {
    setPageError('');
    setIsLoggingIn(true);
    try {
      await saveGmailClientConfig(clientId, clientSecret);
      const status = await loginToGmail();
      setAuthStatus(status);
    } catch (caughtError) {
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    setPageError('');
    try {
      await logoutFromGmail();
      setThreads([]);
      setSelectedThreadId('');
      setSelectedMessage(null);
      await refreshAuth();
    } catch (caughtError) {
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
    }
  };

  const loadThreads = useCallback(async () => {
    setPageError('');
    setIsLoadingThreads(true);
    setSelectedThreadId('');
    setSelectedMessage(null);
    try {
      const nextThreads = await listMailboxThreads(mailbox, 15);
      setThreads(nextThreads);
    } catch (caughtError) {
      setThreads([]);
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
    } finally {
      setIsLoadingThreads(false);
    }
  }, [mailbox]);

  useEffect(() => {
    if (!authStatus?.connected) {
      return;
    }
    void loadThreads();
  }, [authStatus?.connected, loadThreads]);

  const handleSelectThread = async (threadId: string) => {
    setSelectedThreadId(threadId);
    setSelectedMessage(null);
    setSpeechError('');
    setPageError('');
    setIsLoadingMessage(true);
    try {
      const message = await getThreadMessageForSpeech(threadId);
      setSelectedMessage(message);
    } catch (caughtError) {
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
    } finally {
      setIsLoadingMessage(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedMessage?.speechText) {
      return;
    }
    setSpeechError('');
    setEstimatedDurationSec(
      estimateAudioDurationSec(selectedMessage.speechText),
    );
    const safeLabel = selectedMessage.subject
      .replace(/[^\w\s-]+/g, '')
      .trim()
      .slice(0, 48);
    await generateStream({
      text: selectedMessage.speechText,
      style,
      saveToDisk: playbackMode !== 'stream',
      streamAudio: playbackMode !== 'save-silent',
      outputLabel: safeLabel || 'email',
      outputSubdir: 'mail',
      mono: true,
    });
  };

  const handleCopyRedirectUri = async () => {
    try {
      await navigator.clipboard.writeText(GMAIL_OAUTH_REDIRECT_URI);
      setCopiedRedirect(true);
      window.setTimeout(() => setCopiedRedirect(false), 2000);
    } catch (caughtError) {
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
    }
  };

  const connected = Boolean(authStatus?.connected);
  const displayError = pageError || speechError;

  if (isBootstrapping) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Checking Gmail connection…
        </p>
      </main>
    );
  }

  if (!connected) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Mail className="size-5 text-primary" aria-hidden="true" />
            <h1 className="font-semibold text-2xl tracking-tight">
              Mail listen
            </h1>
            <Badge variant="secondary" className="rounded-full">
              PoC
            </Badge>
          </div>
          <p className="max-w-2xl text-muted-foreground text-sm leading-6">
            Connect Gmail once. Credentials stay in localStorage on this device;
            speech is generated on-device.
          </p>
        </div>

        {displayError ? (
          <div
            role="alert"
            className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm"
          >
            {displayError}
          </div>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-muted-foreground" />
              Google OAuth setup
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <ol className="grid gap-3">
              {SETUP_STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="grid grid-cols-[auto_1fr] gap-3 rounded-2xl border px-3 py-3"
                >
                  <span className="grid size-7 place-items-center rounded-full bg-muted font-medium text-xs">
                    {index + 1}
                  </span>
                  <div className="grid gap-1">
                    <p className="font-medium text-sm">{step.title}</p>
                    <p className="text-muted-foreground text-xs leading-5">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="grid gap-2 rounded-2xl border bg-muted/30 px-3 py-3">
              <Label htmlFor="gmail-redirect-uri">
                Authorized redirect URI (port {GMAIL_OAUTH_LOOPBACK_PORT})
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="gmail-redirect-uri"
                  value={GMAIL_OAUTH_REDIRECT_URI}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => void handleCopyRedirectUri()}
                >
                  {copiedRedirect ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copiedRedirect ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs leading-5">
                Copy this into Authorized redirect URIs for the same Client ID
                you paste below, then click Save in Google Cloud. Use
                `127.0.0.1`, not `localhost`.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="gmail-client-id">Client ID</Label>
                <Input
                  id="gmail-client-id"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="xxxxx.apps.googleusercontent.com"
                  autoComplete="off"
                  disabled={isLoggingIn}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gmail-client-secret">
                  Client secret (required for Web clients)
                </Label>
                <Input
                  id="gmail-client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  placeholder="Optional for some Desktop clients"
                  autoComplete="off"
                  disabled={isLoggingIn}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => void handleLogin()}
                disabled={isLoggingIn || !clientId.trim()}
              >
                {isLoggingIn ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Sign in with Google
              </Button>
              <p className="text-muted-foreground text-xs">
                Client ID and secret save automatically in localStorage.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Mail className="size-5 text-primary" aria-hidden="true" />
            <h1 className="font-semibold text-2xl tracking-tight">
              Mail listen
            </h1>
            <Badge variant="secondary" className="rounded-full">
              PoC
            </Badge>
          </div>
          <p className="max-w-2xl text-muted-foreground text-sm leading-6">
            Pick an important or newsletter thread and generate Kokoro audio
            on-device.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="rounded-full" variant="secondary">
            {authStatus?.email}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleLogout()}
          >
            <LogOut className="size-4" />
            Disconnect
          </Button>
        </div>
      </div>

      {displayError ? (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm"
        >
          {displayError}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
        <section className="grid min-w-0 gap-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-heading font-medium text-base">Mailbox</h2>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void loadThreads()}
              disabled={isLoadingThreads}
              aria-label="Refresh threads"
            >
              <RefreshCw
                className={`size-4 ${isLoadingThreads ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>

          <div className="grid gap-2">
            <Label>Category</Label>
            <Select
              value={mailbox}
              onValueChange={(value) => {
                if (
                  value === 'important' ||
                  value === 'updates' ||
                  value === 'promotions' ||
                  value === 'inbox'
                ) {
                  setMailbox(value);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAILBOX_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid max-h-[min(70dvh,36rem)] gap-1 overflow-y-auto">
            {isLoadingThreads ? (
              <p className="px-3 py-3 text-muted-foreground text-sm">
                Loading…
              </p>
            ) : null}
            {!isLoadingThreads && threads.length === 0 ? (
              <p className="px-3 py-3 text-muted-foreground text-sm">
                No threads in this mailbox.
              </p>
            ) : null}
            {threads.map((thread) => {
              const isActive = thread.id === selectedThreadId;
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => void handleSelectThread(thread.id)}
                  className={`rounded-2xl px-3 py-3.5 text-left transition-[background-color,box-shadow,color] ${
                    isActive
                      ? 'bg-card shadow-md ring-1 ring-foreground/5'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm leading-5">
                      {thread.subject}
                    </p>
                    {thread.unread ? (
                      <Badge
                        className="shrink-0 rounded-full"
                        variant="secondary"
                      >
                        unread
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {thread.from}
                  </p>
                  <p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-5">
                    {thread.snippet}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <Card className="min-w-0 shadow-sm backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Listen</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {isLoadingMessage ? (
              <p className="flex items-center gap-2 text-muted-foreground text-sm">
                <LoaderCircle className="size-4 animate-spin" />
                Extracting email text…
              </p>
            ) : null}

            {!selectedMessage && !isLoadingMessage ? (
              <p className="text-muted-foreground text-sm">
                Select a thread to extract speech text and generate audio.
              </p>
            ) : null}

            {selectedMessage ? (
              <>
                <div className="grid gap-1">
                  <p className="font-medium text-sm">
                    {selectedMessage.subject}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {selectedMessage.from} · {selectedMessage.date}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="mail-speech-text">Speech text</Label>
                  <Textarea
                    id="mail-speech-text"
                    value={selectedMessage.speechText}
                    onChange={(event) =>
                      setSelectedMessage({
                        ...selectedMessage,
                        speechText: event.target.value,
                      })
                    }
                    className="min-h-56 font-mono text-sm"
                  />
                </div>

                <div className="grid gap-2 sm:max-w-xs">
                  <Label>Voice</Label>
                  <Select
                    value={style}
                    onValueChange={(value) => setStyle(value ?? 'af_heart')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VOICE_OPTIONS.map((voice) => (
                        <SelectItem key={voice.value} value={voice.value}>
                          {voice.label}
                          {voice.badge ? ` (${voice.badge})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={
                      isGenerating || !selectedMessage.speechText.trim()
                    }
                  >
                    {isGenerating ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <AudioLinesIcon className="size-4" />
                    )}
                    Generate audio
                  </Button>
                  {audioUrl ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handlePlay()}
                    >
                      Play
                    </Button>
                  ) : null}
                </div>

                {isGenerating || generatedDurationSec > 0 ? (
                  <div className="grid gap-2">
                    <div className="flex justify-between text-muted-foreground text-xs">
                      <span>{isGenerating ? 'Generating…' : 'Ready'}</span>
                      <span>
                        {formatDuration(
                          generatedDurationSec || estimatedDurationSec,
                        )}
                      </span>
                    </div>
                    <Progress
                      value={
                        isGenerating
                          ? Math.min(
                              95,
                              estimatedDurationSec > 0
                                ? (generatedDurationSec /
                                    estimatedDurationSec) *
                                    100
                                : 15,
                            )
                          : 100
                      }
                    />
                  </div>
                ) : null}

                {savedOutputPath ? (
                  <p className="break-all text-muted-foreground text-xs">
                    Saved to {savedOutputPath}
                  </p>
                ) : null}

                {/* biome-ignore lint/a11y/useMediaCaption: Generated speech previews do not have a caption track yet. */}
                <audio
                  ref={audioRef}
                  src={audioUrl || undefined}
                  controls
                  className="w-full"
                />
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
