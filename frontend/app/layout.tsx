import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./counseling.css";

export const metadata: Metadata = {
  title: "프바오 마음연구소",
  description: "오늘의 방문자 흔적이 쌓이는 3D 공동서재에서 프바오와 이야기를 나누는 로컬 AI 상담 데모",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#e8dfcc",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
