import { useNavigate } from '@tanstack/react-router';
import { AlertCircleIcon, Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import {
  selectIsModelDownloading,
  selectModelDownloadPercent,
  startModelSync,
  useModelStore,
} from '@/stores/model-store';
import {
  selectIsSynthesisLocked,
  useSynthesisLockStore,
} from '@/stores/synthesis-lock-store';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/** Keeps the voice model status in sync for the whole app. Mount once. */
export function ModelSync() {
  useEffect(() => startModelSync(), []);
  return null;
}

/**
 * Topbar pill shown only while the voice model is downloading or missing.
 * Clicking it opens Settings.
 */
export default function ModelStatusIndicator() {
  const navigate = useNavigate();
  const status = useModelStore((state) => state.status);
  const isDownloading = useModelStore(selectIsModelDownloading);
  const percent = useModelStore(selectModelDownloadPercent);
  const isNavigationLocked = useSynthesisLockStore(selectIsSynthesisLocked);

  if (!status || (status.installed && !isDownloading)) {
    return null;
  }

  const label = isDownloading
    ? `Downloading voice model… ${Math.round(percent)}%`
    : 'Voice model not downloaded';
  const tooltip = isDownloading
    ? 'Speech generation is available once the download finishes.'
    : 'Open Settings to download the voice model.';

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={isDownloading ? 'outline' : 'destructive'}
            size="sm"
            className="h-7 rounded-full px-3 text-xs tabular-nums"
            disabled={isNavigationLocked}
            onClick={() => void navigate({ to: '/settings' })}
            aria-label={`${label}. ${tooltip}`}
          />
        }
      >
        {isDownloading ? (
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <AlertCircleIcon className="size-3.5" aria-hidden="true" />
        )}
        {label}
      </TooltipTrigger>
      <TooltipContent align="end">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
