import React from "react";
import { ChatLayout } from "@/widgets/chat/ChatLayout";

export default function ChatRootLayout({ children }: { children: React.ReactNode }) {
  return <ChatLayout>{children}</ChatLayout>;
}

