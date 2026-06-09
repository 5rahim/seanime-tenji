import { getClientIdentity } from "@/api/client/client-identity"
import {
    Anime_Entry,
    Anime_Episode,
    DebridClient_FilePreview,
    ExtensionRepo_AnimeTorrentProviderExtensionItem,
    Habari_Metadata,
    HibikeTorrent_AnimeTorrent,
    HibikeTorrent_BatchEpisodeFiles,
    Status,
    Torrentstream_FilePreview,
} from "@/api/generated/types"
import { useGetAnimeEpisodeCollection } from "@/api/hooks/anime.hooks"
import { useDebridCancelStream, useDebridGetTorrentFilePreviews, useDebridStartStream } from "@/api/hooks/debrid.hooks"
import { useAnimeListTorrentProviderExtensions } from "@/api/hooks/extensions.hooks"
import { useSearchTorrent } from "@/api/hooks/torrent_search.hooks"
import {
    useGetTorrentstreamBatchHistory,
    useGetTorrentstreamTorrentFilePreviews,
    useTorrentstreamStartStream,
    useTorrentstreamStopStream,
} from "@/api/hooks/torrentstream.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
import { torrentSearchAcrossProvidersAtom, torrentSearchExtraProviderIdsAtom } from "@/atoms/torrent-search.atoms"
import { getDefaultPlaybackSource } from "@/lib/default-playback-source"
import {
    activeStreamSessionAtom,
    debridStreamStateAtom,
    streamSessionModeAtom,
    torrentStreamIsPreparingAtom,
    torrentStreamLoadingStateAtom,
    torrentStreamPendingInfoAtom,
} from "@/lib/player"
import { useAtom } from "jotai"
import { useAtomValue } from "jotai/react"
import * as React from "react"

export const NONE_PROVIDER = "none"
export const TORRENT_RESOLUTIONS = ["2160", "1080", "720", "540", "480"] as const
const TORBOX_DEBRID_PROVIDER = "torbox"

export type StreamMode = "torrent" | "debrid"
export type TorrentResolution = (typeof TORRENT_RESOLUTIONS)[number] | undefined
export type TorrentSearchMode = "smart" | "simple"
export type TorrentSheetStage = "torrents" | "files" | "providers"
export type StreamEpisodeLaunchMode = "manual" | "previous-batch"

type StreamFilePreview = Torrentstream_FilePreview | DebridClient_FilePreview

type PreviousBatchSelection = {
    torrent: HibikeTorrent_AnimeTorrent
    fileId: string
    fileIndex: number | null
    batchEpisodeFiles?: HibikeTorrent_BatchEpisodeFiles
}

type UseTorrentStreamControllerParams = {
    entry: Anime_Entry
    mode?: "stream" | "download"
}

export function useTorrentStreamController({ entry, mode = "stream" }: UseTorrentStreamControllerParams) {
    const serverStatus = useServerStatus()
    const preferredStreamMode = React.useMemo(() => getDefaultStreamMode(serverStatus), [serverStatus])
    const hasTorrentStreaming = React.useMemo(
        () => !!serverStatus?.torrentstreamSettings?.enabled,
        [serverStatus?.torrentstreamSettings?.enabled],
    )
    const hasDebridService = React.useMemo(
        () => !!serverStatus?.debridSettings?.enabled && !!serverStatus?.debridSettings?.provider,
        [serverStatus?.debridSettings?.enabled, serverStatus?.debridSettings?.provider],
    )
    const availableModes = React.useMemo<StreamMode[]>(() => {
        const modes: StreamMode[] = []
        if (hasTorrentStreaming) modes.push("torrent")
        if (hasDebridService) modes.push("debrid")
        return modes.length > 0 ? modes : ["torrent"]
    }, [hasDebridService, hasTorrentStreaming])

    const [pickerOpen, setPickerOpen] = React.useState(false)
    const [sheetStage, setSheetStage] = React.useState<TorrentSheetStage>("torrents")
    const [streamMode, setStreamModeState] = React.useState(preferredStreamMode)
    const [selectedEpisodeNumber, setSelectedEpisodeNumber] = React.useState<number | null>(null)
    const [selectedTorrent, setSelectedTorrent] = React.useState<HibikeTorrent_AnimeTorrent | null>(null)
    const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null)
    const [selectedProviderId, setSelectedProviderId] = React.useState<string>(NONE_PROVIDER)
    const [searchAcrossProviders, setSearchAcrossProviders] = useAtom(torrentSearchAcrossProvidersAtom)
    const [extraProviderIds, setExtraProviderIds] = useAtom(torrentSearchExtraProviderIdsAtom)
    const [searchMode, setSearchMode] = React.useState<TorrentSearchMode>("smart")
    const [searchQuery, setSearchQuery] = React.useState("")
    const deferredSearchQuery = React.useDeferredValue(searchQuery)
    const [smartSearchBatch, setSmartSearchBatch] = React.useState(false)
    const [torrentResolution, setTorrentResolutionState] = React.useState<TorrentResolution>(
        toMobileResolution(serverStatus?.torrentstreamSettings?.preferredResolution) ?? "1080",
    )
    const [debridResolution, setDebridResolutionState] = React.useState<TorrentResolution>(
        toMobileResolution(serverStatus?.debridSettings?.streamPreferredResolution) ?? "1080",
    )
    const [bestRelease, setBestRelease] = React.useState(false)
    const [torrentAutoSelect, setTorrentAutoSelect] = React.useState(serverStatus?.torrentstreamSettings?.autoSelect ?? false)
    const [debridAutoSelect, setDebridAutoSelect] = React.useState(serverStatus?.debridSettings?.streamAutoSelect ?? false)
    const [autoSelectFile, setAutoSelectFile] = React.useState(true)
    const [usePreviousBatchPreference, setUsePreviousBatchPreference] = React.useState(false)

    const pendingStreamInfo = useAtomValue(torrentStreamPendingInfoAtom)
    const isPreparingStream = useAtomValue(torrentStreamIsPreparingAtom)
    const loadingState = useAtomValue(torrentStreamLoadingStateAtom)
    const episodeSelectionLockedRef = React.useRef(false)

    const resolution = streamMode === "debrid" ? debridResolution : torrentResolution
    const autoSelect = streamMode === "debrid" ? debridAutoSelect : torrentAutoSelect

    const { data: episodeCollection, isLoading: isLoadingEpisodeCollection } = useGetAnimeEpisodeCollection(entry.mediaId)
    const { data: providerExtensions } = useAnimeListTorrentProviderExtensions()
    const progress = entry.listData?.progress ?? 0
    const selectedDebridService = serverStatus?.debridSettings?.provider ?? ""
    const supportsIndexedDebridHistory = selectedDebridService !== TORBOX_DEBRID_PROVIDER

    React.useEffect(() => {
        setStreamModeState(current => availableModes.includes(current) ? current : preferredStreamMode)
    }, [availableModes, preferredStreamMode])

    React.useEffect(() => {
        setTorrentResolutionState(toMobileResolution(serverStatus?.torrentstreamSettings?.preferredResolution) ?? "1080")
    }, [serverStatus?.torrentstreamSettings?.preferredResolution])

    React.useEffect(() => {
        setDebridResolutionState(toMobileResolution(serverStatus?.debridSettings?.streamPreferredResolution) ?? "1080")
    }, [serverStatus?.debridSettings?.streamPreferredResolution])

    React.useEffect(() => {
        if (episodeCollection?.hasMappingError) {
            setTorrentAutoSelect(false)
            setDebridAutoSelect(false)
            return
        }

        setTorrentAutoSelect(serverStatus?.torrentstreamSettings?.autoSelect ?? false)
        setDebridAutoSelect(serverStatus?.debridSettings?.streamAutoSelect ?? false)
    }, [
        episodeCollection?.hasMappingError,
        serverStatus?.debridSettings?.streamAutoSelect,
        serverStatus?.torrentstreamSettings?.autoSelect,
    ])

    const streamEpisodes = React.useMemo(() => episodeCollection?.episodes ?? [], [episodeCollection?.episodes])

    const defaultEpisodeNumber = React.useMemo(() => {
        const nextEpisode = streamEpisodes.find(episode => episode.progressNumber > progress)
        return nextEpisode?.episodeNumber ?? streamEpisodes[0]?.episodeNumber ?? 1
    }, [progress, streamEpisodes])

    const selectedEpisode = React.useMemo(() => {
        const targetEpisodeNumber = selectedEpisodeNumber ?? defaultEpisodeNumber
        return streamEpisodes.find(episode => episode.episodeNumber === targetEpisodeNumber) ?? null
    }, [defaultEpisodeNumber, selectedEpisodeNumber, streamEpisodes])

    const preferredProviderId = React.useMemo(() => {
        const fromSettings =
            serverStatus?.settings?.library?.autoSelectTorrentProvider ||
            serverStatus?.settings?.library?.torrentProvider ||
            ""

        if (fromSettings && providerExtensions?.some(provider => provider.id === fromSettings)) {
            return fromSettings
        }

        return providerExtensions?.[0]?.id ?? NONE_PROVIDER
    }, [providerExtensions, serverStatus?.settings?.library?.autoSelectTorrentProvider, serverStatus?.settings?.library?.torrentProvider])

    React.useEffect(() => {
        setSelectedProviderId(current => {
            if (current !== NONE_PROVIDER && providerExtensions?.some(provider => provider.id === current)) {
                return current
            }
            return preferredProviderId
        })
    }, [preferredProviderId, providerExtensions])

    const selectedProvider = React.useMemo<ExtensionRepo_AnimeTorrentProviderExtensionItem | null>(() => {
        return providerExtensions?.find(provider => provider.id === selectedProviderId) ?? null
    }, [providerExtensions, selectedProviderId])

    React.useEffect(() => {
        setSelectedTorrent(null)
        setSelectedFileId(null)
        setSheetStage("torrents")
    }, [streamMode])

    React.useEffect(() => {
        if (!selectedProvider?.settings?.canSmartSearch && searchMode === "smart") {
            setSearchMode("simple")
        }
    }, [searchMode, selectedProvider?.settings?.canSmartSearch])

    React.useEffect(() => {
        if (!pickerOpen) return
        if (!selectedProvider?.settings?.canSmartSearch) return

        setSearchMode("smart")
    }, [pickerOpen, selectedProvider?.settings?.canSmartSearch])

    React.useEffect(() => {
        if (searchMode === "smart") {
            setSearchQuery("")
        } else if (searchMode === "simple") {
            const title = entry.media?.title?.romaji || entry.media?.title?.english || entry.media?.title?.userPreferred || ""
            setSearchQuery(title)
        }
    }, [searchMode, entry.media?.title?.romaji, entry.media?.title?.english, entry.media?.title?.userPreferred])

    React.useEffect(() => {
        if (bestRelease && !selectedProvider?.settings?.smartSearchFilters?.includes("bestReleases")) {
            setBestRelease(false)
        }
    }, [bestRelease, selectedProvider])

    React.useEffect(() => {
        if (smartSearchBatch && !selectedProvider?.settings?.smartSearchFilters?.includes("batch")) {
            setSmartSearchBatch(false)
        }
    }, [smartSearchBatch, selectedProvider])

    const mediaId = entry.media?.id ?? 0
    const absoluteOffset = entry.downloadInfo?.absoluteOffset ?? 0

    const activeExtraProviderIds = React.useMemo(() => {
        const validProviderIds = new Set(providerExtensions?.map(ext => ext.id) ?? [])
        return extraProviderIds.filter(
            id => id !== selectedProviderId && validProviderIds.has(id),
        )
    }, [extraProviderIds, providerExtensions, selectedProviderId])

    const searchProvider = React.useMemo(() => {
        if (selectedProviderId === NONE_PROVIDER || !selectedProviderId) return undefined
        if (!searchAcrossProviders || activeExtraProviderIds.length === 0) return selectedProviderId
        return [selectedProviderId, ...activeExtraProviderIds].join(",")
    }, [activeExtraProviderIds, searchAcrossProviders, selectedProviderId])

    const searchVariables = React.useMemo(
        () => ({
            type: searchMode,
            provider: searchProvider,
            query:
                searchMode === "simple" || selectedProvider?.settings?.smartSearchFilters?.includes("query")
                    ? deferredSearchQuery || undefined
                    : undefined,
            media: entry.media ?? undefined,
            episodeNumber: selectedEpisode?.episodeNumber ?? defaultEpisodeNumber,
            batch: searchMode === "smart" ? smartSearchBatch : false,
            resolution,
            bestRelease: bestRelease || undefined,
            absoluteOffset: absoluteOffset > 0 ? absoluteOffset : undefined,
        }),
        [absoluteOffset, bestRelease, defaultEpisodeNumber, deferredSearchQuery, entry.media, resolution, searchMode, selectedEpisode?.episodeNumber,
            selectedProvider?.settings?.smartSearchFilters, searchProvider, smartSearchBatch],
    )

    const {
        data: searchData,
        isLoading: isSearching,
        refetch: refetchSearch,
    } = useSearchTorrent(
        searchVariables,
        pickerOpen && sheetStage === "torrents" && !!selectedEpisode && selectedProviderId !== NONE_PROVIDER,
    )

    const { data: batchHistory } = useGetTorrentstreamBatchHistory(mediaId, !!mediaId)
    const hasPreviousBatch = !!batchHistory?.torrent?.isBatch

    const supportsPreviousBatch = React.useCallback((mode: StreamMode) => {
        if (mode !== "debrid") {
            return true
        }

        return supportsIndexedDebridHistory
    }, [supportsIndexedDebridHistory])

    const canUsePreviousBatch = hasPreviousBatch && supportsPreviousBatch(streamMode)
    const usePreviousBatch = usePreviousBatchPreference && canUsePreviousBatch

    const torrentMetadataByInfoHash = React.useMemo<Record<string, Habari_Metadata | undefined>>(() => {
        const metadata = searchData?.torrentMetadata
        if (!metadata) return {}

        return Object.fromEntries(
            Object.entries(metadata).map(([infoHash, value]) => [infoHash, value?.metadata]),
        )
    }, [searchData?.torrentMetadata])

    React.useEffect(() => {
        setUsePreviousBatchPreference(hasPreviousBatch)
    }, [hasPreviousBatch])

    const {
        data: torrentFilePreviews,
        isLoading: isLoadingTorrentFilePreviews,
    } = useGetTorrentstreamTorrentFilePreviews(
        {
            torrent: selectedTorrent ?? undefined,
            episodeNumber: selectedEpisode?.episodeNumber ?? defaultEpisodeNumber,
            media: entry.media ?? undefined,
        },
        pickerOpen && sheetStage === "files" && !!selectedTorrent && streamMode === "torrent",
    )

    const {
        data: debridFilePreviews,
        isLoading: isLoadingDebridFilePreviews,
    } = useDebridGetTorrentFilePreviews(
        {
            torrent: selectedTorrent ?? undefined,
            episodeNumber: selectedEpisode?.episodeNumber ?? defaultEpisodeNumber,
            media: entry.media ?? undefined,
        },
        pickerOpen && sheetStage === "files" && !!selectedTorrent && streamMode === "debrid",
    )

    const filePreviews = React.useMemo<StreamFilePreview[]>(() => {
        return streamMode === "debrid"
            ? (debridFilePreviews ?? [])
            : (torrentFilePreviews ?? [])
    }, [debridFilePreviews, streamMode, torrentFilePreviews])

    const isLoadingFilePreviews = streamMode === "debrid"
        ? isLoadingDebridFilePreviews
        : isLoadingTorrentFilePreviews

    const { mutate: startTorrentStream, isPending: isStartingTorrent } = useTorrentstreamStartStream()
    const { mutate: stopTorrentStream, isPending: isStoppingTorrent } = useTorrentstreamStopStream()
    const { mutate: startDebridStream, isPending: isStartingDebrid } = useDebridStartStream()
    const { mutate: cancelDebridStream, isPending: isStoppingDebrid } = useDebridCancelStream()
    const isStarting = streamMode === "debrid" ? isStartingDebrid : isStartingTorrent
    const isStopping = streamMode === "debrid" ? isStoppingDebrid : isStoppingTorrent
    const isCurrentEntryStreamPending = pendingStreamInfo?.mediaId === entry.mediaId
    const isEpisodeSelectionLocked = isCurrentEntryStreamPending && (isStarting || isPreparingStream || loadingState !== null)
    const loadingEpisodeNumber = isEpisodeSelectionLocked
        ? (pendingStreamInfo?.episodeNumber ?? selectedEpisodeNumber)
        : null

    const [, setPendingInfo] = useAtom(torrentStreamPendingInfoAtom)
    const [, setIsPreparing] = useAtom(torrentStreamIsPreparingAtom)
    const [, setLoadingState] = useAtom(torrentStreamLoadingStateAtom)
    const [, setStreamSessionMode] = useAtom(streamSessionModeAtom)
    const [, setDebridStreamState] = useAtom(debridStreamStateAtom)
    const [, setActiveStreamSession] = useAtom(activeStreamSessionAtom)

    React.useEffect(() => {
        episodeSelectionLockedRef.current = isEpisodeSelectionLocked
    }, [isEpisodeSelectionLocked])

    const clearPendingStreamState = React.useCallback(() => {
        setPendingInfo(null)
        setStreamSessionMode(null)
        setIsPreparing(false)
        setLoadingState(null)
        setDebridStreamState(null)
        setActiveStreamSession(null)
    }, [setActiveStreamSession, setDebridStreamState, setIsPreparing, setLoadingState, setPendingInfo, setStreamSessionMode])

    const resetPicker = React.useCallback(() => {
        setPickerOpen(false)
        setSheetStage("torrents")
        setSelectedTorrent(null)
        setSelectedFileId(null)
    }, [])

    const closePicker = React.useCallback((open: boolean) => {
        if (!open) {
            resetPicker()
            return
        }
        setPickerOpen(true)
    }, [resetPicker])

    const setStreamMode = React.useCallback((mode: StreamMode) => {
        if (mode === "debrid" && !hasDebridService) return
        if (mode === "torrent" && !hasTorrentStreaming) return
        setStreamModeState(mode)
    }, [hasDebridService, hasTorrentStreaming])

    const setAutoSelect = React.useCallback((value: boolean) => {
        if (streamMode === "debrid") {
            setDebridAutoSelect(value)
            return
        }

        setTorrentAutoSelect(value)
    }, [streamMode])

    const setResolution = React.useCallback((value: TorrentResolution) => {
        if (streamMode === "debrid") {
            setDebridResolutionState(value)
            return
        }

        setTorrentResolutionState(value)
    }, [streamMode])

    const setUsePreviousBatch = React.useCallback((value: boolean) => {
        if (!value) {
            setUsePreviousBatchPreference(false)
            return
        }

        if (!canUsePreviousBatch) {
            return
        }

        setUsePreviousBatchPreference(true)
    }, [canUsePreviousBatch])

    const startAutoSelectedStream = React.useCallback((episode: Anime_Episode, mode: StreamMode = streamMode) => {
            if (!episode.aniDBEpisode || !mediaId) return
            episodeSelectionLockedRef.current = true

            setPendingInfo({
                streamMode: mode,
                mediaId,
                episodeNumber: episode.episodeNumber,
                media: entry.media ?? undefined,
                episode,
                entryListData: entry.listData ?? undefined,
                entryView: "torrentstream",
                nextEpisodeAction: mode === "debrid" ? "debridstream-auto-select" : "torrentstream-auto-select",
            })
            setActiveStreamSession(toActiveStreamSession(mode,
                entry,
                episode,
                mode === "debrid" ? "Selecting best torrent..." : "Preparing stream..."))
            setStreamSessionMode(mode)
            setIsPreparing(true)
            if (mode === "debrid") {
                setLoadingState(null)
                setDebridStreamState({
                    status: "started",
                    torrentName: "-",
                    message: "Selecting best torrent...",
                })

                startDebridStream(
                    {
                        mediaId,
                        episodeNumber: episode.episodeNumber,
                        aniDBEpisode: episode.aniDBEpisode,
                        autoSelect: true,
                        fileId: "",
                        playbackType: "externalPlayerLink",
                        clientId: getClientIdentity().clientId,
                    },
                    {
                        onSuccess: () => {
                            setIsPreparing(true)
                            resetPicker()
                        },
                        onError: () => {
                            clearPendingStreamState()
                        },
                    },
                )
                return
            }

            setDebridStreamState(null)
            setLoadingState("LOADING")

            startTorrentStream(
                {
                    mediaId,
                    episodeNumber: episode.episodeNumber,
                    aniDBEpisode: episode.aniDBEpisode,
                    autoSelect: true,
                    playbackType: "externalPlayerLink",
                    clientId: getClientIdentity().clientId,
                },
                {
                    onSuccess: () => {
                        setIsPreparing(true)
                        resetPicker()
                    },
                    onError: () => {
                        clearPendingStreamState()
                    },
                },
            )
        },
        [clearPendingStreamState, entry, mediaId, resetPicker, setActiveStreamSession, setDebridStreamState, setIsPreparing, setLoadingState,
            setPendingInfo, setStreamSessionMode, startDebridStream, startTorrentStream, streamMode])

    const startManualStream = React.useCallback((params: {
            episode: Anime_Episode
            torrent: HibikeTorrent_AnimeTorrent
            fileId?: string
            fileIndex?: number
            batchEpisodeFiles?: HibikeTorrent_BatchEpisodeFiles
            launchMode?: StreamEpisodeLaunchMode
        }, mode: StreamMode = streamMode) => {
            if (!params.episode.aniDBEpisode || !mediaId) return
            episodeSelectionLockedRef.current = true

            setPendingInfo({
                streamMode: mode,
                mediaId,
                episodeNumber: params.episode.episodeNumber,
                media: entry.media ?? undefined,
                episode: params.episode,
                entryListData: entry.listData ?? undefined,
                entryView: "torrentstream",
                nextEpisodeAction: mode === "debrid"
                    ? (params.launchMode === "previous-batch" ? "debridstream-previous-batch" : "debridstream-manual")
                    : (params.launchMode === "previous-batch" ? "torrentstream-previous-batch" : "torrentstream-manual"),
            })
            setActiveStreamSession(toActiveStreamSession(
                mode,
                entry,
                params.episode,
                mode === "debrid"
                    ? (params.fileId ? "Preparing selected file..." : "Analyzing selected torrent...")
                    : "Preparing stream...",
                params.torrent.name,
            ))
            setStreamSessionMode(mode)
            setIsPreparing(true)
            if (mode === "debrid") {
                setLoadingState(null)
                setDebridStreamState({
                    status: "started",
                    torrentName: params.torrent.name,
                    message: params.fileId ? "Preparing selected file..." : "Analyzing selected torrent...",
                })

                startDebridStream(
                    {
                        mediaId,
                        episodeNumber: params.episode.episodeNumber,
                        aniDBEpisode: params.episode.aniDBEpisode,
                        autoSelect: false,
                        torrent: params.torrent,
                        fileId: params.fileId ?? "",
                        fileIndex: params.fileIndex,
                        batchEpisodeFiles: params.batchEpisodeFiles,
                        playbackType: "externalPlayerLink",
                        clientId: getClientIdentity().clientId,
                    },
                    {
                        onSuccess: () => {
                            setIsPreparing(true)
                            resetPicker()
                        },
                        onError: () => {
                            clearPendingStreamState()
                        },
                    },
                )
                return
            }

            setDebridStreamState(null)
            setLoadingState("LOADING")

            startTorrentStream(
                {
                    mediaId,
                    episodeNumber: params.episode.episodeNumber,
                    aniDBEpisode: params.episode.aniDBEpisode,
                    autoSelect: false,
                    torrent: params.torrent,
                    fileIndex: params.fileIndex,
                    batchEpisodeFiles: params.batchEpisodeFiles,
                    playbackType: "externalPlayerLink",
                    clientId: getClientIdentity().clientId,
                },
                {
                    onSuccess: () => {
                        setIsPreparing(true)
                        resetPicker()
                    },
                    onError: () => {
                        clearPendingStreamState()
                    },
                },
            )
        },
        [clearPendingStreamState, entry, mediaId, resetPicker, setActiveStreamSession, setDebridStreamState, setIsPreparing, setLoadingState,
            setPendingInfo, setStreamSessionMode, startDebridStream, startTorrentStream, streamMode])

    const buildBatchEpisodeFiles = React.useCallback((
        previews: StreamFilePreview[] | undefined,
        currentFileId: string,
        episode: Anime_Episode,
        mode: StreamMode = streamMode,
    ): HibikeTorrent_BatchEpisodeFiles | undefined => {
        if (!previews?.length || !episode.aniDBEpisode) return undefined
        if (mode === "debrid" && !supportsIndexedDebridHistory) return undefined

        const currentFile = previews.find(file => getFileSelectionValue(file) === currentFileId)
        if (!currentFile) return undefined

        return {
            current: currentFile.index,
            currentAniDBEpisode: episode.aniDBEpisode,
            currentEpisodeNumber: episode.episodeNumber,
            files: previews.map(file => ({
                index: file.index,
                name: file.displayPath,
                path: file.path,
            })),
        }
    }, [streamMode, supportsIndexedDebridHistory])

    const guessPreviousBatchFileIndex = React.useCallback((episode: Anime_Episode, mode: StreamMode = streamMode) => {
        if (!batchHistory?.batchEpisodeFiles) return null
        if (mode === "debrid" && !supportsIndexedDebridHistory) return null

        if (batchHistory.batchEpisodeFiles.currentAniDBEpisode === episode.aniDBEpisode) {
            return batchHistory.batchEpisodeFiles.current
        }

        const offset = episode.episodeNumber - batchHistory.batchEpisodeFiles.currentEpisodeNumber
        const file = batchHistory.batchEpisodeFiles.files?.find(
            item => item.index === (batchHistory.batchEpisodeFiles?.current || 0) + offset,
        )

        return file?.index ?? null
    }, [batchHistory?.batchEpisodeFiles, streamMode, supportsIndexedDebridHistory])

    const openPickerForEpisode = React.useCallback((episode: Anime_Episode, stage: TorrentSheetStage = "torrents", mode: StreamMode = streamMode) => {
        setStreamMode(mode)
        setSelectedEpisodeNumber(episode.episodeNumber)
        setSelectedTorrent(null)
        setSelectedFileId(null)
        setSheetStage(stage)
        setPickerOpen(true)
    }, [setStreamMode, streamMode])

    const getPreviousBatchSelection = React.useCallback((episode: Anime_Episode, mode: StreamMode = streamMode): PreviousBatchSelection | null => {
        if (!batchHistory?.torrent || !supportsPreviousBatch(mode)) return null

        const guessedFileIndex = guessPreviousBatchFileIndex(episode, mode)

        return {
            torrent: batchHistory.torrent,
            fileId: guessedFileIndex !== null ? String(guessedFileIndex) : "",
            fileIndex: guessedFileIndex,
            batchEpisodeFiles: guessedFileIndex !== null && batchHistory.batchEpisodeFiles
            && (mode !== "debrid" || supportsIndexedDebridHistory)
                ? {
                    ...batchHistory.batchEpisodeFiles,
                    current: guessedFileIndex,
                    currentAniDBEpisode: episode.aniDBEpisode ?? batchHistory.batchEpisodeFiles.currentAniDBEpisode,
                    currentEpisodeNumber: episode.episodeNumber,
                }
                : undefined,
        }
    }, [batchHistory, guessPreviousBatchFileIndex, streamMode, supportsIndexedDebridHistory, supportsPreviousBatch])

    const handleEpisodePress = React.useCallback((episode: Anime_Episode) => {
            if (episodeSelectionLockedRef.current) return

            setSelectedEpisodeNumber(episode.episodeNumber)
            const sMode = streamMode

            if (mode === "download") {
                if (usePreviousBatch && batchHistory?.torrent && episode.aniDBEpisode) {
                    const previousBatchSelection = getPreviousBatchSelection(episode, sMode)
                    if (previousBatchSelection) {
                        setSelectedTorrent(previousBatchSelection.torrent)
                        setSheetStage("files")
                        setSelectedFileId(previousBatchSelection.fileId || null)
                        setPickerOpen(true)
                        return
                    }
                }
                openPickerForEpisode(episode, "torrents", sMode)
                return
            }

            if (autoSelect && !episodeCollection?.hasMappingError && episode.aniDBEpisode) {
                startAutoSelectedStream(episode, sMode)
                return
            }

            if (usePreviousBatch && batchHistory?.torrent && episode.aniDBEpisode) {
                const previousBatchSelection = getPreviousBatchSelection(episode, sMode)

                if (!previousBatchSelection) {
                    openPickerForEpisode(episode, "torrents", sMode)
                    return
                }

                if (sMode === "debrid" && autoSelectFile) {
                    startManualStream({
                        episode,
                        torrent: previousBatchSelection.torrent,
                        fileId: previousBatchSelection.fileId,
                        fileIndex: previousBatchSelection.fileIndex ?? undefined,
                        batchEpisodeFiles: previousBatchSelection.batchEpisodeFiles,
                        launchMode: "previous-batch",
                    }, sMode)
                    return
                }

                if (!autoSelectFile) {
                    setSelectedTorrent(previousBatchSelection.torrent)
                    setSheetStage("files")
                    setSelectedFileId(previousBatchSelection.fileId || null)
                    setPickerOpen(true)
                    return
                }

                if (previousBatchSelection.fileIndex !== null) {
                    startManualStream({
                        episode,
                        torrent: previousBatchSelection.torrent,
                        fileId: previousBatchSelection.fileId,
                        fileIndex: previousBatchSelection.fileIndex,
                        batchEpisodeFiles: previousBatchSelection.batchEpisodeFiles,
                        launchMode: "previous-batch",
                    }, sMode)
                    return
                }

                setSelectedTorrent(previousBatchSelection.torrent)
                setSheetStage("files")
                setSelectedFileId(previousBatchSelection.fileId || null)
                setPickerOpen(true)
                return
            }

            openPickerForEpisode(episode, "torrents", sMode)
        },
        [autoSelect, autoSelectFile, batchHistory?.torrent, episodeCollection?.hasMappingError, getPreviousBatchSelection, openPickerForEpisode,
            startAutoSelectedStream, startManualStream, streamMode, usePreviousBatch, mode])

    const startPreviousBatchStream = React.useCallback((episode: Anime_Episode, mode: StreamMode = streamMode) => {
        if (!episode.aniDBEpisode) {
            openPickerForEpisode(episode, "torrents", mode)
            return
        }

        const previousBatchSelection = getPreviousBatchSelection(episode, mode)

        if (!previousBatchSelection) {
            openPickerForEpisode(episode, "torrents", mode)
            return
        }

        if (mode === "debrid" || previousBatchSelection.fileIndex !== null) {
            startManualStream({
                episode,
                torrent: previousBatchSelection.torrent,
                fileId: previousBatchSelection.fileId,
                fileIndex: previousBatchSelection.fileIndex ?? undefined,
                batchEpisodeFiles: previousBatchSelection.batchEpisodeFiles,
                launchMode: "previous-batch",
            }, mode)
            return
        }

        setSelectedTorrent(previousBatchSelection.torrent)
        setSelectedFileId(null)
        setSheetStage("files")
        setPickerOpen(true)
    }, [getPreviousBatchSelection, openPickerForEpisode, startManualStream, streamMode])

    const handleConfirmTorrentSelection = React.useCallback(() => {
        if (!selectedEpisode) return

        if (!selectedTorrent) {
            startAutoSelectedStream(selectedEpisode, streamMode)
            return
        }

        if (selectedTorrent.isBatch && !autoSelectFile) {
            setSelectedFileId(null)
            setSheetStage("files")
            return
        }

        startManualStream({
            episode: selectedEpisode,
            torrent: selectedTorrent,
        }, streamMode)
    }, [autoSelectFile, selectedEpisode, selectedTorrent, startAutoSelectedStream, startManualStream, streamMode])

    const handleConfirmFileSelection = React.useCallback(() => {
        if (!selectedEpisode || !selectedTorrent || !selectedFileId) return

        const selectedFile = filePreviews.find(file => getFileSelectionValue(file) === selectedFileId)
        if (!selectedFile) return

        startManualStream({
            episode: selectedEpisode,
            torrent: selectedTorrent,
            fileId: streamMode === "debrid" ? selectedFileId : undefined,
            fileIndex: selectedFile.index,
            batchEpisodeFiles: buildBatchEpisodeFiles(filePreviews, selectedFileId, selectedEpisode, streamMode),
        }, streamMode)
    }, [buildBatchEpisodeFiles, filePreviews, selectedEpisode, selectedFileId, selectedTorrent, startManualStream, streamMode])

    React.useEffect(() => {
        if (sheetStage !== "files" || !filePreviews?.length || !selectedEpisode || !selectedTorrent) return

        if (filePreviews.length === 1) {
            const file = filePreviews[0]
            const fileId = getFileSelectionValue(file)
            setSelectedFileId(fileId)

            if (mode === "download") return

            const timer = setTimeout(() => {
                startManualStream({
                    episode: selectedEpisode,
                    torrent: selectedTorrent,
                    fileId: streamMode === "debrid" ? fileId : undefined,
                    fileIndex: file.index,
                    batchEpisodeFiles: buildBatchEpisodeFiles(filePreviews, fileId, selectedEpisode, streamMode),
                }, streamMode)
            }, 220)

            return () => clearTimeout(timer)
        }
    }, [buildBatchEpisodeFiles, filePreviews, selectedEpisode, selectedTorrent, sheetStage, startManualStream, streamMode, mode])

    const stopCurrentStream = React.useCallback(() => {
        if (streamMode === "debrid") {
            cancelDebridStream({
                options: {
                    removeTorrent: false,
                },
            }, {
                onSuccess: () => {
                    clearPendingStreamState()
                    setSelectedTorrent(null)
                },
            })
            return
        }

        stopTorrentStream(undefined, {
            onSuccess: () => {
                clearPendingStreamState()
                setSelectedTorrent(null)
            },
        })
    }, [cancelDebridStream, clearPendingStreamState, stopTorrentStream, streamMode])

    return {
        availableModes,
        autoSelect,
        autoSelectFile,
        batchHistory,
        closePicker,
        hasDebridService,
        hasTorrentStreaming,
        filePreviews,
        handleConfirmFileSelection,
        handleConfirmTorrentSelection,
        handleEpisodePress,
        isLoadingFilePreviews,
        isLoadingEpisodeCollection,
        isSearching,
        isStarting,
        isStopping,
        isEpisodeSelectionLocked,
        pickerOpen,
        loadingEpisodeNumber,
        providerExtensions: providerExtensions ?? [],
        refetchSearch,
        resolution,
        searchMode,
        searchQuery,
        selectedEpisode,
        selectedEpisodeNumber,
        setSelectedEpisodeNumber,
        selectedFileId,
        selectedProvider,
        selectedProviderId,
        selectedTorrent,
        setAutoSelect,
        setAutoSelectFile,
        setBestRelease,
        setPickerOpen: closePicker,
        setResolution,
        setStreamMode,
        setSearchMode,
        setSearchQuery,
        setSelectedFileId,
        setSelectedProviderId,
        setSelectedTorrent,
        setSheetStage,
        setSmartSearchBatch,
        setUsePreviousBatch,
        sheetStage,
        smartSearchBatch,
        stopCurrentStream,
        startAutoSelectedStream,
        startPreviousBatchStream,
        streamMode,
        torrents: searchData?.torrents ?? [],
        torrentMetadataByInfoHash,
        torrentstreamSettings: serverStatus?.torrentstreamSettings,
        canUsePreviousBatch,
        usePreviousBatch,
        bestRelease,
        episodeCollection,
        episodes: streamEpisodes,
        selectedProviderSupportsSmartSearch: selectedProvider?.settings?.canSmartSearch ?? false,
        smartSearchFilters: selectedProvider?.settings?.smartSearchFilters ?? [],
        setIsPreparing,
        searchAcrossProviders,
        setSearchAcrossProviders,
        extraProviderIds,
        setExtraProviderIds,
        activeExtraProviderIds,
    }
}

function toMobileResolution(value?: string | null): TorrentResolution {
    if (!value) return undefined
    const clean = value.replace("p", "")
    if (clean === "2160" || clean === "1080" || clean === "720" || clean === "540" || clean === "480") {
        return clean as TorrentResolution
    }
    return undefined
}

function getFileSelectionValue(file: StreamFilePreview): string {
    return "fileId" in file ? file.fileId : String(file.index)
}

function getDefaultStreamMode(serverStatus: Status | null | undefined): StreamMode {
    const hasTorrentStreaming = !!serverStatus?.torrentstreamSettings?.enabled
    const hasDebridService = !!serverStatus?.debridSettings?.enabled && !!serverStatus?.debridSettings?.provider
    const defaultSource = getDefaultPlaybackSource(serverStatus)

    if (defaultSource === "debridstream" && hasDebridService) {
        return "debrid"
    }

    if (defaultSource === "torrentstream" && hasTorrentStreaming) {
        return "torrent"
    }

    if (hasDebridService) return "debrid"
    if (hasTorrentStreaming) return "torrent"

    return "torrent"
}

function toActiveStreamSession(
    streamMode: StreamMode,
    entry: Anime_Entry,
    episode: Anime_Episode,
    message: string,
    torrentName?: string | null,
) {
    const title = entry.media?.title?.userPreferred
        || entry.media?.title?.romaji
        || entry.media?.title?.english
        || `Anime #${entry.mediaId}`
    const episodeTitle = episode.episodeTitle || episode.displayTitle
    const now = Date.now()

    return {
        streamMode,
        mediaId: entry.mediaId,
        episodeNumber: episode.episodeNumber,
        title,
        subtitle: episodeTitle ? `Episode ${episode.episodeNumber} · ${episodeTitle}` : `Episode ${episode.episodeNumber}`,
        status: "preparing" as const,
        message,
        torrentName,
        startedAt: now,
        updatedAt: now,
    }
}
