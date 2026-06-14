import { invoke } from '@tauri-apps/api/core';
import { DownloadIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type AppUpdateResponse = {
  status: 'prepared' | 'upToDate' | 'restarting';
  version: string | null;
};

type UpdateButtonState =
  | 'unchecked'
  | 'preparing'
  | 'ready'
  | 'installing'
  | 'upToDate';

export default function UpdateButton() {
  const [state, setState] = useState<UpdateButtonState>('unchecked');
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  const isDev = import.meta.env.DEV;
  const isLoading = state === 'preparing' || state === 'installing';
  const label = updateButtonLabel(state, availableVersion);
  const variant = state === 'ready' ? 'default' : 'outline';

  async function handleUpdateClick() {
    if (isLoading) {
      return;
    }

    if (state === 'ready') {
      await installPreparedUpdate();
      return;
    }

    await prepareUpdate();
  }

  async function prepareUpdate() {
    setState('preparing');
    const toastId = toast.loading('Checking for updates...');

    try {
      const response = await invoke<AppUpdateResponse>('prepare_app_update');

      if (response.status === 'upToDate') {
        setAvailableVersion(null);
        setState('upToDate');
        toast.success('Kokoro is up to date.', { id: toastId });
        return;
      }

      setAvailableVersion(response.version);
      setState('ready');
      toast.success(
        response.version
          ? `Kokoro v${response.version} is downloaded and ready to install.`
          : 'A Kokoro update is downloaded and ready to install.',
        { id: toastId },
      );
    } catch (error) {
      setState('unchecked');
      toast.error(formatUpdateError(error), { id: toastId });
    }
  }

  async function installPreparedUpdate() {
    setState('installing');
    const toastId = toast.loading(
      availableVersion
        ? `Installing v${availableVersion} and restarting...`
        : 'Installing update and restarting...',
    );

    try {
      const response = await invoke<AppUpdateResponse>(
        'install_prepared_app_update',
      );

      if (response.status === 'upToDate') {
        setAvailableVersion(null);
        setState('upToDate');
        toast.success('Kokoro is already up to date.', { id: toastId });
        return;
      }

      toast.success(
        response.version
          ? `Installed v${response.version}. Restarting...`
          : 'Installed update. Restarting...',
        { id: toastId, duration: 1500 },
      );
    } catch (error) {
      setState('ready');
      toast.error(formatUpdateError(error), { id: toastId });
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type='button'
            variant={variant}
            size='icon-sm'
            className='shrink-0 rounded-full transition-colors duration-200'
            disabled={isLoading || isDev}
            onClick={handleUpdateClick}
            aria-label={label}
          />
        }
      >
        {isLoading ? (
          <Loader2Icon className='size-4 animate-spin' aria-hidden='true' />
        ) : state === 'ready' ? (
          <RefreshCwIcon className='size-4' aria-hidden='true' />
        ) : (
          <DownloadIcon className='size-4' aria-hidden='true' />
        )}
      </TooltipTrigger>
      <TooltipContent align='end'>{label}</TooltipContent>
    </Tooltip>
  );
}

function updateButtonLabel(
  state: UpdateButtonState,
  availableVersion: string | null,
) {
  switch (state) {
    case 'preparing':
      return 'Looking for updates...';
    case 'ready':
      return availableVersion
        ? `Update to v${availableVersion}`
        : 'Update available';
    case 'installing':
      return availableVersion
        ? `Updating to v${availableVersion}...`
        : 'Updating...';
    case 'upToDate':
      return 'All set! You’re on the latest version.';
    case 'unchecked':
      return 'Check for updates';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function formatUpdateError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Update failed.';
}
