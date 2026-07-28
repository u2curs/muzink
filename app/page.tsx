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
    <div className="flex-1 flex items-center justify-center p-4 relative transition-theme">
      <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="absolute top-4 right-4 text-muted hover:text-fg transition-all duration-300 p-2 rounded-xl hover:bg-white/10">
        {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      <div className="glass rounded-3xl p-10 text-center max-w-md w-full">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center">
          <Music className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold mb-1 text-gradient-moving">Music Sync Player</h1>
        <p className="text-muted text-sm mb-8">Choose your role to continue</p>

        <form onSubmit={handleAdminLogin} className="mb-6">
          <h2 className="text-left text-sm font-semibold mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" /> Admin Login
          </h2>
          <input type="text" placeholder="Username" value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-white/10 text-fg rounded-xl px-4 py-2.5 text-sm border border-white/5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 mb-2 placeholder:text-muted/50 transition-all duration-300" />
          <input type="password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-white/10 text-fg rounded-xl px-4 py-2.5 text-sm border border-white/5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 mb-2 placeholder:text-muted/50 transition-all duration-300" />
          {error && <p className="text-red-400 text-sm text-left mb-2">{error}</p>}
          <button type="submit"
            className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 hover:scale-[1.01] active:scale-95">
            Login as Admin
          </button>
        </form>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
          <div className="relative flex justify-center text-xs"><span className="px-2 bg-transparent text-gradient-moving font-semibold">or</span></div>
        </div>

        <button onClick={handleUserLogin}
          className="w-full flex items-center justify-center gap-2 glass-strong hover:bg-emerald-500/10 text-fg font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 hover:scale-[1.01] active:scale-95 border border-emerald-500/20 hover:border-emerald-500/40">
          <User className="w-4 h-4" /> Login as User
        </button>
      </div>
    </div>
  );
}
