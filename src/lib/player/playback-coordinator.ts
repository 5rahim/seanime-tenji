import type { Anime_Entry, Anime_Episode, Onlinestream_VideoSource } from "@/api/generated/types"
import { useServerUrl } from "@/atoms/server.atoms"
import { isLocalServer } from "@/lib/downloads"
import { useIsServerConnected } from "@/lib/offline"
import { toSourceFromOnlineStream, useStartOnlineStreamPlayback } from "@/lib/player"
import { currentPlaybackSourceAtom, playerErrorAtom, playerLoadingMessageAtom, playerOpenAtom } from "@/lib/player"
import { openExternalPlayerURL } from "@/lib/player/external-players"
import { getLocalEpisodePlaybackSource } from "@/lib/player/local-file-source"
import { getPlayerPreferences } from "@/lib/player/player-preferences"
import type { MobilePlaybackSource } from "@/lib/player/types"
import { logger } from "@/lib/utils/logger"
import { toast } from "@/lib/utils/toast"
import { useRouter } from "expo-router"
import { useAtom } from "jotai"

const log = logger("playback-coordinator")

/**
 * If the user has configured an external player, open the URL in that app
 * and return true. Returns false when no external player is set.
 */
async function tryOpenExternalPlayer(streamUrl: string): Promise<boolean> {
    const prefs = getPlayerPreferences()
    if (!prefs.externalPlayerTemplate) return false

    log.info("Opening external player")

    const opened = await openExternalPlayerURL(prefs.externalPlayerTemplate, streamUrl)
    if (!opened) {
        toast.error("External player app not found")
        return false
    }

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
    const startOnlinePlayback = useStartOnlineStreamPlayback()
    const router = useRouter()

    const [, setSource] = useAtom(currentPlaybackSourceAtom)
    const [, setPlayerOpen] = useAtom(playerOpenAtom)
    const [, setLoadingMessage] = useAtom(playerLoadingMessageAtom)
    const [, setError] = useAtom(playerErrorAtom)

    const openBuiltInPlayer = (source: MobilePlaybackSource) => {
        setError(null)
        setLoadingMessage(null)
        setSource(source)
        setPlayerOpen(true)
        router.push("/(app)/(media)/player" as never)
    }

    // Local file playback
    const playLocalFileEpisode = (episode: Anime_Episode) => {
        if (!entry?.media) {
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
            if (!episode.localFile?.path) {
                toast.error("No local file available for this episode")
            } else if (!isServerConnected || !serverUrl) {
                toast.error("Server not connected")
            } else {
                toast.error("Unable to start playback")
            }
            return
        }

        if (source.streamKind === "file") {
            log.info(`Playing downloaded file: ${source.url}`)
            openBuiltInPlayer(source)
            return
        } else {
            log.info(`Starting local file playback: ${episode.localFile?.path ?? "unknown"}`)
        }

        tryOpenExternalPlayer(source.url).then(opened => {
            if (opened) return
            openBuiltInPlayer(source)
        })
    }

    // Online stream playback
    const playOnlineStreamEpisode = (params: {
        videoSource: Onlinestream_VideoSource
        episodeNumber: number
        episode?: Anime_Episode
    }) => {
        if (!entry?.media) {
            toast.error("Media not available")
            return
        }

        log.info(`Starting online stream playback: ep ${params.episodeNumber}`)

        const source = toSourceFromOnlineStream({
            videoSource: params.videoSource,
            mediaId: entry.media.id,
            episodeNumber: params.episodeNumber,
            media: entry.media,
            episode: params.episode,
            entryListData: entry.listData ?? undefined,
            episodes: entry.episodes ?? undefined,
        })

        tryOpenExternalPlayer(source.url).then(opened => {
            if (opened) return
            startOnlinePlayback(source)
        })
    }

    return {
        playLocalFileEpisode,
        playOnlineStreamEpisode,
    }
}
