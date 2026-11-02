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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4fb" },
    { media: "(prefers-color-scheme: dark)", color: "#08080d" },
  ],
  width: "device-width",
  initialScale: 1,
};

const themeInitScript = `(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored
      ? stored === "dark"
      : !window.matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    document.documentElement.classList.add("dark");
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
