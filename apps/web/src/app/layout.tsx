import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/shared/components";
import { SITE } from "@/config/site";

const nunito = Nunito({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-nunito",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: { default: SITE.name, template: `%s | ${SITE.name}` },
  description: SITE.description,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: SITE.name,
    description: SITE.description,
    siteName: SITE.name,
    type: "website",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: SITE.name,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="adventure">
      <head>
        <Script
          id="register-sw"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            }`,
          }}
        />
      </head>
      {/* dvh, not vh (screen): on an iPhone 100vh is the height with the
          Safari toolbars hidden, so a 100vh body scrolled on every page
          while the toolbars showed. dvh is the real screen either way. */}
      {/* bg-slate-950, the colour of <html> and the header bar: Safari on
          iOS 26+ fills the band under its bottom toolbar from <body>, and
          the theme's white (bg-base-100) showed a white band under every
          game in play on a real iPhone SE (2026-10-01). */}
      <body className={`${nunito.className} antialiased min-h-dvh bg-slate-950`}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
