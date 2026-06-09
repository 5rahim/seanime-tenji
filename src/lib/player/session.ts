import { getServerBaseUrl } from "@/api/client/server-url"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type {
    AL_AnimeCollection,
    AL_BaseAnime,
    Anime_Entry,
    Anime_EntryListData,
    Anime_Episode,
    Anime_LibraryCollection,
    DebridClient_StreamState,
    Torrentstream_TorrentStatus,
} from "@/api/generated/types"
import { usePlaybackCancelManualTracking } from "@/api/hooks/playback_manager.hooks"
import { useServerUrl } from "@/atoms/server.atoms"
import { websocketAtom } from "@/atoms/websocket.atoms"
import { logger } from "@/lib/utils/logger"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { atom, useAtom } from "jotai"
import { useAtomValue } from "jotai/react"
import React from "react"
import { openExternalPlayerURL } from "./external-players"
import { getPlayerPreferences } from "./player-preferences"
import type { AnimeEntryLaunchView, MobilePlaybackSource, PlayerNextEpisodeAction } from "./types"

export const currentPlaybackSourceAtom = atom<MobilePlaybackSource | null>(null)

const log = logger("player-session")

export function resolvePlaybackMetadataFromCache(
    queryClient: any,
    mediaId: number | undefined,
    episodeNumber: number | undefined,
    initial: {
        media?: AL_BaseAnime
        episode?: Anime_Episode
        entryListData?: Anime_EntryListData
    } = {},
) {
    let media = initial.media
    let episode = initial.episode
    let entryListData = initial.entryListData

    if (!mediaId || mediaId <= 0) {
        return { media, episode, entryListData }
    }

    const entryCache = queryClient.getQueryData([
        API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key,
        String(mediaId),
    ]) as Anime_Entry | undefined

    if (entryCache) {
        if (!media) media = entryCache.media
        if (!entryListData) entryListData = entryCache.listData
        if (!episode && episodeNumber && episodeNumber > 0 && entryCache.episodes) {
            episode = entryCache.episodes.find(e => e.episodeNumber === episodeNumber)
        }
    }

    if (!media || !episode || !entryListData) {
        const allEntries = queryClient.getQueriesData({
            queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key],
        }) as [unknown, Anime_Entry | undefined][]
        for (const [, data] of allEntries) {
            if (data?.mediaId === mediaId) {
                if (!media) media = data.media
                if (!entryListData) entryListData = data.listData
                if (!episode && episodeNumber && episodeNumber > 0 && data.episodes) {
                    episode = data.episodes.find(e => e.episodeNumber === episodeNumber)
                }
                break
            }
        }
    }

    if (!media || !entryListData) {
        const libCollection = queryClient.getQueryData([
            API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key,
        ]) as Anime_LibraryCollection | undefined
        if (libCollection?.lists) {
            for (const list of libCollection.lists) {
                if (list.entries) {
                    const entry = list.entries.find(e => e.mediaId === mediaId)
                    if (entry) {
                        if (!media) media = entry.media
                        if (!entryListData) entryListData = entry.listData
                        break
                    }
                }
            }
        }
    }

    if (!media) {
        const animeCollection = queryClient.getQueryData([
            API_ENDPOINTS.ANILIST.GetAnimeCollection.key,
        ]) as AL_AnimeCollection | undefined
        if (animeCollection?.MediaListCollection?.lists) {
            for (const list of animeCollection.MediaListCollection.lists) {
                if (list.entries) {
                    const entry = list.entries.find(e => e.media?.id === mediaId)
                    if (entry?.media) {
                        media = entry.media
                        break
                    }
                }
            }
        }
    }

    return { media, episode, entryListData }
}

export function useActivePlaybackSource(): MobilePlaybackSource | null {
    const rawSource = useAtomValue(currentPlaybackSourceAtom)
    const queryClient = useQueryClient()

    return React.useMemo(() => {
        if (!rawSource) return null

        if (rawSource.media && rawSource.episode && rawSource.entryListData) {
            return rawSource
        }

        const hydrated = resolvePlaybackMetadataFromCache(
            queryClient,
            rawSource.mediaId,
            rawSource.episodeNumber,
            {
                media: rawSource.media,
                episode: rawSource.episode,
                entryListData: rawSource.entryListData,
            },
        )

        return {
            ...rawSource,
            media: hydrated.media,
            episode: hydrated.episode,
            entryListData: hydrated.entryListData,
        }
    }, [rawSource, queryClient])
}


export const playerOpenAtom = atom(false)

export const playerLoadingMessageAtom = atom<string | null>(null)

export const playerErrorAtom = atom<string | null>(null)

/**
 * Context stored when a torrent stream is initiated via external player link.
 * Lets us attach full media/episode metadata to the source.
 */
export type StreamSessionMode = "torrent" | "debrid"

export type TorrentStreamPendingInfo = {
    streamMode: StreamSessionMode
    mediaId: number
    episodeNumber: number
    media?: AL_BaseAnime
    episode?: Anime_Episode
    entryListData?: Anime_EntryListData
    entryView?: AnimeEntryLaunchView
    nextEpisodeAction?: PlayerNextEpisodeAction
}

export const torrentStreamPendingInfoAtom = atom<TorrentStreamPendingInfo | null>(null)
export const streamSessionModeAtom = atom<StreamSessionMode | null>(null)

export type ActiveStreamSessionStatus = "preparing" | "ready" | "playing"

export type ActiveStreamSession = {
    streamMode: StreamSessionMode
    mediaId: number | null
    episodeNumber: number | null
    title: string
    subtitle?: string
    status: ActiveStreamSessionStatus
    message?: string | null
    torrentName?: string | null
    isInferred?: boolean
    startedAt: number
    updatedAt: number
}

export const activeStreamSessionAtom = atom<ActiveStreamSession | null>(null)

/** True while the server is preparing the torrent stream (after start -> before URL is ready). */
export const torrentStreamIsPreparingAtom = atom(false)

export type TorrentStreamLoadingState =
    | "LOADING"
    | "SEARCHING_TORRENTS"
    | "CHECKING_TORRENT"
    | "ADDING_TORRENT"
    | "SELECTING_FILE"
    | "STARTING_SERVER"
    | "SENDING_STREAM_TO_MEDIA_PLAYER"

const TORRENT_STREAM_LOADING_FALLBACK_DELAY = 500
const TORRENT_STREAM_LOADING_STATES: TorrentStreamLoadingState[] = [
    "LOADING",
    "SEARCHING_TORRENTS",
    "CHECKING_TORRENT",
    "ADDING_TORRENT",
    "SELECTING_FILE",
    "STARTING_SERVER",
    "SENDING_STREAM_TO_MEDIA_PLAYER",
]

export const torrentStreamLoadingStateAtom = atom<TorrentStreamLoadingState | null>(null)
export const torrentStreamLoadingTorrentNameAtom = atom<string | null>(null)
export const torrentStreamStatusAtom = atom<Torrentstream_TorrentStatus | null>(null)
export const torrentStreamIsLoadedAtom = atom(false)
export const debridStreamStateAtom = atom<DebridClient_StreamState | null>(null)

type TorrentStreamSocketPayload = {
    state?: string
    data?: unknown
}

type TorrentStreamLoadingPayload = {
    state?: string
    torrentBeingLoaded?: string | null
}

type ActiveStreamSessionUpdate = {
    status: ActiveStreamSessionStatus
    message?: string | null
    torrentName?: string | null
}

type ExternalPlayerOpenURLPayload = {
    url?: string
    mediaId?: number
    episodeNumber?: number
    mediaTitle?: string
}

function isTorrentStreamLoadingState(value: string): value is TorrentStreamLoadingState {
    return TORRENT_STREAM_LOADING_STATES.includes(value as TorrentStreamLoadingState)
}

function parseTorrentStreamLoadingPayload(data: unknown): {
    state: TorrentStreamLoadingState | null
    torrentBeingLoaded: string | null
} {
    if (typeof data === "string") {
        return {
            state: isTorrentStreamLoadingState(data) ? data : null,
            torrentBeingLoaded: null,
        }
    }

    if (typeof data === "object" && data !== null) {
        const payload = data as TorrentStreamLoadingPayload
        return {
            state: typeof payload.state === "string" && isTorrentStreamLoadingState(payload.state)
                ? payload.state
                : null,
            torrentBeingLoaded: typeof payload.torrentBeingLoaded === "string"
                ? payload.torrentBeingLoaded
                : null,
        }
    }

    return {
        state: null,
        torrentBeingLoaded: null,
    }
}

function getActiveStreamSessionFromPending(
    pending: TorrentStreamPendingInfo,
    streamMode: StreamSessionMode,
    update: ActiveStreamSessionUpdate,
): ActiveStreamSession {
    const title = pending.media?.title?.userPreferred
        || pending.media?.title?.romaji
        || pending.media?.title?.english
        || `Anime #${pending.mediaId}`
    const episodeTitle = pending.episode?.episodeTitle || pending.episode?.displayTitle
    const subtitle = episodeTitle
        ? `Episode ${pending.episodeNumber} · ${episodeTitle}`
        : `Episode ${pending.episodeNumber}`
    const now = Date.now()

    return {
        streamMode,
        mediaId: pending.mediaId,
        episodeNumber: pending.episodeNumber,
        title,
        subtitle,
        startedAt: now,
        updatedAt: now,
        ...update,
    }
}

function getFallbackActiveStreamCopy(streamMode: StreamSessionMode,
    update: ActiveStreamSessionUpdate,
): Pick<ActiveStreamSession, "title" | "subtitle"> {
    if (streamMode === "debrid") {
        return {
            title: "Debrid streaming",
            subtitle: update.torrentName && update.torrentName !== "-" ? update.torrentName : "Ongoing",
        }
    }

    return {
        title: "Torrent streaming",
        subtitle: "Ongoing",
    }
}

function getFallbackActiveStreamSession(
    streamMode: StreamSessionMode,
    update: ActiveStreamSessionUpdate,
): ActiveStreamSession {
    const now = Date.now()

    return {
        streamMode,
        mediaId: null,
        episodeNumber: null,
        ...getFallbackActiveStreamCopy(streamMode, update),
        isInferred: true,
        startedAt: now,
        updatedAt: now,
        ...update,
    }
}

function updateActiveStreamSession(
    current: ActiveStreamSession | null,
    pending: TorrentStreamPendingInfo | null,
    streamMode: StreamSessionMode,
    update: ActiveStreamSessionUpdate,
): ActiveStreamSession | null {
    const matchesPending = pending
        ? current?.streamMode === streamMode
        && current.mediaId === pending.mediaId
        && current.episodeNumber === pending.episodeNumber
        : current?.streamMode === streamMode
    const base = matchesPending
        ? current
        : pending
            ? getActiveStreamSessionFromPending(pending, streamMode, update)
            : getFallbackActiveStreamSession(streamMode, update)

    // socket status can outlive the launch screen after app reopen
    if (!base) return getFallbackActiveStreamSession(streamMode, update)

    return {
        ...base,
        ...update,
        torrentName: update.torrentName === undefined ? base.torrentName : update.torrentName,
        updatedAt: Date.now(),
    }
}

function updateActiveStreamSessionFromExternalPlayerPayload(
    current: ActiveStreamSession | null,
    pending: TorrentStreamPendingInfo | null,
    streamMode: StreamSessionMode,
    payload: ExternalPlayerOpenURLPayload,
): ActiveStreamSession {
    const update: ActiveStreamSessionUpdate = {
        status: "playing",
        message: "Streaming",
    }
    const base = (pending
        ? updateActiveStreamSession(current, pending, streamMode, update)
        : current?.streamMode === streamMode
            ? current
            : getFallbackActiveStreamSession(streamMode, update)) ?? getFallbackActiveStreamSession(streamMode, update)
    const mediaId = typeof payload.mediaId === "number" ? payload.mediaId : base?.mediaId ?? null
    const episodeNumber = typeof payload.episodeNumber === "number" ? payload.episodeNumber : base?.episodeNumber ?? null
    const title = typeof payload.mediaTitle === "string" && payload.mediaTitle.length > 0
        ? payload.mediaTitle
        : base?.title ?? getFallbackActiveStreamCopy(streamMode, update).title
    const subtitle = episodeNumber !== null
        ? `Episode ${episodeNumber}`
        : base?.subtitle ?? getFallbackActiveStreamCopy(streamMode, update).subtitle

    return {
        ...base,
        streamMode,
        mediaId,
        episodeNumber,
        title,
        subtitle,
        ...update,
        torrentName: base?.torrentName ?? null,
        updatedAt: Date.now(),
    }
}

export function getTorrentStreamLoadingLabel(state: TorrentStreamLoadingState | null, torrentName?: string | null): string {
    switch (state) {
        case "SEARCHING_TORRENTS":
            return "Searching torrents..."
        case "CHECKING_TORRENT":
            return torrentName ? `Checking torrent ${torrentName}` : "Checking torrent..."
        case "ADDING_TORRENT":
            return torrentName ? `Adding torrent ${torrentName}` : "Adding torrent..."
        case "SELECTING_FILE":
            return "Selecting file..."
        case "STARTING_SERVER":
            return "Starting stream server..."
        case "SENDING_STREAM_TO_MEDIA_PLAYER":
            return "Sending stream to player..."
        case "LOADING":
        default:
            return "Preparing stream..."
    }
}


/**
 * Listens for websocket events from the server and navigates to the player.
 *
 * Handles:
 * - `external-player-open-url` events (externalPlayerLink flow for torrent, debrid)
 *
 */
export function usePlayerEventListener() {
    const socket = useAtomValue(websocketAtom)
    const serverUrl = useServerUrl()
    const router = useRouter()
    const queryClient = useQueryClient()

    const [, setSource] = useAtom(currentPlaybackSourceAtom)
    const [, setPlayerOpen] = useAtom(playerOpenAtom)
    const [, setLoadingMessage] = useAtom(playerLoadingMessageAtom)
    const [, setError] = useAtom(playerErrorAtom)
    const [, setIsPreparing] = useAtom(torrentStreamIsPreparingAtom)
    const [, setPendingInfo] = useAtom(torrentStreamPendingInfoAtom)
    const [, setStreamSessionMode] = useAtom(streamSessionModeAtom)
    const [, setTorrentLoadingState] = useAtom(torrentStreamLoadingStateAtom)
    const [, setTorrentLoadingTorrentName] = useAtom(torrentStreamLoadingTorrentNameAtom)
    const [, setTorrentStatus] = useAtom(torrentStreamStatusAtom)
    const [, setTorrentIsLoaded] = useAtom(torrentStreamIsLoadedAtom)
    const [, setDebridStreamState] = useAtom(debridStreamStateAtom)
    const [, setActiveStreamSession] = useAtom(activeStreamSessionAtom)

    const { mutate: cancelManualTracking } = usePlaybackCancelManualTracking({})

    const pendingInfoRef = React.useRef<TorrentStreamPendingInfo | null>(null)
    const streamSessionModeRef = React.useRef<StreamSessionMode | null>(null)
    const loadingFallbackTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const cancelManualTrackingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingInfo = useAtomValue(torrentStreamPendingInfoAtom)
    const streamSessionMode = useAtomValue(streamSessionModeAtom)
    React.useEffect(() => {
        pendingInfoRef.current = pendingInfo
    }, [pendingInfo])
    React.useEffect(() => {
        streamSessionModeRef.current = streamSessionMode
    }, [streamSessionMode])

    React.useEffect(() => {
            if (!socket || !serverUrl) return

            const clearLoadingFallback = () => {
                if (loadingFallbackTimer.current) {
                    clearTimeout(loadingFallbackTimer.current)
                    loadingFallbackTimer.current = null
                }
            }

            const clearCancelManualTrackingTimer = () => {
                if (cancelManualTrackingTimer.current) {
                    clearTimeout(cancelManualTrackingTimer.current)
                    cancelManualTrackingTimer.current = null
                }
            }

            const resetTorrentStreamState = () => {
                clearLoadingFallback()
                clearCancelManualTrackingTimer()
                streamSessionModeRef.current = null
                setIsPreparing(false)
                setPendingInfo(null)
                setStreamSessionMode(null)
                setTorrentLoadingState(null)
                setTorrentLoadingTorrentName(null)
                setTorrentStatus(null)
                setTorrentIsLoaded(false)
                setDebridStreamState(null)
                setActiveStreamSession(null)
            }

            const handleMessage = (event: WebSocketMessageEvent) => {
                let parsed: unknown
                try {
                    parsed = JSON.parse(event.data as string)
                }
                catch (err) {
                    log.warning("Failed to parse WebSocket message data:", err)
                    return
                }
                const message = parsed as { type?: string; payload?: unknown }
                if (typeof message?.type !== "string") return

                log.info("WebSocket event received:", message.type, message.payload)

                if (message.type === "torrentstream-state") {
                    const payload = message.payload as TorrentStreamSocketPayload | undefined
                    if (typeof payload?.state !== "string") return

                    streamSessionModeRef.current = "torrent"
                    setStreamSessionMode("torrent")
                    setDebridStreamState(null)

                    if (payload.state !== "loading") {
                        clearLoadingFallback()
                    }

                    switch (payload.state) {
                        case "loading": {
                            setIsPreparing(true)
                            setTorrentIsLoaded(false)
                            setTorrentStatus(null)

                            const next = parseTorrentStreamLoadingPayload(payload.data)
                            setActiveStreamSession(current => updateActiveStreamSession(current, pendingInfoRef.current, "torrent", {
                                status: "preparing",
                                message: getTorrentStreamLoadingLabel(next.state, next.torrentBeingLoaded),
                                torrentName: next.torrentBeingLoaded,
                            }))
                            if (!next.state) {
                                loadingFallbackTimer.current = setTimeout(() => {
                                    setTorrentLoadingState("SEARCHING_TORRENTS")
                                    setTorrentLoadingTorrentName(null)
                                }, TORRENT_STREAM_LOADING_FALLBACK_DELAY)
                                return
                            }

                            setTorrentLoadingState(next.state)
                            setTorrentLoadingTorrentName(next.torrentBeingLoaded)
                            return
                        }

                        case "loading-failed":
                            resetTorrentStreamState()
                            return

                        case "loaded":
                            setIsPreparing(true)
                            setTorrentIsLoaded(true)
                            setTorrentLoadingState("SENDING_STREAM_TO_MEDIA_PLAYER")
                            setActiveStreamSession(current => updateActiveStreamSession(current, pendingInfoRef.current, "torrent", {
                                status: "ready",
                                message: "Sending stream to player...",
                            }))
                            return

                        case "started-playing":
                            setIsPreparing(false)
                            setTorrentIsLoaded(true)
                            setTorrentLoadingState(null)
                            setTorrentLoadingTorrentName(null)
                            setActiveStreamSession(current => updateActiveStreamSession(current, pendingInfoRef.current, "torrent", {
                                status: "playing",
                                message: "Streaming",
                            }))
                            return

                        case "status":
                            setTorrentIsLoaded(true)
                            setTorrentStatus((payload.data as Torrentstream_TorrentStatus | undefined) ?? null)
                            setActiveStreamSession(current => updateActiveStreamSession(current, pendingInfoRef.current, "torrent", {
                                status: "playing",
                                message: "Streaming",
                            }))
                            return

                        case "stopped":
                            resetTorrentStreamState()
                            return

                        default:
                            return
                    }
                }

                if (message.type === "debrid-stream-state") {
                    const payload = message.payload as DebridClient_StreamState | undefined
                    if (!payload?.status) return

                    clearLoadingFallback()
                    streamSessionModeRef.current = "debrid"
                    setStreamSessionMode("debrid")
                    setTorrentLoadingState(null)
                    setTorrentLoadingTorrentName(null)
                    setTorrentStatus(null)
                    setTorrentIsLoaded(false)

                    switch (payload.status) {
                        case "downloading":
                        case "started":
                        case "ready":
                            setIsPreparing(true)
                            setDebridStreamState(payload)
                            setActiveStreamSession(current => updateActiveStreamSession(current, pendingInfoRef.current, "debrid", {
                                status: payload.status === "ready" ? "ready" : "preparing",
                                message: payload.message ?? null,
                                torrentName: payload.torrentName ?? null,
                            }))
                            return

                        case "failed":
                            resetTorrentStreamState()
                            return

                        default:
                            return
                    }
                }

                // externalPlayerLink torrent stream URL
                if (message.type === "external-player-open-url") {
                    const payload = message.payload as ExternalPlayerOpenURLPayload
                    log.info("Processing external-player-open-url:", payload)
                    if (!payload?.url) {
                        log.warning("external-player-open-url payload is missing URL")
                        return
                    }
                    if (typeof payload.mediaId !== "number" || typeof payload.episodeNumber !== "number") {
                        log.warning("external-player-open-url payload is missing mediaId or episodeNumber")
                        return
                    }

                    clearCancelManualTrackingTimer()
                    cancelManualTrackingTimer.current = setTimeout(() => {
                        log.info("Cancelling manual tracking on server as it is not relevant to Tenji")
                        cancelManualTracking()
                    }, 2000)

                    const base = getServerBaseUrl(serverUrl)
                    const resolvedUrl = payload.url
                        .replace("{{SCHEME}}://{{HOST}}", base)
                        // fallback: replace individually
                        .replace("{{SCHEME}}", base.startsWith("https") ? "https" : "http")
                        .replace("{{HOST}}", base.replace(/^https?:\/\//, ""))

                    const pending = pendingInfoRef.current
                    const streamPrefix = pending?.streamMode === "debrid" ? "debridstream" : "torrentstream"

                    const hydrated = resolvePlaybackMetadataFromCache(
                        queryClient,
                        payload.mediaId,
                        payload.episodeNumber,
                        {
                            media: pending?.media,
                            episode: pending?.episode,
                            entryListData: pending?.entryListData,
                        },
                    )
                    const media = hydrated.media
                    const episode = hydrated.episode
                    const entryListData = hydrated.entryListData

                    const source: MobilePlaybackSource = {
                        id: `${streamPrefix}-${payload.mediaId}-${payload.episodeNumber}-${Date.now()}`,
                        streamKind: "http",
                        url: resolvedUrl,
                        mediaId: pending?.mediaId ?? payload.mediaId,
                        episodeNumber: pending?.episodeNumber ?? payload.episodeNumber,
                        media,
                        episode,
                        entryListData,
                        entryView: pending?.entryView,
                        nextEpisodeAction: pending?.nextEpisodeAction,
                        continuityKind: "external_player",
                    }

                    clearLoadingFallback()
                    setIsPreparing(false)
                    setPendingInfo(null)
                    setStreamSessionMode(null)
                    setTorrentLoadingState(null)
                    setTorrentLoadingTorrentName(null)
                    setDebridStreamState(null)
                    setActiveStreamSession(current => updateActiveStreamSessionFromExternalPlayerPayload(
                        current,
                        pending,
                        pending?.streamMode ?? streamSessionModeRef.current ?? current?.streamMode ?? "torrent",
                        payload,
                    ))
                    setLoadingMessage(null)
                    setError(null)

                    log.info("Resolved playing source:", source)

                    // external player
                    const prefs = getPlayerPreferences()
                    if (prefs.externalPlayerTemplate) {
                        log.info("Opening external player with template:", prefs.externalPlayerTemplate)
                        openExternalPlayerURL(prefs.externalPlayerTemplate, resolvedUrl).then(opened => {
                            if (opened) {
                                log.info("Successfully opened external player URL")
                                return
                            }

                            log.warning("Failed to open external player URL, falling back to internal route")
                            setSource(source)
                            setPlayerOpen(true)
                            router.push("/(app)/(media)/player" as never)
                        })
                        return
                    }

                    log.info("Opening internal media player")
                    setSource(source)
                    setPlayerOpen(true)
                    router.push("/(app)/(media)/player" as never)
                    return
                }

            }

            socket.addEventListener("message", handleMessage)
            return () => {
                clearLoadingFallback()
                clearCancelManualTrackingTimer()
                socket.removeEventListener("message", handleMessage)
            }
        },
        [router, serverUrl, setActiveStreamSession, setDebridStreamState, setError, setIsPreparing, setLoadingMessage, setPendingInfo, setPlayerOpen,
            setSource, setStreamSessionMode, setTorrentIsLoaded, setTorrentLoadingState, setTorrentLoadingTorrentName, setTorrentStatus, socket])
}

/**
 * Start an online-stream playback session directly
 */
export function useStartOnlineStreamPlayback() {
    const [, setSource] = useAtom(currentPlaybackSourceAtom)
    const [, setPlayerOpen] = useAtom(playerOpenAtom)
    const [, setLoadingMessage] = useAtom(playerLoadingMessageAtom)
    const [, setError] = useAtom(playerErrorAtom)
    const router = useRouter()

    return React.useCallback(
        (source: MobilePlaybackSource) => {
            setError(null)
            setLoadingMessage(null)
            setSource(source)
            setPlayerOpen(true)
            router.push("/(app)/(media)/player" as never)
        },
        [router, setSource, setPlayerOpen, setLoadingMessage, setError],
    )
}

/**
 * Called from the player route when it unmounts.
 */
export function useCleanupPlaybackSession() {
    const [source, setSource] = useAtom(currentPlaybackSourceAtom)
    const [, setPlayerOpen] = useAtom(playerOpenAtom)
    const [, setLoadingMessage] = useAtom(playerLoadingMessageAtom)
    const [, setError] = useAtom(playerErrorAtom)
    const [, setPendingInfo] = useAtom(torrentStreamPendingInfoAtom)
    const [, setStreamSessionMode] = useAtom(streamSessionModeAtom)
    const [, setIsPreparing] = useAtom(torrentStreamIsPreparingAtom)
    const [, setTorrentLoadingState] = useAtom(torrentStreamLoadingStateAtom)
    const [, setTorrentLoadingTorrentName] = useAtom(torrentStreamLoadingTorrentNameAtom)
    const [, setTorrentStatus] = useAtom(torrentStreamStatusAtom)
    const [, setTorrentIsLoaded] = useAtom(torrentStreamIsLoadedAtom)
    const [, setDebridStreamState] = useAtom(debridStreamStateAtom)

    return React.useCallback(() => {
            setSource(null)
            setPlayerOpen(false)
            setLoadingMessage(null)
            setError(null)
            setPendingInfo(current => {
                if (current && source && (current.mediaId !== source.mediaId || current.episodeNumber !== source.episodeNumber)) {
                    return current
                }
                return null
            })
            setStreamSessionMode(null)
            setIsPreparing(false)
            setTorrentLoadingState(null)
            setTorrentLoadingTorrentName(null)
            setTorrentStatus(null)
            setTorrentIsLoaded(false)
            setDebridStreamState(null)
        },
        [setDebridStreamState, setError, setIsPreparing, setLoadingMessage, setPendingInfo, setPlayerOpen, setSource, setStreamSessionMode,
            setTorrentIsLoaded, setTorrentLoadingState, setTorrentLoadingTorrentName, setTorrentStatus])
}
