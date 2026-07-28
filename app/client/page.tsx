"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { syncClock, getServerTime } from "@/lib/timeSync";
import { Headphones, Radio, LogOut, Heart, Flame, Star, Music, Volume2 } from "lucide-react";
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

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const channelRef = useRef<any>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const role = localStorage.getItem("music-sync-role");
    if (!role) router.replace("/");
  }, [router]);

  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainRef.current = gain;
      analyserRef.current = analyser;
    }
  }, [volume]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
  }, [volume]);

  useEffect(() => {
    if (phase !== "playing" || !analyserRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const isDark = document.documentElement.classList.contains("dark");

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = canvas.width / bufferLength;
      for (let i = 0; i < bufferLength; i++) {
        const h = (dataArray[i] / 255) * canvas.height;
        const hue = (i / bufferLength) * 140 + 140;
        ctx.fillStyle = `hsla(${hue}, 80%, 55%, 0.7)`;
        ctx.fillRect(i * barWidth, canvas.height - h, Math.max(1, barWidth - 0.5), h);
      }
    }
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  async function handleJoin() {
    setPhase("connecting");
    initAudio();
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
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
        gainRef.current = null;
        analyserRef.current = null;
      }
    });

    channel.on("broadcast", { event: "PLAY" }, async (payload: any) => {
      const { track, title, start_time, position } = payload.payload;
      setTrackTitle(title || "Unknown Track");

      try {
        initAudio();
        const ctx = audioCtxRef.current!;
        if (ctx.state === "suspended") await ctx.resume();

        const resp = await fetch(track);
        const buf = await resp.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(buf);

        if (sourceRef.current) { sourceRef.current.stop(); sourceRef.current.disconnect(); }

        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(gainRef.current!);
        sourceRef.current = src;

        const serverNow = getServerTime();
        const delayMs = start_time - serverNow;
        const delaySec = delayMs / 1000;
        const targetTime = ctx.currentTime + Math.max(0, delaySec);
        src.start(targetTime, position || 0);
        setPhase("playing");
      } catch (e) {
        console.error("Playback error", e);
        setPhase("waiting");
      }
    });

    channel.on("broadcast", { event: "PAUSE" }, (payload: any) => {
      const { position } = payload.payload;
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch {}
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      setPhase("paused");
    });

    channel.on("broadcast", { event: "STOP" }, () => {
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch {}
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      setPhase("waiting");
      setTrackTitle("");
    });

    channel.on("broadcast", { event: "STATE" }, async (payload: any) => {
      const { track, title, start_time, position, is_paused } = payload.payload;
      if (is_paused) {
        setTrackTitle(title || "");
        initAudio();
        if (audioCtxRef.current) {
          const resp = await fetch(track);
          const buf = await resp.arrayBuffer();
          const audioBuf = await audioCtxRef.current.decodeAudioData(buf);
          const src = audioCtxRef.current.createBufferSource();
          src.buffer = audioBuf;
          src.connect(gainRef.current!);
          const seekTo = position || 0;
          src.start(0, seekTo);
          src.stop();
          setPhase("paused");
        }
      } else {
        await handleLateJoin(track, title, start_time, position);
      }
    });

    channel.subscribe(async (status: string) => {
      if (status !== "SUBSCRIBED") return;
      const presence = channel.presenceState();
      let adminState: any = null;
      for (const key of Object.keys(presence)) {
        for (const p of presence[key] as any[]) {
          if (p.type === "admin") { adminState = p; break; }
        }
        if (adminState) break;
      }

      if (adminState?.state === "playing" && adminState.track) {
        await handleLateJoin(adminState.track, adminState.title || "", adminState.start_time || 0, adminState.position || 0);
      } else if (adminState?.state === "paused" && adminState.track) {
        setTrackTitle(adminState.title || "");
        setPhase("paused");
      } else if (adminState?.state === "preparing") {
        setTrackTitle(adminState.title || "");
        setPhase("preparing");
      } else {
        setPhase("waiting");
      }
    });

    setPhase("waiting");
  }

  async function handleLateJoin(track: string, title: string, startTime: number, position: number) {
    setTrackTitle(title || "");
    setPhase("preparing");
    try {
      initAudio();
      const ctx = audioCtxRef.current!;
      if (ctx.state === "suspended") await ctx.resume();

      const resp = await fetch(track);
      const buf = await resp.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(buf);

      if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} sourceRef.current.disconnect(); }

      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(gainRef.current!);
      sourceRef.current = src;

      const elapsed = (getServerTime() - startTime) / 1000;
      const seekTo = Math.max(0, (position || 0) + elapsed);
      src.start(0, seekTo);
      setPhase("playing");
    } catch (e) {
      console.error("Late join error", e);
      setPhase("waiting");
    }
  }

  function handleReact() {
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    setRecentEmoji(emoji);
    setTimeout(() => setRecentEmoji(""), 800);
    channelRef.current?.send({ type: "broadcast", event: "REACT", payload: { emoji } });
  }

  function handleLogout() {
    if (audioCtxRef.current) audioCtxRef.current.close();
    localStorage.removeItem("music-sync-role");
    router.push("/");
  }

  if (phase === "join") {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="glass rounded-3xl p-10 shadow-2xl text-center max-w-sm w-full">
          <button onClick={handleLogout} className="absolute top-4 right-4 text-muted hover:text-fg transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
          <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg">
            <Radio className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-1">Music Sync</h1>
          <p className="text-muted text-sm mb-8">Join a synchronized listening session</p>
          <button
            onClick={handleJoin}
            className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-semibold py-3 px-8 rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-95 shadow-lg"
          >
            Join Session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4 relative">
      <button onClick={handleLogout} className="absolute top-4 right-4 text-muted hover:text-fg z-10 transition-colors">
        <LogOut className="w-5 h-5" />
      </button>

      <div className="glass rounded-3xl p-8 shadow-2xl text-center max-w-sm w-full relative overflow-hidden">
        {phase === "connecting" && (
          <div className="py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center animate-pulse">
              <Radio className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Connecting...</h2>
            <p className="text-sm text-muted">Establishing synchronized session</p>
            <div className="mt-4 w-48 h-1.5 mx-auto bg-slate-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 rounded-full animate-pulse" style={{ width: "40%" }} />
            </div>
          </div>
        )}

        {phase === "waiting" && (
          <div className="py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center">
              <Headphones className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-lg font-semibold mb-1">Session Connected</h2>
            <p className="text-xs text-muted mb-2">Latency: ~{latency}ms</p>
            <div className="flex items-center justify-center gap-1.5 mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400">Live</span>
            </div>
            <p className="text-sm text-muted">Waiting for admin to broadcast...</p>
          </div>
        )}

        {(phase === "preparing" || phase === "paused") && (
          <div className="py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center animate-pulse">
              <Music className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-lg font-semibold mb-1">{phase === "preparing" ? "Preparing..." : "Paused"}</h2>
            {trackTitle && <p className="text-amber-400 font-medium">{trackTitle}</p>}
            {phase === "preparing" && (
              <div className="mt-4 w-48 h-1.5 mx-auto bg-slate-700/50 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: "60%" }} />
              </div>
            )}
          </div>
        )}

        {phase === "playing" && (
          <div className="py-6">
            <div className="w-24 h-24 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg">
              <Music className="w-12 h-12 text-white" />
            </div>
            {trackTitle && <h2 className="text-lg font-semibold mb-3">{trackTitle}</h2>}
            <canvas ref={canvasRef} width={320} height={64} className="w-full h-16 rounded-lg mb-4" />
            <div className="flex items-center justify-center gap-3 mb-4">
              <Volume2 className="w-4 h-4 text-muted" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-32 accent-emerald-500"
              />
              <span className="text-xs text-muted w-8 text-right">{Math.round(volume * 100)}%</span>
            </div>
            <button
              onClick={handleReact}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-400 hover:to-pink-400 text-white font-medium px-6 py-2 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg"
            >
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
