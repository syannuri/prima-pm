import { useState } from 'react';
import { PanelLoading, Card } from '../components/ui';
import { useChat, ConversationList, ContactPicker, ChatThread, SearchResults, ChatSearchBox, NewGroupForm } from '../components/chat/chatCore';
import PushToggle from '../components/PushToggle';
import type { ChatContact } from '../api/types';

export default function MessagesPage() {
  const chat = useChat();
  const [showNew, setShowNew] = useState<null | 'dm' | 'group'>(null);

  const openNew = (mode: 'dm' | 'group') => { setShowNew((s) => (s === mode ? null : mode)); if (mode === 'dm') chat.loadContacts(); };
  const pick = (c: ChatContact) => { setShowNew(null); chat.openContact(c); };

  if (chat.loading) return <PanelLoading />;
  const active = chat.active;

  return (
    <div className="space-y-4">
      <div className={`items-center justify-between gap-2 ${active ? 'hidden sm:flex' : 'flex'}`}>
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 sm:text-2xl">Messages</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Direct chat &amp; group channels for your team</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <PushToggle />
          <button onClick={() => openNew('group')} className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition ${showNew === 'group' ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/20' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            <span className="text-base leading-none">👥</span> {showNew === 'group' ? 'Close' : 'New group'}
          </button>
          <button onClick={() => openNew('dm')} className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">
            <span className="text-base leading-none">＋</span> {showNew === 'dm' ? 'Close' : 'New message'}
          </button>
        </div>
      </div>

      {showNew === 'dm' && (
        <Card className="!p-0 overflow-hidden !rounded-2xl">
          <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">Start a conversation</div>
          <div className="max-h-72 overflow-y-auto"><ContactPicker contacts={chat.contacts} loading={chat.contactsLoading} onPick={pick} /></div>
        </Card>
      )}

      {showNew === 'group' && (
        <Card className="!p-0 overflow-hidden !rounded-2xl">
          <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">New group channel</div>
          <NewGroupForm chat={chat} onCreated={() => setShowNew(null)} />
        </Card>
      )}

      <Card className="!p-0 overflow-hidden shadow-sm -mx-4 !rounded-none sm:mx-0 sm:!rounded-2xl">
        {/* Bound the single row to the container height (minmax(0,1fr)) so a long thread scrolls
            INSIDE its cell instead of growing the grid and pushing the composer out of view. */}
        <div className="grid sm:grid-cols-[20rem_1fr]" style={{ height: 'calc(100vh - 11rem)', gridTemplateRows: 'minmax(0, 1fr)' }}>
          {/* Conversation list (or search results while searching) */}
          <div className={`min-h-0 flex-col overflow-hidden border-r border-slate-100 dark:border-slate-800 sm:flex ${active ? 'hidden' : 'flex'} bg-white dark:bg-slate-900`}>
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
            <div className="fixed inset-0 z-50 sm:static sm:z-auto sm:h-full sm:min-h-0 sm:overflow-hidden">
              <ChatThread chat={chat} onBack={chat.closeThread} backMobileOnly safeArea />
            </div>
          ) : (
            <div className="hidden min-h-0 bg-[#f6f7fb] dark:bg-slate-950 sm:grid sm:place-items-center">
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
