import type {
    AL_BaseAnime,
    Anime_EntryListData,
    Anime_Episode,
    Anime_LocalFile,
    Continuity_Kind,
    MKVParser_Metadata,
    NativePlayer_StreamType,
    Onlinestream_Subtitle,
    Onlinestream_VideoSource,
} from "@/api/generated/types"
import type { ServerLocalIdentity } from "@/lib/offline/server-local-store"

///////////////////////////////////////////////////////////////////////////////
// Mobile playback source
///////////////////////////////////////////////////////////////////////////////

/**
 * Transport classes understood by the mobile player.
 *
 * - `http` , HTTP stream (torrent / debrid / server localfile).
 * - `hls`  , HLS stream (online streaming).
 * - `file` , local file path.
 */
export type MobileStreamKind = "http" | "hls" | "file"

export type AnimeEntryLaunchView = "library" | "torrentstream" | "onlinestream" | "downloaded" | "server-local"

export type PlayerNextEpisodeAction =
    | "local-file"
    | "torrentstream-auto-select"
    | "torrentstream-previous-batch"
    | "torrentstream-manual"
    | "debridstream-auto-select"
    | "debridstream-previous-batch"
    | "debridstream-manual"
    | "onlinestream-play"

/**
 * Every source class (torrent, debrid, local-file, onlinestream) MUST
 * normalize into this shape before the player route is opened.
 */
export type MobilePlaybackSource = {
    /** Unique id for this playback session (use the backend's playback id when available). */
    id: string

    /** Transport kind, determines how the player loads media. */
    streamKind: MobileStreamKind

    /** The playable URL, HTTP(S) for `http`/`hls`, file path for `file`. */
    url: string

    /** MIME type when known (e.g. "video/x-matroska", "application/x-mpegURL"). */
    mimeType?: string

    /** Optional headers required for playback (e.g. referer for HLS sources). */
    headers?: Record<string, string>

    /** AniList media ID. */
    mediaId: number

    /** Episode number. */
    episodeNumber: number

    /** Full media object from backend. */
    media?: AL_BaseAnime

    /** Episode metadata from backend. */
    episode?: Anime_Episode

    /** Entry list data from backend (progress, score, etc.). */
    entryListData?: Anime_EntryListData

    /** Local file reference when applicable. */
    localFile?: Anime_LocalFile

    /** Entry tab to return to when handing playback back to the anime entry screen. */
    entryView?: AnimeEntryLaunchView

    /** Strategy the player should use when advancing to the next episode. */
    nextEpisodeAction?: PlayerNextEpisodeAction

    /** Mobile server identity used to validate manual-offline loopback playback. */
    serverLocalIdentity?: ServerLocalIdentity

    /** Server base selected by the loopback/configured-address resolver. */
    serverLocalServerUrl?: string

    /**
     * unused
     */
    serverStreamType?: NativePlayer_StreamType

    /** MKV metadata parsed by the backend (chapters, fonts, subtitle tracks). */
    mkvMetadata?: MKVParser_Metadata

    continuityKind: Continuity_Kind

    /** Seconds to resume from. Populated from continuity before playback starts. */
    resumePositionSec?: number

    /** External subtitle tracks for online streaming. */
    externalSubtitles?: Onlinestream_Subtitle[]

    /** Sources returned for the current online-stream episode. */
    onlineSources?: Onlinestream_VideoSource[]

    /** Online-stream source currently loaded by the player. */
    onlineSource?: Onlinestream_VideoSource

    episodes?: Anime_Episode[]
}

///////////////////////////////////////////////////////////////////////////////
// Player state
///////////////////////////////////////////////////////////////////////////////

export type PlayerStatus = "idle" | "loading" | "ready" | "buffering" | "error"

/** Track info emitted by the native player. */
export type PlayerTrack = {
    id: number
    type: "audio" | "subtitle"
    title?: string
    language?: string
    codec?: string
    selected: boolean
}

export type PlayerChapter = {
    id: number
    start: number
    title?: string
}

/**
 * Snapshot of native player state pushed from the Kotlin ViewModel.
 * All times are in seconds.
 */
export type PlayerState = {
    status: PlayerStatus
    paused: boolean
    currentTime: number
    duration: number
    eofReached: boolean
    chapters: PlayerChapter[]
    audioTracks: PlayerTrack[]
    subtitleTracks: PlayerTrack[]
    activeAudioTrackId: number | null
    activeSubtitleTrackId: number | null
    speed: number
    subtitleDelay: number
    audioDelay: number
    isPiPActive: boolean
}

/** Commands the React Native layer can send to the native player. */
export type PlayerCommand =
    | { type: "load"; source: MobilePlaybackSource }
    | { type: "play" }
    | { type: "pause" }
    | { type: "stop" }
    | { type: "seek"; positionSec: number }
    | { type: "setAudioTrack"; trackId: number }
    | { type: "setSubtitleTrack"; trackId: number }
    | { type: "destroy" }
