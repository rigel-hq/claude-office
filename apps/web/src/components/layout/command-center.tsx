'use client';

import { useSocket } from '@/hooks/use-socket';
import { useAgentStore } from '@/store/agent-store';
import { OfficeFloor } from '../office/office-floor';
import { Sidebar } from '../sidebar/sidebar';
import { ChatBar } from '../chat/chat-bar';
import { TopBar } from './top-bar';

export function CommandCenter() {
  const { sendMessage, summarize, openTerminal } = useSocket();

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar with RigelHQ heading */}
      <TopBar />

      {/* Main area: office floor + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Office floor — fills remaining space */}
        <div className="flex-1 overflow-hidden bg-rigel-bg">
          <OfficeFloor />
        </div>

        {/* Right sidebar (metrics, agents, events) */}
        <div className="w-[340px] flex-shrink-0">
          <Sidebar onOpenTerminal={openTerminal} />
        </div>
      </div>

      {/* Bottom chat command bar */}
      <ChatBar onSend={sendMessage} onSummarize={summarize} />
    </div>
  );
}
