"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";

import { useAuth } from "@/entities/session/model/auth";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

export function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignUp) {
        await signUp(email, password, name);
        toast.success("Аккаунт создан успешно!");
      } else {
        await signIn(email, password);
        toast.success("Вход выполнен!");
      }
      router.push("/");
    } catch (error: any) {
      toast.error(error.message || "Ошибка авторизации");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-blue-600 rounded-full">
              <MessageSquare className="size-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">{isSignUp ? "Создать аккаунт" : "Войти"}</CardTitle>
          <CardDescription>
            {isSignUp ? "Зарегистрируйтесь для неограниченного доступа" : "Войдите в свой аккаунт"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div className="space-y-2">
                <Label htmlFor="name">Имя</Label>
                <Input
                  id="name"
                  placeholder="Ваше имя"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Загрузка..." : isSignUp ? "Зарегистрироваться" : "Войти"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            {isSignUp ? (
              <span>
                Уже есть аккаунт?{" "}
                <button
                  type="button"
                  onClick={() => setIsSignUp(false)}
                  className="text-blue-600 hover:underline font-medium"
                >
                  Войти
                </button>
              </span>
            ) : (
              <span>
                Нет аккаунта?{" "}
                <button
                  type="button"
                  onClick={() => setIsSignUp(true)}
                  className="text-blue-600 hover:underline font-medium"
                >
                  Зарегистрироваться
                </button>
              </span>
            )}
          </div>
          <div className="mt-4 text-center">
            <Button type="button" variant="ghost" onClick={() => router.push("/")} className="text-sm">
              Продолжить как гость
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

