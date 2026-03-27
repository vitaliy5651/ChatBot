import "../styles/index.css";

import type { Metadata } from "next";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "ChatBot Clone",
  description: "Demo chat app (Next.js + Supabase)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

