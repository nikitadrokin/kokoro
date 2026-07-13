import { createFileRoute } from '@tanstack/react-router';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import {
  ArrowLeft,
  AudioLinesIcon,
  FolderOpen,
  LoaderCircle,
  LogOut,
  Mail,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';
import {
  Activity,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { MailConnectSetup } from '@/components/MailConnectSetup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { useSpeechStreamGeneration } from '@/hooks/use-speech-stream-generation';
import {
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
import { cn } from '@/lib/utils';
import { VOICE_OPTIONS } from '@/lib/voice-options';
import { useGmailCredentialsStore } from '@/stores/gmail-credentials-store';
import { useSettingsStore } from '@/stores/settings-store';

export const Route = createFileRoute('/mail')({ component: MailListenPage });

/** Saved WAV metadata returned by the Tauri library listing command. */
type SavedAudioFile = {
  name: string;
  path: string;
  modifiedSec?: number | null;
  sizeBytes: number;
};

/** Which pane is frontmost when the window is too narrow for side-by-side. */
type NarrowMailPane = 'list' | 'detail';

/** Props for the compact mail listen playback bar. */
type MailAudioPlayerProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioUrl: string;
};

const MAILBOX_OPTIONS: Array<{ value: MailMailbox; label: string }> = [
  { value: 'unread', label: 'Unread' },
  { value: 'important', label: 'Important' },
  { value: 'updates', label: 'Updates' },
  { value: 'promotions', label: 'Promotions / newsletters' },
  { value: 'inbox', label: 'Inbox' },
];

/** How many threads to fetch per mailbox page. */
const MAILBOX_PAGE_SIZE = 15;

/** Scroll distance from the bottom that triggers loading the next page. */
const MAILBOX_SCROLL_LOAD_THRESHOLD_PX = 120;

/** Page width where the side-by-side layout kicks in; keep in sync with the @5xl (64rem) container variants below. */
const MAIL_WIDE_LAYOUT_MIN_PX = 1024;

/** Valid mailbox category values for the category select. */
const MAIL_MAILBOX_VALUES: ReadonlyArray<MailMailbox> = MAILBOX_OPTIONS.map(
  (option) => option.value,
);

/** Returns whether a select value is a known mailbox category. */
function isMailMailbox(value: string | null): value is MailMailbox {
  if (value === null) {
    return false;
  }
  return MAIL_MAILBOX_VALUES.some((mailbox) => mailbox === value);
}

/** Playback rates available in the mail audio player, from 0.5x to 2x. */
const PLAYBACK_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Formats a playback rate for the speed dropdown label. */
function formatSpeedLabel(speed: number): string {
  return `${speed.toFixed(2).replace(/\.?0+$/, '')}x`;
}

/** Builds a stable filename stem that starts with the Gmail message id. */
function mailAudioOutputLabel(messageId: string, subject: string): string {
  const safeSubject = subject
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .slice(0, 48);
  return `${messageId}-${safeSubject || 'email'}`;
}

/** Finds the newest saved WAV for a Gmail message under the mail/ output folder. */
function findSavedMailAudio(
  files: SavedAudioFile[],
  messageId: string,
): SavedAudioFile | undefined {
  const prefix = `${messageId.toLowerCase()}-`;
  return files.find((file) => {
    const normalized = file.name.replace(/\\/g, '/').toLowerCase();
    if (!normalized.startsWith('mail/')) {
      return false;
    }
    const baseName = normalized.slice(normalized.lastIndexOf('/') + 1);
    return baseName.startsWith(prefix);
  });
}

/**
 * Compact mail listen player: play/pause, seek, duration, and speed.
 * Uses a hidden audio element so the chrome matches the rest of the app.
 */
function MailAudioPlayer({ audioRef, audioUrl }: MailAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const isSeekingRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const syncTime = () => {
      if (!isSeekingRef.current) {
        setCurrentTimeSec(audio.currentTime);
      }
    };

    const syncDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDurationSec(audio.duration);
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTimeSec(audio.duration || 0);
    };

    syncDuration();
    syncTime();
    setIsPlaying(!audio.paused);

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', syncTime);
    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('durationchange', syncDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', syncTime);
      audio.removeEventListener('loadedmetadata', syncDuration);
      audio.removeEventListener('durationchange', syncDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.playbackRate = playbackSpeed;
  }, [audioRef, playbackSpeed]);

  const handleTogglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play().catch(() => undefined);
      return;
    }
    audio.pause();
  };

  const handleSeek = (value: number | readonly number[]) => {
    const nextTime = Array.isArray(value) ? (value[0] ?? 0) : value;
    setCurrentTimeSec(nextTime);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = nextTime;
    }
  };

  const seekMax = durationSec > 0 ? durationSec : 0;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/40 px-3 py-2.5 ring-1 ring-foreground/5">
      {/* biome-ignore lint/a11y/useMediaCaption: Generated speech previews do not have a caption track yet. */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        className="hidden"
      />
      <Button
        type="button"
        size="icon-sm"
        variant="default"
        onClick={handleTogglePlayback}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className="shrink-0"
      >
        {isPlaying ? (
          <Pause className="size-4" />
        ) : (
          <Play className="size-4 fill-current" />
        )}
      </Button>
      <Slider
        min={0}
        max={seekMax}
        step={0.1}
        value={[Math.min(currentTimeSec, seekMax)]}
        onValueChange={handleSeek}
        onPointerDown={() => {
          isSeekingRef.current = true;
        }}
        onPointerUp={() => {
          isSeekingRef.current = false;
        }}
        disabled={seekMax <= 0}
        aria-label="Seek"
        className="min-w-0 flex-1"
      />
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
        {formatDuration(durationSec || currentTimeSec)}
      </span>
      <Select
        value={String(playbackSpeed)}
        onValueChange={(value) => {
          const nextSpeed = Number(value);
          if (Number.isFinite(nextSpeed) && nextSpeed > 0) {
            setPlaybackSpeed(nextSpeed);
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="h-8 w-19 shrink-0"
          aria-label="Playback speed"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {PLAYBACK_SPEED_OPTIONS.map((speed) => (
            <SelectItem key={speed} value={String(speed)}>
              {formatSpeedLabel(speed)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

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
  const [mailbox, setMailbox] = useState<MailMailbox>('unread');
  const [threads, setThreads] = useState<GmailThreadSummary[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [selectedMessage, setSelectedMessage] =
    useState<GmailMessageForSpeech | null>(null);
  const [style, setStyle] = useState('af_heart');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingMoreThreads, setIsLoadingMoreThreads] = useState(false);
  const [isLoadingMessage, setIsLoadingMessage] = useState(false);
  const [pageError, setPageError] = useState('');
  const [estimatedDurationSec, setEstimatedDurationSec] = useState(0);
  const [narrowPane, setNarrowPane] = useState<NarrowMailPane>('list');
  const [isNarrowLayout, setIsNarrowLayout] = useState(false);
  const [isRevealingAudio, setIsRevealingAudio] = useState(false);
  const pageRef = useRef<HTMLElement | null>(null);
  const threadListRef = useRef<HTMLDivElement | null>(null);
  const nextPageTokenRef = useRef<string | null>(null);
  const isLoadingMoreThreadsRef = useRef(false);

  const {
    audioUrl,
    clearPlayerSource,
    error: speechError,
    generateStream,
    generatedDurationSec,
    isGenerating,
    savedOutputPath,
    setError: setSpeechError,
    setPlayerSource,
  } = useSpeechStreamGeneration({ audioRef });

  const hasSynthesizedAudio = Boolean(audioUrl) && !isGenerating;

  const refreshAuth = useCallback(async () => {
    const status = await getGmailAuthStatus();
    setAuthStatus(status);
    return status;
  }, []);

  const loadSavedAudioForMessage = useCallback(
    async (messageId: string) => {
      try {
        const files = await invoke<SavedAudioFile[]>('list_saved_audio');
        const match = findSavedMailAudio(files, messageId);
        if (match) {
          setPlayerSource(convertFileSrc(match.path), match.path);
          return;
        }
      } catch {
        // Missing or unreadable library just means no prior take for this email.
      }
      clearPlayerSource();
    },
    [clearPlayerSource, setPlayerSource],
  );
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

  // Track the page's own width (not the viewport) so the pane logic matches
  // the @5xl container-query breakpoint even when the sidebar is open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the connected/bootstrapping states swap which <main> renders, so the observer must re-attach to the new element.
  useEffect(() => {
    const pageElement = pageRef.current;
    if (!pageElement) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width =
        entries[0]?.contentBoxSize?.[0]?.inlineSize ?? pageElement.clientWidth;
      setIsNarrowLayout(width < MAIL_WIDE_LAYOUT_MIN_PX);
    });
    observer.observe(pageElement);
    return () => {
      observer.disconnect();
    };
  }, [authStatus?.connected, isBootstrapping]);

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
      nextPageTokenRef.current = null;
      setNextPageToken(null);
      setSelectedThreadId('');
      setSelectedMessage(null);
      setNarrowPane('list');
      clearPlayerSource();
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
    setIsLoadingMoreThreads(false);
    isLoadingMoreThreadsRef.current = false;
    nextPageTokenRef.current = null;
    setNextPageToken(null);
    setSelectedThreadId('');
    setSelectedMessage(null);
    setNarrowPane('list');
    clearPlayerSource();
    try {
      const result = await listMailboxThreads(mailbox, MAILBOX_PAGE_SIZE);
      setThreads(result.threads);
      nextPageTokenRef.current = result.nextPageToken;
      setNextPageToken(result.nextPageToken);
    } catch (caughtError) {
      setThreads([]);
      nextPageTokenRef.current = null;
      setNextPageToken(null);
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
    } finally {
      setIsLoadingThreads(false);
    }
  }, [clearPlayerSource, mailbox]);

  const loadMoreThreads = useCallback(async () => {
    const pageToken = nextPageTokenRef.current;
    if (!pageToken || isLoadingThreads || isLoadingMoreThreadsRef.current) {
      return;
    }

    isLoadingMoreThreadsRef.current = true;
    setIsLoadingMoreThreads(true);
    setPageError('');
    try {
      const result = await listMailboxThreads(
        mailbox,
        MAILBOX_PAGE_SIZE,
        pageToken,
      );
      setThreads((current) => {
        const seenIds = new Set(current.map((thread) => thread.id));
        const appended = result.threads.filter(
          (thread) => !seenIds.has(thread.id),
        );
        return [...current, ...appended];
      });
      nextPageTokenRef.current = result.nextPageToken;
      setNextPageToken(result.nextPageToken);
    } catch (caughtError) {
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
    } finally {
      isLoadingMoreThreadsRef.current = false;
      setIsLoadingMoreThreads(false);
    }
  }, [isLoadingThreads, mailbox]);

  useEffect(() => {
    if (!authStatus?.connected) {
      return;
    }
    void loadThreads();
  }, [authStatus?.connected, loadThreads]);

  useEffect(() => {
    const listElement = threadListRef.current;
    if (
      !listElement ||
      isLoadingThreads ||
      isLoadingMoreThreads ||
      !nextPageToken
    ) {
      return;
    }

    if (
      listElement.scrollHeight <=
      listElement.clientHeight + MAILBOX_SCROLL_LOAD_THRESHOLD_PX
    ) {
      void loadMoreThreads();
    }
  }, [
    isLoadingMoreThreads,
    isLoadingThreads,
    loadMoreThreads,
    nextPageToken,
    threads.length,
  ]);

  const handleThreadListScroll = useCallback(() => {
    const listElement = threadListRef.current;
    if (!listElement || !nextPageTokenRef.current) {
      return;
    }

    const distanceFromBottom =
      listElement.scrollHeight -
      listElement.scrollTop -
      listElement.clientHeight;

    if (distanceFromBottom <= MAILBOX_SCROLL_LOAD_THRESHOLD_PX) {
      void loadMoreThreads();
    }
  }, [loadMoreThreads]);

  const handleSelectThread = async (threadId: string) => {
    setSelectedThreadId(threadId);
    setSelectedMessage(null);
    setNarrowPane('detail');
    setSpeechError('');
    setPageError('');
    setEstimatedDurationSec(0);
    clearPlayerSource();
    setIsLoadingMessage(true);
    try {
      const message = await getThreadMessageForSpeech(threadId);
      setSelectedMessage(message);
      await loadSavedAudioForMessage(message.id);
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
    await generateStream({
      text: selectedMessage.speechText,
      style,
      saveToDisk: playbackMode !== 'stream',
      streamAudio: playbackMode !== 'save-silent',
      outputLabel: mailAudioOutputLabel(
        selectedMessage.id,
        selectedMessage.subject,
      ),
      outputSubdir: 'mail',
      mono: true,
    });
  };

  const handleRevealInFinder = async () => {
    if (!savedOutputPath || isRevealingAudio) {
      return;
    }
    setPageError('');
    setIsRevealingAudio(true);
    try {
      await invoke('reveal_saved_audio_in_finder', { path: savedOutputPath });
    } catch (caughtError) {
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
    } finally {
      setIsRevealingAudio(false);
    }
  };

  const connected = Boolean(authStatus?.connected);
  const displayError = pageError || speechError;

  if (isBootstrapping) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 @xl/content:px-6 px-4 py-6">
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Checking Gmail connection…
        </p>
      </main>
    );
  }

  if (!connected) {
    return (
      <MailConnectSetup
        clientId={clientId}
        clientSecret={clientSecret}
        error={displayError}
        isLoggingIn={isLoggingIn}
        onClientIdChange={setClientId}
        onClientSecretChange={setClientSecret}
        onLogin={() => void handleLogin()}
        onError={setPageError}
      />
    );
  }

  const showListPane = !isNarrowLayout || narrowPane === 'list';
  const showDetailPane = !isNarrowLayout || narrowPane === 'detail';

  return (
    <main
      ref={pageRef}
      className="flex w-full flex-col gap-6 @5xl/content:px-8 @xl/content:px-6 px-4 py-6"
    >
      <div className="flex @xl/content:flex-row flex-col @xl/content:items-start @xl/content:justify-between gap-3">
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
            Pick an unread, important, or newsletter thread and generate Kokoro
            audio on-device.
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

      <div className="@5xl/content:grid @5xl/content:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] @5xl/content:items-start @5xl/content:gap-8">
        <Activity
          mode={showListPane ? 'visible' : 'hidden'}
          name="mail-mailbox-list"
        >
          <section
            className={cn(
              'flex min-w-0 flex-col gap-4',
              '@5xl/content:sticky @5xl/content:top-14 @5xl/content:h-[calc(100dvh-3.5rem)]',
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-2">
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

            <div className="grid shrink-0 gap-2">
              <Label>Category</Label>
              <Select
                value={mailbox}
                onValueChange={(value) => {
                  if (isMailMailbox(value)) {
                    setMailbox(value);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value) =>
                      MAILBOX_OPTIONS.find((option) => option.value === value)
                        ?.label ?? value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MAILBOX_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      label={option.label}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              ref={threadListRef}
              onScroll={handleThreadListScroll}
              className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain @5xl/content:pb-2"
            >
              <div className="grid gap-1">
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
                {isLoadingMoreThreads ? (
                  <p className="flex items-center gap-2 px-3 py-3 text-muted-foreground text-sm">
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading more…
                  </p>
                ) : null}
                {!isLoadingThreads &&
                !isLoadingMoreThreads &&
                nextPageToken === null &&
                threads.length > 0 ? (
                  <p className="px-3 py-3 text-center text-muted-foreground text-xs">
                    End of mailbox
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </Activity>

        <Activity
          mode={showDetailPane ? 'visible' : 'hidden'}
          name="mail-listen-detail"
        >
          <Card className="min-w-0 shadow-sm backdrop-blur">
            <CardHeader className="gap-3 pb-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 @5xl/content:hidden"
                  onClick={() => setNarrowPane('list')}
                >
                  <ArrowLeft className="size-4" />
                  Mailbox
                </Button>
                <CardTitle className="text-base">Listen</CardTitle>
              </div>
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid min-w-0 gap-1">
                      <p className="font-medium text-sm">
                        {selectedMessage.subject}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {selectedMessage.from} · {selectedMessage.date}
                      </p>
                    </div>
                    {savedOutputPath ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        onClick={() => void handleRevealInFinder()}
                        disabled={isRevealingAudio}
                        aria-label="Reveal track in Finder"
                        title="Reveal track in Finder"
                      >
                        {isRevealingAudio ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <FolderOpen className="size-4" />
                        )}
                      </Button>
                    ) : null}
                  </div>

                  {!hasSynthesizedAudio ? (
                    <>
                      <div className="grid @xl/content:max-w-xs gap-2">
                        <Label>Voice</Label>
                        <Select
                          value={style}
                          onValueChange={(value) =>
                            setStyle(value ?? 'af_heart')
                          }
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
                      </div>

                      {isGenerating || generatedDurationSec > 0 ? (
                        <div className="grid gap-2">
                          <div className="flex justify-between text-muted-foreground text-xs">
                            <span>
                              {isGenerating ? 'Generating…' : 'Ready'}
                            </span>
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
                    </>
                  ) : null}

                  {audioUrl ? (
                    <MailAudioPlayer
                      key={audioUrl}
                      audioRef={audioRef}
                      audioUrl={audioUrl}
                    />
                  ) : null}

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
                </>
              ) : null}
            </CardContent>
          </Card>
        </Activity>
      </div>
    </main>
  );
}
