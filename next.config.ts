import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse 依賴 pdfjs-dist，它會在執行時動態載入一個跟自己放在同一層的
  // pdf.worker.mjs 檔案。如果讓 Turbopack 把它打包進 .next 的快取 chunk 裡，
  // 檔案實際位置會被搬走，載入時就會找不到那個 worker 檔案（"Cannot find
  // module ... pdf.worker.mjs"）。加進這裡讓 Next.js 不要打包它，直接用
  // Node.js 原生的 require/import 去讀 node_modules 裡的原始檔案位置。
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
