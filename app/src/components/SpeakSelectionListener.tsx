import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useSpeechStreamGeneration } from '@/hooks/use-speech-stream-generation';
import { optimizeMarkdownForSpeech } from '@/lib/tts-text';
import { useSettingsStore } from '@/stores/settings-store';

const SPEAK_SELECTION_EVENT = 'speak-selection-pending';

/**
 * Plays text sent through the macOS "Speak Selection with Kokoro" service.
 * Mounted once at the root so spoken selections work on every page, and on
 * launch it drains any selection that arrived before the webview was ready.
 */
export default function SpeakSelectionListener() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { generateStream, isGenerating } = useSpeechStreamGeneration({
    audioRef,
  });

  const isGeneratingRef = useRef(isGenerating);
  isGeneratingRef.current = isGenerating;
  const generateStreamRef = useRef(generateStream);
  generateStreamRef.current = generateStream;

  useEffect(() => {
    let cancelled = false;

    const speakPendingSelection = async () => {
      const text = await invoke<string | null>('take_speak_selection_text');
      if (cancelled || !text?.trim()) {
        return;
      }

      if (isGeneratingRef.current) {
        toast.info('Still speaking the previous selection.');
        return;
      }

      toast.info('Speaking selection…');
      const speechText = optimizeMarkdownForSpeech(text) || text;
      const response = await generateStreamRef.current({
        text: speechText,
        style: useSettingsStore.getState().voice,
        saveToDisk: false,
        streamAudio: true,
        mono: true,
      });

      if (!response && !cancelled) {
        toast.error('Could not speak the selected text.');
      }
    };

    void speakPendingSelection();
    const unlisten = listen(SPEAK_SELECTION_EVENT, () => {
      void speakPendingSelection();
    });

    return () => {
      cancelled = true;
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  // The audio element only backs non-streamed playback of the blob URL;
  // streamed chunks play through the hook's AudioContext.
  // biome-ignore lint/a11y/useMediaCaption: generated speech has no captions
  return <audio ref={audioRef} className="hidden" />;
}
