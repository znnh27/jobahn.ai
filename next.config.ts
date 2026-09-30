import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// 這台電腦目前所有的區網 IPv4 位址（換 WiFi 會變），加上 127.0.0.1。
function localOrigins(): string[] {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
  return ["127.0.0.1", ...ips];
}

const nextConfig: NextConfig = {
  // pdf-parse 依賴 pdfjs-dist，它會在執行時動態載入一個跟自己放在同一層的
  // pdf.worker.mjs 檔案。如果讓 Turbopack 把它打包進 .next 的快取 chunk 裡，
  // 檔案實際位置會被搬走，載入時就會找不到那個 worker 檔案（"Cannot find
  // module ... pdf.worker.mjs"）。加進這裡讓 Next.js 不要打包它，直接用
  // Node.js 原生的 require/import 去讀 node_modules 裡的原始檔案位置。
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],

  // Next.js dev server 預設只允許 localhost 存取內部的開發用資源（JS chunk、Server Action、
  // HMR websocket），用 127.0.0.1 或區網 IP 打開會被擋（403），症狀是畫面有出來、但 JS 沒載入：
  // 泡泡不會跟著滑鼠動、分頁切不了、按鈕沒反應（2026-09-30 Safari 就是這樣）。
  // 所以自動允許這台電腦目前的所有區網 IP（換 WiFi 也不用改設定）跟 127.0.0.1；
  // 其他裝置（例如別人的電腦）要連進來，再加到 .env.local 的 DEV_ALLOWED_ORIGINS（逗號分隔）。
  allowedDevOrigins: [
    ...localOrigins(),
    ...(process.env.DEV_ALLOWED_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []),
  ],
};

export default nextConfig;
