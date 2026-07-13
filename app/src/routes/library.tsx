import { createFileRoute } from '@tanstack/react-router';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import {
  BookOpen,
  Check,
  FolderOpen,
  Headphones,
  LoaderCircle,
  Mail,
  Mic,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const Route = createFileRoute('/library')({ component: LibraryPage });

type SavedAudioFile = {
  name: string;
  path: string;
  modifiedSec: number | null;
  sizeBytes: number;
};

/** Page an audio file was generated from, derived from its saved subfolder. */
type AudioSource = 'speech' | 'mail' | 'book';

type SourceFilter = 'all' | AudioSource;

type AudioGroup = {
  key: string;
  label: string;
  files: SavedAudioFile[];
};

const SOURCE_LABELS: Record<AudioSource, string> = {
  speech: 'Speech',
  mail: 'Mail',
  book: 'Book',
};

/** Labels for the library source filter select (value → trigger/item text). */
const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = {
  all: 'All sources',
  speech: 'Speech',
  mail: 'Mail',
  book: 'Books',
};

const SOURCE_ICONS: Record<AudioSource, typeof Mic> = {
  speech: Mic,
  mail: Mail,
  book: BookOpen,
};

/**
 * Each generation page saves into its own subfolder of the saved-audio
 * directory (mail → `mail/`, EPUB reader → `books/…`, speech page → root),
 * and `name` is the path relative to that directory.
 */
function audioSource(file: SavedAudioFile): AudioSource {
  const relative = file.name.replace(/\\/g, '/');
  if (relative.startsWith('mail/')) return 'mail';
  if (relative.startsWith('books/')) return 'book';
  return 'speech';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  return `${(kib / 1024).toFixed(1)} MB`;
}

function formatModifiedTime(modifiedSec: number | null): string {
  if (!modifiedSec) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(modifiedSec * 1000));
}

function parentFolderName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').at(-2) ?? '';
}

function groupFiles(files: SavedAudioFile[]): AudioGroup[] {
  const map = new Map<string, SavedAudioFile[]>();
  for (const file of files) {
    const key = parentFolderName(file.path);
    const existing = map.get(key) ?? [];
    existing.push(file);
    map.set(key, existing);
  }
  return Array.from(map.entries()).map(([key, grouped]) => ({
    key,
    label: key.replace(/-/g, ' '),
    files: grouped,
  }));
}

function LibraryPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const deleteConfirmTimeoutRef = useRef<number | null>(null);
  const marqueeContainerRef = useRef<HTMLDivElement | null>(null);
  const marqueeTextRef = useRef<HTMLSpanElement | null>(null);
  const [isMarqueeActive, setIsMarqueeActive] = useState(false);

  const [files, setFiles] = useState<SavedAudioFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [deletingPath, setDeletingPath] = useState('');
  const [revealingPath, setRevealingPath] = useState('');
  const [pendingDeletePath, setPendingDeletePath] = useState('');
  const [activeFilePath, setActiveFilePath] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const filteredFiles = useMemo(
    () =>
      sourceFilter === 'all'
        ? files
        : files.filter((file) => audioSource(file) === sourceFilter),
    [files, sourceFilter],
  );

  const groups = useMemo(() => groupFiles(filteredFiles), [filteredFiles]);

  const activeFile = useMemo(
    () => files.find((f) => f.path === activeFilePath) ?? null,
    [files, activeFilePath],
  );

  useEffect(() => {
    const container = marqueeContainerRef.current;
    const text = marqueeTextRef.current;
    if (!container || !text) return;

    const check = () =>
      setIsMarqueeActive(text.scrollWidth > container.clientWidth);
    const observer = new ResizeObserver(check);
    observer.observe(container);
    observer.observe(text);
    check();
    return () => observer.disconnect();
  }, [activeFile]);

  useEffect(() => {
    return () => {
      if (deleteConfirmTimeoutRef.current !== null) {
        window.clearTimeout(deleteConfirmTimeoutRef.current);
      }
    };
  }, []);

  const clearDeleteConfirmation = useCallback(() => {
    if (deleteConfirmTimeoutRef.current !== null) {
      window.clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = null;
    }
    setPendingDeletePath('');
  }, []);

  const loadFiles = useCallback(async () => {
    setError('');
    setIsLoading(true);
    try {
      const result = await invoke<SavedAudioFile[]>('list_saved_audio');
      setFiles(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handlePlay = useCallback((file: SavedAudioFile) => {
    setError('');
    setActiveFilePath(file.path);
    setAudioUrl(convertFileSrc(file.path));
    requestAnimationFrame(() => {
      audioRef.current?.play().catch(() => undefined);
    });
  }, []);

  const handleReveal = useCallback(
    async (file: SavedAudioFile) => {
      if (revealingPath) return;
      setError('');
      setRevealingPath(file.path);
      try {
        await invoke('reveal_saved_audio_in_finder', { path: file.path });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setRevealingPath('');
      }
    },
    [revealingPath],
  );

  const handleDelete = useCallback(
    async (file: SavedAudioFile) => {
      if (deletingPath) return;
      setError('');

      if (pendingDeletePath !== file.path) {
        clearDeleteConfirmation();
        setPendingDeletePath(file.path);
        deleteConfirmTimeoutRef.current = window.setTimeout(() => {
          setPendingDeletePath((current) =>
            current === file.path ? '' : current,
          );
          deleteConfirmTimeoutRef.current = null;
        }, 2000);
        return;
      }

      clearDeleteConfirmation();
      setDeletingPath(file.path);
      try {
        await invoke('delete_saved_audio', { path: file.path });
        setFiles((prev) => prev.filter((f) => f.path !== file.path));
        if (activeFilePath === file.path) {
          setActiveFilePath('');
          setAudioUrl('');
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setDeletingPath('');
      }
    },
    [activeFilePath, clearDeleteConfirmation, deletingPath, pendingDeletePath],
  );

  const playerCard = (
    <Card className="shadow-sm backdrop-blur">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2 overflow-hidden text-base">
          <Headphones className="size-4 shrink-0 text-muted-foreground" />
          {activeFile ? (
            <div
              ref={marqueeContainerRef}
              className={`relative min-w-0 flex-1 overflow-hidden${isMarqueeActive ? 'mask-[linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]' : ''}`}
            >
              {/* hidden span used only for measuring natural text width */}
              <span
                ref={marqueeTextRef}
                className="pointer-events-none invisible absolute whitespace-nowrap"
                aria-hidden="true"
              >
                {activeFile.name}
              </span>
              {isMarqueeActive ? (
                <span
                  className="inline-flex gap-16 whitespace-nowrap"
                  style={{ animation: 'marquee-scroll 18s linear infinite' }}
                >
                  <span>{activeFile.name}</span>
                  <span>{activeFile.name}</span>
                </span>
              ) : (
                <span className="block truncate">{activeFile.name}</span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">No track selected</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* biome-ignore lint/a11y/useMediaCaption: Generated speech does not have captions. */}
        <audio
          ref={audioRef}
          controls
          preload="auto"
          src={audioUrl || undefined}
          aria-label="Audio player"
          className="h-10 w-full"
        />
      </CardContent>
    </Card>
  );

  return (
    <main className="min-h-[calc(100vh-4.5rem)] @xl/content:p-6 p-4">
      <div className="mx-auto flex w-full @3xl/content:max-w-6xl max-w-4xl flex-col gap-4">
        <div className="pb-2">
          <div className="space-y-1">
            <h1 className="font-semibold text-2xl tracking-tight">
              Audio library
            </h1>
            <p className="text-muted-foreground text-sm">
              Browse and play your saved synthesis output.
            </p>
          </div>
        </div>

        <div className="grid @3xl/content:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] @3xl/content:items-start gap-4">
          <div className="@3xl/content:sticky @3xl/content:top-4">
            {playerCard}
          </div>

          <Card className="shadow-sm backdrop-blur">
            <CardHeader className="grid grid-cols-[1fr_auto] items-center">
              <CardTitle className="text-base">Library</CardTitle>
              <div className="flex items-center gap-2">
                <Select
                  value={sourceFilter}
                  onValueChange={(value) =>
                    setSourceFilter(value as SourceFilter)
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-36"
                    aria-label="Filter by source"
                  >
                    <SelectValue>
                      {(value) =>
                        value !== null && value in SOURCE_FILTER_LABELS
                          ? SOURCE_FILTER_LABELS[value as SourceFilter]
                          : value
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(SOURCE_FILTER_LABELS) as Array<
                        [SourceFilter, string]
                      >
                    ).map(([value, label]) => (
                      <SelectItem key={value} value={value} label={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => void loadFiles()}
                  disabled={isLoading}
                  aria-label="Refresh library"
                  title="Refresh library"
                >
                  <RefreshCw
                    className={isLoading ? 'size-4 animate-spin' : 'size-4'}
                  />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              {error ? (
                <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm">
                  {error}
                </div>
              ) : null}

              {groups.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {isLoading
                    ? 'Loading…'
                    : sourceFilter === 'all'
                      ? 'No saved audio files yet.'
                      : `No saved ${SOURCE_LABELS[sourceFilter].toLowerCase()} audio yet.`}
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.key} className="grid gap-1.5">
                    <p className="px-1 font-medium text-sm leading-none">
                      {group.label}
                    </p>
                    <div className="divide-y overflow-hidden rounded-xl border">
                      {group.files.map((file) => {
                        const isActive = activeFilePath === file.path;
                        const isDeleting = deletingPath === file.path;
                        const isRevealing = revealingPath === file.path;
                        const isConfirmingDelete =
                          pendingDeletePath === file.path;
                        const source = audioSource(file);
                        const SourceIcon = SOURCE_ICONS[source];

                        return (
                          <div
                            key={file.path}
                            className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p
                                className={`truncate text-sm ${isActive ? 'font-medium text-primary' : ''}`}
                              >
                                {file.name}
                              </p>
                              <div className="flex min-w-0 items-center gap-1.5">
                                <Badge
                                  variant="secondary"
                                  className="gap-1 px-1.5 py-0 font-normal text-[11px]"
                                >
                                  <SourceIcon className="size-3" />
                                  {SOURCE_LABELS[source]}
                                </Badge>
                                <p className="truncate text-muted-foreground text-xs">
                                  {formatModifiedTime(file.modifiedSec)} ·{' '}
                                  {formatFileSize(file.sizeBytes)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant={isActive ? 'default' : 'ghost'}
                                size="icon-sm"
                                onClick={() => handlePlay(file)}
                                disabled={isDeleting}
                                aria-label={`Play ${file.name}`}
                                title={`Play ${file.name}`}
                              >
                                <Play className="size-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => void handleReveal(file)}
                                disabled={isDeleting || Boolean(revealingPath)}
                                aria-label={`Reveal ${file.name} in Finder`}
                                title="Reveal in Finder"
                              >
                                {isRevealing ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : (
                                  <FolderOpen className="size-4" />
                                )}
                              </Button>
                              <Button
                                variant={
                                  isConfirmingDelete ? 'destructive' : 'ghost'
                                }
                                size="icon-sm"
                                onClick={() => void handleDelete(file)}
                                disabled={Boolean(deletingPath)}
                                aria-label={
                                  isConfirmingDelete
                                    ? `Confirm delete ${file.name}`
                                    : `Delete ${file.name}`
                                }
                                title={
                                  isConfirmingDelete ? 'Confirm?' : 'Delete'
                                }
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
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
