import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  base64ToBytes,
  createFloatWavBlobUrl,
  createStreamId,
  FLOAT_SAMPLE_BYTES,
  revokeBlobUrl,
  SPEECH_STREAM_CHUNK_EVENT,
} from '@/lib/speech-audio';
import { useSynthesisLockStore } from '@/stores/synthesis-lock-store';

/** Computes the playback duration (in seconds) of a raw float32 audio chunk. */
function chunkDurationSec(
  byteLength: number,
  sampleRate: number,
  channels: number,
): number {
  return byteLength / (FLOAT_SAMPLE_BYTES * channels * sampleRate);
}

const WEB_AUDIO_START_DELAY_SEC = 0.08;
const WEB_AUDIO_MIN_LEAD_SEC = 0.02;

type SynthesizeSpeechStreamResponse = {
  sampleRate: number;
  channels: number;
  savedOutputPath: string | null;
};

type SpeechStreamChunkEvent = {
  streamId: string;
  audioBase64: string;
  sampleRate: number;
  channels: number;
  sampleFormat: 'float32le';
};

export type SpeechStreamGenerationRequest = {
  text: string;
  style: string;
  speed?: number;
  saveToDisk: boolean;
  streamAudio?: boolean;
  outputLabel?: string;
  outputSubdir?: string;
  mono?: boolean;
};

type UseSpeechStreamGenerationOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
};

export function useSpeechStreamGeneration({
  audioRef,
}: UseSpeechStreamGenerationOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeStreamIdRef = useRef('');
  const nextPlayTimeRef = useRef(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [savedOutputPath, setSavedOutputPath] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [generatedDurationSec, setGeneratedDurationSec] = useState(0);

  const stopScheduledAudio = useCallback(() => {
    for (const source of scheduledSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Source nodes throw if they already ended; either state is fine here.
      }
    }
    scheduledSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const scheduleStreamChunk = useCallback(
    (bytes: Uint8Array, sampleRate: number, channels: number) => {
      const audioContext = audioContextRef.current;
      if (!audioContext || bytes.byteLength === 0) {
        return;
      }

      const sampleCount = bytes.byteLength / FLOAT_SAMPLE_BYTES;
      const frameCount = sampleCount / channels;
      if (
        !Number.isInteger(sampleCount) ||
        !Number.isInteger(frameCount) ||
        frameCount <= 0
      ) {
        throw new Error('Received a malformed audio stream chunk.');
      }

      const sampleBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(sampleBuffer).set(bytes);
      const samples = new Float32Array(sampleBuffer);
      const audioBuffer = audioContext.createBuffer(
        channels,
        frameCount,
        sampleRate,
      );

      if (channels === 1) {
        audioBuffer.copyToChannel(samples, 0);
      } else {
        for (let channel = 0; channel < channels; channel += 1) {
          const channelData = audioBuffer.getChannelData(channel);
          for (let frame = 0; frame < frameCount; frame += 1) {
            channelData[frame] = samples[frame * channels + channel];
          }
        }
      }

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        scheduledSourcesRef.current = scheduledSourcesRef.current.filter(
          (scheduledSource) => scheduledSource !== source,
        );
      };

      const startAt = Math.max(
        nextPlayTimeRef.current,
        audioContext.currentTime + WEB_AUDIO_MIN_LEAD_SEC,
      );
      source.start(startAt);
      scheduledSourcesRef.current.push(source);
      nextPlayTimeRef.current = startAt + audioBuffer.duration;
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (audioUrl) {
        revokeBlobUrl(audioUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      streamCleanupRef.current?.();
      stopScheduledAudio();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, [stopScheduledAudio]);

  const setPlayerSource = useCallback(
    (nextUrl: string, nextSavedOutputPath: string) => {
      setSavedOutputPath(nextSavedOutputPath);
      setAudioUrl((currentUrl) => {
        if (currentUrl) {
          revokeBlobUrl(currentUrl);
        }
        return nextUrl;
      });
    },
    [],
  );

  const clearPlayerSource = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current?.removeAttribute('src');
    audioRef.current?.load();
    setSavedOutputPath('');
    setGeneratedDurationSec(0);
    setAudioUrl((currentUrl) => {
      if (currentUrl) {
        revokeBlobUrl(currentUrl);
      }
      return '';
    });
  }, [audioRef]);

  const generateStream = useCallback(
    async (request: SpeechStreamGenerationRequest) => {
      if (isGenerating) {
        return null;
      }

      const streamId = createStreamId();
      const streamedAudioChunks: Uint8Array[] = [];

      setError('');
      setIsGenerating(true);
      useSynthesisLockStore.getState().beginSynthesis();
      setGeneratedDurationSec(0);
      activeStreamIdRef.current = streamId;
      audioRef.current?.pause();
      stopScheduledAudio();
      streamCleanupRef.current?.();
      streamCleanupRef.current = null;

      const shouldStream = !!request.streamAudio;

      try {
        if (shouldStream) {
          if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
          }

          if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
          }

          nextPlayTimeRef.current =
            audioContextRef.current.currentTime + WEB_AUDIO_START_DELAY_SEC;
        }

        const unlistenChunk = await listen<SpeechStreamChunkEvent>(
          SPEECH_STREAM_CHUNK_EVENT,
          (event) => {
            if (event.payload.streamId !== activeStreamIdRef.current) {
              return;
            }

            try {
              if (event.payload.sampleFormat !== 'float32le') {
                throw new Error(
                  `Unsupported stream format: ${event.payload.sampleFormat}`,
                );
              }

              const bytes = base64ToBytes(event.payload.audioBase64);
              setGeneratedDurationSec((prev) =>
                prev +
                chunkDurationSec(
                  bytes.byteLength,
                  event.payload.sampleRate,
                  event.payload.channels,
                ),
              );
              if (!request.saveToDisk) {
                streamedAudioChunks.push(bytes);
              }
              if (shouldStream) {
                scheduleStreamChunk(
                  bytes,
                  event.payload.sampleRate,
                  event.payload.channels,
                );
              }
            } catch (caughtError) {
              const message =
                caughtError instanceof Error
                  ? caughtError.message
                  : String(caughtError);
              setError(message);
            }
          },
        );
        streamCleanupRef.current = unlistenChunk;

        const response = await invoke<SynthesizeSpeechStreamResponse>(
          'synthesize_speech_stream',
          {
            request: {
              text: request.text,
              style: request.style,
              speed: request.speed,
              streamId,
              saveToDisk: request.saveToDisk,
              outputLabel: request.outputLabel,
              outputSubdir: request.outputSubdir,
              mono: request.mono ?? true,
              timestamps: false,
            },
          },
        );

        const nextUrl = response.savedOutputPath
          ? convertFileSrc(response.savedOutputPath)
          : createFloatWavBlobUrl(
              streamedAudioChunks,
              response.sampleRate,
              response.channels,
            );

        setPlayerSource(nextUrl, response.savedOutputPath ?? '');

        return response;
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : String(caughtError);
        setError(message);
        return null;
      } finally {
        if (activeStreamIdRef.current === streamId) {
          activeStreamIdRef.current = '';
        }
        streamCleanupRef.current?.();
        streamCleanupRef.current = null;
        setIsGenerating(false);
        useSynthesisLockStore.getState().endSynthesis();
      }
    },
    [
      audioRef,
      isGenerating,
      scheduleStreamChunk,
      setPlayerSource,
      stopScheduledAudio,
    ],
  );

  const play = useCallback(() => {
    audioRef.current?.play().catch(() => undefined);
  }, [audioRef]);

  return {
    audioUrl,
    clearPlayerSource,
    error,
    generateStream,
    generatedDurationSec,
    isGenerating,
    play,
    savedOutputPath,
    setError,
    setPlayerSource,
  };
}
