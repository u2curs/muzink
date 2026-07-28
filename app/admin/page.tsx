"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useTheme } from "next-themes";
import {
  Upload, Play, Pause, Music, LogOut, Download, Radio, Sun, Moon,
  Heart, Library, Headphones, Disc,
} from "lucide-react";

interface Track { id: number; title: string; file_url: string; }
interface Reaction { id: number; emoji: string; x: number; createdAt: number; }

export default function AdminPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [envMissing, setEnvMissing] = useState(false);

  const [phase, setPhase] = useState<"idle" | "preparing" | "playing" | "paused">("idle");
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [readyCount, setReadyCount] = useState(0);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const playStartRef = useRef(0);
  const pausePositionRef = useRef(0);
  const channelRef = useRef<any>(null);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        <div className="bento-card p-8 text-center max-w-md">
          <h1 className="text-xl font-bold mb-2 text-gradient-moving">Configuration Required</h1>
          <p className="text-muted">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local</p>
        </div>
      </div>
    );
  }

  const canPlay = readyCount >= 1;
  const statusLabel = phase === "playing" ? "Playing" : phase === "paused" ? "Paused" : phase === "preparing" ? "Preparing..." : "Idle";

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <header className="px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center bento-sm">
            <Music className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-gradient-moving">Admin Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-2 rounded-xl text-muted hover:text-fg transition-colors hover:bg-white/5">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={handleLogout}
            className="p-2 rounded-xl text-muted hover:text-red-400 transition-colors hover:bg-white/5">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 p-4 lg:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5 max-w-6xl mx-auto">
          {/* Now Playing + Controls */}
          <div className="lg:col-span-2 bento-card p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">Now Playing</h2>
                {activeTrack ? (
                  <p className="text-lg font-bold mt-1 text-gradient-moving">{activeTrack.title}</p>
                ) : (
                  <p className="text-lg font-bold mt-1 text-muted/50">No track selected</p>
                )}
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                phase === "playing" ? "bg-emerald-500/20 text-emerald-400" :
                phase === "paused" ? "bg-amber-500/20 text-amber-400" :
                phase === "preparing" ? "bg-amber-500/20 text-amber-400" :
                "bg-white/10 text-muted"
              }`}>{statusLabel}</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {phase === "idle" && (
                <span className="text-sm text-muted">Select a track and press Prepare</span>
              )}
              {phase === "preparing" && (
                <>
                  <button onClick={handlePlay} disabled={!canPlay}
                    className="bento-btn bg-gradient-to-r from-emerald-500 to-emerald-600 text-white flex items-center gap-1.5 text-sm">
                    <Play className="w-4 h-4" /> Play Now
                    {readyCount > 0 && <span className="ml-1 opacity-80">({readyCount})</span>}
                  </button>
                  <button onClick={handleStop} className="bento-btn bg-white/10 text-muted hover:text-red-400 text-sm">Cancel</button>
                </>
              )}
              {phase === "playing" && (
                <>
                  <button onClick={handlePause}
                    className="bento-btn bg-gradient-to-r from-amber-500 to-amber-600 text-white flex items-center gap-1.5 text-sm">
                    <Pause className="w-4 h-4" /> Pause
                  </button>
                  <button onClick={handleStop} className="bento-btn bg-white/10 text-muted hover:text-red-400 text-sm">Stop</button>
                </>
              )}
              {phase === "paused" && (
                <>
                  <button onClick={handleResume}
                    className="bento-btn bg-gradient-to-r from-emerald-500 to-emerald-600 text-white flex items-center gap-1.5 text-sm">
                    <Play className="w-4 h-4" /> Resume
                  </button>
                  <button onClick={handleStop} className="bento-btn bg-white/10 text-muted hover:text-red-400 text-sm">Stop</button>
                </>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="lg:col-span-1 bento-card p-5">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Session</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Status</span>
                <span className={`text-sm font-semibold ${
                  phase === "playing" ? "text-emerald-400" :
                  phase === "preparing" ? "text-amber-400" : "text-muted"
                }`}>{statusLabel}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Track</span>
                <span className="text-sm font-medium truncate ml-2 max-w-[120px]">{activeTrack?.title || "—"}</span>
              </div>
              {phase === "preparing" && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Ready</span>
                  <span className="text-sm font-semibold text-emerald-400">{readyCount} client{readyCount !== 1 ? "s" : ""}</span>
                </div>
              )}
            </div>
          </div>

          {/* Media Library */}
          <div className="lg:col-span-2 bento-card p-5">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4 flex items-center gap-2">
              <Library className="w-3.5 h-3.5" /> Media Library
            </h2>
            {tracks.length === 0 ? (
              <p className="text-sm text-muted text-center py-8">No tracks yet. Upload some music!</p>
            ) : (
              <div className="space-y-1.5">
                {tracks.map((track) => {
                  const isActive = activeTrack?.id === track.id;
                  return (
                    <div key={track.id} className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all ${
                      isActive ? "bg-emerald-500/10" : "hover:bg-white/5"
                    }`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400/30 via-emerald-500/30 to-emerald-600/30 flex items-center justify-center shrink-0">
                          <Music className="w-4 h-4 text-emerald-400" />
                        </div>
                        <span className="text-sm font-medium truncate">{track.title}</span>
                      </div>
                      <div className="shrink-0 ml-2">
                        {phase === "idle" && (
                          <button onClick={() => handlePrepare(track)}
                            className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors px-2.5 py-1 rounded-lg hover:bg-emerald-500/10">
                            Prepare
                          </button>
                        )}
                        {isActive && (phase === "preparing" || phase === "paused") && (
                          <span className="text-xs font-semibold text-amber-400">{phase === "preparing" ? "Preparing..." : "Paused"}</span>
                        )}
                        {isActive && phase === "playing" && (
                          <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1"><Radio className="w-3 h-3 animate-pulse" /> Live</span>
                        )}
                        {!isActive && phase !== "idle" && (
                          <span className="text-xs text-muted/40">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upload */}
          <div className="lg:col-span-1 bento-card p-5">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4 flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" /> Upload
            </h2>
            <div className="space-y-3">
              <input type="text" placeholder="Track title" value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-white/10 text-fg rounded-xl px-3.5 py-2.5 text-sm border border-white/5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 placeholder:text-muted/50" />
              <input ref={fileRef} type="file" accept="audio/*"
                className="w-full text-xs text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:bg-emerald-500/15 file:text-emerald-400 file:font-medium file:cursor-pointer file:transition-colors hover:file:bg-emerald-500/25" />
              <button onClick={handleUpload} disabled={uploading || !title || !fileRef.current?.files?.length}
                className="w-full bento-btn bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm flex items-center justify-center gap-1.5">
                <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>

          {/* Live Reactions */}
          <div className="lg:col-span-1 bento-card p-5">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
              <Heart className="w-3.5 h-3.5" /> Live Reactions
            </h2>
            <div className="relative h-40 rounded-xl bg-gradient-to-b from-white/[0.03] to-transparent border border-white/[0.04] overflow-hidden">
              {reactions.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-muted/40 text-xs">Waiting...</div>
              ) : (
                reactions.map((r) => (
                  <span key={r.id} className="absolute text-2xl animate-float-up pointer-events-none" style={{ left: `${r.x}%`, bottom: "10%" }}>{r.emoji}</span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
