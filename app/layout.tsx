import type { Metadata, Viewport } from "next";
import { SITE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${SITE.name} — Tải nhạc YouTube thành MP3`,
    template: `%s | ${SITE.name}`,
  },
  description:
    "Chuyển video YouTube thành MP3 chất lượng cao trực tiếp trên trình duyệt. Miễn phí, không quảng cáo, không cần đăng ký.",
  keywords: [
    "youtube to mp3",
    "tải nhạc youtube",
    "chuyển youtube sang mp3",
    "youtube mp3",
    "tải mp3",
  ],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    title: `${SITE.name} — Tải nhạc YouTube thành MP3`,
    description:
      "Dán link YouTube, chọn chất lượng và tải MP3 ngay trên trình duyệt. Miễn phí, không quảng cáo.",
    siteName: SITE.name,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — Tải nhạc YouTube thành MP3`,
    description: "Chuyển video YouTube thành MP3 trực tiếp trên trình duyệt.",
  },
};

export const viewport: Viewport = {
  themeColor: "#08080d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
