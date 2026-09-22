import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Setup — Smyth",
  description: "Configure Smyth on your Mac.",
};

export default function SetupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
