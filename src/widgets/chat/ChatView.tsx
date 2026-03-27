"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Image as ImageIcon, Loader2, Send, Square, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";

import { useAuth } from "@/entities/session/model/auth";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Textarea } from "@/shared/ui/textarea";
import { getSocket } from "@/shared/realtime/socket";
import { makeChatTitleFromMessage } from "@/shared/lib/chatTitle";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: Array<{ url: string; name: string }>;
  documents?: Array<{ url: string; name: string; content: string }>;
  created_at: string;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block size-1.5 rounded-full bg-gray-500/70" style={{ animation: "pulse 1s infinite" }} />
      <span
        className="inline-block size-1.5 rounded-full bg-gray-500/70"
        style={{ animation: "pulse 1s infinite", animationDelay: "150ms" }}
      />
      <span
        className="inline-block size-1.5 rounded-full bg-gray-500/70"
        style={{ animation: "pulse 1s infinite", animationDelay: "300ms" }}
      />
    </span>
  );
}

export function ChatView({ chatId }: { chatId?: string }) {
  const router = useRouter();
  const { user, accessToken, isAnonymous, anonymousQuestionsLeft, refreshAnonymousCount } = useAuth();
  const queryClient = useQueryClient();
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [anonymousPending, setAnonymousPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [images, setImages] = useState<Array<{ url: string; name: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ url: string; name: string; content: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const consumedPendingRef = useRef(false);
  const inFlightSendRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const anonAbortRef = useRef<AbortController | null>(null);

  const pendingSendKey = chatId ? `pending_send:${chatId}` : null;
  const pendingSendLockKey = chatId ? `pending_send_lock:${chatId}` : null;
  const pendingSendRaw = useMemo(() => {
    if (!pendingSendKey) return null;
    try {
      return sessionStorage.getItem(pendingSendKey);
    } catch {
      return null;
    }
  }, [pendingSendKey]);

  useEffect(() => {
    consumedPendingRef.current = false;
  }, [chatId]);

  const messagesQuery = useQuery({
    queryKey: ["messages", chatId],
    enabled: Boolean(chatId && accessToken && !isAnonymous && !pendingSendRaw),
    queryFn: async (): Promise<Message[]> => {
      const response = await fetch(`/api/chats/${chatId}/messages`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Failed to load messages");
      const data = await response.json();
      return data.messages ?? [];
    },
  });

  const readEventStream = async (
    response: Response,
    onEvent: (event: string, data: any) => void,
  ): Promise<void> => {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const lines = raw.split("\n");
        let event = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice("event:".length).trim();
          if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
        }
        const dataStr = dataLines.join("\n");
        const data = dataStr ? JSON.parse(dataStr) : null;
        onEvent(event, data);
      }
    }
  };

  const sendToChatWithStream = async (args: {
    chatId: string;
    accessToken: string;
    content: string;
    images: Array<{ url: string; name: string }>;
    documents: Array<{ url: string; name: string; content: string }>;
  }) => {
    await queryClient.cancelQueries({ queryKey: ["messages", args.chatId] });
    const abort = new AbortController();
    streamAbortRef.current?.abort();
    streamAbortRef.current = abort;

    const tempUserId = crypto.randomUUID();
    const tempAssistantId = crypto.randomUUID();
    const now = new Date().toISOString();

    const optimisticUser: Message = {
      id: tempUserId,
      role: "user",
      content: args.content,
      images: args.images.length ? args.images : undefined,
      documents: args.documents.length ? args.documents : undefined,
      created_at: now,
    };
    const optimisticAssistant: Message = {
      id: tempAssistantId,
      role: "assistant",
      content: "",
      created_at: now,
    };

    queryClient.setQueryData<Message[]>(["messages", args.chatId], (prev) => [
      ...(prev ?? []),
      optimisticUser,
      optimisticAssistant,
    ]);

    const updateAssistant = (delta: string) => {
      queryClient.setQueryData<Message[]>(["messages", args.chatId], (prev) =>
        (prev ?? []).map((m) => (m.id === tempAssistantId ? { ...m, content: m.content + delta } : m)),
      );
    };

    const replaceOptimistic = (userMessage: Message, assistantMessage: Message) => {
      queryClient.setQueryData<Message[]>(["messages", args.chatId], (prev) =>
        (prev ?? []).map((m) => {
          if (m.id === tempUserId) return userMessage;
          if (m.id === tempAssistantId) return assistantMessage;
          return m;
        }),
      );
    };

    const response = await fetch(`/api/chats/${args.chatId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.accessToken}`,
      },
      signal: abort.signal,
      body: JSON.stringify({
        content: args.content,
        images: args.images,
        documents: args.documents,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Не удалось отправить сообщение");
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/event-stream")) {
      const data = await response.json();
      replaceOptimistic(data.userMessage, data.assistantMessage);
      return;
    }

    try {
      await readEventStream(response, (event, data) => {
        if (event === "delta") updateAssistant(String(data?.delta ?? ""));
        if (event === "done") {
          replaceOptimistic(data.userMessage, data.assistantMessage);
          socketRef.current?.emit("message:created", {
            chatId: args.chatId,
            userMessage: data.userMessage,
            assistantMessage: data.assistantMessage,
          });
        }
        if (event === "error") toast.error(String(data?.error ?? "Ошибка стрима"));
      });
    } catch (e: any) {
      if (abort.signal.aborted) {
        // user stopped generation; keep partial content
        return;
      }
      throw e;
    } finally {
      if (streamAbortRef.current === abort) streamAbortRef.current = null;
    }
  };

  const messages = useMemo(() => {
    if (isAnonymous) return localMessages;
    return messagesQuery.data ?? [];
  }, [isAnonymous, localMessages, messagesQuery.data]);

  useEffect(() => {
    if (isAnonymous) return;
    if (!chatId) return;

    const socket = getSocket();
    if (!socket) return;
    socketRef.current = socket;

    socket.emit("room:join", { room: `chat:${chatId}` });

    const onMessage = (payload: { chatId: string; userMessage: Message; assistantMessage: Message }) => {
      if (payload.chatId !== chatId) return;
      queryClient.setQueryData<Message[]>(["messages", chatId], (prev) => {
        const existing = prev ?? [];
        const byId = new Set(existing.map((m) => m.id));
        const next = [...existing];
        for (const m of [payload.userMessage, payload.assistantMessage]) {
          if (m?.id && !byId.has(m.id)) {
            byId.add(m.id);
            next.push(m);
          }
        }
        return next;
      });
    };

    socket.on("message:created", onMessage);

    return () => {
      socket.off("message:created", onMessage);
      socket.emit("room:leave", { room: `chat:${chatId}` });
    };
  }, [chatId, isAnonymous, queryClient]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (!isAtBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!isAnonymous) {
      setLocalMessages([]);
    }
  }, [isAnonymous]);

  const updateAtBottom = () => {
    const el = viewportRef.current;
    if (!el) return;
    const threshold = 80;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !accessToken) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error("Пожалуйста, выберите изображение");
          continue;
        }

        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(`/api/uploads`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          setImages((prev) => [...prev, { url: data.url, name: data.fileName }]);
          toast.success("Изображение загружено");
        } else {
          toast.error("Не удалось загрузить изображение");
        }
      }
    } catch (error) {
      toast.error("Ошибка загрузки");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!accessToken) {
          toast.error("Чтобы прикреплять документы, нужно войти в аккаунт");
          continue;
        }

        // Upload to server storage first
        const formData = new FormData();
        formData.append("file", file);

        const uploadRes = await fetch(`/api/uploads`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: formData,
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          toast.error(err?.error || `Не удалось загрузить документ (HTTP ${uploadRes.status})`);
          continue;
        }

        const uploaded = await uploadRes.json();
        const signedUrl = String(uploaded?.url ?? "");
        const fileType = String(uploaded?.fileType ?? file.type ?? "");
        const fileName = String(uploaded?.fileName ?? file.name);

        const extractRes = await fetch(`/api/documents/extract`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ url: signedUrl, fileType }),
        });

        if (!extractRes.ok) {
          const err = await extractRes.json().catch(() => ({}));
          toast.error(err?.error || `Не удалось прочитать документ (HTTP ${extractRes.status})`);
          continue;
        }

        const extracted = await extractRes.json();
        const content = String(extracted?.content ?? "").slice(0, 60000);

        setDocuments((prev) => [...prev, { url: signedUrl, name: fileName, content }]);
        toast.success("Документ добавлен");
      }
    } catch (error) {
      toast.error("Ошибка чтения документа");
    } finally {
      setUploading(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeDocument = (index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  useLayoutEffect(() => {
    if (!chatId || !accessToken || isAnonymous) return;
    if (consumedPendingRef.current) return;

    const raw = pendingSendRaw;
    if (!raw || !pendingSendKey) return;
    if (pendingSendLockKey) {
      try {
        if (sessionStorage.getItem(pendingSendLockKey)) return;
        sessionStorage.setItem(pendingSendLockKey, "1");
      } catch {
        // ignore
      }
    }

    consumedPendingRef.current = true;
    sessionStorage.removeItem(pendingSendKey);
    const pending = JSON.parse(raw);

    setSending(true);
    sendToChatWithStream({
      chatId,
      accessToken,
      content: String(pending.content ?? ""),
      images: Array.isArray(pending.images) ? pending.images : [],
      documents: Array.isArray(pending.documents) ? pending.documents : [],
    })
      .catch((e: any) => toast.error(e?.message ?? "Ошибка отправки сообщения"))
      .finally(() => {
        setSending(false);
        if (pendingSendLockKey) {
          try {
            sessionStorage.removeItem(pendingSendLockKey);
          } catch {
            // ignore
          }
        }
      });
  }, [accessToken, chatId, isAnonymous, pendingSendKey, pendingSendRaw]);

  const sendMessage = async () => {
    if (inFlightSendRef.current) return;
    if (sending || anonymousPending) return;
    if (!inputValue.trim() && images.length === 0) return;

    if (isAnonymous && anonymousQuestionsLeft <= 0) {
      toast.error("Вы исчерпали бесплатные вопросы. Пожалуйста, войдите в систему.");
      router.push("/auth");
      return;
    }

    const shouldAutoCreateChat = Boolean(user && accessToken && !chatId && !isAnonymous);

    if (isAnonymous) {
      inFlightSendRef.current = true;
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: inputValue,
        images: images.length > 0 ? images : undefined,
        documents: documents.length > 0 ? documents : undefined,
        created_at: new Date().toISOString(),
      };

      setLocalMessages((prev) => [...prev, userMessage]);
      setInputValue("");
      setImages([]);
      setDocuments([]);

      setAnonymousPending(true);
      try {
        const abort = new AbortController();
        anonAbortRef.current?.abort();
        anonAbortRef.current = abort;

        const anonymousId = localStorage.getItem("anonymous_id");
        const response = await fetch(`/api/anonymous/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Anonymous-ID": anonymousId ?? "",
          },
          signal: abort.signal,
          body: JSON.stringify({
            content: userMessage.content,
            documents: userMessage.documents ?? [],
            stream: true,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || "Не удалось получить ответ");
        }

        const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
        const assistantId = crypto.randomUUID();
        setLocalMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString() },
        ]);

        const appendDelta = (delta: string) => {
          setLocalMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
        };

        if (contentType.includes("text/event-stream")) {
          await readEventStream(response, (event, data) => {
            if (event === "delta") appendDelta(String(data?.delta ?? ""));
            if (event === "done") {
              const full = String(data?.content ?? "");
              setLocalMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: full } : m)));
            }
            if (event === "error") {
              toast.error(String(data?.error ?? "Ошибка стрима"));
            }
          });
        } else {
          const data = await response.json();
          const full = String(data?.content ?? "");
          setLocalMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: full } : m)));
        }

        await refreshAnonymousCount();
      } catch (e: any) {
        if (anonAbortRef.current?.signal.aborted) return;
        toast.error(e?.message ?? "Ошибка анонимного запроса");
      } finally {
        setAnonymousPending(false);
        inFlightSendRef.current = false;
        anonAbortRef.current = null;
      }

      return;
    }

    if (!accessToken) return;

    inFlightSendRef.current = true;
    const content = inputValue;
    setInputValue("");
    const currentImages = [...images];
    const currentDocuments = [...documents];
    setImages([]);
    setDocuments([]);

    try {
      if (shouldAutoCreateChat) {
        const title = makeChatTitleFromMessage(content);
        const createChatRes = await fetch("/api/chats", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ title }),
        });

        if (!createChatRes.ok) {
          const err = await createChatRes.json().catch(() => ({}));
          throw new Error(err.error || "Не удалось создать чат");
        }

        const created = await createChatRes.json();
        const newChatId = created?.chat?.id as string | undefined;
        if (!newChatId) throw new Error("Не удалось создать чат");

        sessionStorage.setItem(
          `pending_send:${newChatId}`,
          JSON.stringify({ content, images: currentImages, documents: currentDocuments }),
        );
        router.push(`/chat/${newChatId}`);
        return;
      }

      if (!chatId) return;
      setSending(true);
      await sendToChatWithStream({
        chatId,
        accessToken,
        content,
        images: currentImages,
        documents: currentDocuments,
      });
    } catch (error: any) {
      // rollback inputs on error (basic)
      setInputValue(content);
      setImages(currentImages);
      setDocuments(currentDocuments);
      toast.error(error?.message ?? "Ошибка отправки сообщения");
    } finally {
      setSending(false);
      inFlightSendRef.current = false;
    }
  };

  const stopStreaming = () => {
    streamAbortRef.current?.abort();
    anonAbortRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea
        className="flex-1 overflow-y-auto"
        viewportRef={viewportRef}
        viewportProps={{
          className: "p-4",
          onScroll: updateAtBottom,
        }}
      >
        {!isAnonymous && messages.length === 0 && (messagesQuery.isLoading || (chatId && sending)) ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-500">Загрузка…</div>
        ) : messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-4 max-w-2xl">
              <h2 className="text-4xl font-bold">Как я могу помочь вам сегодня?</h2>
              <p className="text-gray-500">
                {isAnonymous
                  ? `У вас есть ${anonymousQuestionsLeft} бесплатных вопроса. Войдите для неограниченного доступа.`
                  : "Начните новый разговор или выберите существующий чат из боковой панели."}
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6 pb-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    message.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
                  }`}
                >
                  {message.images && message.images.length > 0 && (
                    <div className="mb-2 space-y-2">
                      {message.images.map((img, idx) => (
                        <div key={idx} className="relative">
                          <img src={img.url} alt={img.name} className="rounded-lg max-w-full h-auto" />
                          <div className="text-xs mt-1 opacity-75">{img.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {message.documents && message.documents.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {message.documents.map((doc, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm opacity-75">
                          <FileText className="size-4" />
                          <span>{doc.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    {message.role === "assistant" ? (
                      message.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      ) : (
                        <TypingDots />
                      )
                    ) : (
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t border-gray-200 p-4">
        <div className="max-w-3xl mx-auto">
          {(images.length > 0 || documents.length > 0) && (
            <div className="mb-3 flex flex-wrap gap-2">
              {images.map((img, idx) => (
                <div
                  key={`img-${idx}`}
                  className="relative bg-gray-100 rounded-lg p-2 pr-8 flex items-center gap-2"
                >
                  <ImageIcon className="size-4 text-gray-600" />
                  <span className="text-sm">{img.name}</span>
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute right-1 top-1 p-1 hover:bg-gray-200 rounded"
                    aria-label="Remove image"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {documents.map((doc, idx) => (
                <div
                  key={`doc-${idx}`}
                  className="relative bg-gray-100 rounded-lg p-2 pr-8 flex items-center gap-2"
                >
                  <FileText className="size-4 text-gray-600" />
                  <span className="text-sm">{doc.name}</span>
                  <button
                    onClick={() => removeDocument(idx)}
                    className="absolute right-1 top-1 p-1 hover:bg-gray-200 rounded"
                    aria-label="Remove document"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <div className="flex-1 relative">
              <Textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Напишите сообщение..."
                className="resize-none pr-24 min-h-[56px] max-h-[200px]"
                disabled={sending || uploading || anonymousPending}
              />
              <div className="absolute right-2 bottom-2 flex gap-1">
                {user && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending || uploading}
                      className="size-8"
                    >
                      <ImageIcon className="size-4" />
                    </Button>

                    <input
                      ref={docInputRef}
                      type="file"
                      accept=".txt,.md,.pdf,.docx"
                      multiple
                      onChange={handleDocumentUpload}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => docInputRef.current?.click()}
                      disabled={sending || uploading}
                      className="size-8"
                    >
                      <FileText className="size-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <Button
              onClick={sendMessage}
              disabled={
                sending ||
                uploading ||
                anonymousPending ||
                (!inputValue.trim() && images.length === 0)
              }
              size="icon"
              className="size-14 rounded-xl"
            >
              {sending || uploading || anonymousPending ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
            </Button>
          </div>

          {(sending || anonymousPending) && (
            <div className="mt-2 flex justify-center">
              <Button type="button" variant="outline" onClick={stopStreaming} className="gap-2">
                <Square className="size-4" />
                Остановить генерацию
              </Button>
            </div>
          )}

          {isAnonymous && (
            <div className="mt-2 text-xs text-center text-gray-500">
              Осталось {anonymousQuestionsLeft} бесплатных вопроса
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

