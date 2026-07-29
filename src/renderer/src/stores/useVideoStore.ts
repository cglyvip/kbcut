import { create } from "zustand";

export interface VideoInfo {
  filePath: string;
  fileName: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  fileSize: number;
  codec: string;
}

interface VideoState {
  videoInfo: VideoInfo | null;
  loading: boolean;
  setVideoInfo: (info: VideoInfo | null) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  videoInfo: null,
  loading: false,
  setVideoInfo: (info) => set({ videoInfo: info }),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ videoInfo: null, loading: false }),
}));
