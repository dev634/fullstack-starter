import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import LogoutButton from "@/components/LogoutButton";
import { LocaleProvider } from "@/components/LocaleProvider";
import { auth } from "@/lib/auth";
import { getAdminAccess } from "@/lib/adminAccess";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getAppSettings } from "@/lib/appSettings";

// Belt-and-suspenders re-validation of stored colors before they're
// interpolated into a raw <style> tag — the DB values are already validated
// on write (schemas/appSettings.ts), but a value edited directly in the
// database should never be trusted for injection into HTML.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
function safeHex(value: string, fallback: string): string {
  return HEX_COLOR.test(value) ? value : fallback;
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();
  return {
    title: settings.appName,
    description: "Manage your clients — a Next.js, Prisma and PostgreSQL starter.",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const isClient = session?.user?.role === "CLIENT";
  const adminAccess = await getAdminAccess(session?.user?.role);
  const locale = await getLocale();
  const t = getDictionary(locale);
  const settings = await getAppSettings();
  const primaryColor = safeHex(settings.primaryColor, "#3b82f6");
  const accentColor = safeHex(settings.accentColor, "#8b5cf6");
  // Set by proxy.ts on every request — authorizes the two inline tags below
  // under the nonce-based CSP (see proxy.ts for why).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <head>
        {/* Branding tokens, server-rendered so there's no flash of the
            default colors — consumed via @theme inline in globals.css. */}
        <style
          nonce={nonce}
          // The nonce legitimately differs between the SSR pass and any
          // later client render (a fresh one is minted per request, and
          // browsers never expose it back via the DOM) — expected per
          // Next.js's own CSP-nonce guide, not a real hydration bug.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `:root{--primary:${primaryColor};--accent:${accentColor}}`,
          }}
        />
        {/* Apply the saved (or system) theme before paint to avoid a flash. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body className="flex flex-col h-dvh overflow-y-hidden">
        <LocaleProvider locale={locale}>
          <Navbar
            brand={{
              href: "/",
              display: settings.logoUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local asset next/image can optimize at build time */}
                  <img src={settings.logoUrl} alt={settings.appName} className="block h-8 w-auto" />
                  <span>{settings.appName}</span>
                </>
              ) : (
                settings.appName
              ),
            }}
            links={
              !session
                ? []
                : isClient
                  ? // Client-portal logins only ever see their own projects.
                    [{ href: "/portail", display: t.portal.myProjects }]
                  : [
                      { href: "/clients", display: t.nav.clients },
                      { href: "/projects", display: t.nav.projects },
                      // Administration groups the Fonctions / Utilisateurs /
                      // Theme / Section order / Rôles & accès tabs behind one
                      // link; shown when the role can open at least one, and
                      // points at the first accessible tab.
                      ...(adminAccess.any
                        ? [{ href: adminAccess.landing!, display: t.nav.admin }]
                        : []),
                    ]
            }
            action={session ? <LogoutButton /> : undefined}
          />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
