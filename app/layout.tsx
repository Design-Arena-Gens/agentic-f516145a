export const metadata = {
  title: "Ultra Pro Voice Changer",
  description: "Real-time voice effects in your browser",
};

import "./globals.css";
import React from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-bg text-white antialiased">
        {children}
      </body>
    </html>
  );
}
