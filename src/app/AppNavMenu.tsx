"use client";

import { useEffect, useRef, type ReactNode } from "react";

// 原生 <details> 點外面不會自動收起，這裡補上：點選單以外的地方或按 Esc 就關閉。
export function AppNavMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close(e: Event) {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) {
        el.open = false;
      }
    }
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="app-nav-menu">
      {children}
    </details>
  );
}
