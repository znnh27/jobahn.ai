import type { Metadata } from "next";
import { Geist, Geist_Mono, Baloo_2, Huninn } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 陽光檸檬風格的標題字：Baloo 2 給英文/數字用，Huninn（粉圓體）給中文用。
// 兩個都是圓潤字體，接在同一個 font-family 清單裡，瀏覽器會依字元自動分流
// （拉丁字母用 Baloo 2、中文字用 Huninn），不用另外寫語言判斷邏輯。
const baloo2 = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const huninn = Huninn({
  variable: "--font-huninn",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "jobahn",
  description: "AI 找工作助手：職缺比對、履歷生成、求職信一站完成",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${baloo2.variable} ${huninn.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
