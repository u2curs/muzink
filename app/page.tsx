"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Music, Shield, User } from "lucide-react";

const ADMIN_USERNAME = "u2curs";
const ADMIN_PASSWORD = "AbCdE123#@$";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user" | null>(null);
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
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="bg-slate-800 rounded-2xl p-10 shadow-2xl border border-slate-700 text-center max-w-md w-full">
        <Music className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-1">Music Sync Player</h1>
        <p className="text-slate-400 text-sm mb-8">Choose your role to continue</p>

        <form onSubmit={handleAdminLogin} className="mb-6">
          <h2 className="text-left text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" /> Admin Login
          </h2>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-slate-700 text-slate-100 rounded-lg px-4 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-2"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-slate-700 text-slate-100 rounded-lg px-4 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-2"
          />
          {error && <p className="text-red-400 text-sm text-left mb-2">{error}</p>}
          <button
            type="submit"
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            Login as Admin
          </button>
        </form>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-700" />
          </div>
          <div className="relative flex justify-center text-xs text-slate-500">
            <span className="bg-slate-800 px-2">or</span>
          </div>
        </div>

        <button
          onClick={handleUserLogin}
          className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors border border-slate-600"
        >
          <User className="w-4 h-4" /> Login as User
        </button>
      </div>
    </div>
  );
}
