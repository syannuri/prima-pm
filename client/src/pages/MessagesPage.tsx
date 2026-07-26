import { useState } from 'react';
import { PanelLoading, Card } from '../components/ui';
import { useChat, ConversationList, ContactPicker, ChatThread, SearchResults, ChatSearchBox } from '../components/chat/chatCore';
import type { ChatContact } from '../api/types';

export default function MessagesPage() {
  const chat = useChat();
  const [showNew, setShowNew] = useState(false);

  const toggleNew = () => { setShowNew((s) => { if (!s) chat.loadContacts(); return !s; }); };
  const pick = (c: ChatContact) => { setShowNew(false); chat.openContact(c); };

  if (chat.loading) return <PanelLoading />;
  const active = chat.active;

  return (
    <div className="space-y-4">
      <div className={`items-center justify-between ${active ? 'hidden sm:flex' : 'flex'}`}>
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 sm:text-2xl">Messages</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Private 1-to-1 chat with your team</p>
        </div>
        <button onClick={toggleNew} className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">
          <span className="text-base leading-none">＋</span> {showNew ? 'Close' : 'New message'}
        </button>
      </div>

      {showNew && (
        <Card className="!p-0 overflow-hidden !rounded-2xl">
          <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">Start a conversation</div>
          <div className="max-h-72 overflow-y-auto"><ContactPicker contacts={chat.contacts} loading={chat.contactsLoading} onPick={pick} /></div>
        </Card>
      )}

      <Card className="!p-0 overflow-hidden shadow-sm -mx-4 !rounded-none sm:mx-0 sm:!rounded-2xl">
        <div className="grid sm:grid-cols-[20rem_1fr]" style={{ height: 'calc(100vh - 11rem)' }}>
          {/* Conversation list (or search results while searching) */}
          <div className={`flex flex-col border-r border-slate-100 dark:border-slate-800 sm:flex ${active ? 'hidden' : 'flex'} bg-white dark:bg-slate-900`}>
            <div className="border-b border-slate-100 p-3 dark:border-slate-800">
              <ChatSearchBox value={chat.searchQuery} onChange={chat.setSearchQuery} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {chat.searchActive
                ? <SearchResults results={chat.searchResults} query={chat.searchQuery.trim()} loading={chat.searchLoading} me={chat.me} onOpen={chat.openSearchResult} />
                : <ConversationList conversations={chat.conversations} me={chat.me} activeConvId={active?.convId} onOpen={chat.openConversation} />}
            </div>
          </div>

          {/* Thread — phones: immersive full-screen overlay (covers app header + tab bar); sm+: grid cell. */}
          {active ? (
            <div className="fixed inset-0 z-50 sm:static sm:z-auto sm:h-full">
              <ChatThread chat={chat} onBack={chat.closeThread} backMobileOnly safeArea />
            </div>
          ) : (
            <div className="hidden bg-[#f6f7fb] dark:bg-slate-950 sm:grid sm:place-items-center">
              <div className="p-6 text-center text-sm text-slate-400">
                <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">💬</div>Select a conversation to start chatting.
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
