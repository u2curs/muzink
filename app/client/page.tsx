"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Headphones, Radio, LogOut } from "lucide-react";

export default function ClientPage() {
  const router = useRouter();
  const [joined, setJoined] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [trackTitle, setTrackTitle] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const role = localStorage.getItem("music-sync-role");
    if (!role) router.replace("/");
  }, [router]);

  useEffect(() => {
    if (!joined || !supabase) return;

    const channel = supabase.channel("audio-sync");
    channel.on(
      "broadcast",
      { event: "PLAY" },
      (payload) => {
        const { file_url, start_time } = payload.payload as { file_url: string; start_time: number };
        const audio = audioRef.current;
        if (!audio) return;

        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        setPlaying(false);
        setBuffering(true);

        audio.src = file_url;
        audio.currentTime = 0;

        audio.addEventListener("canplaythrough", () => {
          const delay = start_time - Date.now();
          if (delay <= 0) {
            audio.play().then(() => setPlaying(true)).catch(console.error);
          } else {
            syncTimerRef.current = setTimeout(() => {
              audio.play().then(() => setPlaying(true)).catch(console.error);
            }, delay);
          }
          setBuffering(false);
        }, { once: true });

        setTrackTitle(
          file_url
            .split("/")
            .pop()
            ?.replace(/^\d+_/, "")
            .replace(/\.[^.]+$/, "") || "Unknown Track"
        );
      }
    );
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [joined]);

  function handleLogout() {
    localStorage.removeItem("music-sync-role");
    router.push("/");
  }

  if (!joined) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-slate-800 rounded-2xl p-10 shadow-2xl border border-slate-700 text-center max-w-md w-full relative">
          <button
            onClick={handleLogout}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <Radio className="w-16 h-16 text-emerald-400 mx-auto mb-6" />
          <h1 className="text-2xl font-bold mb-2">Music Sync Player</h1>
          <p className="text-slate-400 mb-8">Join a synchronized listening session</p>
          <button
            onClick={() => setJoined(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-8 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg"
          >
            Join Sync Session
          </button>
        </div>
      </div>
    );
  }

  const isActive = playing || buffering;

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="bg-slate-800 rounded-2xl p-10 shadow-2xl border border-slate-700 text-center max-w-md w-full relative">
        <button
          onClick={handleLogout}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <LogOut className="w-5 h-5" />
        </button>
        <div className={`relative mb-6 ${isActive ? "animate-pulse" : ""}`}>
          <Headphones
            className={`w-20 h-20 mx-auto transition-colors duration-300 ${
              playing ? "text-emerald-400" : buffering ? "text-amber-400" : "text-slate-500"
            }`}
          />
          {playing && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-5 w-5 bg-emerald-500" />
            </span>
          )}
          {buffering && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5">
              <span className="animate-spin absolute inline-flex h-full w-full rounded-full border-2 border-t-transparent border-amber-400" />
            </span>
          )}
        </div>
        <h2 className="text-xl font-bold mb-2">
          {playing ? "Listening..." : buffering ? "Buffering..." : "Session Connected"}
        </h2>
        {trackTitle && (
          <p className={`font-medium ${isActive ? "animate-pulse" : ""} ${playing ? "text-emerald-400" : buffering ? "text-amber-400" : "text-slate-400"}`}>
            {trackTitle}
          </p>
        )}
        {!isActive && (
          <p className="text-slate-400">Waiting for the admin to broadcast a track...</p>
        )}
      </div>
      <audio ref={audioRef} />
    </div>
  );
}
