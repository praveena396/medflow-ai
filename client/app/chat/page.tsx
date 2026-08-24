'use client';

import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api';
import { useRequireAuth } from '../lib/useRequireAuth';

interface ChatMessage {
  sender: 'user' | 'bot';
  text: string;
  sourceDocument?: string;
  confidence?: number;
}

interface HistoryMessage {
  sender: 'user' | 'bot';
  content: string;
  sourceDocument?: string;
  confidence?: number;
}

export default function ChatPage() {
  const user = useRequireAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load previous conversation when the page opens.
  useEffect(() => {
    if (!user) return;
    apiJson<{ messages: HistoryMessage[] }>('/api/chat/history')
      .then((data) =>
        setMessages(
          data.messages.map((m) => ({
            sender: m.sender,
            text: m.content,
            sourceDocument: m.sourceDocument,
            confidence: m.confidence,
          }))
        )
      )
      .catch(() => {});
  }, [user]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;

    const question = input;
    setMessages((prev) => [...prev, { sender: 'user', text: question }]);
    setInput('');
    setLoading(true);

    try {
      const data = await apiJson<{
        response: { text: string; sourceDocuments?: { fileName: string }[]; confidence?: number };
      }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: question }),
      });

      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: data.response.text,
          sourceDocument: data.response.sourceDocuments?.[0]?.fileName,
          confidence: data.response.confidence,
        },
      ]);
    } catch {
      setMessages((prev) => [...prev, { sender: 'bot', text: 'Error: Could not get response' }]);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-blue-600">Health Chat Assistant</h1>

        <div className="bg-white rounded-lg shadow-lg p-6 h-96 overflow-y-auto mb-4">
          {messages.length === 0 ? (
            <p className="text-gray-500 text-center">Start a conversation with our AI health assistant</p>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`mb-4 ${msg.sender === 'user' ? 'text-right' : 'text-left'}`}>
                <div className={`inline-block px-4 py-2 rounded-lg max-w-[85%] text-left ${msg.sender === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}>
                  {msg.text}
                  {msg.sourceDocument && (
                    <p className="text-xs mt-2 opacity-70">
                      📄 Source: {msg.sourceDocument}
                      {typeof msg.confidence === 'number' && ` · confidence ${(msg.confidence * 100).toFixed(0)}%`}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="text-left mb-4">
              <div className="inline-block px-4 py-2 rounded-lg bg-gray-200 text-gray-500 animate-pulse">
                Thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ask me anything about your health..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
            disabled={loading}
          />
          <button
            onClick={handleSendMessage}
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
