'use client';

import { useSocket } from '@/hooks/use-socket';
import { TopBar } from './top-bar';
import { OfficeFloor } from '../office/office-floor';
import { ChatPanel } from '../chat/chat-panel';

export function CommandCenter() {
  const { sendMessage } = useSocket();

  return (
    <div className="flex flex-col h-screen">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Office floor — takes most of the space */}
        <div className="flex-1 overflow-hidden p-2">
          <OfficeFloor />
        </div>

        {/* Chat panel — fixed width sidebar */}
        <div className="w-80 flex-shrink-0">
          <ChatPanel onSend={sendMessage} />
        </div>
      </div>
    </div>
  );
}
