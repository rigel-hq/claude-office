'use client';

import { useState, useCallback } from 'react';

export function ChatInput({ onSend }: { onSend: (message: string) => void }) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed) return;
      onSend(trimmed);
      setValue('');
    },
    [value, onSend],
  );

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-3 border-t border-rigel-border">
      <input
        type="text"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
        placeholder="Send a message to CEA..."
        className="flex-1 bg-rigel-bg border border-rigel-border rounded-lg px-3 py-2 text-sm text-rigel-text placeholder-rigel-muted focus:outline-none focus:border-rigel-blue"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="px-4 py-2 bg-rigel-blue text-rigel-bg rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        Send
      </button>
    </form>
  );
}
