"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Upload, Play, Music, LogOut } from "lucide-react";

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
  const [broadcastingId, setBroadcastingId] = useState<number | null>(null);
  const [envMissing, setEnvMissing] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem("music-sync-role");
    if (role !== "admin") router.replace("/");
  }, [router]);

  useEffect(() => {
    if (!supabase) { setEnvMissing(true); return; }
    fetchTracks();
  }, []);

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

  async function broadcastPlay(track: Track) {
    if (!supabase) return;
    setBroadcastingId(track.id);
    await supabase.channel("audio-sync").send({
      type: "broadcast",
      event: "PLAY",
      payload: { file_url: track.file_url },
    });
    setTimeout(() => setBroadcastingId(null), 500);
  }

  function handleLogout() {
    localStorage.removeItem("music-sync-role");
    router.push("/");
  }

  return (
    <div className="flex-1 flex flex-col items-center p-6 relative">
      <button
        onClick={handleLogout}
        className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"
      >
        <LogOut className="w-5 h-5" />
      </button>
      <h1 className="text-3xl font-bold mb-8 flex items-center gap-3 text-emerald-400">
        <Music className="w-8 h-8" /> Admin Dashboard
      </h1>

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
                {tracks.map((track) => (
                  <tr key={track.id} className="border-b border-slate-700/50">
                    <td className="py-3 pr-4 text-slate-200">{track.title}</td>
                    <td className="py-3">
                      <button
                        onClick={() => broadcastPlay(track)}
                        className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                      >
                        <Play className="w-4 h-4" />
                        {broadcastingId === track.id ? "Playing..." : "Broadcast Play"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
