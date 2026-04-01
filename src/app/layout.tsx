import type { Metadata } from "next";
import { Nunito_Sans, JetBrains_Mono, Host_Grotesk } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SupabaseLockGuard } from "@/components/SupabaseLockGuard";
import "./globals.css";

const nunitoSans = Nunito_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const hostGrotesk = Host_Grotesk({
  variable: "--font-logo",
  subsets: ["latin"],
  weight: "700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PROLOG — For Health & Care Workers",
  description: "AI-powered clinical de-escalation training through realistic voice simulations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${nunitoSans.variable} ${jetbrainsMono.variable} ${hostGrotesk.variable} h-full`}
    >
      <body className="min-h-full flex flex-col antialiased">
        <SupabaseLockGuard />
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
