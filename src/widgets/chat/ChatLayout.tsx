"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogIn, LogOut, Menu, MessageSquare, Plus, Trash2, User, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/entities/session/model/auth";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Chat } from "@/types/chat.types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";

export function ChatLayout({ children }: { children: React.ReactNode }) {
  const { user, accessToken, signOut, isAnonymous, anonymousQuestionsLeft } = useAuth();
  const router = useRouter();
  const params = useParams<{ chatId?: string }>();
  const activeChatId = useMemo(() => (typeof params?.chatId === "string" ? params.chatId : null), [params]);
  const queryClient = useQueryClient();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<Chat | null>(null);

  const chatsQuery = useQuery({
    queryKey: ["chats", user?.id],
    enabled: Boolean(user && accessToken),
    queryFn: async (): Promise<Chat[]> => {
      const response = await fetch("/api/chats", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err: any = new Error(data?.error || "Failed to load chats");
        err.code = data?.code;
        throw err;
      }
      return data.chats ?? [];
    },
    staleTime: 3000,
    retry: false,
    refetchInterval: (query) => (query.state.status === "error" ? false : 3000),
  });

  const createChatMutation = useMutation({
    mutationFn: async (): Promise<Chat> => {
      const response = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (!response.ok) throw new Error("Не удалось создать чат");
      const data = await response.json();
      return data.chat;
    },
    onSuccess: async (chat) => {
      await queryClient.invalidateQueries({ queryKey: ["chats", user?.id] });
      router.push(`/chat/${chat.id}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Не удалось создать чат"),
  });

  const deleteChatMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/chats/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Не удалось удалить чат");
      return id;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["chats", user?.id] });
      if (activeChatId === id) router.push("/");
      toast.success("Чат удален");
    },
    onError: (e: any) => toast.error(e?.message ?? "Не удалось удалить чат"),
  });

  const createNewChat = () => {
    if (isAnonymous) {
      router.push("/");
      return;
    }
    createChatMutation.mutate();
  };

  const deleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const chat = (chatsQuery.data ?? []).find((c) => c.id === id) ?? null;
    setChatToDelete(chat);
    setDeleteDialogOpen(true);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
    toast.success("Вы вышли из аккаунта");
  };

  return (
    <div className="flex h-screen bg-white">
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить чат?</AlertDialogTitle>
            <AlertDialogDescription>
              {chatToDelete?.title
                ? `Чат “${chatToDelete.title}” будет удалён без возможности восстановления.`
                : "Чат будет удалён без возможности восстановления."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteChatMutation.isPending}
              onClick={() => {
                setChatToDelete(null);
              }}
            >
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteChatMutation.isPending}
              onClick={() => {
                if (!chatToDelete?.id) return;
                deleteChatMutation.mutate(chatToDelete.id, {
                  onSettled: () => {
                    setDeleteDialogOpen(false);
                    setChatToDelete(null);
                  },
                });
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } transition-all duration-300 border-r border-gray-200 flex flex-col bg-gray-50`}
      >
        {sidebarOpen && (
          <>
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-6 text-blue-600" />
                  <h1 className="font-bold text-lg">ChatGPT Clone</h1>
                </div>
              </div>
              {user ? (
                <Button
                  onClick={createNewChat}
                  className="w-full"
                  disabled={createChatMutation.isPending}
                >
                  <Plus className="size-4 mr-2" />
                  Новый чат
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm text-gray-600 text-center">
                    {anonymousQuestionsLeft > 0 ? (
                      <span>Осталось {anonymousQuestionsLeft} бесплатных вопроса</span>
                    ) : (
                      <span className="text-red-600">Лимит исчерпан</span>
                    )}
                  </div>
                  <Button onClick={() => router.push("/auth")} className="w-full" variant="default">
                    <LogIn className="size-4 mr-2" />
                    Войти / Регистрация
                  </Button>
                </div>
              )}
            </div>

            <ScrollArea className="flex-1 overflow-y-auto">
              <div className="w-64 p-2 space-y-1">
                {user && chatsQuery.isLoading && (
                  <div className="text-center text-sm text-gray-500 py-8">Загрузка…</div>
                )}
                {user && chatsQuery.isError && (
                  <div className="text-center text-sm text-red-600 py-8">
                    {(chatsQuery.error as any)?.code === "DB_SCHEMA_MISSING"
                      ? "База не инициализирована. Примените `supabase/schema.sql` в Supabase и обновите страницу."
                      : "Не удалось загрузить чаты"}
                  </div>
                )}
                {user && !chatsQuery.isLoading && (chatsQuery.data?.length ?? 0) === 0 && (
                  <div className="text-center text-sm text-gray-500 py-8">Нет чатов. Создайте новый!</div>
                )}
                {(chatsQuery.data ?? []).map((chat) => (
                  <Link
                    key={chat.id}
                    href={`/chat/${chat.id}`}
                    className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer hover:bg-gray-200 transition-colors ${
                      activeChatId === chat.id ? "bg-gray-200" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{chat.title}</div>
                    </div>
                    <button
                      onClick={(e) => deleteChat(chat.id, e)}
                      disabled={deleteChatMutation.isPending}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-300 rounded transition-opacity"
                      aria-label="Delete chat"
                    >
                      <Trash2 className="size-4 text-red-600" />
                    </button>
                  </Link>
                ))}
              </div>
            </ScrollArea>

            <div className="p-4 border-t border-gray-200">
              {user ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="size-4" />
                    <span className="truncate">{user.email}</span>
                  </div>
                  <Button onClick={handleSignOut} variant="ghost" className="w-full justify-start">
                    <LogOut className="size-4 mr-2" />
                    Выйти
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-gray-500 text-center">Режим гостя</div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        <div className="h-14 border-b border-gray-200 flex items-center px-4">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>

        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

