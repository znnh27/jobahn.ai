import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse 依賴 pdfjs-dist，它會在執行時動態載入一個跟自己放在同一層的
  // pdf.worker.mjs 檔案。如果讓 Turbopack 把它打包進 .next 的快取 chunk 裡，
  // 檔案實際位置會被搬走，載入時就會找不到那個 worker 檔案（"Cannot find
  // module ... pdf.worker.mjs"）。加進這裡讓 Next.js 不要打包它，直接用
  // Node.js 原生的 require/import 去讀 node_modules 裡的原始檔案位置。
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],

  // Next.js dev server 預設只允許 localhost 存取內部的開發用資源（靜態 chunk、
  // Server Action、HMR websocket），從區網 IP（例如手機連同一個 WiFi）打開會被
  // 擋掉，症狀是畫面看起來正常但按鈕/上傳這類會呼叫 Server Action 的功能沒反應。
  // 要從區網連線測試時，在 .env.local 設定 DEV_ALLOWED_ORIGINS（多個用逗號分隔），
  // 例如 DEV_ALLOWED_ORIGINS=192.168.1.10。沒設定就只允許 localhost。
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [],
};

export default nextConfig;
