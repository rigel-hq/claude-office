'use client';

interface VoiceBarProps {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  onStop: () => void;
}

function WaveformBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-[3px] h-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-[3px] rounded-full transition-all duration-150 ${
            active ? 'bg-red-500/70 animate-pulse' : 'bg-rigel-muted'
          }`}
          style={{
            height: active ? `${8 + Math.sin(i * 1.2) * 8}px` : '4px',
            animationDelay: `${i * 100}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function VoiceBar({
  isListening,
  isSpeaking,
  transcript,
  onStop,
}: VoiceBarProps) {
  const isIdle = !isSpeaking && !isListening;

  const statusText = isSpeaking
    ? 'Speaking...'
    : isListening
      ? 'Listening...'
      : 'Tap mic to speak';

  const statusColor = isSpeaking
    ? 'text-purple-400/80'
    : isListening
      ? 'text-red-400/80'
      : 'text-rigel-muted';

  return (
    <div className="flex items-center gap-3 flex-1 bg-rigel-bg border border-rigel-border rounded-lg px-3 py-2">
      {/* Status indicator */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isSpeaking
              ? 'bg-purple-500/70 animate-pulse'
              : isListening
                ? 'bg-red-500/70 animate-pulse'
                : 'bg-gray-600'
          }`}
        />
        <span className={`text-xs font-medium ${statusColor}`}>
          {statusText}
        </span>
      </div>

      {/* Waveform */}
      <WaveformBars active={isListening || isSpeaking} />

      {/* Transcript preview */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isIdle ? 'text-rigel-muted' : 'text-rigel-text'}`}>
          {transcript || (isListening ? 'Say something...' : isIdle ? 'Ready for next command' : '')}
        </p>
      </div>

      {/* Stop button */}
      <button
        type="button"
        onClick={onStop}
        className="flex-shrink-0 px-3 py-1.5 bg-red-900/30 text-red-400/80 rounded-lg text-xs font-medium hover:bg-red-900/40 transition-colors"
      >
        &#9632; Stop
      </button>
    </div>
  );
}
