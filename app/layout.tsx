import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WSHS Science Day Stamp",
  description: "Secure stamp, profile, leaderboard, and reward coupon system for Wooshin High School Science Day."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
