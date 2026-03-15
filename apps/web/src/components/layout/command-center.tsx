'use client';

import { useSocket } from '@/hooks/use-socket';
import { OfficeFloor } from '../office/office-floor';
import { Sidebar } from '../sidebar/sidebar';

export function CommandCenter() {
  const { sendMessage } = useSocket();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Office floor — fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <OfficeFloor />
      </div>

      {/* Rich sidebar */}
      <div className="w-[380px] flex-shrink-0">
        <Sidebar onSend={sendMessage} />
      </div>
    </div>
  );
}
