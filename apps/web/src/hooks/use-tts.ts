'use client';

import { useState, useRef, useCallback } from 'react';
import { voiceConfig } from '@/lib/voice-config';

interface UseTtsOptions {
  voiceId?: string;
  audioContext?: AudioContext | null;
}

/** Module-level cache — survives hook re-renders and remounts */
const audioCache = new Map<string, ArrayBuffer>();

export function useTts({
  voiceId = voiceConfig.ttsVoiceId,
  audioContext,
}: UseTtsOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped
      }
      sourceRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  /** Play an ArrayBuffer through the audio context */
  const playBuffer = useCallback(
    async (arrayBuffer: ArrayBuffer) => {
      if (!audioContext) return;

      // decodeAudioData detaches the buffer, so pass a copy
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      sourceRef.current = source;

      setIsSpeaking(true);
      source.onended = () => {
        sourceRef.current = null;
        setIsSpeaking(false);
      };
      source.start();
    },
    [audioContext],
  );

  const speak = useCallback(
    async (text: string) => {
      if (!voiceId || !audioContext) return;

      stopPlayback();

      try {
        // Check cache first
        const cached = audioCache.get(text);
        if (cached) {
          await playBuffer(cached);
          return;
        }

        const resp = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceId }),
        });

        if (!resp.ok) return;

        const arrayBuffer = await resp.arrayBuffer();

        // Cache the raw audio for future plays
        audioCache.set(text, arrayBuffer);

        await playBuffer(arrayBuffer);
      } catch {
        setIsSpeaking(false);
      }
    },
    [voiceId, audioContext, stopPlayback, playBuffer],
  );

  return { speak, stop: stopPlayback, isSpeaking };
}
