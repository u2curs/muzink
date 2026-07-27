"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Upload, Play, Music, LogOut, Download, Radio } from "lucide-react";

interface Track {
  id: number;
  title: string;
  file_url: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [envMissing, setEnvMissing] = useState(false);

  const [phase, setPhase] = useState<"idle" | "preparing" | "playing">("idle");
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const playStartRef = useRef(0);
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
      if (activeTrack && phase === "playing") {
        const elapsed = (Date.now() - playStartRef.current) / 1000;
        channel.send({
          type: "broadcast",
          event: "STATE",
          payload: {
            track: activeTrack.file_url,
            title: activeTrack.title,
            start_time: playStartRef.current,
            position: Math.max(0, elapsed),
          },
        });
      }
    });

    channel.subscribe();
    channel.track({ type: "admin", state: "idle" });

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!channelRef.current) return;
    if (phase === "playing" && activeTrack) {
      channelRef.current.track({
        type: "admin",
        state: "playing",
        track: activeTrack.file_url,
        title: activeTrack.title,
        start_time: playStartRef.current,
        updated_at: Date.now(),
      });

      syncRef.current = setInterval(() => {
        if (!channelRef.current) return;
        const elapsed = (Date.now() - playStartRef.current) / 1000;
        channelRef.current.track({
          type: "admin",
          state: "playing",
          track: activeTrack.file_url,
          title: activeTrack.title,
          start_time: playStartRef.current,
          position: Math.max(0, elapsed),
          updated_at: Date.now(),
        });
      }, 2000);
    } else if (phase === "preparing" && activeTrack) {
      channelRef.current.track({
        type: "admin",
        state: "preparing",
        track: activeTrack.file_url,
        title: activeTrack.title,
      });
    } else {
      channelRef.current.track({ type: "admin", state: "idle" });
    }
    return () => { if (syncRef.current) clearInterval(syncRef.current); };
  }, [phase, activeTrack]);

  async function fetchTracks() {
    const { data } = await supabase.from("playlist").select("*").order("id", { ascending: false });
    if (data) setTracks(data);
  }

  if (envMissing) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-slate-800 rounded-xl p-8 border border-slate-700 text-center max-w-md">
          <h1 className="text-xl font-bold mb-2">Configuration Required</h1>
          <p className="text-slate-400">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local</p>
        </div>
      </div>
    );
  }

  async function handleUpload() {
    if (!supabase) return;
    const file = fileRef.current?.files?.[0];
    if (!file || !title) return;
    setUploading(true);

    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `public/${Date.now()}_${sanitized}`;
    const { error: uploadError } = await supabase.storage.from("tracks").upload(filePath, file);
    if (uploadError) {
      alert("Upload failed: " + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("tracks").getPublicUrl(filePath);
    const file_url = urlData.publicUrl;

    const { error: dbError } = await supabase.from("playlist").insert({ title, file_url });
    if (dbError) {
      alert("DB insert failed: " + dbError.message);
    } else {
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      fetchTracks();
    }
    setUploading(false);
  }

  async function handlePrepare(track: Track) {
    if (!supabase || phase !== "idle") return;
    setActiveTrack(track);
    setPhase("preparing");
    await supabase.channel("audio-sync").send({
      type: "broadcast",
      event: "PREPARE",
      payload: { track: track.file_url, title: track.title },
    });
  }

  async function handlePlay() {
    if (!supabase || phase !== "preparing" || !activeTrack) return;
    const startTime = Date.now() + 500;
    playStartRef.current = startTime;
    setPhase("playing");
    await supabase.channel("audio-sync").send({
      type: "broadcast",
      event: "PLAY",
      payload: {
        track: activeTrack.file_url,
        title: activeTrack.title,
        start_time: startTime,
        position: 0,
      },
    });
  }

  function handleStop() {
    setPhase("idle");
    setActiveTrack(null);
    if (channelRef.current) {
      channelRef.current.track({ type: "admin", state: "idle" });
      channelRef.current.send({
        type: "broadcast",
        event: "STOP",
        payload: {},
      });
    }
  }

  function handleLogout() {
    localStorage.removeItem("music-sync-role");
    router.push("/");
  }

  const statusBar = phase === "playing" ? (
    <span className="text-emerald-400 flex items-center gap-2"><Radio className="w-4 h-4 animate-pulse" /> Now Playing: {activeTrack?.title}</span>
  ) : phase === "preparing" ? (
    <span className="text-amber-400 flex items-center gap-2"><Download className="w-4 h-4 animate-pulse" /> Prepared: {activeTrack?.title} — ready to play</span>
  ) : (
    <span className="text-slate-400">Idle — select a track to prepare</span>
  );

  return (
    <div className="flex-1 flex flex-col items-center p-6 relative">
      <button
        onClick={handleLogout}
        className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"
      >
        <LogOut className="w-5 h-5" />
      </button>
      <h1 className="text-3xl font-bold mb-2 flex items-center gap-3 text-emerald-400">
        <Music className="w-8 h-8" /> Admin Dashboard
      </h1>

      <div className="w-full max-w-2xl mb-6 bg-slate-800/60 rounded-lg px-5 py-3 border border-slate-700 text-sm flex items-center justify-between">
        {statusBar}
        {phase === "preparing" && (
          <div className="flex gap-2">
            <button
              onClick={handlePlay}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
            >
              <Play className="w-3.5 h-3.5" /> Play Now
            </button>
            <button
              onClick={handleStop}
              className="text-slate-400 hover:text-slate-200 text-sm px-2 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        {phase === "playing" && (
          <button
            onClick={handleStop}
            className="text-red-400 hover:text-red-300 text-sm px-2 py-1.5 transition-colors"
          >
            Stop
          </button>
        )}
      </div>

      <div className="w-full max-w-2xl bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700 mb-8">
        <h2 className="text-lg font-semibold mb-4 text-slate-200">Upload Track</h2>
        <div className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Track title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-slate-700 text-slate-100 rounded-lg px-4 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-emerald-600 file:text-white hover:file:bg-emerald-500"
          />
          <button
            onClick={handleUpload}
            disabled={uploading || !title || !fileRef.current?.files?.length}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" /> {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>

      <div className="w-full max-w-2xl bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700">
        <h2 className="text-lg font-semibold mb-4 text-slate-200">Playlist</h2>
        {tracks.length === 0 ? (
          <p className="text-slate-400 text-center py-8">No tracks uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 text-sm">
                  <th className="pb-3 pr-4">Title</th>
                  <th className="pb-3 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track) => {
                  const isActive = activeTrack?.id === track.id;
                  return (
                    <tr key={track.id} className="border-b border-slate-700/50">
                      <td className="py-3 pr-4 text-slate-200">{track.title}</td>
                      <td className="py-3">
                        {phase === "idle" && (
                          <button
                            onClick={() => handlePrepare(track)}
                            className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors font-medium text-sm"
                          >
                            <Download className="w-3.5 h-3.5" /> Prepare
                          </button>
                        )}
                        {phase === "preparing" && isActive && (
                          <span className="text-amber-400 text-sm flex items-center gap-1.5">
                            <Download className="w-3.5 h-3.5 animate-pulse" /> Prepared
                          </span>
                        )}
                        {phase === "playing" && isActive && (
                          <span className="text-emerald-400 text-sm flex items-center gap-1.5">
                            <Radio className="w-3.5 h-3.5 animate-pulse" /> Live
                          </span>
                        )}
                        {phase !== "idle" && !isActive && (
                          <span className="text-slate-600 text-sm">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
