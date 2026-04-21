// User storage service for anonymous user persistence
const USER_ID_KEY = 'clearpath_user_id';
const THREAD_TITLES_KEY = 'clearpath_thread_titles';
const CHAT_SESSIONS_KEY = 'clearpath_chat_sessions';
const SELECTED_CHAT_ID_KEY = 'clearpath_selected_chat_id';
const HIDDEN_DEFAULT_CHAT_IDS_KEY = 'clearpath_hidden_default_chat_ids';

export interface StoredChatMessage {
  sender: string;
  content: string;
  timestamp?: string;
}

export interface StoredChatSession {
  id: string;
  threadId?: string;
  researchThreadId?: string;
  quantThreadId?: string;
  riskThreadId?: string;
  title: string;
  timestamp: string;
  messages: StoredChatMessage[];
  hiddenContextPrompt?: string;
  hiddenMessageContents?: string[];
}

// Generate a UUID v4
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Get or generate user ID
export function getUserId(): string {
  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = generateUUID();
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}

// Get thread titles mapping
export function getThreadTitles(): Record<string, string> {
  const stored = localStorage.getItem(THREAD_TITLES_KEY);
  if (!stored) {
    return {};
  }
  try {
    return JSON.parse(stored);
  } catch {
    return {};
  }
}

// Save thread title
export function saveThreadTitle(threadId: string, title: string): void {
  const titles = getThreadTitles();
  titles[threadId] = title;
  localStorage.setItem(THREAD_TITLES_KEY, JSON.stringify(titles));
}

// Remove thread title
export function removeThreadTitle(threadId: string): void {
  const titles = getThreadTitles();
  delete titles[threadId];
  localStorage.setItem(THREAD_TITLES_KEY, JSON.stringify(titles));
}

export function getStoredChatSessions(): StoredChatSession[] {
  const stored = localStorage.getItem(CHAT_SESSIONS_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((session) => session && typeof session === 'object')
      .map((session) => ({
        id: typeof session.id === 'string' ? session.id : '',
        threadId: typeof session.threadId === 'string' ? session.threadId : undefined,
        researchThreadId: typeof session.researchThreadId === 'string' ? session.researchThreadId : undefined,
        quantThreadId: typeof session.quantThreadId === 'string' ? session.quantThreadId : undefined,
        riskThreadId: typeof session.riskThreadId === 'string' ? session.riskThreadId : undefined,
        title: typeof session.title === 'string' ? session.title : 'New Chat',
        timestamp: typeof session.timestamp === 'string' ? session.timestamp : new Date().toISOString(),
        hiddenContextPrompt: typeof session.hiddenContextPrompt === 'string' ? session.hiddenContextPrompt : undefined,
        hiddenMessageContents: Array.isArray(session.hiddenMessageContents)
          ? session.hiddenMessageContents.filter((value: unknown): value is string => typeof value === 'string')
          : undefined,
        messages: Array.isArray(session.messages)
          ? session.messages
              .filter((message: any) => message && typeof message === 'object' && typeof message.sender === 'string' && typeof message.content === 'string')
              .map((message: any) => ({
                sender: message.sender,
                content: message.content,
                timestamp: typeof message.timestamp === 'string' ? message.timestamp : undefined,
              }))
          : [],
      }))
      .filter((session) => session.id.length > 0);
  } catch {
    return [];
  }
}

export function saveStoredChatSessions(sessions: StoredChatSession[]): void {
  localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
}

export function getSelectedChatId(): string | null {
  return localStorage.getItem(SELECTED_CHAT_ID_KEY);
}

export function saveSelectedChatId(chatId: string): void {
  localStorage.setItem(SELECTED_CHAT_ID_KEY, chatId);
}

export function getHiddenDefaultChatIds(): string[] {
  const stored = localStorage.getItem(HIDDEN_DEFAULT_CHAT_IDS_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === 'string');
  } catch {
    return [];
  }
}

export function hideDefaultChatId(chatId: string): void {
  const hiddenIds = new Set(getHiddenDefaultChatIds());
  hiddenIds.add(chatId);
  localStorage.setItem(HIDDEN_DEFAULT_CHAT_IDS_KEY, JSON.stringify(Array.from(hiddenIds)));
}
