import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Rivals Connections",
    template: "%s · Rivals Connections",
  },
  description:
    "An interactive Marvel Rivals team-up network and six-hero composition builder.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
