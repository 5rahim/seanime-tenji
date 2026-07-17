import type { PlayerChapter } from "@/lib/player"
import type { MobilePlaybackSource } from "@/lib/player/types"
import { CENTER_TAP_ZONE_RATIO, DEFAULT_VIDEO_ASPECT_RATIO, DOUBLE_TAP_SEEK_EDGE_ZONE_RATIO } from "./constants"
import type { PlayerPanel } from "./types"

export function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return "0:00"
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    return `${m}:${String(s).padStart(2, "0")}`
}

export function formatSecondsLabel(seconds: number): string {
    return `${seconds}s`
}

export function getChapterAtTime(
    chapters: PlayerChapter[] | undefined,
    time: number,
): PlayerChapter | undefined {
    if (!chapters || chapters.length === 0) return undefined
    let result: PlayerChapter | undefined
    for (const ch of chapters) {
        if (ch.start <= time) result = ch
        else break
    }
    return result
}

export function getSourceVideoAspectRatio(source: MobilePlaybackSource | null): number {
    const videoTrack = source?.mkvMetadata?.videoTracks?.[0]?.video
        ?? source?.mkvMetadata?.tracks?.find(track => track.type === "video")?.video

    if (videoTrack?.PixelWidth && videoTrack.PixelHeight) {
        return videoTrack.PixelWidth / videoTrack.PixelHeight
    }

    return DEFAULT_VIDEO_ASPECT_RATIO
}

export function getFillZoomScale(screenWidth: number, screenHeight: number, videoAspectRatio: number): number {
    if (screenWidth <= 0 || screenHeight <= 0 || videoAspectRatio <= 0) return 1
    const containerAspectRatio = screenWidth / screenHeight
    return Math.max(1, containerAspectRatio / videoAspectRatio, videoAspectRatio / containerAspectRatio)
}

export function clamp(value: number, min: number, max: number): number {
    "worklet"
    return Math.min(max, Math.max(min, value))
}

export function getTapZone(screenWidth: number, tapX: number): "left" | "center" | "right" {
    "worklet"
    const centerInset = (screenWidth * (1 - CENTER_TAP_ZONE_RATIO)) / 2
    if (tapX >= centerInset && tapX <= screenWidth - centerInset) return "center"
    return tapX < screenWidth / 2 ? "left" : "right"
}

export function getDoubleTapSeekZone(screenWidth: number, tapX: number): "left" | "right" | null {
    "worklet"
    const edgeWidth = screenWidth * DOUBLE_TAP_SEEK_EDGE_ZONE_RATIO
    if (tapX <= edgeWidth) return "left"
    if (tapX >= screenWidth - edgeWidth) return "right"
    return null
}

export function getGestureTouchX(event: {
    allTouches?: Array<{ x: number }>
    changedTouches?: Array<{ x: number }>
}): number | null {
    "worklet"
    return event.allTouches?.[0]?.x ?? event.changedTouches?.[0]?.x ?? null
}

export function getBackPanel(panel: PlayerPanel): PlayerPanel | null {
    switch (panel) {
        case "audio-subtitles":
        case "speed":
        case "seek-buttons":
        case "double-tap-seek":
        case "video-sources":
        case "video-output":
            return "main"
        case "audio-tracks":
        case "subtitle-tracks":
        case "external-subtitles":
        case "audio-delay":
        case "subtitle-delay":
        case "subtitle-size":
        case "default-audio-lang":
        case "default-subtitle-lang":
            return "audio-subtitles"
        case "episodes":
        default:
            return null
    }
}
