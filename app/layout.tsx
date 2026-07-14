import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import LogoutButton from "@/components/LogoutButton";
import { LocaleProvider } from "@/components/LocaleProvider";
import { auth } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fullstack Starter",
  description: "Manage your clients — a Next.js, Prisma and PostgreSQL starter.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const locale = await getLocale();
  const t = getDictionary(locale);
  // Set by proxy.ts on every request — authorizes the inline script below
  // under the nonce-based CSP (see proxy.ts for why).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <head>
        {/* Apply the saved (or system) theme before paint to avoid a flash. */}
        <script
          nonce={nonce}
          // The nonce legitimately differs between the SSR pass and any
          // later client render (a fresh one is minted per request, and
          // browsers never expose it back via the DOM) — expected per
          // Next.js's own CSP-nonce guide, not a real hydration bug.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body className="flex flex-col h-dvh overflow-y-hidden">
        <LocaleProvider locale={locale}>
          <Navbar
            brand={{ href: "/", display: t.common.brand }}
            links={session ? [
              { href: "/clients", display: t.nav.clients },
              { href: "/projects", display: t.nav.projects },
            ] : []}
            action={session ? <LogoutButton /> : undefined}
          />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
