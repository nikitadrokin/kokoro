import { createFileRoute } from '@tanstack/react-router';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  AudioLinesIcon,
  ChevronLeft,
  ChevronRight,
  FileAudio,
  FileText,
  LoaderCircle,
  Minus,
  Plus,
  Save,
  Square,
  Upload,
} from 'lucide-react';
import type {
  PDFDocumentProxy,
  TextLayer as PdfJsTextLayer,
  RenderTask,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSpeechStreamGeneration } from '@/hooks/use-speech-stream-generation';
import {
  buildPdfSpeechText,
  extractPdfPageText,
  hasExtractablePdfText,
  type PdfTextItemLike,
} from '@/lib/pdf-text';
import { estimateAudioDurationSec, formatDuration } from '@/lib/speech-audio';
import { VOICE_OPTIONS } from '@/lib/voice-options';
import { type LastOpenedPdf, usePdfStore } from '@/stores/pdf-store';
import './pdf-reader.css';

export const Route = createFileRoute('/pdf')({ component: PdfReaderPage });

let pdfJsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfJs() {
  pdfJsPromise ??= import('pdfjs-dist');
  const pdfJs = await pdfJsPromise;
  pdfJs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfJs;
}

type NarrationScope = 'page' | 'document';
type NarrationMode = 'stream' | 'save-stream' | 'save-silent';

type PdfFilePayload = {
  fileName: string;
  filePath: string;
  fileSize: number;
  fileLastModified: number;
  bytesBase64: string;
};

type PdfSource = {
  bytes: Uint8Array;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileLastModified: number;
};

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function filePath(file: File): string {
  const path = (file as File & { path?: unknown }).path;
  return typeof path === 'string' && path ? path : file.name;
}

function pdfSourceFromFile(file: File, bytes: Uint8Array): PdfSource {
  return {
    bytes,
    fileName: file.name,
    filePath: filePath(file),
    fileSize: file.size,
    fileLastModified: file.lastModified,
  };
}

async function readPdfPath(path: string): Promise<PdfSource> {
  const payload = await invoke<PdfFilePayload>('read_pdf_file', { path });
  return {
    bytes: bytesFromBase64(payload.bytesBase64),
    fileName: payload.fileName,
    filePath: payload.filePath,
    fileSize: payload.fileSize,
    fileLastModified: Number(payload.fileLastModified),
  };
}

async function pickPdfPath(defaultPath?: string): Promise<string | null> {
  const selected = await openDialog({
    defaultPath,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    multiple: false,
    title: 'Open PDF',
  });
  return typeof selected === 'string' ? selected : null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  return `${(kib / 1024).toFixed(1)} MB`;
}

function formatSpeedLabel(speed: number): string {
  return `${speed.toFixed(2).replace(/\.?0+$/, '')}x`;
}

function metadataTitle(info: object, fallback: string): string {
  const title = (info as { Title?: unknown }).Title;
  return typeof title === 'string' && title.trim() ? title.trim() : fallback;
}

function textItemForExtraction(item: unknown): PdfTextItemLike | null {
  if (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof (item as { str?: unknown }).str === 'string' &&
    'transform' in item &&
    'width' in item &&
    'height' in item
  ) {
    return item as PdfTextItemLike;
  }
  return null;
}

function PdfReaderPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageSurfaceRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const openingRequestRef = useRef(0);
  const autoOpenAttemptedPathRef = useRef('');
  const lastOpenedPdf = usePdfStore((state) => state.lastOpenedPdf);
  const lastOpenedPdfRef = useRef<LastOpenedPdf | null>(lastOpenedPdf);
  const setLastOpenedPdf = usePdfStore((state) => state.setLastOpenedPdf);
  const setLastOpenedPdfPage = usePdfStore(
    (state) => state.setLastOpenedPdfPage,
  );

  const [title, setTitle] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1.15);
  const [isOpening, setIsOpening] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [extractedPageCount, setExtractedPageCount] = useState(0);
  const [error, setError] = useState('');
  const [autoOpenStatus, setAutoOpenStatus] = useState('');
  const [narrationScope, setNarrationScope] = useState<NarrationScope>('page');
  const [narrationStyle, setNarrationStyle] = useState('af_heart');
  const [narrationSpeed, setNarrationSpeed] = useState(1);
  const [narrationMode, setNarrationMode] =
    useState<NarrationMode>('save-stream');
  const [estimatedDurationSec, setEstimatedDurationSec] = useState(0);
  const {
    audioUrl,
    clearPlayerSource,
    error: narrationError,
    generateStream,
    generatedDurationSec,
    isGenerating: isNarrating,
    play: playNarration,
    setError: setNarrationError,
    stopGeneration,
  } = useSpeechStreamGeneration({ audioRef });

  const hasTextLayer = useMemo(
    () => pageTexts.length > 0 && hasExtractablePdfText(pageTexts),
    [pageTexts],
  );
  const extractionComplete = pageCount > 0 && pageTexts.length === pageCount;
  const currentPageText = pageTexts[pageNumber - 1] ?? '';
  const optimizedCurrentPageText = useMemo(
    () => buildPdfSpeechText([currentPageText]),
    [currentPageText],
  );

  useEffect(() => {
    lastOpenedPdfRef.current = lastOpenedPdf;
  }, [lastOpenedPdf]);

  useEffect(() => {
    return () => {
      openingRequestRef.current += 1;
      const document = documentRef.current;
      documentRef.current = null;
      if (document) void document.loadingTask.destroy();
    };
  }, []);

  const openPdf = useCallback(
    async (source: PdfSource, resume: LastOpenedPdf | null = null) => {
      const requestId = openingRequestRef.current + 1;
      openingRequestRef.current = requestId;
      setError('');
      setNarrationError('');
      setIsOpening(true);
      setExtractedPageCount(0);
      setPageTexts([]);
      setTitle('');
      setFileName('');
      setFileSize(0);
      setPageCount(0);
      setPageNumber(1);
      clearPlayerSource();

      const previousDocument = documentRef.current;
      documentRef.current = null;
      if (previousDocument) await previousDocument.loadingTask.destroy();

      try {
        const { getDocument } = await loadPdfJs();
        const loadingTask = getDocument({ data: copyBytes(source.bytes) });
        const document = await loadingTask.promise;
        if (openingRequestRef.current !== requestId) {
          await document.loadingTask.destroy();
          return;
        }

        documentRef.current = document;
        setDocumentVersion(requestId);
        const metadata = await document.getMetadata();
        const documentTitle = metadataTitle(metadata.info, source.fileName);
        const resumedPage =
          resume?.filePath === source.filePath
            ? Math.min(Math.max(resume.pageNumber, 1), document.numPages)
            : 1;

        setTitle(documentTitle);
        setFileName(source.fileName);
        setFileSize(source.fileSize);
        setPageCount(document.numPages);
        setPageNumber(resumedPage);
        autoOpenAttemptedPathRef.current = source.filePath;
        setLastOpenedPdf({
          fileName: source.fileName,
          filePath: source.filePath,
          fileSize: source.fileSize,
          fileLastModified: source.fileLastModified,
          title: documentTitle,
          pageNumber: resumedPage,
        });

        const extracted: string[] = [];
        for (let index = 1; index <= document.numPages; index += 1) {
          if (openingRequestRef.current !== requestId) return;
          const page = await document.getPage(index);
          const textContent = await page.getTextContent();
          extracted.push(
            extractPdfPageText(
              textContent.items
                .map(textItemForExtraction)
                .filter((item): item is PdfTextItemLike => item !== null),
            ),
          );
          setExtractedPageCount(index);
        }

        if (openingRequestRef.current === requestId) {
          setPageTexts(extracted);
          if (!hasExtractablePdfText(extracted)) {
            setNarrationError(
              'No readable text layer was found. Scanned or image-only PDFs need OCR and are not supported yet.',
            );
          }
        }
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        if (openingRequestRef.current === requestId) setError(message);
      } finally {
        if (openingRequestRef.current === requestId) setIsOpening(false);
      }
    },
    [clearPlayerSource, setLastOpenedPdf, setNarrationError],
  );

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    const pageSurface = pageSurfaceRef.current;
    const textLayerContainer = textLayerRef.current;
    if (
      documentVersion === 0 ||
      !document ||
      !canvas ||
      !pageSurface ||
      !textLayerContainer ||
      pageNumber < 1 ||
      pageNumber > pageCount
    )
      return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayerTask: PdfJsTextLayer | null = null;
    let textLayerFinished = false;
    const renderCanvas = canvas;
    const renderSurface = pageSurface;
    const renderTextLayer = textLayerContainer;
    setIsRendering(true);

    async function renderPage() {
      try {
        const page = await document?.getPage(pageNumber);
        if (!page || cancelled) return;
        const viewport = page.getViewport({ scale: zoom });
        const outputScale = window.devicePixelRatio || 1;
        const { TextLayer } = await loadPdfJs();
        if (cancelled) return;

        renderSurface.style.width = `${Math.floor(viewport.width)}px`;
        renderSurface.style.height = `${Math.floor(viewport.height)}px`;
        renderSurface.style.setProperty(
          '--scale-factor',
          String(viewport.scale),
        );
        renderSurface.style.setProperty('--user-unit', String(page.userUnit));
        renderCanvas.width = Math.floor(viewport.width * outputScale);
        renderCanvas.height = Math.floor(viewport.height * outputScale);
        renderCanvas.style.width = `${Math.floor(viewport.width)}px`;
        renderCanvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTextLayer.replaceChildren();
        textLayerTask = new TextLayer({
          textContentSource: page.streamTextContent({
            includeMarkedContent: true,
            disableNormalization: true,
          }),
          container: renderTextLayer,
          viewport,
        });
        renderTask = page.render({
          canvas: renderCanvas,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await Promise.all([renderTask.promise, textLayerTask.render()]);
        textLayerFinished = true;
      } catch (caught) {
        if (
          !cancelled &&
          (!(caught instanceof Error) ||
            !['AbortException', 'RenderingCancelledException'].includes(
              caught.name,
            ))
        ) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    }

    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      if (!textLayerFinished) textLayerTask?.cancel();
      renderTextLayer.replaceChildren();
    };
  }, [documentVersion, pageCount, pageNumber, zoom]);

  const selectPage = useCallback(
    (nextPage: number) => {
      const clamped = Math.min(Math.max(nextPage, 1), pageCount);
      if (!pageCount || clamped === pageNumber) return;
      setPageNumber(clamped);
      setLastOpenedPdfPage(clamped);
      setNarrationError('');
    },
    [pageCount, pageNumber, setLastOpenedPdfPage, setNarrationError],
  );

  const handleBrowserFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setAutoOpenStatus('');
      const bytes = new Uint8Array(await file.arrayBuffer());
      await openPdf(pdfSourceFromFile(file, bytes));
    },
    [openPdf],
  );

  const handleChooseFile = useCallback(async () => {
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }

    try {
      setError('');
      setAutoOpenStatus('');
      const path = await pickPdfPath(lastOpenedPdf?.filePath);
      if (!path) return;
      const source = await readPdfPath(path);
      await openPdf(source, lastOpenedPdfRef.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [lastOpenedPdf, openPdf]);

  useEffect(() => {
    const saved = lastOpenedPdf;
    if (
      !saved ||
      !isTauri() ||
      autoOpenAttemptedPathRef.current === saved.filePath
    ) {
      return;
    }

    let cancelled = false;
    const savedPdf = saved;
    autoOpenAttemptedPathRef.current = savedPdf.filePath;
    setAutoOpenStatus(`Opening ${savedPdf.title}...`);

    async function reopen() {
      try {
        const source = await readPdfPath(savedPdf.filePath);
        if (cancelled) return;
        await openPdf(source, savedPdf);
        if (!cancelled) setAutoOpenStatus('');
      } catch (caught) {
        if (!cancelled) {
          const message =
            caught instanceof Error ? caught.message : String(caught);
          setAutoOpenStatus(`Could not reopen the PDF: ${message}`);
        }
      }
    }

    void reopen();
    return () => {
      cancelled = true;
    };
  }, [lastOpenedPdf, openPdf]);

  const handleReadAloud = useCallback(async () => {
    const text =
      narrationScope === 'document'
        ? buildPdfSpeechText(pageTexts)
        : optimizedCurrentPageText;
    if (!text) {
      setNarrationError(
        'This PDF scope has no readable text. Scanned or image-only pages are not supported yet.',
      );
      return;
    }

    setEstimatedDurationSec(estimateAudioDurationSec(text, narrationSpeed));
    const scopeLabel =
      narrationScope === 'document'
        ? 'Complete document'
        : `Page ${String(pageNumber).padStart(3, '0')}`;
    await generateStream({
      text,
      style: narrationStyle,
      speed: narrationSpeed,
      saveToDisk: narrationMode !== 'stream',
      streamAudio: narrationMode !== 'save-silent',
      outputLabel: `${scopeLabel} - ${narrationStyle} - ${formatSpeedLabel(narrationSpeed)}`,
      outputSubdir: `books/${title || 'Untitled PDF'}`,
    });
  }, [
    generateStream,
    narrationMode,
    narrationScope,
    narrationSpeed,
    narrationStyle,
    pageNumber,
    pageTexts,
    setNarrationError,
    title,
    optimizedCurrentPageText,
  ]);

  return (
    <main className="flex h-[calc(100vh-3.5rem)] flex-col p-4 @3xl/content:p-6">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
        <div className="space-y-1 pb-2">
          <h1 className="font-semibold text-2xl tracking-tight">PDF reader</h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            Open a text-based PDF, browse its pages, and convert a page or the
            complete document to speech.
          </p>
        </div>

        <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 @5xl/content:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
          <Tabs
            defaultValue="document"
            className="flex min-w-0 flex-col gap-3 @5xl/content:self-start"
          >
            <TabsList className="grid h-9 w-full grid-cols-2">
              <TabsTrigger
                value="document"
                className="h-7"
                disabled={isNarrating}
              >
                <FileText className="size-4" aria-hidden="true" />
                Document
              </TabsTrigger>
              <TabsTrigger
                value="narration"
                className="h-7"
                disabled={isNarrating}
              >
                <AudioLinesIcon className="size-4" aria-hidden="true" />
                Narration
              </TabsTrigger>
              <TabsIndicator />
            </TabsList>

            <TabsContent value="document" className="min-w-0">
              <div className="flex flex-col rounded-2xl border bg-card shadow-sm">
                <div className="border-b p-4">
                  <h2 className="flex items-center gap-2 font-semibold text-sm">
                    <FileText className="size-4 text-muted-foreground" />
                    Document
                  </h2>
                </div>
                <div className="flex flex-col gap-4 p-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="sr-only"
                    aria-label="Choose PDF file"
                    onChange={(event) => {
                      void handleBrowserFile(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                  <div className="space-y-2">
                    <Label htmlFor="pdf-file-trigger" className="sr-only">PDF file</Label>
                    <Button
                      id="pdf-file-trigger"
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={isOpening}
                      onClick={() => void handleChooseFile()}
                    >
                      {isOpening ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Upload className="size-4" />
                      )}
                      Choose file…
                    </Button>
                  </div>

                  {autoOpenStatus && !title ? (
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground text-sm">
                      {autoOpenStatus}
                    </div>
                  ) : null}

                  {title ? (
                    <div className="grid gap-1 rounded-lg border bg-muted/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate font-medium text-sm">
                          {title}
                        </p>
                        {extractionComplete ? (
                          <Badge
                            variant={hasTextLayer ? 'secondary' : 'destructive'}
                          >
                            {hasTextLayer
                              ? 'Text layer ready'
                              : 'No text layer'}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {fileName} · {formatFileSize(fileSize)} · {pageCount}{' '}
                        {pageCount === 1 ? 'page' : 'pages'}
                      </p>
                    </div>
                  ) : null}

                  {isOpening && pageCount > 0 ? (
                    <div className="grid gap-1.5">
                      <Progress
                        value={Math.round(
                          (extractedPageCount / pageCount) * 100,
                        )}
                      />
                      <p className="text-muted-foreground text-xs">
                        Reading text layer… {extractedPageCount} of {pageCount}{' '}
                        pages
                      </p>
                    </div>
                  ) : null}

                  {error ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                      {error}
                    </div>
                  ) : null}

                  {extractionComplete && !hasTextLayer ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                      This PDF appears to be scanned or image-only. It can still
                      be viewed, but speech conversion requires a real text
                      layer.
                    </div>
                  ) : null}

                  <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="rounded-full"
                      disabled={pageNumber <= 1}
                      onClick={() => selectPage(pageNumber - 1)}
                      aria-label="Previous PDF page"
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <p className="text-center text-muted-foreground text-sm tabular-nums">
                      {pageCount
                        ? `Page ${pageNumber} of ${pageCount}`
                        : 'No PDF open'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="rounded-full"
                      disabled={!pageCount || pageNumber >= pageCount}
                      onClick={() => selectPage(pageNumber + 1)}
                      aria-label="Next PDF page"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>

                  {optimizedCurrentPageText ? (
                    <details className="group rounded-lg border bg-muted/10">
                      <summary className="cursor-pointer px-3 py-2 font-medium text-sm">
                        Optimized page text
                      </summary>
                      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t px-3 py-2 text-muted-foreground text-xs leading-relaxed">
                        {optimizedCurrentPageText}
                      </p>
                    </details>
                  ) : null}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="narration" className="min-w-0">
              <div className="flex flex-col rounded-2xl border bg-card shadow-sm">
                <div className="border-b p-4">
                  <h2 className="flex items-center gap-2 font-semibold text-sm">
                    <AudioLinesIcon className="size-4 text-muted-foreground" />
                    Narration
                  </h2>
                </div>
                <div className="flex flex-col gap-4 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="pdf-narration-scope">Scope</Label>
                    <Select
                      value={narrationScope}
                      onValueChange={(value) =>
                        setNarrationScope(value as NarrationScope)
                      }
                    >
                      <SelectTrigger
                        id="pdf-narration-scope"
                        className="w-full border-none bg-muted/50 shadow-none hover:bg-muted/80 focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <SelectValue>
                          {(value: string | null) =>
                            value === 'document'
                              ? 'Complete document'
                              : 'Current page'
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="page" label="Current page">
                          Current page
                        </SelectItem>
                        <SelectItem value="document" label="Complete document">
                          Complete document
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pdf-voice-select">Voice</Label>
                    <Select
                      value={narrationStyle}
                      onValueChange={(value) => setNarrationStyle(value ?? '')}
                    >
                      <SelectTrigger id="pdf-voice-select" className="w-full border-none bg-muted/50 shadow-none hover:bg-muted/80 focus-visible:ring-1 focus-visible:ring-ring">
                        <SelectValue>
                          {(value: string | null) =>
                            VOICE_OPTIONS.find((voice) => voice.value === value)
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
                            <span className="flex flex-1 items-center justify-between gap-2">
                              {voice.label}
                              {voice.badge !== undefined ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {voice.badge}
                                </Badge>
                              ) : null}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="pdf-speed-slider">Speed</Label>
                      <span className="text-muted-foreground text-xs">
                        {formatSpeedLabel(narrationSpeed)}
                      </span>
                    </div>
                    <Slider
                      id="pdf-speed-slider"
                      min={0.7}
                      max={1.4}
                      step={0.05}
                      value={[narrationSpeed]}
                      onValueChange={(value) =>
                        setNarrationSpeed(
                          Array.isArray(value) ? (value[0] ?? 1) : value,
                        )
                      }
                      aria-label="Narration speed"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pdf-playback-mode">Playback mode</Label>
                    <Select
                      value={narrationMode}
                      onValueChange={(value) =>
                        setNarrationMode(value as NarrationMode)
                      }
                    >
                      <SelectTrigger
                        id="pdf-playback-mode"
                        className="w-full border-none bg-muted/50 shadow-none hover:bg-muted/80 focus-visible:ring-1 focus-visible:ring-ring"
                        aria-label="Playback mode"
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
                        <SelectItem value="stream" label="Stream only">
                          <div className="grid gap-0.5">
                            <span className="font-medium text-sm leading-none">Stream only</span>
                            <span className="text-muted-foreground text-xs">Play immediately</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="save-stream" label="Save & stream">
                          <div className="grid gap-0.5">
                            <span className="font-medium text-sm leading-none">Save & stream</span>
                            <span className="text-muted-foreground text-xs">Save WAV and stream</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="save-silent" label="Save silently">
                          <div className="grid gap-0.5">
                            <span className="font-medium text-sm leading-none">Save silently</span>
                            <span className="text-muted-foreground text-xs">Save WAV without playing</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {narrationError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                      {narrationError}
                    </div>
                  ) : null}

                  {isNarrating ? (
                    <div className="flex w-full gap-2">
                      <Button type="button" className="flex-1 rounded-full" disabled>
                        <LoaderCircle className="size-4 animate-spin" />
                        Generating…
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => void stopGeneration()}
                      >
                        <Square className="size-4" />
                        Stop
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      className="w-full rounded-full"
                      onClick={() => void handleReadAloud()}
                      disabled={!hasTextLayer || !extractionComplete}
                    >
                      {narrationMode === 'save-silent' ? (
                        <Save className="size-4" />
                      ) : (
                        <AudioLinesIcon className="size-4" />
                      )}
                      {narrationMode === 'save-silent'
                        ? 'Save audio'
                        : 'Read aloud'}
                    </Button>
                  )}

                  {isNarrating && estimatedDurationSec > 0 ? (
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
                        {formatDuration(generatedDurationSec)} generated · ~
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

                  <div className="grid gap-2">
                    {/* biome-ignore lint/a11y/useMediaCaption: Generated narration does not have captions yet. */}
                    <audio
                      ref={audioRef}
                      controls
                      preload="auto"
                      src={audioUrl || undefined}
                      aria-label="PDF narration preview"
                      className="h-10 w-full"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full rounded-full"
                      onClick={playNarration}
                      disabled={!audioUrl || isNarrating}
                    >
                      <FileAudio className="size-4" />
                      Play again
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex min-w-0 flex-col rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="font-semibold text-sm">Reading pane</h2>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!pageCount || zoom <= 0.6}
                  onClick={() =>
                    setZoom((value) => Math.max(0.6, value - 0.15))
                  }
                  aria-label="Zoom out"
                >
                  <Minus className="size-4" />
                </Button>
                <span className="w-12 text-center text-muted-foreground text-xs tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!pageCount || zoom >= 2.5}
                  onClick={() =>
                    setZoom((value) => Math.min(2.5, value + 0.15))
                  }
                  aria-label="Zoom in"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col p-4">
              <div className="relative flex min-h-[65vh] grow items-start justify-center overflow-auto rounded-lg bg-muted/40 p-4">
                {!pageCount ? (
                  <div className="m-auto max-w-sm text-center text-muted-foreground text-sm">
                    Choose a text-based PDF to render it here. Image-only PDFs
                    can be viewed, but they cannot be converted to speech.
                  </div>
                ) : null}
                {isRendering ? (
                  <div className="absolute top-3 right-3 z-10 rounded-full border bg-background/90 p-2 shadow-sm">
                    <LoaderCircle className="size-4 animate-spin" />
                  </div>
                ) : null}
                <div
                  ref={pageSurfaceRef}
                  className={pageCount ? 'pdf-page-surface' : 'hidden'}
                >
                  <canvas
                    ref={canvasRef}
                    className="pdf-page-canvas"
                    aria-label={`PDF page ${pageNumber}`}
                    aria-hidden={Boolean(optimizedCurrentPageText)}
                  />
                  <div
                    ref={textLayerRef}
                    className="pdf-text-layer"
                    role="document"
                    aria-label={`Selectable text for PDF page ${pageNumber}`}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
