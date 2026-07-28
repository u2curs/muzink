"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { syncClock, getServerTime } from "@/lib/timeSync";
import { useTheme } from "next-themes";
import {
  Upload, Play, Pause, Music, LogOut, Download, Radio, Sun, Moon,
  Heart, Disc, PanelRight, Volume2, List,
} from "lucide-react";

interface Track { id: number; title: string; file_url: string; }
interface Reaction { id: number; emoji: string; x: number; }

const EMOJIS = ["❤️", "🔥", "🌟", "🎵", "💚", "💜", "✨"];

export default function AdminPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [envMissing, setEnvMissing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);

  const [phase, setPhase] = useState<"idle" | "playing" | "paused">("idle");
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<any>(null);
  const channelRef = useRef<any>(null);
  const syncRef = useRef<any>(null);
  const playStartRef = useRef(0);
  const pausePositionRef = useRef(0);
  const [ntpReady, setNtpReady] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem("music-sync-role");
    if (role !== "admin") router.replace("/");
  }, [router]);

  useEffect(() => {
    syncClock().then(() => setNtpReady(true));
  }, []);

  useEffect(() => {
    if (!supabase) { setEnvMissing(true); return; }
    fetchTracks();

    const channel = supabase.channel("audio-sync");
    channelRef.current = channel;

    channel.on("broadcast", { event: "REQUEST_STATE" }, () => {
      if (activeTrack && (phase === "playing" || phase === "paused")) {
        const elapsed = phase === "playing" ? (getServerTime() - playStartRef.current) / 1000 : pausePositionRef.current;
        channel.send({
          type: "broadcast", event: "STATE", payload: {
            track: activeTrack.file_url, title: activeTrack.title,
            start_time: phase === "playing" ? playStartRef.current : getServerTime(),
            position: Math.max(0, elapsed), is_paused: phase === "paused",
          },
        });
      }
    });

    channel.on("broadcast", { event: "REACT" }, (payload: any) => {
      const r: Reaction = { id: getServerTime() + Math.random(), emoji: payload.payload.emoji || EMOJIS[Math.floor(Math.random() * EMOJIS.length)], x: Math.random() * 70 + 15 };
      setReactions((prev) => [...prev, r]);
      setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== r.id)), 3500);
    });

    channel.subscribe();
    channel.track({ type: "admin", state: "idle" });
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!channelRef.current) return;
    if (phase === "playing" && activeTrack) {
      channelRef.current.track({ type: "admin", state: "playing", track: activeTrack.file_url, title: activeTrack.title, start_time: playStartRef.current, updated_at: getServerTime() });
      syncRef.current = setInterval(() => {
        if (!channelRef.current) return;
        channelRef.current.track({ type: "admin", state: "playing", track: activeTrack.file_url, title: activeTrack.title, start_time: playStartRef.current, position: Math.max(0, (getServerTime() - playStartRef.current) / 1000), updated_at: getServerTime() });
      }, 2000);
    } else if (phase === "paused" && activeTrack) {
      channelRef.current.track({ type: "admin", state: "paused", track: activeTrack.file_url, title: activeTrack.title, position: pausePositionRef.current, updated_at: getServerTime() });
    } else {
      channelRef.current.track({ type: "admin", state: "idle" });
    }
    return () => { if (syncRef.current) clearInterval(syncRef.current); };
  }, [phase, activeTrack]);

  async function fetchTracks() {
    const { data } = await supabase.from("playlist").select("*").order("id", { ascending: false });
    if (data) setTracks(data);
  }

  async function handleUpload() {
    if (!supabase) return;
    const file = fileRef.current?.files?.[0];
    if (!file || !title) return;
    setUploading(true);
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `public/${Date.now()}_${sanitized}`;
    const { error: uploadError } = await supabase.storage.from("tracks").upload(filePath, file);
    if (uploadError) { alert("Upload failed: " + uploadError.message); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("tracks").getPublicUrl(filePath);
    const { error: dbError } = await supabase.from("playlist").insert({ title, file_url: urlData.publicUrl });
    if (dbError) alert("DB insert failed: " + dbError.message);
    else { setTitle(""); if (fileRef.current) fileRef.current.value = ""; fetchTracks(); }
    setUploading(false);
  }

  async function handlePlay(track: Track) {
    if (!supabase) return;
    setActiveTrack(track);

    const targetTime = getServerTime() + 1500;
    playStartRef.current = targetTime;
    setCountdown(100);

    await supabase.channel("audio-sync").send({ type: "broadcast", event: "PREPARE", payload: { track: track.file_url, title: track.title } });

    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, targetTime - getServerTime());
      const pct = (remaining / 1500) * 100;
      setCountdown(pct);
      if (remaining <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(0);
      }
    }, 16);

    setTimeout(async () => {
      setPhase("playing");
      await supabase.channel("audio-sync").send({
        type: "broadcast", event: "PLAY", payload: {
          track: track.file_url, title: track.title,
          start_time: targetTime, position: 0,
        },
      });
    }, 1500);
  }

  async function handlePause() {
    if (!supabase || phase !== "playing" || !activeTrack) return;
    pausePositionRef.current = Math.max(0, (getServerTime() - playStartRef.current) / 1000);
    if (syncRef.current) clearInterval(syncRef.current);
    setPhase("paused");
    await supabase.channel("audio-sync").send({ type: "broadcast", event: "PAUSE", payload: { position: pausePositionRef.current } });
  }

  async function handleResume() {
    if (!supabase || phase !== "paused" || !activeTrack) return;
    const targetTime = getServerTime() + 1500;
    playStartRef.current = targetTime;
    setCountdown(100);

    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, targetTime - getServerTime());
      setCountdown((remaining / 1500) * 100);
      if (remaining <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(0);
      }
    }, 16);

    setTimeout(async () => {
      setPhase("playing");
      await supabase.channel("audio-sync").send({
        type: "broadcast", event: "PLAY", payload: {
          track: activeTrack.file_url, title: activeTrack.title,
          start_time: targetTime, position: pausePositionRef.current,
        },
      });
    }, 1500);
  }

  function handleStop() {
    setPhase("idle"); setActiveTrack(null);
    if (syncRef.current) clearInterval(syncRef.current);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; setCountdown(0); }
    if (channelRef.current) { channelRef.current.track({ type: "admin", state: "idle" }); channelRef.current.send({ type: "broadcast", event: "STOP", payload: {} }); }
  }

  function handleLogout() { localStorage.removeItem("music-sync-role"); router.push("/"); }

  if (envMissing) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 text-center max-w-md">
          <h1 className="text-xl font-bold mb-2 text-gradient-moving">Configuration Required</h1>
          <p className="text-muted">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local</p>
        </div>
      </div>
    );
  }

  const isActive = phase === "playing" || phase === "paused";
  const circumference = 2 * Math.PI * 14;

  return (
    <div className="flex-1 flex flex-col min-h-screen transition-theme">
      <header className="glass-strong px-6 py-3 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <button onClick={() => setDrawerOpen(!drawerOpen)} className="text-muted hover:text-fg transition-colors p-1.5 rounded-xl hover:bg-white/10">
            <List className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center">
            <Music className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-gradient-moving text-lg">Admin Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-2 rounded-xl text-muted hover:text-fg transition-all duration-300 hover:bg-white/10">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={handleLogout}
            className="p-2 rounded-xl text-muted hover:text-red-400 transition-all duration-300 hover:bg-white/10">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className={`fixed left-0 top-[57px] bottom-20 w-72 z-20 glass transition-transform duration-300 ease-in-out border-r ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="p-4 h-full flex flex-col">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Disc className="w-3.5 h-3.5" /> Tracks
          </h2>
          <div className="flex-1 overflow-y-auto space-y-1">
            {tracks.length === 0 ? (
              <p className="text-xs text-muted text-center py-8">No tracks yet.</p>
            ) : (
              tracks.map((track) => {
                const isActiveT = activeTrack?.id === track.id;
                return (
                  <div key={track.id} className="group relative">
                    <button onClick={() => setActiveTrack(track)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                        isActiveT ? "bg-emerald-500/15 text-emerald-400 font-medium" : "hover:bg-white/10 text-fg"
                      }`}>
                      <div className="flex items-center gap-2.5">
                        <Music className="w-4 h-4 shrink-0" />
                        <span className="truncate">{track.title}</span>
                        {isActiveT && phase === "playing" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />}
                      </div>
                    </button>
                    {!isActive && (
                      <button onClick={() => handlePlay(track)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400">
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-white/10">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" /> Upload
            </h3>
            <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/10 text-fg rounded-xl px-3 py-2 text-xs border border-white/5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 mb-2 placeholder:text-muted/50" />
            <input ref={fileRef} type="file" accept="audio/*"
              className="w-full text-xs text-muted mb-2 file:mr-2 file:py-1 file:px-2.5 file:rounded-xl file:border-0 file:bg-emerald-500/15 file:text-emerald-400 file:font-medium file:text-xs file:cursor-pointer" />
            <button onClick={handleUpload} disabled={uploading || !title || !fileRef.current?.files?.length}
              className="w-full bento-btn bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-xs font-medium py-2 rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Upload className="w-3 h-3" /> {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </div>
      </div>

      <div className={`flex-1 p-6 transition-all duration-300 ${drawerOpen ? "ml-72" : "ml-0"}`}>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="glass rounded-2xl p-6">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
              <Heart className="w-3.5 h-3.5" /> Live Reactions
            </h2>
            <div className="relative h-48 rounded-xl bg-gradient-to-b from-white/[0.03] to-transparent border border-white/[0.04] overflow-hidden">
              {reactions.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-muted/40 text-sm">Waiting for listener reactions...</div>
              ) : (
                reactions.map((r) => (
                  <span key={r.id} className="absolute text-3xl animate-float-up pointer-events-none" style={{ left: `${r.x}%`, bottom: "10%" }}>{r.emoji}</span>
                ))
              )}
            </div>
          </div>

          {!activeTrack && (
            <div className="glass rounded-2xl p-10 text-center">
              <Music className="w-12 h-12 text-muted/30 mx-auto mb-3" />
              <h2 className="text-lg font-semibold mb-1">No Track Selected</h2>
              <p className="text-sm text-muted">Select a track from the drawer or upload a new one</p>
            </div>
          )}
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 z-30 glass-strong border-t border-white/10 px-6 py-3 flex items-center justify-between transition-all duration-300`}>
        <div className="flex items-center gap-4 min-w-0">
          {activeTrack ? (
            <>
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400/30 via-emerald-500/30 to-emerald-600/30 flex items-center justify-center shrink-0">
                <Music className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{activeTrack.title}</p>
                <p className="text-xs text-muted">{phase === "playing" ? "Playing" : phase === "paused" ? "Paused" : "Ready"}</p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">No track selected</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {countdown > 0 && (
            <div className="countdown-active w-9 h-9 rounded-full flex items-center justify-center">
              <svg className="w-9 h-9 -rotate-90" viewBox="0 0 32 32">
                <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/10" />
                <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2"
                  className="text-emerald-400"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - countdown / 100)}
                  style={{ transition: "stroke-dashoffset 0.1s linear" }}
                />
              </svg>
            </div>
          )}

          {activeTrack && !isActive && (
            <button onClick={() => handlePlay(activeTrack)}
              className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-medium px-5 py-2 rounded-xl text-sm transition-all duration-300 hover:scale-[1.02] active:scale-95">
              <Play className="w-4 h-4" /> Play Now
            </button>
          )}
          {phase === "playing" && (
            <button onClick={handlePause}
              className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-medium px-5 py-2 rounded-xl text-sm transition-all duration-300 hover:scale-[1.02] active:scale-95">
              <Pause className="w-4 h-4" /> Pause
            </button>
          )}
          {phase === "paused" && (
            <button onClick={handleResume}
              className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-medium px-5 py-2 rounded-xl text-sm transition-all duration-300 hover:scale-[1.02] active:scale-95">
              <Play className="w-4 h-4" /> Resume
            </button>
          )}
          {isActive && (
            <button onClick={handleStop}
              className="px-4 py-2 rounded-xl text-sm text-muted hover:text-red-400 transition-all duration-300 hover:bg-white/10">
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
