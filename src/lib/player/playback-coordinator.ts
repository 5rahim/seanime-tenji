import type { Anime_Entry, Anime_Episode, Onlinestream_VideoSource } from "@/api/generated/types"
import { useServerUrl } from "@/atoms/server.atoms"
import { isLocalServer } from "@/lib/downloads"
import { useIsServerConnected, useServerLocalIdentity } from "@/lib/offline"
import { toSourceFromOnlineStream, useStartOnlineStreamPlayback } from "@/lib/player"
import { currentPlaybackSourceAtom, playerErrorAtom, playerLoadingMessageAtom, playerOpenAtom } from "@/lib/player"
import { openExternalPlayerURL } from "@/lib/player/external-players"
import { getLocalEpisodePlaybackSource } from "@/lib/player/local-file-source"
import { getPlayerPreferences } from "@/lib/player/player-preferences"
import { resolveServerLocalEpisodePlaybackSource } from "@/lib/player/server-local-source"
import type { MobilePlaybackSource } from "@/lib/player/types"
import { logger } from "@/lib/utils/logger"
import { toast } from "@/lib/utils/toast"
import { useRouter } from "expo-router"
import { useAtom } from "jotai"
import { Alert } from "react-native"

const log = logger("playback-coordinator")

function sourceLogData(source: MobilePlaybackSource) {
    return {
        id: source.id,
        streamKind: source.streamKind,
        mediaId: source.mediaId,
        episodeNumber: source.episodeNumber,
        entryView: source.entryView ?? null,
        subtitleCount: source.externalSubtitles?.length ?? 0,
        hasHeaders: !!source.headers && Object.keys(source.headers).length > 0,
    }
}

/**
 * If the user has configured an external player, open the URL in that app
 * and return true. Returns false when no external player is set.
 */
async function tryOpenExternalPlayer(streamUrl: string, source: MobilePlaybackSource): Promise<boolean> {
    const prefs = getPlayerPreferences()
    if (!prefs.externalPlayerTemplate) return false

    log.info("Opening external player", sourceLogData(source))

    const opened = await openExternalPlayerURL(prefs.externalPlayerTemplate, streamUrl)
    if (!opened) {
        log.warning("External player could not be opened; using the built-in player")
        toast.error("External player app not found")
        return false
    }

    log.success("External player opened")
    return true
}

/**
 * For torrentstream and debrid, the existing controllers already send the correct playbackType and the NativePlayerEventListener picks up the
 * websocket event to navigate to the player.
 *
 * This coordinator handles:
 * - Local file
 * - Onlinestream
 */
export function usePlaybackCoordinator(entry: Anime_Entry | undefined) {
    const serverUrl = useServerUrl()
    const isServerConnected = useIsServerConnected()
    const serverLocalIdentity = useServerLocalIdentity()
    const startOnlinePlayback = useStartOnlineStreamPlayback()
    const router = useRouter()

    const [, setSource] = useAtom(currentPlaybackSourceAtom)
    const [, setPlayerOpen] = useAtom(playerOpenAtom)
    const [, setLoadingMessage] = useAtom(playerLoadingMessageAtom)
    const [, setError] = useAtom(playerErrorAtom)

    const openBuiltInPlayer = (source: MobilePlaybackSource) => {
        log.info("Opening built-in player", sourceLogData(source))
        setError(null)
        setLoadingMessage(null)
        setSource(source)
        setPlayerOpen(true)
        router.push("/(app)/(media)/player" as never)
    }

    // applies the saved player preference and opens the built-in player when the handoff fails.
    const playFileSource = async (source: MobilePlaybackSource) => {
        const opened = await tryOpenExternalPlayer(source.url, source)
        if (opened) return
        openBuiltInPlayer(source)
    }

    // Local file playback
    const playLocalFileEpisode = (episode: Anime_Episode) => {
        if (!entry?.media) {
            log.warning("Local playback stopped: media metadata is missing")
            toast.error("Media not available")
            return
        }

        const isLocal = serverUrl ? isLocalServer(serverUrl) : false
        const effectiveServerUrl = (isServerConnected || isLocal) ? serverUrl : null

        const source = getLocalEpisodePlaybackSource({
            mediaId: entry.media.id,
            episode,
            media: entry.media,
            entryListData: entry.listData ?? undefined,
            episodes: entry.episodes ?? undefined,
            serverUrl: effectiveServerUrl,
            entryView: "library",
        })

        if (!source) {
            log.warning("Local playback source could not be resolved", {
                mediaId: entry.media.id,
                episodeNumber: episode.episodeNumber,
                hasLocalFile: !!episode.localFile?.path,
                isServerConnected,
                hasServerUrl: !!serverUrl,
            })
            if (!episode.localFile?.path) {
                toast.error("No local file available for this episode")
            } else if (!isServerConnected || !serverUrl) {
                toast.error("Server not connected")
            } else {
                toast.error("Unable to start playback")
            }
            return
        }

        playFileSource(source)
    }

    const playServerLocalFileEpisode = async (episode: Anime_Episode, serverLocalEntry?: Anime_Entry) => {
        const playbackEntry = serverLocalEntry ?? entry
        if (!playbackEntry?.media || !serverUrl || !serverLocalIdentity) {
            log.warning("Server-local playback stopped: required server data is missing", {
                hasMedia: !!playbackEntry?.media,
                hasServerUrl: !!serverUrl,
                hasIdentity: !!serverLocalIdentity,
            })
            toast.error("Server-owned media is unavailable")
            return
        }

        log.info("Resolving server-local playback", {
            mediaId: playbackEntry.media.id,
            episodeNumber: episode.episodeNumber,
        })

        const source = await resolveServerLocalEpisodePlaybackSource({
            mediaId: playbackEntry.media.id,
            episode,
            media: playbackEntry.media,
            entryListData: playbackEntry.listData ?? undefined,
            episodes: playbackEntry.episodes ?? undefined,
            configuredServerUrl: serverUrl,
            identity: serverLocalIdentity,
        })

        if (!source) {
            log.warning("Server-local playback source could not be resolved", {
                mediaId: playbackEntry.media.id,
                episodeNumber: episode.episodeNumber,
            })
            Alert.alert(
                "Seanime Server unavailable",
                "Start Seanime Server Mobile. Without internet, enable its offline mode before starting the server.",
            )
            return
        }

        await playFileSource(source)
    }

    // Online stream playback
    const playOnlineStreamEpisode = (params: {
        videoSource: Onlinestream_VideoSource
        videoSources: Onlinestream_VideoSource[]
        episodeNumber: number
        episode?: Anime_Episode
    }) => {
        if (!entry?.media) {
            log.warning("Online playback stopped: media metadata is missing")
            toast.error("Media not available")
            return
        }

        const source = toSourceFromOnlineStream({
            videoSource: params.videoSource,
            videoSources: params.videoSources,
            mediaId: entry.media.id,
            episodeNumber: params.episodeNumber,
            media: entry.media,
            episode: params.episode,
            entryListData: entry.listData ?? undefined,
            episodes: entry.episodes ?? undefined,
        })

        log.info("Online stream source selected", {
            ...sourceLogData(source),
            server: params.videoSource.server,
            quality: params.videoSource.quality,
            type: params.videoSource.type,
        })

        tryOpenExternalPlayer(source.url, source).then(opened => {
            if (opened) return
            startOnlinePlayback(source)
        })
    }

    return {
        playFileSource,
        playLocalFileEpisode,
        playServerLocalFileEpisode,
        playOnlineStreamEpisode,
    }
}
