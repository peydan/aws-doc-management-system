import { useState, useRef, useEffect } from 'react';
import { loadConfig, ApiClient } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Bot, Send, User, Sparkles, Wrench, FileText, Trash2, StopCircle, RefreshCw, Settings, Loader2 } from 'lucide-react';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  tools?: string[];
  citations?: Array<{
    document_id: string;
    filename?: string;
    application_version?: number;
    document_class?: string;
  }>;
}

interface AiAssistantProps {
  onSelectDocument?: (docId: string) => void;
}

const PROMPT_SUGGESTIONS = [
  '📋 Find all mortgage loan agreements for customer 1094827 and summarize their terms.',
  '🔍 Search for loan agreement LN-2026-88821 and check its signed amount, currency, and date.',
  '⚖️ Which documents have an active legal hold or SOX regulatory framework?',
  '🔒 Identify documents containing PII categories such as NATIONAL_ID or FINANCIAL_HISTORY.',
];

export function AiAssistant({ onSelectDocument }: AiAssistantProps) {
  const { token } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am your AI Document Assistant powered by Amazon Bedrock (Nova 2 Lite) and intelligent MCP tools.\n\nI have direct real-time access to your repository via MCP Gateway tools:\n• 🔍 search_documents: Multi-attribute search across customers, loan numbers, document classes, and metadata.\n• 📄 fetch_document: Retrieval of authoritative S3 document annotations, versions, and verified content.\n\nAsk questions in plain English or select a suggestion below.',
    },
  ]);
  const [input, setInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [streamingText, setStreamingText] = useState<string>('');
  const [customEndpoint, setCustomEndpoint] = useState<string>('');
  const [showEndpointConfig, setShowEndpointConfig] = useState<boolean>(false);
  const [sessionId, setSessionId] = useState<string>(() => 'sess-' + Math.random().toString(36).substring(2, 10));

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, isProcessing]);

  const handleStartNewSession = () => {
    const newSess = 'sess-' + Math.random().toString(36).substring(2, 10);
    setSessionId(newSess);
    setMessages([
      {
        id: 'welcome-' + Date.now(),
        sender: 'assistant',
        text: `Started fresh session: ${newSess}. How can I assist you with your document repository today?`,
      },
    ]);
  };

  const handleClear = () => {
    setMessages([
      {
        id: 'welcome-' + Date.now(),
        sender: 'assistant',
        text: 'Chat history cleared. How can I help you today?',
      },
    ]);
  };

  const handleSendPrompt = async (textToSend?: string) => {
    const prompt = (textToSend || input).trim();
    if (!prompt || isProcessing) return;

    if (!textToSend) setInput('');

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: prompt,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);
    setStreamingText('');
    setActiveTools([]);
    setProcessingStatus('Reasoning with Amazon Bedrock & MCP Tools...');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const config = await loadConfig();
      const streamingUrl = customEndpoint.trim() || config.agentStreamingUrl;
      const isFunctionUrl = !!(streamingUrl && streamingUrl.includes('lambda-url'));

      if (isFunctionUrl) {
        // SSE Streaming Handler (when Lambda Function URL is available)
        setProcessingStatus('Streaming from Amazon Bedrock...');
        const res = await fetch(streamingUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            message: prompt,
            sessionId,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Bedrock streaming failed with status ${res.status}`);
        }

        if (!res.body) {
          throw new Error('No readable stream returned by Bedrock endpoint');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let accumulated = '';
        const tools: string[] = [];
        const citations: any[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          let currentEvent = 'message';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              currentEvent = 'message';
              continue;
            }
            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.substring(6).trim();
              continue;
            }
            if (trimmed.startsWith('data:')) {
              const rawData = trimmed.substring(5).trim();
              try {
                const data = JSON.parse(rawData);
                if (currentEvent === 'text_delta' && data.delta) {
                  accumulated += data.delta;
                  setStreamingText(accumulated);
                } else if (currentEvent === 'tool_call' && data.tool) {
                  if (!tools.includes(data.tool)) {
                    tools.push(data.tool);
                    setActiveTools([...tools]);
                  }
                } else if (currentEvent === 'done' && data.citations) {
                  citations.push(...data.citations);
                }
              } catch {
                // ignore
              }
            }
          }
        }

        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          sender: 'assistant',
          text: accumulated || 'Completed response.',
          tools: tools.length > 0 ? tools : undefined,
          citations: citations.length > 0 ? citations : undefined,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        // Standard Authoritative API Gateway Endpoint (POST /agent/chat)
        setProcessingStatus('Invoking Amazon Nova 2 Lite & MCP Tools...');
        const res = await ApiClient.chatWithAgent({
          message: prompt,
          sessionId,
        });

        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          sender: 'assistant',
          text: res.message || '',
          tools: res.tools_used && res.tools_used.length > 0 ? res.tools_used : undefined,
          citations: res.citations && res.citations.length > 0 ? res.citations : undefined,
        };

        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: 'assistant',
            text: `⚠️ Error communicating with Amazon Bedrock: ${err.message}`,
          },
        ]);
      }
    } finally {
      setIsProcessing(false);
      setStreamingText('');
      setActiveTools([]);
      setProcessingStatus('');
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsProcessing(false);
    }
  };

  return (
    <Card className="h-[780px] flex flex-col border-slate-800 bg-slate-900/60 max-w-5xl mx-auto shadow-2xl">
      {/* Top Header Bar */}
      <CardHeader className="border-b border-slate-800 py-3 px-6 flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400 border border-purple-500/20">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              Amazon Bedrock Assistant
              <Badge variant="outline" className="text-[11px] text-purple-400 border-purple-500/30">
                AgentCore Harness (Nova 2 Lite)
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span>Session: <code className="text-aws-orange">{sessionId}</code></span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleStartNewSession}
            className="text-xs h-8 gap-1.5"
            title="Start fresh conversational session"
          >
            <RefreshCw className="w-3 h-3" /> New Session
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="text-xs h-8 text-slate-400 hover:text-slate-200 gap-1.5"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowEndpointConfig(!showEndpointConfig)}
            className="text-xs h-8 text-slate-400 hover:text-slate-200 gap-1.5"
          >
            <Settings className="w-3.5 h-3.5" /> Endpoint
          </Button>
        </div>
      </CardHeader>

      {/* Collapsible Endpoint Config */}
      {showEndpointConfig && (
        <div className="p-3 bg-slate-950 border-b border-slate-800 text-xs flex flex-wrap items-center gap-2">
          <span className="text-slate-400">Custom Streaming Endpoint:</span>
          <Input
            value={customEndpoint}
            onChange={(e) => setCustomEndpoint(e.target.value)}
            placeholder="Leave blank to use API Gateway /v1/agent/chat"
            className="flex-1 min-w-[280px] h-8 bg-slate-900 border-slate-700 text-xs font-mono"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCustomEndpoint('')}
            className="h-8 text-xs"
          >
            Reset Default
          </Button>
        </div>
      )}

      {/* Suggestion Chips */}
      <div className="px-6 py-2 bg-slate-950/40 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto text-xs">
        <span className="text-[11px] text-slate-500 shrink-0">Suggestions:</span>
        {PROMPT_SUGGESTIONS.map((s, idx) => (
          <button
            key={idx}
            onClick={() => handleSendPrompt(s)}
            disabled={isProcessing}
            className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300 hover:border-aws-orange/60 hover:text-white transition-colors whitespace-nowrap text-[11px] shrink-0 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Message List */}
      <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.sender === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-purple-900/50 border border-purple-500/40 text-purple-300 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              className={`max-w-[80%] rounded-xl p-4 text-sm leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-aws-orange text-slate-950 font-medium ml-12'
                  : 'bg-slate-950/90 border border-slate-800 text-slate-200 shadow-sm'
              }`}
            >
              {/* Tool Badges */}
              {msg.tools && msg.tools.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2 pb-2 border-b border-slate-800">
                  {msg.tools.map((t, idx) => (
                    <Badge key={idx} variant="secondary" className="text-[10px] gap-1 font-mono">
                      <Wrench className="w-3 h-3 text-purple-400" /> {t}
                    </Badge>
                  ))}
                </div>
              )}

              <p className="whitespace-pre-wrap">{msg.text}</p>

              {/* Citation Chips */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-aws-orange" /> Referenced Documents:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {msg.citations.map((c, i) => (
                      <button
                        key={i}
                        onClick={() => onSelectDocument && onSelectDocument(c.document_id)}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-aws-orange hover:bg-slate-800 transition-colors"
                      >
                        <FileText className="w-3 h-3" />
                        <span>{c.filename || c.document_id.slice(0, 8)}</span>
                        <span className="text-[10px] text-slate-500">v{c.application_version || 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {msg.sender === 'user' && (
              <div className="w-8 h-8 rounded-full bg-aws-orange/20 border border-aws-orange/40 text-aws-orange flex items-center justify-center shrink-0">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {/* Live In-Progress State */}
        {isProcessing && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-purple-900/50 border border-purple-500/40 text-purple-300 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>
            <div className="max-w-[80%] rounded-xl p-4 text-sm leading-relaxed bg-slate-950/80 border border-purple-500/30 text-slate-200 space-y-2">
              <div className="flex items-center gap-2 text-xs text-purple-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-aws-orange" />
                <span>{processingStatus || 'Reasoning with Amazon Bedrock...'}</span>
              </div>

              {activeTools.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {activeTools.map((t, idx) => (
                    <Badge key={idx} variant="secondary" className="text-[10px] gap-1 font-mono text-purple-300 animate-pulse">
                      <Wrench className="w-3 h-3 text-purple-400" /> Executing {t}...
                    </Badge>
                  ))}
                </div>
              )}

              {streamingText && (
                <div className="pt-2 border-t border-slate-800">
                  <p className="whitespace-pre-wrap">{streamingText}</p>
                  <span className="inline-block w-2 h-4 bg-aws-orange animate-pulse ml-1 align-middle" />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </CardContent>

      {/* Input Bar */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/60">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendPrompt();
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask AI about documents, policies, or loan details..."
            disabled={isProcessing}
            className="flex-1 h-11 bg-slate-900 border-slate-700 text-sm focus-visible:ring-aws-orange"
          />

          {isProcessing ? (
            <Button
              type="button"
              variant="destructive"
              onClick={handleStop}
              className="h-11 px-4 gap-2"
            >
              <StopCircle className="w-4 h-4" /> Stop
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!input.trim()}
              className="h-11 px-5 gap-2 bg-aws-orange hover:bg-aws-orangeHover text-slate-950 font-bold"
            >
              <Send className="w-4 h-4" /> Send
            </Button>
          )}
        </form>
      </div>
    </Card>
  );
}
