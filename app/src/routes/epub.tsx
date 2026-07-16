import geistCyrillicFontUrl from '@fontsource-variable/geist/files/geist-cyrillic-wght-normal.woff2?url';
import geistLatinExtFontUrl from '@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?url';
import geistLatinFontUrl from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
import {
  type EpubFile,
  type EpubProcessedChapter,
  initEpubFile,
  type NavPoint,
} from '@lingo-reader/epub-parser';
import { createFileRoute } from '@tanstack/react-router';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  AudioLinesIcon,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileAudio,
  FileText,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Save,
  Section,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FileRowContextMenu,
  quickActionClass,
} from '@/components/FileRowContextMenu';
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
import { Slider } from '@/components/ui/slider';
import {
  Tabs,
  TabsContent,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useShiftHeld } from '@/hooks/use-shift-held';
import { useSpeechStreamGeneration } from '@/hooks/use-speech-stream-generation';
import {
  extractSelectedSpeechText,
  extractSpeechTextFromChapterHtml,
  extractSpeechTextFromDocument,
} from '@/lib/epub-speech';
import {
  estimateAudioDurationSec,
  formatDuration,
} from '@/lib/speech-audio';
import { VOICE_OPTIONS } from '@/lib/voice-options';
import {
  type EpubChapterResume,
  type LastOpenedEpub,
  useEpubStore,
} from '@/stores/epub-store';
import rawReaderDocumentCss from './epub-reader.css?raw';

export const Route = createFileRoute('/epub')({ component: EpubReaderPage });

/** One spine row when the book has no usable NCX / nav tree. */
type SpineListItem = {
  kind: 'spine';
  id: string;
  label: string;
};

/** One TOC row resolved to a loadable manifest id. */
type TocListItem = {
  kind: 'toc';
  id: string;
  navId: string;
  playOrder: string;
  label: string;
  selector: string;
  depth: number;
};

type ChapterListItem = SpineListItem | TocListItem;

type NarrationScope = 'chapter' | 'section' | 'selection';

type ReadEpubFileResponse = {
  id: string | null;
  fileName: string;
  filePath: string;
  importedPath: string | null;
  originalPath: string | null;
  fileSize: number;
  fileLastModified: number;
  bytesBase64: string;
};

type ImportedEpubFileResponse = {
  id: string;
  fileName: string;
  filePath: string;
  importedPath: string;
  originalPath: string;
  fileSize: number;
  fileLastModified: number;
  bytesBase64: string;
};

type ImportedEpubBook = {
  id: string;
  name: string;
  path: string;
  modifiedSec: number | null;
  sizeBytes: number;
};

type ReaderTheme = {
  background: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  fontFamily: string;
  colorScheme: 'light' | 'dark';
};

const DEFAULT_READER_THEME: ReaderTheme = {
  background: 'oklch(1 0 0)',
  foreground: 'oklch(0.147 0.004 49.3)',
  mutedForeground: 'oklch(0.547 0.021 43.1)',
  border: 'oklch(0.922 0.005 34.3)',
  fontFamily: '"Geist Variable", sans-serif',
  colorScheme: 'light',
};

const readerDocumentCss = rawReaderDocumentCss
  .replaceAll(
    '__GEIST_CYRILLIC_FONT_URL__',
    JSON.stringify(geistCyrillicFontUrl),
  )
  .replaceAll(
    '__GEIST_LATIN_EXT_FONT_URL__',
    JSON.stringify(geistLatinExtFontUrl),
  )
  .replaceAll('__GEIST_LATIN_FONT_URL__', JSON.stringify(geistLatinFontUrl));

/**
 * Flattens NCX nav points into rows with manifest ids for `loadChapter`.
 */
function flattenNavPoints(
  points: NavPoint[],
  epub: EpubFile,
  depth: number,
): TocListItem[] {
  const rows: TocListItem[] = [];
  for (const point of points) {
    const resolved = epub.resolveHref(point.href);
    if (resolved) {
      rows.push({
        kind: 'toc',
        id: resolved.id,
        navId: point.id,
        playOrder: point.playOrder,
        label: point.label,
        selector: resolved.selector,
        depth,
      });
    }
    if (point.children?.length) {
      rows.push(...flattenNavPoints(point.children, epub, depth + 1));
    }
  }
  return rows;
}

function buildChapterList(epub: EpubFile): ChapterListItem[] {
  const tocRows = flattenNavPoints(epub.getToc(), epub, 0);
  if (tocRows.length > 0) {
    return tocRows;
  }
  const spine = epub.getSpine();
  return spine.map((item) => ({
    kind: 'spine',
    id: item.id,
    label: item.href.split('/').pop() ?? item.id,
  }));
}

function chapterListItemKey(item: ChapterListItem): string {
  return item.kind === 'toc'
    ? `toc-${item.navId}-${item.playOrder}-${item.id}-${item.selector}`
    : `spine-${item.id}`;
}

function chapterListItemIndex(
  items: ChapterListItem[],
  item: ChapterListItem | null,
): number {
  if (!item) {
    return -1;
  }

  const key = chapterListItemKey(item);
  return items.findIndex((candidate) => chapterListItemKey(candidate) === key);
}

function chapterResumeFromItem(
  items: ChapterListItem[],
  item: ChapterListItem,
): EpubChapterResume {
  return {
    listItemKey: chapterListItemKey(item),
    id: item.id,
    label: item.label,
    selector: item.kind === 'toc' ? item.selector : '',
    index: chapterListItemIndex(items, item),
    updatedAt: Date.now(),
  };
}

function readFilePath(file: File): string | undefined {
  const path = (file as File & { path?: unknown }).path;
  return typeof path === 'string' && path ? path : undefined;
}

function attachFilePath(file: File, path: string): File {
  Object.defineProperty(file, 'path', {
    configurable: true,
    value: path,
  });
  return file;
}

function attachImportedBookMetadata(
  file: File,
  payload: ReadEpubFileResponse | ImportedEpubFileResponse,
): File {
  attachFilePath(file, payload.filePath);
  Object.defineProperties(file, {
    importedBookId: {
      configurable: true,
      value: payload.id,
    },
    importedPath: {
      configurable: true,
      value: payload.importedPath,
    },
    originalPath: {
      configurable: true,
      value: payload.originalPath,
    },
  });
  return file;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function fileFromEpubPayload(
  response: ReadEpubFileResponse | ImportedEpubFileResponse,
): File {
  const bytes = bytesFromBase64(response.bytesBase64);
  const fileBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBytes).set(bytes);
  const file = new File([fileBytes], response.fileName, {
    lastModified: Number(response.fileLastModified),
    type: 'application/epub+zip',
  });
  return attachImportedBookMetadata(file, response);
}

async function importEpubFileFromPath(filePath: string): Promise<File> {
  const response = await invoke<ImportedEpubFileResponse>('import_epub_file', {
    path: filePath,
  });
  return fileFromEpubPayload(response);
}

async function readImportedEpubFile(importedPath: string): Promise<File> {
  const response = await invoke<ReadEpubFileResponse>(
    'read_imported_epub_file',
    {
      importedPath,
    },
  );
  return fileFromEpubPayload(response);
}

function browserFileToImportedFile(file: File): File {
  return attachImportedBookMetadata(file, {
    id: crypto.randomUUID(),
    fileName: file.name,
    filePath: file.name,
    importedPath: file.name,
    originalPath: file.name,
    fileSize: file.size,
    fileLastModified: file.lastModified,
    bytesBase64: '',
  });
}

async function pickEpubPath(defaultPath?: string): Promise<string | null> {
  const selected = await openDialog({
    defaultPath,
    filters: [{ name: 'EPUB', extensions: ['epub'] }],
    multiple: false,
    title: 'Open EPUB',
  });
  return typeof selected === 'string' ? selected : null;
}

function isSameEpubFile(file: File, book: LastOpenedEpub): boolean {
  return (
    file.name === book.fileName &&
    file.size === book.fileSize &&
    file.lastModified === book.fileLastModified
  );
}

function readImportedBookId(file: File): string | undefined {
  const id = (file as File & { importedBookId?: unknown }).importedBookId;
  return typeof id === 'string' && id ? id : undefined;
}

function readImportedPath(file: File): string | undefined {
  const importedPath = (file as File & { importedPath?: unknown }).importedPath;
  return typeof importedPath === 'string' && importedPath
    ? importedPath
    : undefined;
}

function readOriginalPath(file: File): string | undefined {
  const originalPath = (file as File & { originalPath?: unknown }).originalPath;
  return typeof originalPath === 'string' && originalPath
    ? originalPath
    : undefined;
}

function shouldResumeEpubFile(file: File, book: LastOpenedEpub): boolean {
  return (
    Boolean(readImportedBookId(file) === book.id) ||
    Boolean(readImportedPath(file) === book.importedPath) ||
    isSameEpubFile(file, book)
  );
}

function formatLastOpenedTime(openedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(openedAt));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KB`;
  }

  return `${(kib / 1024).toFixed(1)} MB`;
}

function formatModifiedTime(modifiedSec: number | null): string {
  if (!modifiedSec) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(modifiedSec * 1000));
}

function findNextSectionSelector(
  items: ChapterListItem[],
  item: ChapterListItem | null,
): string {
  if (!item || item.kind !== 'toc' || !item.selector) {
    return '';
  }

  const currentIndex = chapterListItemIndex(items, item);
  if (currentIndex < 0) {
    return '';
  }

  for (const nextItem of items.slice(currentIndex + 1)) {
    if (nextItem.id !== item.id) {
      return '';
    }
    if (nextItem.kind === 'toc' && nextItem.selector) {
      return nextItem.selector;
    }
  }

  return '';
}

function formatSpeedLabel(speed: number): string {
  return `${speed.toFixed(2).replace(/\.?0+$/, '')}x`;
}

function readCssVariable(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

function readReaderTheme(): ReaderTheme {
  if (typeof window === 'undefined') {
    return DEFAULT_READER_THEME;
  }

  const root = document.documentElement;
  const styles = window.getComputedStyle(root);
  const isDark =
    root.classList.contains('dark') || styles.colorScheme === 'dark';

  return {
    background:
      readCssVariable(styles, '--background') ||
      DEFAULT_READER_THEME.background,
    foreground:
      readCssVariable(styles, '--foreground') ||
      DEFAULT_READER_THEME.foreground,
    mutedForeground:
      readCssVariable(styles, '--muted-foreground') ||
      DEFAULT_READER_THEME.mutedForeground,
    border: readCssVariable(styles, '--border') || DEFAULT_READER_THEME.border,
    fontFamily: styles.fontFamily || DEFAULT_READER_THEME.fontFamily,
    colorScheme: isDark ? 'dark' : 'light',
  };
}

function sameReaderTheme(a: ReaderTheme, b: ReaderTheme): boolean {
  return (
    a.background === b.background &&
    a.foreground === b.foreground &&
    a.mutedForeground === b.mutedForeground &&
    a.border === b.border &&
    a.fontFamily === b.fontFamily &&
    a.colorScheme === b.colorScheme
  );
}

function useReaderTheme(): ReaderTheme {
  const [theme, setTheme] = useState(readReaderTheme);

  useEffect(() => {
    const syncTheme = () => {
      setTheme((current) => {
        const next = readReaderTheme();
        return sameReaderTheme(current, next) ? current : next;
      });
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', syncTheme);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', syncTheme);
    };
  }, []);

  return theme;
}

function readerThemeCss(theme: ReaderTheme): string {
  return `:root {
	--epub-reader-background: ${theme.background};
	--epub-reader-foreground: ${theme.foreground};
	--epub-reader-muted-foreground: ${theme.mutedForeground};
	--epub-reader-border: ${theme.border};
	--epub-reader-font-family: ${theme.fontFamily};
	background: var(--epub-reader-background) !important;
	color: var(--epub-reader-foreground) !important;
	color-scheme: ${theme.colorScheme};
	font-family: var(--epub-reader-font-family) !important;
}

html,
body {
	min-height: 100%;
	background: var(--epub-reader-background) !important;
}

body {
	background: var(--epub-reader-background) !important;
	color: var(--epub-reader-foreground) !important;
}
`;
}

function readerCriticalStyle(theme: ReaderTheme): string {
  return `<style>${readerThemeCss(theme)}</style>`;
}

function readerDocumentStyle(theme: ReaderTheme): string {
  return `<style>${readerThemeCss(theme)}${readerDocumentCss}</style>`;
}

function emptyReaderDocument(theme: ReaderTheme): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>${readerDocumentStyle(theme)}</head><body></body></html>`;
}

function chapterDocument(
  chapter: EpubProcessedChapter,
  theme: ReaderTheme,
): string {
  const links = chapter.css
    .map(
      (part) => `<link rel="stylesheet" href=${JSON.stringify(part.href)} />`,
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>${readerCriticalStyle(theme)}${links}${readerDocumentStyle(theme)}</head><body>${chapter.html}</body></html>`;
}

function EpubReaderPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const deleteBookConfirmationTimeoutRef = useRef<number | null>(null);
  const epubRef = useRef<EpubFile | null>(null);
  const loadedChapterIdRef = useRef<string | null>(null);
  const autoOpenAttemptedImportedPathRef = useRef<string | null>(null);
  const readerTheme = useReaderTheme();
  const lastOpenedBook = useEpubStore((state) => state.lastOpenedBook);
  const lastOpenedBookRef = useRef<LastOpenedEpub | null>(lastOpenedBook);
  const setLastOpenedBook = useEpubStore((state) => state.setLastOpenedBook);
  const setLastOpenedBookChapter = useEpubStore(
    (state) => state.setLastOpenedBookChapter,
  );
  const clearLastOpenedBook = useEpubStore(
    (state) => state.clearLastOpenedBook,
  );

  const [bookTitle, setBookTitle] = useState('');
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [activeListItem, setActiveListItem] = useState<ChapterListItem | null>(
    null,
  );
  const [activeChapter, setActiveChapter] = useState<{
    id: string;
    chapter: EpubProcessedChapter;
    scrollSelector: string;
    scrollRequestId: number;
  } | null>(null);
  const [narrationScope, setNarrationScope] =
    useState<NarrationScope>('chapter');
  const [narrationStyle, setNarrationStyle] = useState('af_heart');
  const [narrationSpeed, setNarrationSpeed] = useState(1);
  const [narrationMode, setNarrationMode] = useState<
    'stream' | 'save-stream' | 'save-silent'
  >('save-stream');
  const [autoOpenStatus, setAutoOpenStatus] = useState('');
  const [importedBooks, setImportedBooks] = useState<ImportedEpubBook[]>([]);
  const [importedBooksError, setImportedBooksError] = useState('');
  const [isLoadingImportedBooks, setIsLoadingImportedBooks] = useState(false);
  const [deletingBookPath, setDeletingBookPath] = useState('');
  const [pendingDeleteBookPath, setPendingDeleteBookPath] = useState('');
  const [revealingBookPath, setRevealingBookPath] = useState('');
  const isShiftHeld = useShiftHeld();
  const [isBusy, setIsBusy] = useState(false);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const {
    audioUrl,
    clearPlayerSource,
    error: narrationError,
    generateStream,
    generatedDurationSec,
    isGenerating: isReadingAloud,
    play: playNarration,
    setError: setNarrationError,
  } = useSpeechStreamGeneration({ audioRef });
  const [estimatedDurationSec, setEstimatedDurationSec] = useState(0);
  const readerSrcDoc = useMemo(
    () =>
      activeChapter
        ? chapterDocument(activeChapter.chapter, readerTheme)
        : emptyReaderDocument(readerTheme),
    [activeChapter, readerTheme],
  );

  const itemsWithChildren = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (let i = 0; i < chapters.length - 1; i++) {
      const curr = chapters[i];
      const next = chapters[i + 1];
      if (
        curr.kind === 'toc' &&
        next?.kind === 'toc' &&
        next.depth > curr.depth
      ) {
        set.add(chapterListItemKey(curr));
      }
    }
    return set;
  }, [chapters]);

  const visibleChapters = useMemo<ChapterListItem[]>(() => {
    if (collapsedKeys.size === 0) return chapters;
    const result: ChapterListItem[] = [];
    const depthStack: number[] = [];
    for (const item of chapters) {
      const depth = item.kind === 'toc' ? item.depth : 0;
      while (
        depthStack.length > 0 &&
        (depthStack[depthStack.length - 1] ?? 0) >= depth
      ) {
        depthStack.pop();
      }
      if (depthStack.length === 0) {
        result.push(item);
      }
      if (collapsedKeys.has(chapterListItemKey(item))) {
        depthStack.push(depth);
      }
    }
    return result;
  }, [chapters, collapsedKeys]);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const disposeEpub = useCallback(() => {
    const current = epubRef.current;
    if (current) {
      current.destroy();
      epubRef.current = null;
    }
    loadedChapterIdRef.current = null;
    setChapters([]);
    setActiveListItem(null);
    setActiveChapter(null);
    setBookTitle('');
    setNarrationError('');
    setCollapsedKeys(new Set());
    clearPlayerSource();
  }, [clearPlayerSource, setNarrationError]);

  useEffect(() => {
    lastOpenedBookRef.current = lastOpenedBook;
  }, [lastOpenedBook]);

  useEffect(() => {
    return () => {
      if (deleteBookConfirmationTimeoutRef.current !== null) {
        window.clearTimeout(deleteBookConfirmationTimeoutRef.current);
      }
      const current = epubRef.current;
      if (current) {
        current.destroy();
        epubRef.current = null;
      }
      loadedChapterIdRef.current = null;
    };
  }, []);

  const clearBookDeleteConfirmation = useCallback(() => {
    if (deleteBookConfirmationTimeoutRef.current !== null) {
      window.clearTimeout(deleteBookConfirmationTimeoutRef.current);
      deleteBookConfirmationTimeoutRef.current = null;
    }
    setPendingDeleteBookPath('');
  }, []);

  const loadImportedBooks = useCallback(async () => {
    if (!isTauri()) {
      setImportedBooks([]);
      return;
    }

    setImportedBooksError('');
    setIsLoadingImportedBooks(true);

    try {
      const books = await invoke<ImportedEpubBook[]>(
        'list_imported_epub_books',
      );
      setImportedBooks(books);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setImportedBooksError(message);
    } finally {
      setIsLoadingImportedBooks(false);
    }
  }, []);

  useEffect(() => {
    void loadImportedBooks();
  }, [loadImportedBooks]);

  const scrollIframeToSelector = useCallback((selector: string) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      return;
    }
    if (!selector) {
      doc.defaultView?.scrollTo({ behavior: 'smooth', top: 0 });
      return;
    }
    const target = doc.querySelector(selector);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    if (!activeChapter || loadedChapterIdRef.current !== activeChapter.id) {
      return;
    }
    scrollIframeToSelector(activeChapter.scrollSelector);
  }, [activeChapter, scrollIframeToSelector]);

  const openChapter = useCallback(
    async (epub: EpubFile, id: string, scrollSelector: string) => {
      const processed = await epub.loadChapter(id);
      startTransition(() => {
        setActiveChapter((current) => ({
          id,
          chapter: processed,
          scrollSelector,
          scrollRequestId: (current?.scrollRequestId ?? 0) + 1,
        }));
      });
    },
    [],
  );

  const openEpubFile = useCallback(
    async (file: File, resumeBook: LastOpenedEpub | null = null) => {
      setError('');
      setIsBusy(true);
      disposeEpub();
      try {
        const epub = await initEpubFile(file);
        epubRef.current = epub;
        const meta = epub.getMetadata();
        const title = meta.title || file.name;
        setBookTitle(title);
        const list = buildChapterList(epub);
        setChapters(list);
        const resumedItem =
          resumeBook && shouldResumeEpubFile(file, resumeBook)
            ? list.find(
                (item) =>
                  chapterListItemKey(item) ===
                  resumeBook.activeChapter?.listItemKey,
              )
            : undefined;
        const itemToOpen = resumedItem ?? list[0];
        const activeChapterResume = itemToOpen
          ? chapterResumeFromItem(list, itemToOpen)
          : null;

        if (itemToOpen) {
          const selector = itemToOpen.kind === 'toc' ? itemToOpen.selector : '';
          setActiveListItem(itemToOpen);
          await openChapter(epub, itemToOpen.id, selector);
        }
        const importedPath =
          readImportedPath(file) ?? readFilePath(file) ?? file.name;
        autoOpenAttemptedImportedPathRef.current = importedPath;
        setLastOpenedBook({
          id: readImportedBookId(file) ?? crypto.randomUUID(),
          fileName: file.name,
          fileSize: file.size,
          fileLastModified: file.lastModified,
          importedPath,
          originalPath: readOriginalPath(file),
          title,
          activeChapter: activeChapterResume,
        });
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setIsBusy(false);
      }
    },
    [disposeEpub, openChapter, setLastOpenedBook],
  );

  const handleFileChange = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }

      try {
        setAutoOpenStatus('');
        const filePath = readFilePath(file);
        const fileToOpen =
          isTauri() && filePath
            ? await importEpubFileFromPath(filePath)
            : browserFileToImportedFile(file);
        await openEpubFile(fileToOpen);
        void loadImportedBooks();
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        setError(message);
      }
    },
    [loadImportedBooks, openEpubFile],
  );

  const handleChooseFile = useCallback(async () => {
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }

    try {
      setError('');
      setAutoOpenStatus('');
      const filePath = await pickEpubPath(lastOpenedBook?.originalPath);
      if (!filePath) {
        return;
      }

      const file = await importEpubFileFromPath(filePath);
      await openEpubFile(file, lastOpenedBook);
      void loadImportedBooks();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
    }
  }, [lastOpenedBook, loadImportedBooks, openEpubFile]);

  const lastOpenedImportedPath = lastOpenedBook?.importedPath;
  const openEpubFileRef = useRef(openEpubFile);

  useEffect(() => {
    openEpubFileRef.current = openEpubFile;
  }, [openEpubFile]);

  useEffect(() => {
    const bookToReopen = lastOpenedBookRef.current;
    const importedPath = lastOpenedImportedPath;
    if (
      !importedPath ||
      !bookToReopen ||
      !isTauri() ||
      autoOpenAttemptedImportedPathRef.current === importedPath
    ) {
      return;
    }

    let isCancelled = false;
    const pathToReopen = importedPath;
    autoOpenAttemptedImportedPathRef.current = pathToReopen;
    setAutoOpenStatus(`Opening ${bookToReopen.title} from app storage...`);

    async function reopenLastBook() {
      try {
        const file = await readImportedEpubFile(pathToReopen);
        if (isCancelled) {
          return;
        }

        await openEpubFileRef.current(file, bookToReopen);
        if (!isCancelled) {
          setAutoOpenStatus('');
        }
      } catch (caught) {
        if (isCancelled) {
          return;
        }

        const message =
          caught instanceof Error ? caught.message : String(caught);
        setAutoOpenStatus(`Could not reopen the imported EPUB: ${message}`);
      }
    }

    void reopenLastBook();

    return () => {
      isCancelled = true;
    };
  }, [lastOpenedImportedPath]);

  const handleOpenImportedBook = useCallback(
    async (book: ImportedEpubBook) => {
      if (isBusy) {
        return;
      }

      setError('');
      setImportedBooksError('');
      setAutoOpenStatus('');

      try {
        const file = await readImportedEpubFile(book.path);
        await openEpubFile(file, lastOpenedBookRef.current);
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        setImportedBooksError(message);
      }
    },
    [isBusy, openEpubFile],
  );

  const handleRevealImportedBook = useCallback(
    async (book: ImportedEpubBook) => {
      if (revealingBookPath) {
        return;
      }

      setImportedBooksError('');
      setRevealingBookPath(book.path);

      try {
        await invoke('reveal_imported_epub_book', { importedPath: book.path });
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        setImportedBooksError(message);
      } finally {
        setRevealingBookPath('');
      }
    },
    [revealingBookPath],
  );

  const handleDeleteImportedBook = useCallback(
    async (book: ImportedEpubBook, options?: { skipConfirm?: boolean }) => {
      if (deletingBookPath) {
        return;
      }

      setError('');
      setImportedBooksError('');

      if (!options?.skipConfirm && pendingDeleteBookPath !== book.path) {
        clearBookDeleteConfirmation();
        setPendingDeleteBookPath(book.path);
        deleteBookConfirmationTimeoutRef.current = window.setTimeout(() => {
          setPendingDeleteBookPath((currentPath) =>
            currentPath === book.path ? '' : currentPath,
          );
          deleteBookConfirmationTimeoutRef.current = null;
        }, 2000);
        return;
      }

      clearBookDeleteConfirmation();
      setDeletingBookPath(book.path);

      try {
        await invoke('delete_imported_epub_book', {
          importedPath: book.path,
        });
        setImportedBooks((books) =>
          books.filter((savedBook) => savedBook.path !== book.path),
        );

        if (lastOpenedBookRef.current?.importedPath === book.path) {
          clearLastOpenedBook();
          disposeEpub();
          setAutoOpenStatus('');
        }
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        setImportedBooksError(message);
      } finally {
        setDeletingBookPath('');
      }
    },
    [
      clearBookDeleteConfirmation,
      clearLastOpenedBook,
      deletingBookPath,
      disposeEpub,
      pendingDeleteBookPath,
    ],
  );

  const onPickChapter = async (item: ChapterListItem) => {
    const epub = epubRef.current;
    if (!epub) {
      return;
    }
    setError('');
    setNarrationError('');
    const selector = item.kind === 'toc' ? item.selector : '';
    if (activeChapter?.id === item.id) {
      setActiveListItem(item);
      setActiveChapter((current) =>
        current
          ? {
              ...current,
              scrollSelector: selector,
              scrollRequestId: current.scrollRequestId + 1,
            }
          : current,
      );
      setLastOpenedBookChapter(chapterResumeFromItem(chapters, item));
      return;
    }
    setIsBusy(true);
    try {
      setActiveListItem(item);
      await openChapter(epub, item.id, selector);
      setLastOpenedBookChapter(chapterResumeFromItem(chapters, item));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  const buildNarrationText = useCallback(() => {
    if (!activeChapter) {
      return '';
    }

    const iframeDoc = iframeRef.current?.contentDocument ?? null;

    if (narrationScope === 'selection') {
      return extractSelectedSpeechText(iframeDoc);
    }

    if (
      narrationScope === 'section' &&
      activeListItem?.kind === 'toc' &&
      activeListItem.selector
    ) {
      const scope = {
        startSelector: activeListItem.selector,
        endSelector: findNextSectionSelector(chapters, activeListItem),
      };
      return iframeDoc
        ? extractSpeechTextFromDocument(iframeDoc, scope)
        : extractSpeechTextFromChapterHtml(activeChapter.chapter.html, scope);
    }

    return iframeDoc
      ? extractSpeechTextFromDocument(iframeDoc)
      : extractSpeechTextFromChapterHtml(activeChapter.chapter.html);
  }, [activeChapter, activeListItem, chapters, narrationScope]);

  const buildNarrationOutputNames = useCallback(() => {
    const itemIndex = chapterListItemIndex(chapters, activeListItem);
    const numberPrefix =
      itemIndex >= 0 ? `${String(itemIndex + 1).padStart(3, '0')} - ` : '';
    const chapterLabel = activeListItem?.label || 'Current chapter';
    const scopeLabel =
      narrationScope === 'selection'
        ? 'Selection'
        : narrationScope === 'section'
          ? 'Section'
          : 'Chapter';

    return {
      outputLabel: `${numberPrefix}${chapterLabel} - ${scopeLabel} - ${narrationStyle} - ${formatSpeedLabel(narrationSpeed)}`,
      outputSubdir: `books/${bookTitle || 'Untitled book'}`,
    };
  }, [
    activeListItem,
    bookTitle,
    chapters,
    narrationScope,
    narrationSpeed,
    narrationStyle,
  ]);

  const handleReadAloud = async () => {
    const text = buildNarrationText();
    if (!text) {
      setNarrationError(
        narrationScope === 'selection'
          ? 'Select text in the reading pane before reading a selection.'
          : 'This EPUB section did not contain readable text.',
      );
      return;
    }

    setEstimatedDurationSec(estimateAudioDurationSec(text, narrationSpeed));
    await generateStream({
      text,
      style: narrationStyle,
      speed: narrationSpeed,
      saveToDisk: narrationMode !== 'stream',
      streamAudio: narrationMode !== 'save-silent',
      ...buildNarrationOutputNames(),
    });
  };

  const sectionScopeUnavailable =
    activeListItem?.kind !== 'toc' || !activeListItem.selector;
  const isNarrationBusy = isReadingAloud;

  const activeIndex = chapterListItemIndex(chapters, activeListItem);
  const prevChapter =
    activeIndex > 0 ? (chapters[activeIndex - 1] ?? null) : null;
  const nextChapter =
    activeIndex >= 0 && activeIndex < chapters.length - 1
      ? (chapters[activeIndex + 1] ?? null)
      : null;

  return (
    <main className='min-h-[calc(100vh-4.5rem)] @3xl/content:p-6 p-4'>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
        <div className='pb-2'>
          <div className='space-y-1'>
            <h1 className='font-semibold text-2xl tracking-tight'>
              EPUB reader
            </h1>
            <p className='max-w-2xl text-muted-foreground text-sm'>
              Open an EPUB, browse the table of contents, and read chapters
              inline.
            </p>
          </div>
        </div>

        <div className='grid min-w-0 grid-cols-1 gap-4 @5xl/content:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]'>
          <Tabs
            defaultValue='library'
            className='flex min-w-0 flex-col gap-3 @5xl/content:self-start'
          >
            <TabsList className='grid h-9 w-full grid-cols-2'>
              <TabsTrigger value='library' className='h-7'>
                <BookOpen className='size-4' aria-hidden='true' />
                Library
              </TabsTrigger>
              <TabsTrigger value='narration' className='h-7'>
                <AudioLinesIcon className='size-4' aria-hidden='true' />
                Narration
              </TabsTrigger>
              <TabsIndicator />
            </TabsList>

            <TabsContent value='library' className='min-w-0'>
              <Card className='min-w-0 shadow-sm backdrop-blur'>
                <CardHeader className='space-y-1'>
                  <CardTitle className='flex items-center gap-2 text-base'>
                    <BookOpen className='size-4 text-muted-foreground' />
                    Library
                  </CardTitle>
                </CardHeader>
                <CardContent className='grid gap-4 pt-4'>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='.epub,application/epub+zip'
                    className='sr-only'
                    aria-label='Choose EPUB file'
                    onChange={(event) => {
                      const next = event.target.files?.[0];
                      void handleFileChange(next);
                      event.target.value = '';
                    }}
                  />
                  <div className='space-y-2'>
                    <Label htmlFor='epub-file-trigger'>EPUB file</Label>
                    <Button
                      id='epub-file-trigger'
                      type='button'
                      variant='secondary'
                      className='w-full'
                      disabled={isBusy}
                      onClick={() => {
                        void handleChooseFile();
                      }}
                    >
                      {isBusy ? (
                        <LoaderCircle className='size-4 animate-spin' />
                      ) : (
                        <Upload className='size-4' />
                      )}
                      Choose file…
                    </Button>
                  </div>

                  {autoOpenStatus && !bookTitle ? (
                    <div className='rounded-md border px-3 py-2 text-muted-foreground text-sm'>
                      {autoOpenStatus}
                    </div>
                  ) : null}

                  {lastOpenedBook && !bookTitle ? (
                    <div className='rounded-md border px-3 py-2 text-sm'>
                      <p className='font-medium leading-snug'>
                        Last opened: {lastOpenedBook.title}
                      </p>
                      <p className='text-muted-foreground text-xs leading-5'>
                        {lastOpenedBook.fileName} ·{' '}
                        {formatLastOpenedTime(lastOpenedBook.openedAt)}
                        {lastOpenedBook.activeChapter
                          ? ` · ${lastOpenedBook.activeChapter.label}`
                          : ''}
                      </p>
                      <p className='text-muted-foreground text-xs leading-5'>
                        Opening this EPUB automatically from app storage.
                      </p>
                    </div>
                  ) : null}

                  {bookTitle ? (
                    <p className='font-medium text-sm leading-snug'>
                      {bookTitle}
                    </p>
                  ) : null}

                  {error ? (
                    <div className='rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
                      {error}
                    </div>
                  ) : null}

                  <div className='grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-muted-foreground text-xs'>
                    <div className='h-px bg-border' />
                    <span>or</span>
                    <div className='h-px bg-border' />
                  </div>

                  <div className='grid gap-2'>
                    <div className='flex items-center justify-between gap-3'>
                      <p className='font-medium text-sm'>Open copied book</p>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        onClick={() => void loadImportedBooks()}
                        disabled={isLoadingImportedBooks}
                        aria-label='Refresh copied books'
                        title='Refresh copied books'
                      >
                        <RefreshCw
                          className={
                            isLoadingImportedBooks
                              ? 'size-4 animate-spin'
                              : 'size-4'
                          }
                        />
                      </Button>
                    </div>

                    {importedBooksError ? (
                      <div className='rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
                        {importedBooksError}
                      </div>
                    ) : null}

                    {importedBooks.length > 0 ? (
                      <div className='max-h-64 overflow-y-auto pr-1'>
                        {importedBooks.map((book) => {
                          const isActive =
                            lastOpenedBook?.importedPath === book.path;
                          const isDeleting = deletingBookPath === book.path;
                          const isRevealing = revealingBookPath === book.path;
                          const isConfirmingDelete =
                            pendingDeleteBookPath === book.path;

                          return (
                            <FileRowContextMenu
                              key={book.path}
                              className='grid grid-cols-[1fr_auto] items-center gap-3 border-b py-2 last:border-b-0'
                              actions={[
                                {
                                  key: 'open',
                                  label: 'Open',
                                  icon: <BookOpen />,
                                  onSelect: () =>
                                    void handleOpenImportedBook(book),
                                  disabled: isBusy || isDeleting,
                                },
                                {
                                  key: 'reveal',
                                  label: 'Reveal in Finder',
                                  icon: <FolderOpen />,
                                  onSelect: () =>
                                    void handleRevealImportedBook(book),
                                  disabled:
                                    isDeleting || Boolean(revealingBookPath),
                                },
                                {
                                  key: 'delete',
                                  label: isConfirmingDelete
                                    ? 'Confirm delete'
                                    : 'Delete',
                                  icon: <Trash2 />,
                                  onSelect: () =>
                                    void handleDeleteImportedBook(book),
                                  disabled: Boolean(deletingBookPath),
                                  destructive: true,
                                },
                              ]}
                            >
                              <div className='min-w-0'>
                                <p className='truncate font-medium text-sm'>
                                  {book.id}
                                </p>
                                <p className='truncate text-muted-foreground text-xs'>
                                  {book.name} ·{' '}
                                  {formatModifiedTime(book.modifiedSec)} ·{' '}
                                  {formatFileSize(book.sizeBytes)}
                                </p>
                              </div>
                              <div className='flex items-center gap-2'>
                                <Button
                                  type='button'
                                  variant={isActive ? 'secondary' : 'ghost'}
                                  size='icon-sm'
                                  onClick={() =>
                                    void handleOpenImportedBook(book)
                                  }
                                  disabled={isBusy || isDeleting}
                                  aria-label={`Open ${book.id}`}
                                  title={`Open ${book.id}`}
                                >
                                  {isBusy && isActive ? (
                                    <LoaderCircle className='size-4 animate-spin' />
                                  ) : (
                                    <BookOpen className='size-4' />
                                  )}
                                </Button>
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon-sm'
                                  className={quickActionClass(
                                    isShiftHeld,
                                    isRevealing,
                                  )}
                                  onClick={() =>
                                    void handleRevealImportedBook(book)
                                  }
                                  disabled={
                                    isDeleting || Boolean(revealingBookPath)
                                  }
                                  aria-label={`Reveal ${book.id} in Finder`}
                                  title='Reveal in Finder'
                                >
                                  {isRevealing ? (
                                    <LoaderCircle className='size-4 animate-spin' />
                                  ) : (
                                    <FolderOpen className='size-4' />
                                  )}
                                </Button>
                                <Button
                                  type='button'
                                  variant={
                                    isConfirmingDelete ? 'destructive' : 'ghost'
                                  }
                                  size='icon-sm'
                                  className={quickActionClass(
                                    isShiftHeld,
                                    isConfirmingDelete || isDeleting,
                                  )}
                                  onClick={(event) =>
                                    void handleDeleteImportedBook(book, {
                                      skipConfirm: event.shiftKey,
                                    })
                                  }
                                  disabled={Boolean(deletingBookPath)}
                                  aria-label={
                                    isConfirmingDelete
                                      ? `Confirm delete ${book.id}`
                                      : `Delete ${book.id}`
                                  }
                                  title={
                                    isConfirmingDelete ? 'Confirm?' : 'Delete'
                                  }
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
                      <p className='py-2 text-muted-foreground text-sm'>
                        {isLoadingImportedBooks
                          ? 'Loading copied books...'
                          : 'Imported EPUBs will appear here.'}
                      </p>
                    )}
                  </div>

                  <div className='max-h-[min(42dvh,520px)] space-y-0 overflow-y-auto rounded-lg @5xl/content:max-h-[min(60dvh,520px)]'>
                    {chapters.length === 0 ? (
                      <p className='p-3 text-muted-foreground text-sm'>
                        No chapters yet. Choose an EPUB to list its spine or
                        table of contents.
                      </p>
                    ) : (
                      <ul className='divide-y'>
                        {visibleChapters.map((item) => {
                          const key = chapterListItemKey(item);
                          const isInCurrentChapter =
                            activeChapter?.id === item.id;
                          const hasChildren = itemsWithChildren.has(key);
                          const isCollapsed = collapsedKeys.has(key);
                          const ItemIcon = isInCurrentChapter
                            ? Section
                            : FileText;

                          return (
                            <li key={key}>
                              <div className='flex w-full items-stretch'>
                                <button
                                  type='button'
                                  className='flex min-w-0 flex-1 items-start gap-2 py-2 pr-2 text-left text-sm hover:bg-muted/60'
                                  style={{
                                    paddingLeft:
                                      item.kind === 'toc'
                                        ? `${12 + item.depth * 12}px`
                                        : '12px',
                                  }}
                                  onClick={() => void onPickChapter(item)}
                                >
                                  <ItemIcon
                                    className='mt-0.5 size-4 shrink-0 text-muted-foreground'
                                    aria-hidden='true'
                                  />
                                  <span className='leading-snug'>
                                    {item.label}
                                  </span>
                                </button>
                                {hasChildren ? (
                                  <button
                                    type='button'
                                    className='flex shrink-0 items-center px-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                                    onClick={() => toggleCollapsed(key)}
                                    aria-label={
                                      isCollapsed
                                        ? `Expand ${item.label}`
                                        : `Collapse ${item.label}`
                                    }
                                    title={isCollapsed ? 'Expand' : 'Collapse'}
                                  >
                                    {isCollapsed ? (
                                      <ChevronRight className='size-3.5' />
                                    ) : (
                                      <ChevronDown className='size-3.5' />
                                    )}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='narration' className='min-w-0'>
              <Card className='min-w-0 shadow-sm backdrop-blur'>
                <CardHeader className='space-y-1'>
                  <CardTitle className='flex items-center gap-2 text-base'>
                    <AudioLinesIcon className='size-4 text-muted-foreground' />
                    Narration
                  </CardTitle>
                </CardHeader>
                <CardContent className='grid gap-4 pt-4'>
                  <div className='grid gap-3'>
                    <div className='space-y-2'>
                      <Label htmlFor='epub-narration-scope'>Scope</Label>
                      <Select
                        value={narrationScope}
                        onValueChange={(value) =>
                          setNarrationScope(value as NarrationScope)
                        }
                      >
                        <SelectTrigger
                          id='epub-narration-scope'
                          className='w-full'
                          aria-label='Narration scope'
                        >
                          <SelectValue>
                            {(value: string | null) =>
                              value === 'section'
                                ? 'Current section'
                                : value === 'selection'
                                  ? 'Selected text'
                                  : 'Current chapter'
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='chapter' label='Current chapter'>
                            Current chapter
                          </SelectItem>
                          <SelectItem
                            value='section'
                            label='Current section'
                            disabled={sectionScopeUnavailable}
                          >
                            Current section
                          </SelectItem>
                          <SelectItem value='selection' label='Selected text'>
                            Selected text
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className='space-y-2'>
                      <Label htmlFor='epub-voice-select'>Voice</Label>
                      <Select
                        value={narrationStyle}
                        onValueChange={(value) =>
                          setNarrationStyle(value ?? '')
                        }
                      >
                        <SelectTrigger
                          id='epub-voice-select'
                          className='w-full'
                          aria-label='Narration voice'
                        >
                          <SelectValue>
                            {(value: string | null) =>
                              VOICE_OPTIONS.find((v) => v.value === value)
                                ?.label ?? value
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
                                  <Badge
                                    variant='secondary'
                                    className='text-[10px]'
                                  >
                                    {voice.badge}
                                  </Badge>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className='space-y-3'>
                      <div className='flex items-center justify-between gap-3'>
                        <Label htmlFor='epub-speed-slider'>Speed</Label>
                        <span className='text-muted-foreground text-xs'>
                          {formatSpeedLabel(narrationSpeed)}
                        </span>
                      </div>
                      <Slider
                        id='epub-speed-slider'
                        min={0.7}
                        max={1.4}
                        step={0.05}
                        value={[narrationSpeed]}
                        onValueChange={(value) => {
                          setNarrationSpeed(
                            Array.isArray(value) ? (value[0] ?? 1) : value,
                          );
                        }}
                        aria-label='Narration speed'
                      />
                    </div>

                    <div className='space-y-2'>
                      <Label>Playback mode</Label>
                      <RadioGroup
                        value={narrationMode}
                        onValueChange={(value) =>
                          setNarrationMode(
                            value as 'stream' | 'save-stream' | 'save-silent',
                          )
                        }
                        className='gap-2'
                      >
                        <label
                          htmlFor='epub-mode-stream'
                          className='flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50 has-[[data-checked]]:border-primary/50 has-[[data-checked]]:bg-primary/5'
                        >
                          <RadioGroupItem
                            id='epub-mode-stream'
                            value='stream'
                            className='mt-0.5 shrink-0'
                          />
                          <div className='grid gap-0.5'>
                            <span className='font-medium text-sm leading-none'>
                              Stream only
                            </span>
                            <span className='text-muted-foreground text-xs'>
                              Play immediately, no file saved
                            </span>
                          </div>
                        </label>

                        <label
                          htmlFor='epub-mode-save-stream'
                          className='flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50 has-[[data-checked]]:border-primary/50 has-[[data-checked]]:bg-primary/5'
                        >
                          <RadioGroupItem
                            id='epub-mode-save-stream'
                            value='save-stream'
                            className='mt-0.5 shrink-0'
                          />
                          <div className='grid gap-0.5'>
                            <span className='font-medium text-sm leading-none'>
                              Save &amp; stream
                            </span>
                            <span className='text-muted-foreground text-xs'>
                              Save WAV and stream audio while synthesizing
                            </span>
                          </div>
                        </label>

                        <label
                          htmlFor='epub-mode-save-silent'
                          className='flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50 has-[[data-checked]]:border-primary/50 has-[[data-checked]]:bg-primary/5'
                        >
                          <RadioGroupItem
                            id='epub-mode-save-silent'
                            value='save-silent'
                            className='mt-0.5 shrink-0'
                          />
                          <div className='grid gap-0.5'>
                            <span className='font-medium text-sm leading-none'>
                              Save silently
                            </span>
                            <span className='text-muted-foreground text-xs'>
                              Save WAV without auto-playing — use Play for full
                              spatial audio
                            </span>
                          </div>
                        </label>
                      </RadioGroup>
                    </div>
                  </div>

                  {narrationError ? (
                    <div className='rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
                      {narrationError}
                    </div>
                  ) : null}

                  <Button
                    type='button'
                    className='w-full'
                    onClick={() => void handleReadAloud()}
                    disabled={!activeChapter || isNarrationBusy}
                  >
                    {isNarrationBusy ? (
                      <LoaderCircle className='size-4 animate-spin' />
                    ) : narrationMode === 'save-silent' ? (
                      <Save className='size-4' />
                    ) : (
                      <AudioLinesIcon className='size-4' />
                    )}
                    {isNarrationBusy
                      ? narrationMode === 'save-silent'
                        ? 'Saving…'
                        : 'Reading…'
                      : narrationMode === 'save-silent'
                        ? 'Save audio'
                        : 'Read aloud'}
                  </Button>

                  {isNarrationBusy && estimatedDurationSec > 0 ? (
                    <div className='grid gap-1'>
                      <Progress
                        value={Math.round(
                          Math.min(
                            generatedDurationSec / estimatedDurationSec,
                            0.95,
                          ) * 100,
                        )}
                      />
                      <p className='text-muted-foreground text-xs tabular-nums'>
                        {formatDuration(generatedDurationSec)} generated ·{' '}
                        ~
                        {formatDuration(
                          Math.max(
                            estimatedDurationSec - generatedDurationSec,
                            0,
                          ),
                        )}{' '}
                        remaining
                      </p>
                    </div>
                  ) : null}

                  <div className='grid gap-2'>
                    {/* biome-ignore lint/a11y/useMediaCaption: Generated narration does not have captions yet. */}
                    <audio
                      ref={audioRef}
                      controls
                      preload='auto'
                      src={audioUrl || undefined}
                      aria-label='EPUB narration preview'
                      className='h-10 w-full'
                    />
                    <Button
                      type='button'
                      variant='outline'
                      className='w-full'
                      onClick={playNarration}
                      disabled={!audioUrl || isNarrationBusy}
                    >
                      <FileAudio className='size-4' />
                      Play again
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <Card className='flex min-w-0 flex-col border-border/70 shadow-sm backdrop-blur'>
            <CardHeader className='flex flex-row items-center justify-between'>
              <CardTitle className='text-base'>Reading pane</CardTitle>
              <div className='flex items-center gap-1'>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => prevChapter && void onPickChapter(prevChapter)}
                  disabled={!prevChapter || isBusy || isNarrationBusy}
                  aria-label='Previous chapter'
                  title='Previous chapter'
                >
                  <ChevronLeft className='size-4' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => nextChapter && void onPickChapter(nextChapter)}
                  disabled={!nextChapter || isBusy || isNarrationBusy}
                  aria-label='Next chapter'
                  title='Next chapter'
                >
                  <ChevronRight className='size-4' />
                </Button>
              </div>
            </CardHeader>
            <CardContent className='flex min-w-0 grow flex-col'>
              <div className='grow overflow-hidden rounded-lg bg-background'>
                <iframe
                  ref={iframeRef}
                  title='EPUB chapter'
                  className='h-full min-h-[65vh] w-full border-0 bg-background'
                  sandbox='allow-same-origin'
                  srcDoc={readerSrcDoc}
                  style={{ colorScheme: readerTheme.colorScheme }}
                  onLoad={() => {
                    if (activeChapter) {
                      loadedChapterIdRef.current = activeChapter.id;
                      scrollIframeToSelector(activeChapter.scrollSelector);
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
