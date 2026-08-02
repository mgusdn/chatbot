import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./counseling.css";

export const metadata: Metadata = {
  title: "프바오와 나 찾기",
  description: "오늘의 방문자 흔적이 쌓이는 3D 공동서재에서 프바오와 천천히 나를 알아가는 공간",
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
