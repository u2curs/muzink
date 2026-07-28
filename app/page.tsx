"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Music, Shield, User, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";

const ADMIN_USERNAME = "u2curs";
const ADMIN_PASSWORD = "AbCdE123#@$";

export default function LoginPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("music-sync-role");
    if (saved === "admin") router.replace("/admin");
    else if (saved === "user") router.replace("/client");
  }, [router]);

  function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      localStorage.setItem("music-sync-role", "admin");
      router.push("/admin");
    } else {
      setError("Invalid admin credentials");
    }
  }

  function handleUserLogin() {
    localStorage.setItem("music-sync-role", "user");
    router.push("/client");
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6 relative transition-theme">
      <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="absolute top-6 right-6 text-muted hover:text-main transition-all duration-300 p-3 rounded-xl hover:bg-accent-soft spring-btn"
        style={{ transitionTimingFunction: "var(--spring)" }}>
        {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      <div className="glass-card p-12 text-center max-w-md w-full" style={{ borderRadius: "32px" }}>
        <div className="w-14 h-14 mx-auto mb-6 rounded-2xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2))" }}>
          <Music className="w-7 h-7 text-white" />
        </div>

        <h1 className="font-serif text-4xl font-bold mb-2 text-gradient-moving" style={{ letterSpacing: "-0.03em", lineHeight: 1.1 }}>
          Music Sync
        </h1>
        <p className="text-muted text-sm mb-10" style={{ lineHeight: 1.65 }}>
          Synchronized listening, anywhere
        </p>

        <form onSubmit={handleAdminLogin} className="mb-8">
          <h2 className="text-left text-xs font-semibold mb-4 flex items-center gap-2 text-muted uppercase tracking-wider">
            <Shield className="w-3.5 h-3.5" /> Admin Login
          </h2>
          <input type="text" placeholder="Username" value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-surface text-main rounded-xl px-4 py-3 text-sm border border-subtle focus:outline-none focus:ring-2 mb-3 placeholder:text-subtle transition-all duration-300"
            style={{ boxShadow: "var(--shadow-sm)", borderRadius: "12px", "--tw-ring-color": "var(--accent-soft)" } as React.CSSProperties} />
          <input type="password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-surface text-main rounded-xl px-4 py-3 text-sm border border-subtle focus:outline-none focus:ring-2 mb-3 placeholder:text-subtle transition-all duration-300"
            style={{ boxShadow: "var(--shadow-sm)", borderRadius: "12px", "--tw-ring-color": "var(--accent-soft)" } as React.CSSProperties} />
          {error && <p className="text-red-400 text-sm text-left mb-3">{error}</p>}
          <button type="submit"
            className="spring-btn w-full text-white font-semibold py-3 px-4 rounded-xl transition-all"
            style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2))", borderRadius: "12px" }}>
            Login as Admin
          </button>
        </form>

        <div className="relative mb-8">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t" style={{ borderColor: "var(--border-subtle)" }} /></div>
          <div className="relative flex justify-center text-xs">
            <span className="px-3 text-muted font-medium" style={{ background: "var(--glass-bg)" }}>or continue as</span>
          </div>
        </div>

        <button onClick={handleUserLogin}
          className="spring-btn w-full flex items-center justify-center gap-2 font-semibold py-3 px-4 rounded-xl transition-all border"
          style={{ borderRadius: "12px", borderColor: "var(--border-default)", color: "var(--text-main)", background: "var(--bg-surface)", boxShadow: "var(--shadow-sm)" }}>
          <User className="w-4 h-4" /> Listener
        </button>
      </div>
    </div>
  );
}
