"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useTheme } from "next-themes";
import {
  Upload, Play, Pause, Music, LogOut, Download, Radio, Sun, Moon,
  Library, Heart, Flame, Star, PanelLeft, Volume2,
} from "lucide-react";

interface Track { id: number; title: string; file_url: string; }
interface Reaction { id: number; emoji: string; x: number; createdAt: number; }

const SIDEBAR_TABS = [
  { key: "library", label: "Media Library", icon: Library },
  { key: "upload", label: "Upload", icon: Upload },
  { key: "reactions", label: "Live Reactions", icon: Heart },
];

export default function AdminPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [envMissing, setEnvMissing] = useState(false);
  const [activeTab, setActiveTab] = useState("library");

  const [phase, setPhase] = useState<"idle" | "preparing" | "playing" | "paused">("idle");
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [readyCount, setReadyCount] = useState(0);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const playStartRef = useRef(0);
  const pausePositionRef = useRef(0);
  const channelRef = useRef<any>(null);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const role = localStorage.getItem("music-sync-role");
    if (role !== "admin") router.replace("/");
  }, [router]);

  useEffect(() => {
    if (!supabase) { setEnvMissing(true); return; }
    fetchTracks();

    const channel = supabase.channel("audio-sync");
    channelRef.current = channel;

    channel.on("broadcast", { event: "REQUEST_STATE" }, () => {
      if (activeTrack && (phase === "playing" || phase === "paused")) {
        const elapsed = phase === "playing" ? (Date.now() - playStartRef.current) / 1000 : pausePositionRef.current;
        channel.send({
          type: "broadcast", event: "STATE", payload: {
            track: activeTrack.file_url, title: activeTrack.title,
            start_time: phase === "playing" ? playStartRef.current : Date.now(),
            position: Math.max(0, elapsed), is_paused: phase === "paused",
          },
        });
      }
    });

    channel.on("broadcast", { event: "READY" }, () => setReadyCount((c) => c + 1));
    channel.on("broadcast", { event: "REACT" }, (payload: any) => {
      const r: Reaction = { id: Date.now() + Math.random(), emoji: payload.payload.emoji, x: Math.random() * 70 + 15, createdAt: Date.now() };
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
      channelRef.current.track({ type: "admin", state: "playing", track: activeTrack.file_url, title: activeTrack.title, start_time: playStartRef.current, updated_at: Date.now() });
      syncRef.current = setInterval(() => {
        if (!channelRef.current) return;
        channelRef.current.track({ type: "admin", state: "playing", track: activeTrack.file_url, title: activeTrack.title, start_time: playStartRef.current, position: Math.max(0, (Date.now() - playStartRef.current) / 1000), updated_at: Date.now() });
      }, 2000);
    } else if (phase === "paused" && activeTrack) {
      channelRef.current.track({ type: "admin", state: "paused", track: activeTrack.file_url, title: activeTrack.title, position: pausePositionRef.current, updated_at: Date.now() });
    } else if (phase === "preparing" && activeTrack) {
      channelRef.current.track({ type: "admin", state: "preparing", track: activeTrack.file_url, title: activeTrack.title });
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

  async function handlePrepare(track: Track) {
    if (!supabase || phase !== "idle") return;
    setActiveTrack(track); setReadyCount(0); setPhase("preparing");
    await supabase.channel("audio-sync").send({ type: "broadcast", event: "PREPARE", payload: { track: track.file_url, title: track.title } });
  }

  async function handlePlay() {
    if (!supabase || phase !== "preparing" || !activeTrack) return;
    const startTime = Date.now() + 500;
    playStartRef.current = startTime; setPhase("playing");
    await supabase.channel("audio-sync").send({ type: "broadcast", event: "PLAY", payload: { track: activeTrack.file_url, title: activeTrack.title, start_time: startTime, position: 0 } });
  }

  async function handlePause() {
    if (!supabase || phase !== "playing" || !activeTrack) return;
    pausePositionRef.current = Math.max(0, (Date.now() - playStartRef.current) / 1000);
    if (syncRef.current) clearInterval(syncRef.current); setPhase("paused");
    await supabase.channel("audio-sync").send({ type: "broadcast", event: "PAUSE", payload: { position: pausePositionRef.current } });
  }

  async function handleResume() {
    if (!supabase || phase !== "paused" || !activeTrack) return;
    const startTime = Date.now() + 500;
    playStartRef.current = startTime; setPhase("playing");
    await supabase.channel("audio-sync").send({ type: "broadcast", event: "PLAY", payload: { track: activeTrack.file_url, title: activeTrack.title, start_time: startTime, position: pausePositionRef.current } });
  }

  function handleStop() {
    setPhase("idle"); setActiveTrack(null); setReadyCount(0);
    if (syncRef.current) clearInterval(syncRef.current);
    if (channelRef.current) { channelRef.current.track({ type: "admin", state: "idle" }); channelRef.current.send({ type: "broadcast", event: "STOP", payload: {} }); }
  }

  function handleLogout() { localStorage.removeItem("music-sync-role"); router.push("/"); }

  if (envMissing) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="glass rounded-xl p-8 text-center max-w-md">
          <h1 className="text-xl font-bold mb-2">Configuration Required</h1>
          <p className="text-muted">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local</p>
        </div>
      </div>
    );
  }

  const canPlay = readyCount >= 1;
  const isActive = phase === "playing" || phase === "paused" || phase === "preparing";

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <header className="glass-strong px-6 py-3 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-muted hover:text-fg transition-colors">
            <PanelLeft className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
            <Music className="w-4 h-4 text-white" />
          </div>
          <h1 className="font-bold text-sm">Admin Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="text-muted hover:text-fg transition-colors p-1.5 rounded-lg hover:bg-white/5">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={handleLogout} className="text-muted hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-white/5">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className={`${sidebarOpen ? "w-56" : "w-0"} transition-all duration-200 overflow-hidden glass-strong shrink-0 flex flex-col`}>
          <nav className="flex-1 p-3 space-y-1">
            {SIDEBAR_TABS.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  activeTab === tab.key
                    ? "bg-emerald-500/15 text-emerald-400 shadow-sm"
                    : "text-muted hover:text-fg hover:bg-white/5"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {activeTab === "upload" && (
            <div className="glass rounded-2xl p-6 max-w-2xl mx-auto">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Upload className="w-5 h-5 text-emerald-400" /> Upload Track</h2>
              <div className="flex flex-col gap-4">
                <input type="text" placeholder="Track title" value={title} onChange={(e) => setTitle(e.target.value)}
                  className="bg-white/10 text-fg rounded-xl px-4 py-2.5 border border-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-muted/60" />
                <input ref={fileRef} type="file" accept="audio/*"
                  className="text-muted file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-emerald-500/20 file:text-emerald-400 file:font-medium hover:file:bg-emerald-500/30 file:cursor-pointer file:transition-colors" />
                <button onClick={handleUpload} disabled={uploading || !title || !fileRef.current?.files?.length}
                  className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-xl transition-all duration-200">
                  <Upload className="w-4 h-4" /> {uploading ? "Uploading..." : "Upload"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "library" && (
            <div className="glass rounded-2xl p-6 max-w-3xl mx-auto">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Library className="w-5 h-5 text-emerald-400" /> Media Library</h2>
              {tracks.length === 0 ? (
                <p className="text-muted text-center py-8">No tracks uploaded yet. Go to Upload to add music.</p>
              ) : (
                <div className="space-y-2">
                  {tracks.map((track) => {
                    const isActiveTrack = activeTrack?.id === track.id;
                    return (
                      <div key={track.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-400/30 to-emerald-600/30 flex items-center justify-center">
                            <Music className="w-5 h-5 text-emerald-400" />
                          </div>
                          <span className="font-medium text-sm">{track.title}</span>
                        </div>
                        <div>
                          {phase === "idle" && (
                            <button onClick={() => handlePrepare(track)}
                              className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-emerald-500/10">
                              <Download className="w-3.5 h-3.5" /> Prepare
                            </button>
                          )}
                          {(phase === "preparing" || phase === "paused") && isActiveTrack && (
                            <span className="text-amber-400 text-sm flex items-center gap-1.5"><Download className="w-3.5 h-3.5 animate-pulse" /> {phase === "preparing" ? "Preparing..." : "Paused"}</span>
                          )}
                          {phase === "playing" && isActiveTrack && (
                            <span className="text-emerald-400 text-sm flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 animate-pulse" /> Live</span>
                          )}
                          {phase !== "idle" && !isActiveTrack && <span className="text-muted/40 text-sm">—</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "reactions" && (
            <div className="glass rounded-2xl p-6 max-w-2xl mx-auto">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Heart className="w-5 h-5 text-rose-400" /> Live Reactions</h2>
              <div className="relative h-64 rounded-xl bg-gradient-to-b from-white/[0.03] to-transparent border border-white/[0.05] overflow-hidden">
                {reactions.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-muted/50 text-sm">Waiting for reactions from listeners...</div>
                ) : (
                  reactions.map((r) => (
                    <span key={r.id} className="absolute text-3xl animate-float-up pointer-events-none" style={{ left: `${r.x}%`, bottom: "10%" }}>{r.emoji}</span>
                  ))
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                <Heart className="w-3 h-3 text-rose-400" />
                <span>{reactions.length} reaction{reactions.length !== 1 ? "s" : ""} in last 3s</span>
              </div>
            </div>
          )}
        </main>
      </div>

      <div className={`glass-strong px-6 py-3 flex items-center justify-between shrink-0 transition-all duration-300 ${isActive ? "translate-y-0" : "translate-y-full"}`}>
        <div className="flex items-center gap-3 min-w-0">
          {activeTrack && (
            <>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400/30 to-emerald-600/30 flex items-center justify-center shrink-0">
                <Music className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{activeTrack.title}</p>
                <p className="text-xs text-muted">{phase === "playing" ? "Playing" : phase === "paused" ? "Paused" : "Preparing"}{phase === "preparing" ? ` — ${readyCount} ready` : ""}</p>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {phase === "preparing" && (
            <>
              <button onClick={handlePlay} disabled={!canPlay}
                className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-xl transition-all duration-200">
                <Play className="w-4 h-4" /> Play Now
              </button>
              <button onClick={handleStop} className="text-muted hover:text-red-400 text-sm px-3 py-2 transition-colors">Cancel</button>
            </>
          )}
          {phase === "playing" && (
            <>
              <button onClick={handlePause}
                className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white text-sm font-medium px-5 py-2 rounded-xl transition-all duration-200">
                <Pause className="w-4 h-4" /> Pause
              </button>
              <button onClick={handleStop} className="text-muted hover:text-red-400 text-sm px-3 py-2 transition-colors">Stop</button>
            </>
          )}
          {phase === "paused" && (
            <>
              <button onClick={handleResume}
                className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white text-sm font-medium px-5 py-2 rounded-xl transition-all duration-200">
                <Play className="w-4 h-4" /> Resume
              </button>
              <button onClick={handleStop} className="text-muted hover:text-red-400 text-sm px-3 py-2 transition-colors">Stop</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
