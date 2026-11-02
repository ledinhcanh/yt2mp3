"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setMounted(true);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";

    document.documentElement.classList.toggle("dark", next === "dark");
    setTheme(next);

    try {
      localStorage.setItem("theme", next);
    } catch {
      // ignore private-mode storage errors
    }
  }

  const label = mounted
    ? theme === "dark"
      ? "Chuyển sang chế độ sáng"
      : "Chuyển sang chế độ tối"
    : "Chuyển chế độ sáng tối";

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {mounted && (
        <svg key={theme} className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
          {theme === "dark" ? (
            <path
              d="M12 3v1.8m0 14.4V21m9-9h-1.8M4.8 12H3m15.36 6.36-1.27-1.27M6.91 6.91 5.64 5.64m12.72 0-1.27 1.27M6.91 17.09l-1.27 1.27M12 8.1a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}
    </button>
  );
}
