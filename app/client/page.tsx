"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { syncClock, getServerTime } from "@/lib/timeSync";
import { Headphones, Radio, LogOut, Heart, Music, Volume2, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";

const EMOJIS = ["❤️", "🔥", "🌟", "🎵", "💚", "💜", "✨"];

export default function ClientPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [phase, setPhase] = useState<"join" | "connecting" | "waiting" | "preparing" | "playing" | "paused">("join");
  const [trackTitle, setTrackTitle] = useState("");
  const [latency, setLatency] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [recentEmoji, setRecentEmoji] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<any>(null);
  const syncTimerRef = useRef<any>(null);
  const heartbeatRef = useRef<any>(null);
  const sessionStartRef = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const role = localStorage.getItem("music-sync-role");
    if (!role) router.replace("/");
  }, [router]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audio.volume = volume;
    audioRef.current = audio;

    audio.addEventListener("canplaythrough", onAudioReady);
    audio.addEventListener("loadeddata", onAudioReady);
    audio.addEventListener("error", onAudioError);

    return () => {
      audio.removeEventListener("canplaythrough", onAudioReady);
      audio.removeEventListener("loadeddata", onAudioReady);
      audio.removeEventListener("error", onAudioError);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  function onAudioReady() {
    if (phaseRef.current === "preparing") {
      setPhase("waiting");
    }
  }

  function onAudioError() {
    if (sessionStartRef.current && phaseRef.current === "playing") {
      const elapsed = (getServerTime() - sessionStartRef.current) / 1000;
      const audio = audioRef.current;
      if (audio) { audio.currentTime = elapsed; audio.play().catch(() => {}); }
    }
  }

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  async function handleJoin() {
    setPhase("connecting");
    const t1 = performance.now();
    await syncClock();
    const t4 = performance.now();
    setLatency(Math.round((t4 - t1) / 3));

    if (!supabase) { setPhase("join"); return; }
    const channel = supabase.channel("audio-sync");
    channelRef.current = channel;

    channel.on("broadcast", { event: "PREPARE" }, (payload: any) => {
      const { track, title } = payload.payload;
      setTrackTitle(title || "Unknown Track");
      setPhase("preparing");
      clearTimeout(syncTimerRef.current);
      clearTimeout(heartbeatRef.current);

      const audio = audioRef.current;
      if (audio) {
        audio.src = track;

        heartbeatRef.current = setTimeout(() => {
          audio.play().catch(() => {});
        }, 3000);
      }
    });

    channel.on("broadcast", { event: "PLAY" }, (payload: any) => {
      const { track, title, start_time, position } = payload.payload;
      if (!track) return;
      setTrackTitle(title || "Unknown Track");
      clearTimeout(heartbeatRef.current);

      const audio = audioRef.current;
      if (!audio) return;
      clearTimeout(syncTimerRef.current);

      if (audio.src !== track) { audio.src = track; audio.preload = "auto"; }

      audio.currentTime = position || 0;
      sessionStartRef.current = start_time;

      const serverNow = getServerTime();
      const delay = Math.max(0, start_time - serverNow);

      if (delay <= 0) {
        audio.play().then(() => setPhase("playing")).catch(() => {});
      } else {
        syncTimerRef.current = setTimeout(() => {
          audio.play().then(() => setPhase("playing")).catch(() => {});
        }, delay);
      }
    });

    channel.on("broadcast", { event: "PAUSE" }, () => {
      clearTimeout(syncTimerRef.current);
      clearTimeout(heartbeatRef.current);
      audioRef.current?.pause();
      setPhase("paused");
    });

    channel.on("broadcast", { event: "STOP" }, () => {
      clearTimeout(syncTimerRef.current);
      clearTimeout(heartbeatRef.current);
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      setPhase("waiting");
      setTrackTitle("");
    });

    channel.on("broadcast", { event: "STATE" }, (payload: any) => {
      const { track, title, start_time, position, is_paused } = payload.payload;
      if (!track) return;
      setTrackTitle(title || "");
      if (is_paused) {
        setPhase("paused");
        if (audioRef.current) { audioRef.current.src = track; audioRef.current.currentTime = position || 0; }
      } else {
        syncToTrack(track, start_time, position || 0);
      }
    });

    channel.subscribe(async (status: string) => {
      if (status !== "SUBSCRIBED") return;
      const presence = channel.presenceState();
      let admin: any = null;
      for (const key of Object.keys(presence)) {
        for (const p of presence[key] as any[]) {
          if (p.type === "admin") { admin = p; break; }
        }
        if (admin) break;
      }
      if (admin?.state === "playing" && admin.track) {
        syncToTrack(admin.track, admin.start_time || 0, admin.position || 0);
      } else if (admin?.state === "paused") {
        setTrackTitle(admin.title || "");
        setPhase("paused");
        if (audioRef.current) { audioRef.current.src = admin.track; audioRef.current.currentTime = admin.position || 0; }
      } else if (admin?.state === "preparing") {
        setTrackTitle(admin.title || "");
        setPhase("preparing");
      } else {
        setPhase("waiting");
      }
    });

    setPhase("waiting");
  }

  function syncToTrack(track: string, startTime: number, position: number) {
    setPhase("preparing");
    clearTimeout(syncTimerRef.current);
    clearTimeout(heartbeatRef.current);

    const audio = audioRef.current;
    if (!audio) return;

    audio.src = track;
    audio.preload = "auto";
    sessionStartRef.current = startTime;

    const elapsed = (getServerTime() - startTime) / 1000;
    const seekTo = Math.max(0, position + elapsed);
    audio.currentTime = seekTo;
    audio.play().then(() => setPhase("playing")).catch(() => {});
  }

  function handleReact() {
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    setRecentEmoji(emoji);
    setTimeout(() => setRecentEmoji(""), 800);
    channelRef.current?.send({ type: "broadcast", event: "REACT", payload: { emoji } });
  }

  function handleLogout() {
    localStorage.removeItem("music-sync-role");
    router.push("/");
  }

  if (phase === "join") {
    return (
      <div className="flex-1 flex items-center justify-center p-4 transition-theme">
        <div className="glass rounded-3xl p-10 text-center max-w-sm w-full">
          <button onClick={handleLogout} className="absolute top-4 right-4 text-muted hover:text-fg transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
          <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center">
            <Radio className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-1 text-gradient-moving">Music Sync</h1>
          <p className="text-muted text-sm mb-8">Join a synchronized listening session</p>
          <button onClick={handleJoin}
            className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-semibold py-3 px-8 rounded-xl transition-all duration-300 hover:scale-[1.02] active:scale-95">
            Join Session
          </button>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="mt-3 w-full py-2.5 rounded-xl text-sm text-muted hover:text-fg transition-all duration-300 hover:bg-white/10 flex items-center justify-center gap-2">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />} {theme === "dark" ? "Light" : "Dark"} Mode
          </button>
        </div>
      </div>
    );
  }

  const barCount = 7;

  return (
    <div className="flex-1 flex items-center justify-center p-4 relative transition-theme">
      <button onClick={handleLogout} className="absolute top-4 right-4 text-muted hover:text-fg z-10 transition-colors">
        <LogOut className="w-5 h-5" />
      </button>
      <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="absolute top-4 left-4 text-muted hover:text-fg z-10 transition-colors p-1.5 rounded-xl hover:bg-white/10">
        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="glass rounded-3xl p-8 text-center max-w-sm w-full relative">
        {phase === "connecting" && (
          <div className="py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center animate-pulse">
              <Radio className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-lg font-semibold mb-2 text-gradient">Connecting...</h2>
            <p className="text-sm text-muted">Establishing synchronized session</p>
          </div>
        )}

        {phase === "waiting" && (
          <div className="py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center">
              <Headphones className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-lg font-semibold mb-1 text-gradient">Session Connected</h2>
            <p className="text-xs text-muted mb-2">Latency: ~{latency}ms</p>
            <div className="flex items-center justify-center gap-1.5 mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400">Live</span>
            </div>
            <p className="text-sm text-muted">Waiting for admin to broadcast...</p>
          </div>
        )}

        {(phase === "preparing" || phase === "paused") && (
          <div className="py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center animate-pulse">
              <Music className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-lg font-semibold mb-1 text-gradient">{phase === "preparing" ? "Preparing..." : "Paused"}</h2>
            {trackTitle && <p className="text-emerald-400 font-medium">{trackTitle}</p>}
            {phase === "preparing" && (
              <div className="mt-5 flex items-center justify-center gap-1 h-8">
                {Array.from({ length: barCount }).map((_, i) => (
                  <div key={i} className="w-2.5 rounded-full bg-gradient-to-t from-emerald-400 to-emerald-600 equalizer-bar"
                    style={{ height: "2rem", "--i": i } as React.CSSProperties} />
                ))}
              </div>
            )}
          </div>
        )}

        {phase === "playing" && (
          <div className="py-4">
            <div className="w-24 h-24 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center">
              <Music className="w-12 h-12 text-white" />
            </div>
            {trackTitle && <h2 className="text-lg font-bold mb-4 text-gradient-moving">{trackTitle}</h2>}

            <div className="flex items-center justify-center gap-1 h-16 mb-5">
              {Array.from({ length: barCount * 2 }).map((_, i) => (
                <div key={i} className="w-2.5 rounded-full bg-gradient-to-t from-emerald-400 via-emerald-400 to-emerald-600 equalizer-bar shadow-lg shadow-emerald-500/30"
                  style={{ height: "4rem", "--i": i } as React.CSSProperties} />
              ))}
            </div>

            <div className="flex items-center justify-center gap-3 mb-5">
              <Volume2 className="w-4 h-4 text-muted" />
              <input type="range" min={0} max={1} step={0.01} value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-32 accent-emerald-500" />
              <span className="text-xs text-muted w-8 text-right">{Math.round(volume * 100)}%</span>
            </div>
            <button onClick={handleReact}
              className="bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white font-medium px-6 py-2 rounded-full transition-all duration-300 hover:scale-105 active:scale-95 inline-flex items-center gap-2">
              <Heart className="w-4 h-4" /> React
            </button>
            {recentEmoji && (
              <span className="fixed text-3xl pointer-events-none animate-float-up" style={{ left: "50%", top: "40%" }}>
                {recentEmoji}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
