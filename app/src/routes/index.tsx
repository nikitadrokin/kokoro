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
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  estimateAudioDurationSec,
  formatDuration,
} from '@/lib/speech-audio';
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
  const [style, setStyle] = useState('af_heart');
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

  const handleDeleteSavedAudio = async (file: SavedAudioFile) => {
    if (deletingAudioPath) {
      return;
    }

    setError('');
    setSavedAudioError('');

    if (pendingDeletePath !== file.path) {
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
    <main className="min-h-[calc(100vh-4.5rem)] @3xl/content:p-6 p-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="pb-4">
          <div className="space-y-1">
            <h1 className="font-semibold text-2xl tracking-tight">
              Generate and audition speech
            </h1>
            <p className="max-w-2xl text-muted-foreground text-sm">
              Write your script, pick a voice, then generate. Choose a playback
              mode — stream immediately, save and stream, or save silently for
              full spatial audio quality.
            </p>
          </div>
        </div>

        <div className="grid gap-4 @5xl/content:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <Card className="shadow-sm backdrop-blur">
            <CardHeader>
              <CardTitle>Script</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="playground-text">Text</Label>
                <Textarea
                  id="playground-text"
                  aria-label="Text to synthesize"
                  className="min-h-72 resize-y"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.metaKey && !isGenerating) {
                      void handleGenerate();
                    }
                  }}
                  placeholder="Enter text for Kokoro to synthesize."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="voice-select">Voice</Label>
                <Select
                  value={style}
                  onValueChange={(value) => setStyle(value ?? '')}
                >
                  <SelectTrigger
                    id="voice-select"
                    className="w-full"
                    aria-label="Voice style"
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
                      <SelectItem key={voice.value} value={voice.value} label={voice.label}>
                        <span className="flex flex-1 items-center justify-between gap-2">
                          {voice.label}
                          {voice.badge !== undefined && (
                            <Badge variant="secondary" className="text-[10px]">
                              {voice.badge}
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Playback mode</Label>
                <RadioGroup
                  value={playbackMode}
                  onValueChange={(value) => {
                    if (isPlaybackMode(value)) {
                      setPlaybackMode(value);
                    }
                  }}
                  className="gap-2"
                >
                  <label
                    htmlFor="mode-stream"
                    className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50 has-[[data-checked]]:border-primary/50 has-[[data-checked]]:bg-primary/5"
                  >
                    <RadioGroupItem
                      id="mode-stream"
                      value="stream"
                      className="mt-0.5 shrink-0"
                    />
                    <div className="grid gap-0.5">
                      <span className="font-medium text-sm leading-none">
                        Stream only
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Play immediately, no file saved
                      </span>
                    </div>
                  </label>

                  <label
                    htmlFor="mode-save-stream"
                    className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50 has-[[data-checked]]:border-primary/50 has-[[data-checked]]:bg-primary/5"
                  >
                    <RadioGroupItem
                      id="mode-save-stream"
                      value="save-stream"
                      className="mt-0.5 shrink-0"
                    />
                    <div className="grid gap-0.5">
                      <span className="font-medium text-sm leading-none">
                        Save &amp; stream
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Save WAV and stream audio while synthesizing
                      </span>
                    </div>
                  </label>

                  <label
                    htmlFor="mode-save-silent"
                    className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50 has-[[data-checked]]:border-primary/50 has-[[data-checked]]:bg-primary/5"
                  >
                    <RadioGroupItem
                      id="mode-save-silent"
                      value="save-silent"
                      className="mt-0.5 shrink-0"
                    />
                    <div className="grid gap-0.5">
                      <span className="font-medium text-sm leading-none">
                        Save silently
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Save WAV without auto-playing — use Play for full
                        spatial audio
                      </span>
                    </div>
                  </label>
                </RadioGroup>
              </div>

              {error ? (
                <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm">
                  {error}
                </div>
              ) : null}

              <Button
                className="w-full @xl/content:w-auto @xl/content:min-w-48"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <AudioLinesIcon className="size-4" />
                )}
                {isGenerating ? 'Generating…' : 'Generate audio'}
              </Button>

              {isGenerating && estimatedDurationSec > 0 ? (
                <div className="grid gap-1">
                  <Progress
                    value={Math.round(
                      Math.min(
                        generatedDurationSec / estimatedDurationSec,
                        0.95,
                      ) * 100,
                    )}
                  />
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatDuration(generatedDurationSec)} generated ·{' '}
                    ~
                    {formatDuration(
                      Math.max(estimatedDurationSec - generatedDurationSec, 0),
                    )}{' '}
                    remaining
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4 @5xl/content:self-start">
            <Card className="shadow-sm backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileAudio className="size-4 text-muted-foreground" />
                  Audio
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="rounded-lg">
                  {/* biome-ignore lint/a11y/useMediaCaption: Generated speech previews do not have a caption track yet. */}
                  <audio
                    ref={audioRef}
                    controls
                    preload="auto"
                    src={audioUrl || undefined}
                    aria-label="Generated audio preview"
                    className="h-10 w-full"
                  />
                </div>

                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={handlePlay}
                  disabled={!audioUrl || isGenerating}
                >
                  <Play className="size-4" />
                  Play again
                </Button>
              </CardContent>
            </Card>

            <Card className="shadow-sm backdrop-blur">
              <CardHeader className="grid-cols-[1fr_auto] items-center">
                <CardTitle className="flex items-center gap-2">
                  <Music2 className="size-4 text-muted-foreground" />
                  Saved audio
                </CardTitle>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => void loadSavedAudio()}
                  disabled={isLoadingSavedAudio}
                  aria-label="Refresh saved audio"
                  title="Refresh saved audio"
                >
                  <RefreshCw
                    className={
                      isLoadingSavedAudio ? 'size-4 animate-spin' : 'size-4'
                    }
                  />
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3">
                {savedAudioError ? (
                  <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm">
                    {savedAudioError}
                  </div>
                ) : null}

                {savedAudioFiles.length > 0 ? (
                  <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
                    {savedAudioFiles.map((file) => {
                      const isActive = savedOutputPath === file.path;
                      const isDeleting = deletingAudioPath === file.path;
                      const isRevealing = revealingAudioPath === file.path;
                      const isConfirmingDelete =
                        pendingDeletePath === file.path;

                      return (
                        <div
                          key={file.path}
                          className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-sm">
                              {file.name}
                            </p>
                            <p className="truncate text-muted-foreground text-xs">
                              {formatModifiedTime(file.modifiedSec)} ·{' '}
                              {formatFileSize(file.sizeBytes)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant={isActive ? 'default' : 'secondary'}
                              size="icon-sm"
                              onClick={() => handlePlaySavedAudio(file)}
                              disabled={isDeleting}
                              aria-label={`Play ${file.name}`}
                              title={`Play ${file.name}`}
                            >
                              <Play className="size-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              onClick={() => void handleRevealSavedAudio(file)}
                              disabled={isDeleting || Boolean(revealingAudioPath)}
                              aria-label={`Reveal ${file.name} in Finder`}
                              title={`Reveal ${file.name} in Finder`}
                            >
                              {isRevealing ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <FolderOpen className="size-4" />
                              )}
                            </Button>
                            <Button
                              variant="destructive"
                              size="icon-sm"
                              onClick={() => void handleDeleteSavedAudio(file)}
                              disabled={Boolean(deletingAudioPath)}
                              aria-label={
                                isConfirmingDelete
                                  ? `Confirm delete ${file.name}`
                                  : `Delete ${file.name}`
                              }
                              title={isConfirmingDelete ? 'Confirm?' : 'Delete'}
                            >
                              {isDeleting ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : isConfirmingDelete ? (
                                <Check className="size-4" />
                              ) : (
                                <Trash2 className="size-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {isLoadingSavedAudio
                      ? 'Loading saved audio…'
                      : 'Saved WAV files will appear here.'}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
