import type { ViewProps } from "react-native"

///////////////////////////////////////////////////////////////////////////////
// Source
///////////////////////////////////////////////////////////////////////////////

export type MpvExternalSubtitle = {
    url: string
    title?: string
}

export type NowPlayingMetadata = {
    title?: string
    artist?: string
    albumTitle?: string
    artworkUri?: string
}

export type SubtitleHorizontalAlignment = "left" | "center" | "right"
export type SubtitleVerticalAlignment = "top" | "center" | "bottom"
export type MpvVideoOutput = "gpu-next" | "gpu"

/**
 * Fully-resolved playback source passed to the native view via the `source` prop.
 * Changing this prop triggers the native view to load the new video.
 */
export type MpvVideoSource = {
    url: string
    headers?: Record<string, string>
    externalSubtitles?: MpvExternalSubtitle[]
    startPosition?: number
    autoplay?: boolean
}

///////////////////////////////////////////////////////////////////////////////
// Event payloads
///////////////////////////////////////////////////////////////////////////////

export type OnLoadEventPayload = {
    url: string
}

export type OnProgressEventPayload = {
    position: number
    duration: number
    cacheSeconds: number
}

export type OnPlaybackStateChangePayload = {
    isPaused?: boolean
    isPlaying?: boolean
    isLoading?: boolean
    isReadyToSeek?: boolean
    eofReached?: boolean
    isPiPActive?: boolean
    speed?: number
    subtitleDelay?: number
    audioDelay?: number
}

export type OnErrorEventPayload = {
    error: string
}

///////////////////////////////////////////////////////////////////////////////
// Tracks
///////////////////////////////////////////////////////////////////////////////

export type SubtitleTrack = {
    id: number
    title?: string
    lang?: string
    codec?: string
    selected: boolean
}

export type AudioTrack = {
    id: number
    title?: string
    lang?: string
    codec?: string
    channels?: number
    selected: boolean
}

export type MpvChapter = {
    id: number
    title?: string
    time: number
}

///////////////////////////////////////////////////////////////////////////////
// Technical info
///////////////////////////////////////////////////////////////////////////////

export type TechnicalInfo = {
    videoWidth?: number
    videoHeight?: number
    videoCodec?: string
    audioCodec?: string
    fps?: number
    cacheSeconds?: number
    droppedFrames?: number
}

///////////////////////////////////////////////////////////////////////////////
// View ref (imperative handle)
///////////////////////////////////////////////////////////////////////////////

export type MpvPlayerViewRef = {
    // playback
    play: () => Promise<void>
    pause: () => Promise<void>
    seekTo: (position: number) => Promise<void>
    seekBy: (offset: number) => Promise<void>
    setSpeed: (speed: number) => Promise<void>
    getSpeed: () => Promise<number>
    isPaused: () => Promise<boolean>
    getCurrentPosition: () => Promise<number>
    getDuration: () => Promise<number>

    // PiP
    startPictureInPicture: () => Promise<void>
    stopPictureInPicture: () => Promise<void>
    isPictureInPictureSupported: () => Promise<boolean>
    isPictureInPictureActive: () => Promise<boolean>

    // subtitle controls
    getSubtitleTracks: () => Promise<SubtitleTrack[]>
    getChapters: () => Promise<MpvChapter[]>
    setSubtitleTrack: (trackId: number) => Promise<void>
    disableSubtitles: () => Promise<void>
    getCurrentSubtitleTrack: () => Promise<number>
    addSubtitleFile: (url: string, select: boolean) => Promise<void>
    setSubtitleDelay: (delay: number) => Promise<void>
    setSubtitleFontSize: (size: number) => Promise<void>
    setSubtitleVisibility: (visible: boolean) => Promise<void>
    setSubtitlePosition: (position: number) => Promise<void>
    setSubtitleScale: (scale: number) => Promise<void>
    setSubtitleMarginY: (margin: number) => Promise<void>
    setSubtitleAlignX: (alignment: SubtitleHorizontalAlignment) => Promise<void>
    setSubtitleAlignY: (alignment: SubtitleVerticalAlignment) => Promise<void>

    // audio controls
    getAudioTracks: () => Promise<AudioTrack[]>
    setAudioTrack: (trackId: number) => Promise<void>
    getCurrentAudioTrack: () => Promise<number>
    setAudioDelay: (delay: number) => Promise<void>

    // zoom
    setVideoZoom: (scale: number) => Promise<void>
    setZoomedToFill: (zoomed: boolean) => Promise<void>
    isZoomedToFill: () => Promise<boolean>

    // technical info
    getTechnicalInfo: () => Promise<TechnicalInfo>
}

///////////////////////////////////////////////////////////////////////////////
// View props
///////////////////////////////////////////////////////////////////////////////

export type OnPictureInPictureChangeEventPayload = {
    isActive: boolean
}

type NativeEvent<T> = { nativeEvent: T }

export type MpvPlayerViewProps = ViewProps & {
    source?: MpvVideoSource
    nowPlayingMetadata?: NowPlayingMetadata
    videoOutput?: MpvVideoOutput
    onLoad?: (event: NativeEvent<OnLoadEventPayload>) => void
    onProgress?: (event: NativeEvent<OnProgressEventPayload>) => void
    onPlaybackStateChange?: (event: NativeEvent<OnPlaybackStateChangePayload>) => void
    onError?: (event: NativeEvent<OnErrorEventPayload>) => void
    onTracksReady?: (event: NativeEvent<Record<string, never>>) => void
    onPictureInPictureChange?: (event: NativeEvent<OnPictureInPictureChangeEventPayload>) => void
}
