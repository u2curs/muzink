"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { startPeriodicSync, stopPeriodicSync, getServerTime, getOffset } from "@/lib/sync-clock";
import { Headphones, Radio, LogOut, Heart, Music, Volume2, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";

const EMOJIS = ["❤️", "🔥", "🌟", "🎵", "💚", "💜", "✨"];

export default function ClientPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [phase, setPhase] = useState<"join" | "connecting" | "ready" | "loading_track" | "ready_to_play" | "playing" | "paused">("join");
  const [trackTitle, setTrackTitle] = useState("");
  const [offset, setOffset] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [recentEmoji, setRecentEmoji] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [drift, setDrift] = useState(0);

  const clientId = useRef(Math.random().toString(36).substring(2, 9));
  const audioRef = useRef<AudioContext | null>(null);
  const channelRef = useRef<any>(null);
  const driftRef = useRef<any>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const targetTimeRef = useRef(0);
  const contextTargetTimeRef = useRef(0);
  const pausePositionRef = useRef(0);

  useEffect(() => {
    const role = localStorage.getItem("music-sync-role");
    if (!role) router.replace("/");
  }, [router]);

  useEffect(() => {
    startPeriodicSync((off) => setOffset(off));
    return () => stopPeriodicSync();
  }, []);

  useEffect(() => {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    audioRef.current = ctx;
    gainRef.current = gain;
    return () => { ctx.close(); };
  }, []);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
  }, [volume]);

  useEffect(() => {
    if (phase !== "playing") {
      if (driftRef.current) { clearInterval(driftRef.current); driftRef.current = null; }
      return;
    }
    driftRef.current = setInterval(() => {
      const ctx = audioRef.current;
      if (!ctx || !targetTimeRef.current) return;
      const expectedElapsed = (getServerTime() - targetTimeRef.current) / 1000;
      const actualElapsed = ctx.currentTime - contextTargetTimeRef.current;
      const driftMs = (actualElapsed - expectedElapsed) * 1000;
      setDrift(Math.round(driftMs));
      if (Math.abs(driftMs) > 50) {
        const source = sourceRef.current;
        if (source) {
          source.playbackRate.value = driftMs > 0 ? 0.98 : 1.02;
          setTimeout(() => { if (source) source.playbackRate.value = 1; }, 1000);
        }
      }
    }, 2000);
    return () => { if (driftRef.current) clearInterval(driftRef.current); };
  }, [phase]);

  async function handleJoin() {
    setPhase("connecting");
    await startPeriodicSync((off) => setOffset(off));

    if (!supabase) { setPhase("join"); return; }
    const channel = supabase.channel("audio-sync");
    channelRef.current = channel;

    channel.on("broadcast", { event: "LOAD" }, async (payload: any) => {
      const { track, title } = payload.payload;
      if (!track) return;
      setTrackTitle(title || "Unknown Track");
      setDownloadProgress(0);
      setPhase("loading_track");
      try {
        const buffer = await fetchAndDecode(track);
        bufferRef.current = buffer;
        setDownloadProgress(100);
        channel.send({ type: "broadcast", event: "READY", payload: { clientId: clientId.current } });
        setPhase("ready_to_play");
      } catch {
        setPhase("ready");
      }
    });

    channel.on("broadcast", { event: "PLAY_AT" }, (payload: any) => {
      const { track, title, targetServerTime, position } = payload.payload;
      if (!track) return;
      setTrackTitle(title || "Unknown Track");
      const ctx = audioRef.current;
      if (!ctx) return;

      if (ctx.state === "suspended") ctx.resume();

      const currentServerTime = getServerTime();
      const delayMs = Math.max(0, targetServerTime - currentServerTime);
      const contextTargetTime = ctx.currentTime + delayMs / 1000;
      contextTargetTimeRef.current = contextTargetTime;
      targetTimeRef.current = targetServerTime;

      const source = ctx.createBufferSource();
      const buffer = bufferRef.current;
      if (buffer) {
        source.buffer = buffer;
        source.playbackRate.value = 1;
        source.connect(gainRef.current!);
        source.start(contextTargetTime, position || 0);
        sourceRef.current = source;
      }

      if (delayMs <= 0) {
        setPhase("playing");
      } else {
        setTimeout(() => setPhase("playing"), delayMs);
      }
    });

    channel.on("broadcast", { event: "PAUSE" }, () => {
      const ctx = audioRef.current;
      if (ctx && sourceRef.current) {
        pausePositionRef.current = ctx.currentTime - contextTargetTimeRef.current + (pausePositionRef.current || 0);
        sourceRef.current.stop();
        sourceRef.current = null;
      }
      if (driftRef.current) { clearInterval(driftRef.current); driftRef.current = null; }
      setPhase("paused");
    });

    channel.on("broadcast", { event: "STOP" }, () => {
      if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} sourceRef.current = null; }
      if (driftRef.current) { clearInterval(driftRef.current); driftRef.current = null; }
      bufferRef.current = null;
      targetTimeRef.current = 0;
      pausePositionRef.current = 0;
      setPhase("ready");
      setTrackTitle("");
      setDownloadProgress(0);
    });

    channel.on("broadcast", { event: "STATE" }, async (payload: any) => {
      const { track, title, start_time, position, is_paused } = payload.payload;
      if (!track) return;
      setTrackTitle(title || "");
      if (is_paused) {
        setPhase("paused");
        bufferRef.current = await fetchAndDecode(track);
        pausePositionRef.current = position || 0;
      } else if (start_time) {
        setPhase("loading_track");
        setDownloadProgress(0);
        try {
          const buffer = await fetchAndDecode(track);
          bufferRef.current = buffer;
          setDownloadProgress(100);
          const ctx = audioRef.current;
          if (!ctx) return;
          if (ctx.state === "suspended") ctx.resume();
          const elapsed = (getServerTime() - start_time) / 1000;
          const seekTo = Math.max(0, (position || 0) + elapsed);
          contextTargetTimeRef.current = ctx.currentTime;
          targetTimeRef.current = start_time;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = 1;
          source.connect(gainRef.current!);
          source.start(0, seekTo);
          sourceRef.current = source;
          setPhase("playing");
        } catch {
          setPhase("ready");
        }
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
      if (admin?.state === "playing" && admin.track && admin.start_time) {
        setPhase("loading_track");
        setTrackTitle(admin.title || "");
        setDownloadProgress(0);
        try {
          const buffer = await fetchAndDecode(admin.track);
          bufferRef.current = buffer;
          setDownloadProgress(100);
          const ctx = audioRef.current;
          if (!ctx) return;
          if (ctx.state === "suspended") ctx.resume();
          const elapsed = (getServerTime() - admin.start_time) / 1000;
          contextTargetTimeRef.current = ctx.currentTime;
          targetTimeRef.current = admin.start_time;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = 1;
          source.connect(gainRef.current!);
          source.start(0, Math.max(0, (admin.position || 0) + elapsed));
          sourceRef.current = source;
          setPhase("playing");
        } catch { setPhase("ready"); }
      } else if (admin?.state === "paused" && admin.track) {
        setTrackTitle(admin.title || "");
        setPhase("paused");
        try { bufferRef.current = await fetchAndDecode(admin.track); } catch {}
        pausePositionRef.current = admin.position || 0;
      } else if (admin?.state === "waiting_ready" && admin.track) {
        setTrackTitle(admin.title || "");
        setPhase("ready");
      } else {
        setPhase("ready");
      }
    });
  }

  async function fetchAndDecode(url: string): Promise<AudioBuffer> {
    const ctx = audioRef.current;
    if (!ctx) throw new Error("No AudioContext");
    const response = await fetch(url);
    const contentLength = response.headers.get("content-length");
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let receivedLength = 0;
    const total = contentLength ? parseInt(contentLength) : 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedLength += value.length;
      if (total) setDownloadProgress(Math.round((receivedLength / total) * 90));
    }
    const arrayBuf = new Uint8Array(receivedLength);
    let pos = 0;
    for (const chunk of chunks) { arrayBuf.set(chunk, pos); pos += chunk.length; }
    return ctx.decodeAudioData(arrayBuf.buffer);
  }

  function handleReact() {
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    setRecentEmoji(emoji);
    setTimeout(() => setRecentEmoji(""), 800);
    channelRef.current?.send({ type: "broadcast", event: "REACT", payload: { emoji } });
  }

  function handleLogout() { stopPeriodicSync(); localStorage.removeItem("music-sync-role"); router.push("/"); }

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
          <p className="text-muted text-sm mb-8">Web Audio synchronized listening</p>
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

        {phase === "ready" && (
          <div className="py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center">
              <Headphones className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-lg font-semibold mb-1 text-gradient">Session Connected</h2>
            <p className="text-xs text-muted mb-2 flex items-center justify-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${offset !== 0 ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`} />
              Offset: {offset}ms
            </p>
            <p className="text-sm text-muted">Waiting for admin to broadcast...</p>
          </div>
        )}

        {phase === "loading_track" && (
          <div className="py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center animate-pulse">
              <Music className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-lg font-semibold mb-1 text-gradient">Buffering...</h2>
            {trackTitle && <p className="text-emerald-400 font-medium text-sm mb-4">{trackTitle}</p>}
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden mb-2">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-300 ease-out"
                style={{ width: `${downloadProgress}%` }} />
            </div>
            <p className="text-xs text-muted">{downloadProgress}%</p>
          </div>
        )}

        {phase === "ready_to_play" && (
          <div className="py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center">
              <Headphones className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-lg font-semibold mb-1 text-gradient">Ready to Play</h2>
            {trackTitle && <p className="text-emerald-400 font-medium">{trackTitle}</p>}
            <p className="text-xs text-muted mt-2">Waiting for admin to start...</p>
          </div>
        )}

        {(phase === "playing" || phase === "paused") && (
          <div className="py-4">
            <div className="w-24 h-24 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 flex items-center justify-center">
              <Music className="w-12 h-12 text-white" />
            </div>
            {trackTitle && <h2 className="text-lg font-bold mb-1 text-gradient-moving">{trackTitle}</h2>}
            <p className="text-xs text-muted mb-2 flex items-center justify-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${phase === "playing" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              {phase === "playing" ? "Playing" : "Paused"} &middot; Drift: {drift}ms
            </p>

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
