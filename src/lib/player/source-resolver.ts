import type { AL_BaseAnime, Anime_EntryListData, Anime_Episode, Onlinestream_VideoSource } from "@/api/generated/types"
import type { MobilePlaybackSource, MobileStreamKind } from "./types"

export function toSourceFromOnlineStream(params: {
    videoSource: Onlinestream_VideoSource
    videoSources?: Onlinestream_VideoSource[]
    mediaId: number
    episodeNumber: number
    media?: AL_BaseAnime
    episode?: Anime_Episode
    entryListData?: Anime_EntryListData
    episodes?: Anime_Episode[]
    resumePositionSec?: number
}): MobilePlaybackSource {
    const { videoSource, mediaId, episodeNumber, media, episode, entryListData } = params

    const isHls = videoSource.type === "m3u8" || videoSource.url.endsWith(".m3u8")
    const streamKind: MobileStreamKind = isHls ? "hls" : "http"
    const sourceIndex = params.videoSources?.findIndex(source => (
        source.url === videoSource.url
        && source.server === videoSource.server
        && source.quality === videoSource.quality
    )) ?? -1
    const sourceKey = sourceIndex >= 0
        ? String(sourceIndex)
        : `${videoSource.server}-${videoSource.quality}`

    return {
        id: `onlinestream-${mediaId}-${episodeNumber}-${sourceKey}`,
        streamKind,
        url: videoSource.url,
        mimeType: isHls ? "application/x-mpegURL" : "video/mp4",
        headers: videoSource.headers,

        mediaId,
        episodeNumber,
        media,
        episode,
        entryListData,
        entryView: "onlinestream",
        nextEpisodeAction: "onlinestream-play",

        continuityKind: "onlinestream",

        resumePositionSec: params.resumePositionSec,
        externalSubtitles: videoSource.subtitles ?? undefined,
        onlineSources: params.videoSources,
        onlineSource: videoSource,
        episodes: params.episodes,
    }
}

export function switchOnlineSource(
    source: MobilePlaybackSource,
    videoSource: Onlinestream_VideoSource,
    position: number,
): MobilePlaybackSource {
    return toSourceFromOnlineStream({
        videoSource,
        videoSources: source.onlineSources,
        mediaId: source.mediaId,
        episodeNumber: source.episodeNumber,
        media: source.media,
        episode: source.episode,
        entryListData: source.entryListData,
        episodes: source.episodes,
        resumePositionSec: position,
    })
}
