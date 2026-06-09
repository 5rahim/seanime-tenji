import { appendServerHMACToken } from "@/api/client/server-auth"
import { getServerBaseUrl } from "@/api/client/server-url"
import type { AL_BaseAnime, Anime_EntryListData, Anime_Episode } from "@/api/generated/types"
import { getDownloadedEpisode, getDownloadEpisodeId } from "@/lib/downloads"
import type { AnimeEntryLaunchView, MobilePlaybackSource } from "./types"

type BuildLocalEpisodePlaybackSourceParams = {
    mediaId: number
    episode: Anime_Episode
    media?: AL_BaseAnime
    entryListData?: Anime_EntryListData
    episodes?: Anime_Episode[]
    serverUrl?: string | null
    entryView?: AnimeEntryLaunchView
}

export function getLocalEpisodePlaybackSource(
    params: BuildLocalEpisodePlaybackSourceParams,
): MobilePlaybackSource | null {
    const {
        mediaId,
        episode,
        media,
        entryListData,
        episodes,
        serverUrl,
        entryView = "library",
    } = params

    const episodeId = getDownloadEpisodeId(episode.aniDBEpisode, episode.type, episode.episodeNumber, episode.localFile?.path)
    const downloaded = getDownloadedEpisode(mediaId, episodeId)

    if (downloaded?.status === "completed" && downloaded.localFilePath && !downloaded.isLocalServerFile) {
        return {
            id: `downloaded-${Date.now()}`,
            streamKind: "file",
            url: downloaded.localFilePath,
            mediaId,
            episodeNumber: episode.episodeNumber,
            media,
            episode,
            entryListData,
            localFile: episode.localFile ?? undefined,
            entryView,
            nextEpisodeAction: "local-file",
            continuityKind: "mediastream",
            episodes,
        }
    }

    if (!episode.localFile?.path || !serverUrl) return null

    const base = getServerBaseUrl(serverUrl)
    const streamUrl = appendServerHMACToken(
        `${base}/api/v1/mediastream/file?path=${encodeURIComponent(episode.localFile.path)}`,
        "/api/v1/mediastream/file",
    )

    return {
        id: `local-${Date.now()}`,
        streamKind: "http",
        url: streamUrl,
        mediaId,
        episodeNumber: episode.episodeNumber,
        media,
        episode,
        entryListData,
        localFile: episode.localFile,
        entryView,
        nextEpisodeAction: "local-file",
        continuityKind: "mediastream",
        episodes,
    }
}
