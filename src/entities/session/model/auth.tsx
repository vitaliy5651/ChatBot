"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/shared/config/supabase";

interface User {
  id: string;
  email?: string;
  name?: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isAnonymous: boolean;
  anonymousId: string | null;
  anonymousQuestionsLeft: number;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAnonymousCount: () => Promise<void>;
  incrementAnonymousCount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const [anonymousQuestionsLeft, setAnonymousQuestionsLeft] = useState(3);
  const [loading, setLoading] = useState(true);

  const supabase = useMemo(() => {
    if (!supabaseEnv.url || !supabaseEnv.anonKey) return null;
    return createClient(supabaseEnv.url, supabaseEnv.anonKey);
  }, []);

  // Initialize anonymous ID
  useEffect(() => {
    let anonId = localStorage.getItem("anonymous_id");
    if (!anonId) {
      anonId = crypto.randomUUID();
      localStorage.setItem("anonymous_id", anonId);
    }
    setAnonymousId(anonId);
  }, []);

  // Check for existing session
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (!supabase) {
          setLoading(false);
          return;
        }
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error("Error getting session:", error);
          setLoading(false);
          return;
        }

        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata?.name,
          });
          setAccessToken(session.access_token);
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.name,
        });
        setAccessToken(session.access_token);
      } else {
        setUser(null);
        setAccessToken(null);
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const refreshAnonymousCount = async () => {
    if (!anonymousId) return;

    try {
      const response = await fetch(`/api/anonymous/usage`, {
        headers: {
          "X-Anonymous-ID": anonymousId,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setAnonymousQuestionsLeft(3 - data.count);
      }
    } catch (error) {
      console.error("Error refreshing anonymous count:", error);
    }
  };

  const incrementAnonymousCount = async () => {
    if (!anonymousId) return;

    try {
      const response = await fetch(`/api/anonymous/usage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Anonymous-ID": anonymousId,
        },
        body: JSON.stringify({ delta: 1 }),
      });

      if (response.ok) {
        const data = await response.json();
        setAnonymousQuestionsLeft(3 - data.count);
      }
    } catch (error) {
      console.error("Error incrementing anonymous count:", error);
    }
  };

  useEffect(() => {
    if (anonymousId && !user) {
      refreshAnonymousCount();
    }
  }, [anonymousId, user]);

  const signIn = async (email: string, password: string) => {
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    if (data.session?.user) {
      setUser({
        id: data.session.user.id,
        email: data.session.user.email,
        name: data.session.user.user_metadata?.name,
      });
      setAccessToken(data.session.access_token);
    }
  };

  const signUp = async (email: string, password: string, name?: string) => {
    if (!supabase) throw new Error("Supabase is not configured");
    const response = await fetch(`/api/auth/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, name }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Sign up failed");
    }

    await signIn(email, password);
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setAccessToken(null);
  };

  if (loading) {
    return (
      <div className="size-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900" />
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isAnonymous: !user,
        anonymousId,
        anonymousQuestionsLeft,
        signIn,
        signUp,
        signOut,
        refreshAnonymousCount,
        incrementAnonymousCount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

