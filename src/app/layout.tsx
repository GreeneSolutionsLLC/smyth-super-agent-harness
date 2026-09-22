import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smyth Super Agent",
  description: "Multi-tenant agent platform. OpenClaw engine, Smyth skin, Echo Vision.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full"
      suppressHydrationWarning
    >
      <head>
        {/* Greene Solutions font stack */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Rajdhani:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
          rel="stylesheet"
        />
        {/* Theme bootstrap — runs before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("smyth-theme");if(t){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.setAttribute("data-theme","dark")}}catch(e){document.documentElement.setAttribute("data-theme","dark")}})()`,
          }}
        />
      </head>
      <body className="h-full flex flex-col bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
