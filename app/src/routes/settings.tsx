import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FolderOpenIcon,
  Loader2Icon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  formatBytes,
  type ModelSource,
  selectIsModelDownloading,
  selectModelDownloadPercent,
  useModelStore,
} from '@/stores/model-store';
import {
  selectIsSynthesisLocked,
  useSynthesisLockStore,
} from '@/stores/synthesis-lock-store';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <main className="min-h-[calc(100vh-4.5rem)] p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="space-y-1 pb-2">
          <h1 className="font-semibold text-2xl tracking-tight">Settings</h1>
        </div>
        <VoiceModelCard />
      </div>
    </main>
  );
}

const SOURCE_DESCRIPTIONS: Record<ModelSource, string> = {
  downloaded:
    'Stored on this Mac, outside the app. App updates keep using it without downloading it again.',
  bundled:
    'Included with this version of the app. It’s copied out of the app so future updates keep it.',
  development: 'Loaded from the repository’s checkpoints and data folders.',
};

function VoiceModelCard() {
  const status = useModelStore((state) => state.status);
  const task = useModelStore((state) => state.task);
  const progress = useModelStore((state) => state.progress);
  const error = useModelStore((state) => state.error);
  const download = useModelStore((state) => state.download);
  const verify = useModelStore((state) => state.verify);
  const deleteDownloaded = useModelStore((state) => state.deleteDownloaded);
  const isDownloading = useModelStore(selectIsModelDownloading);
  const percent = useModelStore(selectModelDownloadPercent);
  const isSynthesisLocked = useSynthesisLockStore(selectIsSynthesisLocked);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);

  const isBusy = task !== null || isDownloading || status?.busy === true;
  const actionsDisabled = !status || isBusy || isSynthesisLocked;
  const disabledReason = isSynthesisLocked
    ? 'Please wait for speech synthesis to finish'
    : undefined;

  async function handleVerify() {
    const valid = await verify();
    if (valid === true) {
      toast.success('The voice model is intact.');
    } else if (valid === false) {
      toast.error(
        'Some model files were damaged and have been removed. Download the model again.',
      );
    }
  }

  async function handleReveal() {
    setIsRevealing(true);
    try {
      await invoke('reveal_models_dir');
    } catch (revealError) {
      toast.error(
        typeof revealError === 'string'
          ? revealError
          : 'Could not open the models folder.',
      );
    } finally {
      setIsRevealing(false);
    }
  }

  async function handleDelete() {
    setConfirmDeleteOpen(false);
    await deleteDownloaded();
  }

  return (
    <Card className="shadow-sm backdrop-blur">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Voice model</CardTitle>
            <CardDescription>
              Kokoro v1.0 with word timestamps, plus the voice pack.{' '}
              {status ? formatBytes(status.totalBytes) : null}
            </CardDescription>
          </div>
          <ModelStatusBadge
            installed={status?.installed}
            isDownloading={isDownloading}
            task={task}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-5 text-sm">
        {isDownloading ? (
          <div className="space-y-2">
            <Progress
              value={percent}
              aria-label="Voice model download progress"
            />
            <p className="text-muted-foreground tabular-nums">
              {progress
                ? `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)}`
                : 'Starting download…'}
            </p>
          </div>
        ) : status?.source ? (
          <p className="text-muted-foreground">
            {SOURCE_DESCRIPTIONS[status.source]}
          </p>
        ) : status && !status.installed ? (
          <p className="text-muted-foreground">
            Speech generation needs the voice model. It downloads once (
            {formatBytes(status.missingBytes)}) and stays on this Mac across app
            updates.
          </p>
        ) : null}

        {error ? (
          <p className="flex items-start gap-2 text-destructive" role="alert">
            <AlertCircleIcon
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {error}
          </p>
        ) : null}

        {status ? (
          <div className="space-y-1.5">
            <p className="font-medium">Location</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                {status.modelsDir}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRevealing}
                onClick={() => void handleReveal()}
              >
                {isRevealing ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : (
                  <FolderOpenIcon aria-hidden="true" />
                )}
                Show in Finder
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {status && !status.installed ? (
            <Button
              type="button"
              disabled={actionsDisabled}
              title={disabledReason}
              onClick={() => void download()}
            >
              {isDownloading ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <DownloadIcon aria-hidden="true" />
              )}
              {isDownloading
                ? 'Downloading…'
                : error
                  ? 'Retry download'
                  : `Download (${formatBytes(status.missingBytes)})`}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="outline"
            disabled={actionsDisabled || !status?.installed}
            title={disabledReason}
            onClick={() => void handleVerify()}
          >
            {task === 'verify' ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheckIcon aria-hidden="true" />
            )}
            {task === 'verify' ? 'Verifying…' : 'Verify files'}
          </Button>

          <Button
            type="button"
            variant="destructive"
            disabled={actionsDisabled || status?.source !== 'downloaded'}
            title={
              disabledReason ??
              (status?.source && status.source !== 'downloaded'
                ? 'Only a downloaded copy can be deleted.'
                : undefined)
            }
            onClick={() => setConfirmDeleteOpen(true)}
          >
            {task === 'delete' ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2Icon aria-hidden="true" />
            )}
            {task === 'delete' ? 'Deleting…' : 'Delete model'}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the voice model?</AlertDialogTitle>
            <AlertDialogDescription>
              This frees {status ? formatBytes(status.totalBytes) : 'space'}.
              Speech generation won’t work until you download it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ModelStatusBadge({
  installed,
  isDownloading,
  task,
}: {
  installed: boolean | undefined;
  isDownloading: boolean;
  task: string | null;
}) {
  if (installed === undefined) {
    return <Badge variant="outline">Checking…</Badge>;
  }
  if (isDownloading) {
    return (
      <Badge variant="outline">
        <Loader2Icon className="animate-spin" aria-hidden="true" />
        Downloading
      </Badge>
    );
  }
  if (task === 'verify') {
    return (
      <Badge variant="outline">
        <Loader2Icon className="animate-spin" aria-hidden="true" />
        Verifying
      </Badge>
    );
  }
  if (installed) {
    return (
      <Badge variant="secondary">
        <CheckCircle2Icon aria-hidden="true" />
        Ready
      </Badge>
    );
  }
  return <Badge variant="destructive">Not downloaded</Badge>;
}
