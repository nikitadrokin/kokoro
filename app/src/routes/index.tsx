import { createFileRoute } from '@tanstack/react-router';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import {
  AudioLinesIcon,
  Check,
  FileAudio,
  FolderOpen,
  LoaderCircle,
  Music2,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileRowContextMenu } from '@/components/FileRowContextMenu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSpeechStreamGeneration } from '@/hooks/use-speech-stream-generation';
import { estimateAudioDurationSec, formatDuration } from '@/lib/speech-audio';
import { optimizeMarkdownForSpeech } from '@/lib/tts-text';
import { VOICE_OPTIONS } from '@/lib/voice-options';
import { usePlaygroundStore } from '@/stores/playground-store';
import { isPlaybackMode, useSettingsStore } from '@/stores/settings-store';

export const Route = createFileRoute('/')({ component: PlaygroundPage });

type SavedAudioFile = {
  name: string;
  path: string;
  modifiedSec: number | null;
  sizeBytes: number;
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KB`;
  }

  return `${(kib / 1024).toFixed(1)} MB`;
};

const formatModifiedTime = (modifiedSec: number | null) => {
  if (!modifiedSec) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(modifiedSec * 1000));
};

function PlaygroundPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const deleteConfirmationTimeoutRef = useRef<number | null>(null);
  const text = usePlaygroundStore((state) => state.draftText);
  const setText = usePlaygroundStore((state) => state.setDraftText);
  const style = useSettingsStore((state) => state.voice);
  const setStyle = useSettingsStore((state) => state.setVoice);
  const playbackMode = useSettingsStore((state) => state.playbackMode);
  const setPlaybackMode = useSettingsStore((state) => state.setPlaybackMode);
  const [isLoadingSavedAudio, setIsLoadingSavedAudio] = useState(false);
  const [deletingAudioPath, setDeletingAudioPath] = useState('');
  const [revealingAudioPath, setRevealingAudioPath] = useState('');
  const [pendingDeletePath, setPendingDeletePath] = useState('');
  const [savedAudioFiles, setSavedAudioFiles] = useState<SavedAudioFile[]>([]);
  const [savedAudioError, setSavedAudioError] = useState('');
  const {
    audioUrl,
    clearPlayerSource,
    error,
    generateStream,
    generatedDurationSec,
    isGenerating,
    play: handlePlay,
    savedOutputPath,
    setError,
    setPlayerSource,
    stopGeneration,
  } = useSpeechStreamGeneration({ audioRef });
  const [estimatedDurationSec, setEstimatedDurationSec] = useState(0);

  useEffect(() => {
    return () => {
      if (deleteConfirmationTimeoutRef.current !== null) {
        window.clearTimeout(deleteConfirmationTimeoutRef.current);
      }
    };
  }, []);

  const clearDeleteConfirmation = useCallback(() => {
    if (deleteConfirmationTimeoutRef.current !== null) {
      window.clearTimeout(deleteConfirmationTimeoutRef.current);
      deleteConfirmationTimeoutRef.current = null;
    }
    setPendingDeletePath('');
  }, []);

  const loadSavedAudio = useCallback(async () => {
    setSavedAudioError('');
    setIsLoadingSavedAudio(true);

    try {
      const files = await invoke<SavedAudioFile[]>('list_saved_audio');
      setSavedAudioFiles(files);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError);
      setSavedAudioError(message);
    } finally {
      setIsLoadingSavedAudio(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedAudio();
  }, [loadSavedAudio]);

  const handleGenerate = async () => {
    // Optimize the script for speech behind the scenes, but leave the
    // textarea showing the user's original text untouched.
    const optimizedText = optimizeMarkdownForSpeech(text) || text;
    setEstimatedDurationSec(estimateAudioDurationSec(optimizedText));
    const response = await generateStream({
      text: optimizedText,
      style,
      saveToDisk: playbackMode !== 'stream',
      streamAudio: playbackMode !== 'save-silent',
      mono: true,
    });

    if (response?.savedOutputPath) {
      void loadSavedAudio();
    }
  };

  const handlePlaySavedAudio = (file: SavedAudioFile) => {
    setError('');
    setPlayerSource(convertFileSrc(file.path), file.path);
    requestAnimationFrame(() => {
      audioRef.current?.play().catch(() => undefined);
    });
  };

  const handleRevealSavedAudio = async (file: SavedAudioFile) => {
    if (revealingAudioPath) {
      return;
    }

    setError('');
    setSavedAudioError('');
    setRevealingAudioPath(file.path);

    try {
      await invoke('reveal_saved_audio_in_finder', { path: file.path });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError);
      setSavedAudioError(message);
    } finally {
      setRevealingAudioPath('');
    }
  };

  const handleDeleteSavedAudio = async (
    file: SavedAudioFile,
    options?: { skipConfirm?: boolean },
  ) => {
    if (deletingAudioPath) {
      return;
    }

    setError('');
    setSavedAudioError('');

    if (!options?.skipConfirm && pendingDeletePath !== file.path) {
      clearDeleteConfirmation();
      setPendingDeletePath(file.path);
      deleteConfirmationTimeoutRef.current = window.setTimeout(() => {
        setPendingDeletePath((currentPath) =>
          currentPath === file.path ? '' : currentPath,
        );
        deleteConfirmationTimeoutRef.current = null;
      }, 2000);
      return;
    }

    clearDeleteConfirmation();
    setDeletingAudioPath(file.path);

    try {
      await invoke('delete_saved_audio', { path: file.path });
      setSavedAudioFiles((files) =>
        files.filter((savedFile) => savedFile.path !== file.path),
      );

      if (savedOutputPath === file.path) {
        clearPlayerSource();
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError);
      setSavedAudioError(message);
    } finally {
      setDeletingAudioPath('');
    }
  };

  return (
    <main className='flex h-[calc(100vh-3.5rem)] flex-col @3xl/content:flex-row'>
      <div className='flex flex-1 flex-col p-4 @3xl/content:p-6'>
        <div className='flex flex-1 flex-col rounded-2xl border bg-card shadow-sm'>
          <Textarea
            id='playground-text'
            aria-label='Text to synthesize'
            className='flex-1 resize-none border-0 bg-transparent p-6 text-lg shadow-none focus-visible:ring-0 focus-visible:bg-muted/30 transition-colors'
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.metaKey && !isGenerating) {
                void handleGenerate();
              }
            }}
            placeholder='Enter text for Kokoro to synthesize.'
          />

          <div className='flex flex-wrap items-center justify-between gap-4 border-t p-4'>
            <div className='flex items-center gap-4'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='voice-select' className='sr-only'>
                  Voice
                </Label>
                <Select
                  value={style}
                  onValueChange={(value) => setStyle(value ?? '')}
                >
                  <SelectTrigger
                    id='voice-select'
                    className='w-[200px] border-none bg-muted/50 shadow-none hover:bg-muted/80 focus-visible:ring-1 focus-visible:ring-ring'
                    aria-label='Voice style'
                  >
                    <SelectValue>
                      {(value: string | null) =>
                        VOICE_OPTIONS.find((v) => v.value === value)?.label ??
                        value
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_OPTIONS.map((voice) => (
                      <SelectItem
                        key={voice.value}
                        value={voice.value}
                        label={voice.label}
                      >
                        <span className='flex flex-1 items-center justify-between gap-2'>
                          {voice.label}
                          {voice.badge !== undefined && (
                            <Badge variant='secondary' className='text-[10px]'>
                              {voice.badge}
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='flex items-center gap-2'>
                <Label htmlFor='playback-mode' className='sr-only'>
                  Playback mode
                </Label>
                <Select
                  value={playbackMode}
                  onValueChange={(value) => {
                    if (isPlaybackMode(value)) {
                      setPlaybackMode(value);
                    }
                  }}
                >
                  <SelectTrigger
                    id='playback-mode'
                    className='w-[160px] border-none bg-muted/50 shadow-none hover:bg-muted/80 focus-visible:ring-1 focus-visible:ring-ring'
                    aria-label='Playback mode'
                  >
                    <SelectValue>
                      {(value: string | null) => {
                        switch (value) {
                          case 'stream':
                            return 'Stream only';
                          case 'save-stream':
                            return 'Save & stream';
                          case 'save-silent':
                            return 'Save silently';
                          default:
                            return value;
                        }
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='stream' label='Stream only'>
                      <div className='grid gap-0.5'>
                        <span className='font-medium text-sm leading-none'>
                          Stream only
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          Play immediately
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value='save-stream' label='Save & stream'>
                      <div className='grid gap-0.5'>
                        <span className='font-medium text-sm leading-none'>
                          Save & stream
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          Save WAV and stream
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value='save-silent' label='Save silently'>
                      <div className='grid gap-0.5'>
                        <span className='font-medium text-sm leading-none'>
                          Save silently
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          Save WAV without playing
                        </span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className='flex items-center gap-3'>
              {error ? (
                <div className='text-destructive text-sm'>{error}</div>
              ) : null}

              {isGenerating ? (
                <div className='flex items-center gap-2'>
                  {estimatedDurationSec > 0 && (
                    <div className='w-24'>
                      <Progress
                        value={Math.round(
                          Math.min(
                            generatedDurationSec / estimatedDurationSec,
                            0.95,
                          ) * 100,
                        )}
                        className='h-2'
                      />
                    </div>
                  )}
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => void stopGeneration()}
                    className='rounded-full'
                  >
                    <Square className='size-4' />
                    Stop
                  </Button>
                </div>
              ) : (
                <Button
                  className='rounded-full px-8'
                  onClick={() => void handleGenerate()}
                >
                  <AudioLinesIcon className='size-4' />
                  Generate
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className='flex w-full flex-col @3xl/content:w-[320px] @5xl/content:w-95'>
        <div className='flex flex-col gap-4 p-4 @3xl/content:p-6'>
          <div className='space-y-3'>
            <h2 className='font-semibold text-sm flex items-center gap-2'>
              <FileAudio className='size-4 text-muted-foreground' />
              Current Audio
            </h2>
            <div className='rounded-xl border bg-card p-3 shadow-sm'>
              {/* biome-ignore lint/a11y/useMediaCaption: Generated speech previews do not have a caption track yet. */}
              <audio
                ref={audioRef}
                controls
                preload='auto'
                src={audioUrl || undefined}
                aria-label='Generated audio preview'
                className='h-10 w-full'
              />
              <Button
                variant='secondary'
                className='mt-3 w-full'
                onClick={handlePlay}
                disabled={!audioUrl || isGenerating}
              >
                <Play className='size-4' />
                Play again
              </Button>
            </div>
          </div>

          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <h2 className='font-semibold text-sm flex items-center gap-2'>
                <Music2 className='size-4 text-muted-foreground' />
                History
              </h2>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={() => void loadSavedAudio()}
                disabled={isLoadingSavedAudio}
                aria-label='Refresh saved audio'
                title='Refresh saved audio'
              >
                <RefreshCw
                  className={
                    isLoadingSavedAudio ? 'size-3 animate-spin' : 'size-3'
                  }
                />
              </Button>
            </div>

            {savedAudioError ? (
              <div className='rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm'>
                {savedAudioError}
              </div>
            ) : null}

            {savedAudioFiles.length > 0 ? (
              <div className='grid gap-2'>
                {savedAudioFiles.map((file) => {
                  const isActive = savedOutputPath === file.path;
                  const isDeleting = deletingAudioPath === file.path;
                  const isRevealing = revealingAudioPath === file.path;
                  const isConfirmingDelete = pendingDeletePath === file.path;

                  return (
                    <FileRowContextMenu
                      key={file.path}
                      className='grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border bg-card px-3 py-2 shadow-sm transition-colors hover:bg-accent/50'
                      actions={[
                        {
                          key: 'play',
                          label: 'Play',
                          icon: <Play />,
                          onSelect: () => handlePlaySavedAudio(file),
                          disabled: isDeleting,
                        },
                        {
                          key: 'reveal',
                          label: 'Reveal in Finder',
                          icon: <FolderOpen />,
                          onSelect: () => void handleRevealSavedAudio(file),
                          disabled: isDeleting || Boolean(revealingAudioPath),
                        },
                        {
                          key: 'delete',
                          label: isConfirmingDelete
                            ? 'Confirm delete'
                            : 'Delete',
                          icon: <Trash2 />,
                          onSelect: () => void handleDeleteSavedAudio(file),
                          disabled: Boolean(deletingAudioPath),
                          destructive: true,
                        },
                      ]}
                    >
                      <div className='min-w-0'>
                        <p className='truncate font-medium text-sm'>
                          {file.name}
                        </p>
                        <p className='truncate text-muted-foreground text-xs'>
                          {formatModifiedTime(file.modifiedSec)} ·{' '}
                          {formatFileSize(file.sizeBytes)}
                        </p>
                      </div>
                      <div className='flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/context-menu:opacity-100'>
                        <Button
                          variant={isActive ? 'secondary' : 'ghost'}
                          size='icon-sm'
                          onClick={() => handlePlaySavedAudio(file)}
                          disabled={isDeleting}
                          aria-label={`Play ${file.name}`}
                          title={`Play ${file.name}`}
                        >
                          <Play className='size-4' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          onClick={() => void handleRevealSavedAudio(file)}
                          disabled={isDeleting || Boolean(revealingAudioPath)}
                          aria-label={`Reveal ${file.name} in Finder`}
                          title={`Reveal ${file.name} in Finder`}
                        >
                          {isRevealing ? (
                            <LoaderCircle className='size-4 animate-spin' />
                          ) : (
                            <FolderOpen className='size-4' />
                          )}
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          className='text-destructive hover:bg-destructive/10 hover:text-destructive'
                          onClick={(event) =>
                            void handleDeleteSavedAudio(file, {
                              skipConfirm: event.shiftKey,
                            })
                          }
                          disabled={Boolean(deletingAudioPath)}
                          aria-label={
                            isConfirmingDelete
                              ? `Confirm delete ${file.name}`
                              : `Delete ${file.name}`
                          }
                          title={isConfirmingDelete ? 'Confirm?' : 'Delete'}
                        >
                          {isDeleting ? (
                            <LoaderCircle className='size-4 animate-spin' />
                          ) : isConfirmingDelete ? (
                            <Check className='size-4' />
                          ) : (
                            <Trash2 className='size-4' />
                          )}
                        </Button>
                      </div>
                    </FileRowContextMenu>
                  );
                })}
              </div>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {isLoadingSavedAudio
                  ? 'Loading saved audio…'
                  : 'Saved WAV files will appear here.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
