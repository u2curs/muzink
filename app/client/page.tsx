"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Headphones, Radio, LogOut, Download } from "lucide-react";

export default function ClientPage() {
  const router = useRouter();
  const [joined, setJoined] = useState(false);
  const [state, setState] = useState<"idle" | "preparing" | "playing">("idle");
  const [trackTitle, setTrackTitle] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    const role = localStorage.getItem("music-sync-role");
    if (!role) router.replace("/");
  }, [router]);

  useEffect(() => {
    if (!joined || !supabase) return;

    const channel = supabase.channel("audio-sync");
    channelRef.current = channel;

    channel.on("broadcast", { event: "PREPARE" }, (payload) => {
      const { track, title } = payload.payload as { track: string; title: string };
      setTrackTitle(title || "Unknown Track");
      setState("preparing");
      if (audioRef.current) {
        audioRef.current.src = track;
        audioRef.current.load();
      }
    });

    channel.on("broadcast", { event: "PLAY" }, (payload) => {
      const { track, title, start_time, position } = payload.payload as {
        track: string; title: string; start_time: number; position: number;
      };
      const audio = audioRef.current;
      if (!audio) return;

      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      setTrackTitle(title || "Unknown Track");

      if (audio.src !== track) {
        audio.src = track;
        audio.currentTime = position || 0;
        audio.load();
      } else {
        audio.currentTime = position || 0;
      }

      const playSync = () => {
        const delay = start_time - Date.now();
        if (delay <= 0) {
          audio.play().catch(console.error);
          setState("playing");
        } else {
          syncTimerRef.current = setTimeout(() => {
            audio.play().catch(console.error);
            setState("playing");
          }, delay);
        }
      };

      if (audio.readyState >= 3) {
        playSync();
      } else {
        audio.addEventListener("canplaythrough", playSync, { once: true });
      }
    });

    channel.on("broadcast", { event: "STOP" }, () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      setState("idle");
      setTrackTitle("");
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    });

    channel.on("broadcast", { event: "STATE" }, (payload) => {
      const { track, title, start_time, position } = payload.payload as {
        track: string; title: string; start_time: number; position: number;
      };
      lateJoinSync(track, title, start_time, position);
    });

    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;

      const presence = channel.presenceState();
      let adminState: any = null;
      for (const key of Object.keys(presence)) {
        const presences = presence[key] as any[];
        for (const p of presences) {
          if (p.type === "admin") { adminState = p; break; }
        }
        if (adminState) break;
      }

      if (adminState?.state === "playing" && adminState.track) {
        lateJoinSync(adminState.track, adminState.title || "", adminState.start_time || 0, adminState.position || 0);
      } else if (adminState?.state === "preparing" && adminState.track) {
        setTrackTitle(adminState.title || "Unknown Track");
        setState("preparing");
        if (audioRef.current) {
          audioRef.current.src = adminState.track;
          audioRef.current.load();
        }
      } else {
        channel.send({
          type: "broadcast",
          event: "REQUEST_STATE",
          payload: {},
        });
      }
    });

    return () => {
      supabase.removeChannel(channel);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
    };
  }, [joined]);

  function lateJoinSync(track: string, title: string, startTime: number, position: number) {
    const audio = audioRef.current;
    if (!audio) return;

    setTrackTitle(title);
    setState("preparing");

    audio.src = track;
    const elapsed = (Date.now() - startTime) / 1000;
    const seekTo = Math.max(0, position + elapsed);
    audio.currentTime = seekTo;

    audio.addEventListener("canplaythrough", () => {
      audio.play().catch(console.error);
      setState("playing");
    }, { once: true });
  }

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

  const isActive = state !== "idle";

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
              state === "playing" ? "text-emerald-400" : state === "preparing" ? "text-amber-400" : "text-slate-500"
            }`}
          />
          {state === "playing" && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-5 w-5 bg-emerald-500" />
            </span>
          )}
          {state === "preparing" && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5">
              <span className="animate-spin absolute inline-flex h-full w-full rounded-full border-2 border-t-transparent border-amber-400" />
            </span>
          )}
        </div>
        <h2 className="text-xl font-bold mb-2">
          {state === "playing" ? "Listening..." : state === "preparing" ? "Preparing..." : "Session Connected"}
        </h2>
        {trackTitle && (
          <p className={`font-medium ${isActive ? "animate-pulse" : ""} ${state === "playing" ? "text-emerald-400" : state === "preparing" ? "text-amber-400" : "text-slate-400"}`}>
            {trackTitle}
          </p>
        )}
        {state === "preparing" && (
          <div className="mt-4 flex justify-center">
            <div className="w-48 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: "60%" }} />
            </div>
          </div>
        )}
        {state === "idle" && (
          <p className="text-slate-400">Waiting for the admin to broadcast a track...</p>
        )}
      </div>
      <audio ref={audioRef} />
    </div>
  );
}
