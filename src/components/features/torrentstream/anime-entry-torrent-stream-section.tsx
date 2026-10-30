import { Anime_Entry } from "@/api/generated/types"
import { requestTVFocus } from "@/components/tv/tv-native"
import { animeEntryPlaybackIntentAtom } from "@/atoms/anime-entry.atoms"
import { CenteredSpinner } from "@/components/shared/centered-spinner"
import { LuffyError } from "@/components/shared/luffy-error"
import { Button } from "@/components/ui/button"
import {
    debridStreamStateAtom,
    getTorrentStreamLoadingLabel,
    streamSessionModeAtom,
    torrentStreamIsLoadedAtom,
    torrentStreamIsPreparingAtom,
    torrentStreamLoadingStateAtom,
    torrentStreamLoadingTorrentNameAtom,
    torrentStreamPendingInfoAtom,
    torrentStreamStatusAtom,
} from "@/lib/player"
import { useAtom } from "jotai"
import { useAtomValue, useSetAtom } from "jotai/react"
import * as React from "react"
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native"
import { TorrentStreamPickerSheet } from "./torrent-stream-picker-sheet"
import { TorrentStreamView } from "./torrent-stream-view"
import { TVPillButton, TV, tvSize, TVTorrentStreamPickerDrawer } from "@/components/tv"
import { useTorrentStreamController } from "./use-torrent-stream-controller"

type AnimeEntryTorrentStreamSectionProps = {
    entry: Anime_Entry
}

export function AnimeEntryTorrentStreamSection({ entry }: AnimeEntryTorrentStreamSectionProps) {
    const torrentStream = useTorrentStreamController({ entry })
    const [playbackIntent, setPlaybackIntent] = useAtom(animeEntryPlaybackIntentAtom)
    const progress = entry.listData?.progress ?? 0
    const sessionMode = useAtomValue(streamSessionModeAtom)
    const debridStreamState = useAtomValue(debridStreamStateAtom)
    const isPreparingStream = useAtomValue(torrentStreamIsPreparingAtom) && sessionMode === torrentStream.streamMode
    const setIsPreparingStream = useSetAtom(torrentStreamIsPreparingAtom)
    const isLoadedStream = useAtomValue(torrentStreamIsLoadedAtom) && sessionMode === torrentStream.streamMode
    const loadingState = useAtomValue(torrentStreamLoadingStateAtom)
    const loadingTorrentName = useAtomValue(torrentStreamLoadingTorrentNameAtom)
    const pendingInfo = useAtomValue(torrentStreamPendingInfoAtom)
    const torrentStatus = useAtomValue(torrentStreamStatusAtom)
    const playRef = React.useRef<React.ElementRef<typeof Pressable>>(null)
    const restoreFocusRef = React.useRef(false)
    const statusVisible = (isPreparingStream || !!loadingState)
        || (!isPreparingStream && isLoadedStream)
    const statusVisibleRef = React.useRef(statusVisible)

    const stopTVStream = React.useCallback(() => {
        restoreFocusRef.current = true
        torrentStream.stopCurrentStream()
    }, [torrentStream.stopCurrentStream])

    React.useEffect(() => {
        const wasVisible = statusVisibleRef.current
        statusVisibleRef.current = statusVisible
        if (!Platform.isTV || !restoreFocusRef.current || !wasVisible || statusVisible) return

        restoreFocusRef.current = false
        let innerFrame = 0
        const outerFrame = requestAnimationFrame(() => {
            innerFrame = requestAnimationFrame(() => {
                requestTVFocus(playRef.current)
            })
        })

        return () => {
            cancelAnimationFrame(outerFrame)
            if (innerFrame) cancelAnimationFrame(innerFrame)
        }
    }, [statusVisible])

    const loadingLabel = React.useMemo(() => {
        if (torrentStream.streamMode === "debrid") {
            if (debridStreamState?.message === "External player link sent") {
                return ""
            }
            return debridStreamState?.message || "Preparing debrid stream..."
        }

        return getTorrentStreamLoadingLabel(loadingState, loadingTorrentName)
    }, [debridStreamState?.message, loadingState, loadingTorrentName, torrentStream.streamMode])

    const loadingLabelRef = React.useRef(loadingLabel)

    React.useEffect(() => {
        if (!!loadingLabelRef.current && !loadingLabel && isPreparingStream) {
            setIsPreparingStream(false)
        }
        loadingLabelRef.current = loadingLabel
    }, [loadingLabel, isPreparingStream, setIsPreparingStream])

    const pendingLabel = React.useMemo(() => {
        if (!pendingInfo) return null

        const title =
            pendingInfo.episode?.episodeTitle ||
            pendingInfo.episode?.displayTitle ||
            pendingInfo.media?.title?.userPreferred ||
            pendingInfo.media?.title?.romaji ||
            pendingInfo.media?.title?.english

        if (title) {
            return `Episode ${pendingInfo.episodeNumber} · ${title}`
        }

        return `Episode ${pendingInfo.episodeNumber}`
    }, [pendingInfo])

    const activeStreamLabel = React.useMemo(() => {
        if (torrentStream.streamMode === "debrid") {
            return debridStreamState?.message ?? null
        }

        if (!torrentStatus) return null

        const parts = [
            `${torrentStatus.progressPercentage.toFixed(1)}%`,
            `${torrentStatus.seeders} seeders`,
        ]

        if (torrentStatus.downloadSpeed) {
            parts.push(torrentStatus.downloadSpeed)
        }

        return parts.join(" · ")
    }, [debridStreamState?.message, torrentStatus, torrentStream.streamMode])

    const continueEpisodes = React.useMemo(() => {
        if (!torrentStream.episodes.length) return []

        const nextEpisodes =
            entry.media?.episodes && progress === entry.media.episodes
                ? [...torrentStream.episodes].reverse()
                : torrentStream.episodes.slice(progress)

        return nextEpisodes.slice(0, 30)
    }, [entry.media?.episodes, progress, torrentStream.episodes])

    const handledPlaybackIntentRef = React.useRef<string | null>(null)

    React.useEffect(() => {
        if (!playbackIntent || playbackIntent.mediaId !== entry.mediaId) return
        if (
            playbackIntent.kind !== "torrentstream-auto-select"
            && playbackIntent.kind !== "torrentstream-previous-batch"
            && playbackIntent.kind !== "debridstream-auto-select"
            && playbackIntent.kind !== "debridstream-previous-batch"
        ) return
        if (torrentStream.isLoadingEpisodeCollection || torrentStream.episodes.length === 0) return
        if (handledPlaybackIntentRef.current === playbackIntent.id) return

        const playbackMode = playbackIntent.kind.startsWith("debridstream") ? "debrid" : "torrent"
        handledPlaybackIntentRef.current = playbackIntent.id
        setPlaybackIntent(current => current?.id === playbackIntent.id ? null : current)
        torrentStream.setStreamMode(playbackMode)

        const targetEpisode = torrentStream.episodes.find(episode => episode.episodeNumber === playbackIntent.episodeNumber)
        if (!targetEpisode) return

        if (playbackIntent.kind === "torrentstream-auto-select" || playbackIntent.kind === "debridstream-auto-select") {
            torrentStream.startAutoSelectedStream(targetEpisode, playbackMode)
            return
        }

        torrentStream.startPreviousBatchStream(targetEpisode, playbackMode)
    }, [entry.mediaId, playbackIntent, setPlaybackIntent, torrentStream])

    return (
        <>

            {(isPreparingStream || !!loadingState) && (
                Platform.isTV ? (
                    <View style={{ paddingHorizontal: TV.gutter, paddingTop: tvSize(10), paddingBottom: tvSize(15) }}>
                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: tvSize(20),
                                padding: tvSize(16),
                                borderRadius: tvSize(16),
                                backgroundColor: "rgba(59,130,246,0.15)",
                                borderColor: "rgba(96,165,250,0.3)",
                                borderWidth: tvSize(2),
                                alignSelf: "flex-start",
                            }}
                        >
                            <ActivityIndicator size="small" color="#60a5fa" />
                            <View style={{ gap: tvSize(4) }}>
                                <Text className="text-white font-bold" style={{ fontSize: tvSize(20) }}>
                                    {loadingLabel}
                                </Text>
                                {!!pendingLabel && (
                                    <Text className="text-white/70" style={{ fontSize: tvSize(16) }} numberOfLines={1}>
                                        {pendingLabel}
                                    </Text>
                                )}
                            </View>
                            <TVPillButton
                                label="Cancel"
                                disabled={torrentStream.isStopping}
                                onPress={stopTVStream}
                            />
                        </View>
                    </View>
                ) : (
                    <View className="px-4 pt-2 pb-3">
                        <View className="flex-row items-center gap-3 p-3.5 rounded-2xl bg-blue-500/15 border border-blue-500/25">
                            <ActivityIndicator size="small" color="#60a5fa" />
                            <View className="flex-1 gap-0.5">
                                <Text className="text-white font-semibold text-sm">
                                    {loadingLabel}
                                </Text>
                                {!!pendingLabel && (
                                    <Text className="text-xs text-white/70" numberOfLines={1}>
                                        {pendingLabel}
                                    </Text>
                                )}
                            </View>
                            <Button
                                size="sm"
                                variant="unstyled"
                                onPress={torrentStream.stopCurrentStream}
                                disabled={torrentStream.isStopping}
                                className="rounded-full border border-white/20 bg-white/10 px-3"
                            >
                                <Text className="text-white text-xs font-semibold">
                                    Cancel
                                </Text>
                            </Button>
                        </View>
                    </View>
                )
            )}

            {!isPreparingStream && isLoadedStream && (
                Platform.isTV ? (
                    <View style={{ paddingHorizontal: TV.gutter, paddingTop: tvSize(10), paddingBottom: tvSize(15) }}>
                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: tvSize(20),
                                padding: tvSize(16),
                                borderRadius: tvSize(16),
                                backgroundColor: "rgba(22,101,52,0.15)",
                                borderColor: "rgba(34,197,94,0.3)",
                                borderWidth: tvSize(2),
                                alignSelf: "flex-start",
                            }}
                        >
                            <View style={{ width: tvSize(12), height: tvSize(12), borderRadius: tvSize(6), backgroundColor: "#4ade80" }} />
                            <View style={{ gap: tvSize(4) }}>
                                <Text className="text-white font-bold" style={{ fontSize: tvSize(20) }}>
                                    {torrentStream.streamMode === "debrid" ? "Debrid stream active" : "Torrent stream active"}
                                </Text>
                                {!!activeStreamLabel && (
                                    <Text className="text-white/70" style={{ fontSize: tvSize(16) }} numberOfLines={1}>
                                        {activeStreamLabel}
                                    </Text>
                                )}
                            </View>
                            <TVPillButton
                                label={torrentStream.isStopping ? "Stopping..." : "Stop"}
                                disabled={torrentStream.isStopping}
                                onPress={stopTVStream}
                                className="bg-red-600/80 border-red-500"
                            />
                        </View>
                    </View>
                ) : (
                    <View className="px-4 pt-2 pb-3">
                        <View className="flex-row items-center gap-2.5 p-3.5 rounded-2xl bg-green-700/10 border border-green-600/25">
                            <View className="w-2 h-2 rounded-full bg-green-400" />
                            <View className="flex-1 gap-0.5">
                                <Text className="text-white font-semibold text-sm">
                                    {torrentStream.streamMode === "debrid" ? "Debrid stream active" : "Torrent stream active"}
                                </Text>
                                {!!activeStreamLabel && (
                                    <Text className="text-xs text-white/70" numberOfLines={1}>
                                        {activeStreamLabel}
                                    </Text>
                                )}
                            </View>
                            <Button
                                size="sm"
                                variant="destructive"
                                onPress={torrentStream.stopCurrentStream}
                                disabled={torrentStream.isStopping}
                                className="rounded-full"
                            >
                                <Text className="text-white text-xs font-semibold">
                                    {torrentStream.isStopping ? "Stopping..." : "Stop"}
                                </Text>
                            </Button>
                        </View>
                    </View>
                )
            )}

            {torrentStream.isLoadingEpisodeCollection ? (
                <CenteredSpinner />
            ) : torrentStream.episodes.length > 0 ? (
                <TorrentStreamView
                    entry={entry}
                    availableModes={torrentStream.availableModes}
                    continueEpisodes={continueEpisodes}
                    episodes={torrentStream.episodes}
                    progress={progress}
                    selectedEpisodeNumber={torrentStream.selectedEpisodeNumber ?? 0}
                    onEpisodePress={torrentStream.handleEpisodePress}
                    isEpisodeSelectionLocked={torrentStream.isEpisodeSelectionLocked}
                    loadingEpisodeNumber={torrentStream.loadingEpisodeNumber}
                    autoSelect={torrentStream.autoSelect}
                    autoSelectFile={torrentStream.autoSelectFile}
                    streamMode={torrentStream.streamMode}
                    onSelectStreamMode={torrentStream.setStreamMode}
                    onToggleAutoSelect={() => torrentStream.setAutoSelect(!torrentStream.autoSelect)}
                    onToggleAutoSelectFile={() => torrentStream.setAutoSelectFile(!torrentStream.autoSelectFile)}
                    onToggleUsePreviousBatch={() => torrentStream.setUsePreviousBatch(!torrentStream.usePreviousBatch)}
                    usePreviousBatch={torrentStream.usePreviousBatch}
                    hasMappingError={torrentStream.episodeCollection?.hasMappingError ?? false}
                    playRef={playRef}
                />
            ) : (
                <View className="">
                    <LuffyError
                        title="No episodes found"
                        description="Seanime couldn't find any streamable episodes for this anime."
                    />
                </View>
            )}

            {!Platform.isTV && (
                <TorrentStreamPickerSheet
                    batchHistory={torrentStream.batchHistory}
                    batchHistoryMetadata={torrentStream.batchHistory?.metadata}
                    bestRelease={torrentStream.bestRelease}
                    canUsePreviousBatch={torrentStream.canUsePreviousBatch}
                    episodes={torrentStream.episodes}
                    episodeCollectionHasMappingError={torrentStream.episodeCollection?.hasMappingError ?? false}
                    filePreviews={torrentStream.filePreviews}
                    isLoadingFilePreviews={torrentStream.isLoadingFilePreviews}
                    isSearching={torrentStream.isSearching}
                    isStarting={torrentStream.isStarting}
                    onConfirmFileSelection={torrentStream.handleConfirmFileSelection}
                    onConfirmTorrentSelection={torrentStream.handleConfirmTorrentSelection}
                    onBackToTorrentList={() => torrentStream.setSheetStage("torrents")}
                    onOpenChange={torrentStream.setPickerOpen}
                    onRefetchSearch={torrentStream.refetchSearch}
                    onSelectFileId={torrentStream.setSelectedFileId}
                    onSelectProvider={torrentStream.setSelectedProviderId}
                    onSelectResolution={torrentStream.setResolution}
                    onSelectSearchMode={torrentStream.setSearchMode}
                    onSelectTorrent={torrentStream.setSelectedTorrent}
                    onToggleBestRelease={() => torrentStream.setBestRelease(!torrentStream.bestRelease)}
                    onToggleSmartBatch={() => torrentStream.setSmartSearchBatch(!torrentStream.smartSearchBatch)}
                    onToggleUsePreviousBatch={() => torrentStream.setUsePreviousBatch(!torrentStream.usePreviousBatch)}
                    onUpdateSearchQuery={torrentStream.setSearchQuery}
                    open={torrentStream.pickerOpen}
                    pickerStage={torrentStream.sheetStage}
                    providerExtensions={torrentStream.providerExtensions}
                    streamMode={torrentStream.streamMode}
                    searchMode={torrentStream.searchMode}
                    searchQuery={torrentStream.searchQuery}
                    selectedEpisode={torrentStream.selectedEpisode}
                    selectedFileId={torrentStream.selectedFileId}
                    selectedProvider={torrentStream.selectedProvider}
                    selectedProviderId={torrentStream.selectedProviderId}
                    selectedTorrent={torrentStream.selectedTorrent}
                    smartSearchBatch={torrentStream.smartSearchBatch}
                    smartSearchFilters={torrentStream.smartSearchFilters}
                    supportsSmartSearch={torrentStream.selectedProviderSupportsSmartSearch}
                    torrents={torrentStream.torrents}
                    torrentCache={torrentStream.torrentCache}
                    torrentMetadataByInfoHash={torrentStream.torrentMetadataByInfoHash}
                    usePreviousBatch={torrentStream.usePreviousBatch}
                    resolution={torrentStream.resolution}
                    searchAcrossProviders={torrentStream.searchAcrossProviders}
                    onToggleSearchAcrossProviders={() => torrentStream.setSearchAcrossProviders(!torrentStream.searchAcrossProviders)}
                    extraProviderIds={torrentStream.extraProviderIds}
                    onSelectExtraProviderIds={torrentStream.setExtraProviderIds}
                    onSelectStage={torrentStream.setSheetStage}
                    availableModes={torrentStream.availableModes}
                    onSelectStreamMode={torrentStream.setStreamMode}
                    onSelectEpisodeNumber={torrentStream.setSelectedEpisodeNumber}
                />
            )}

            {Platform.isTV && (
                <TVTorrentStreamPickerDrawer
                    open={torrentStream.pickerOpen}
                    onOpenChange={torrentStream.setPickerOpen}
                    pickerStage={torrentStream.sheetStage}
                    torrents={torrentStream.torrents}
                    filePreviews={torrentStream.filePreviews}
                    isLoadingFilePreviews={torrentStream.isLoadingFilePreviews}
                    isSearching={torrentStream.isSearching}
                    isStarting={torrentStream.isStarting}
                    onSelectTorrent={torrentStream.setSelectedTorrent}
                    onSelectFileId={torrentStream.setSelectedFileId}
                    onConfirmFileSelection={torrentStream.handleConfirmFileSelection}
                    onConfirmTorrentSelection={torrentStream.handleConfirmTorrentSelection}
                    onBackToTorrentList={() => torrentStream.setSheetStage("torrents")}
                    selectedEpisode={torrentStream.selectedEpisode}
                    episodes={torrentStream.episodes}
                    selectedTorrent={torrentStream.selectedTorrent}
                    selectedFileId={torrentStream.selectedFileId}
                    streamMode={torrentStream.streamMode}
                    bestRelease={torrentStream.bestRelease}
                    searchAcrossProviders={torrentStream.searchAcrossProviders}
                    resolution={torrentStream.resolution}
                    searchMode={torrentStream.searchMode}
                    onToggleBestRelease={() => torrentStream.setBestRelease(!torrentStream.bestRelease)}
                    onToggleSearchAcrossProviders={() => torrentStream.setSearchAcrossProviders(!torrentStream.searchAcrossProviders)}
                    onSelectResolution={torrentStream.setResolution}
                    onSelectSearchMode={torrentStream.setSearchMode}
                    torrentCache={torrentStream.torrentCache}
                    torrentMetadataByInfoHash={torrentStream.torrentMetadataByInfoHash}

                    providerExtensions={torrentStream.providerExtensions}
                    selectedProviderId={torrentStream.selectedProviderId}
                    onSelectProvider={torrentStream.setSelectedProviderId}
                    supportsSmartSearch={torrentStream.selectedProviderSupportsSmartSearch}
                    smartSearchFilters={torrentStream.smartSearchFilters}
                    smartSearchBatch={torrentStream.smartSearchBatch}
                    onToggleSmartBatch={() => torrentStream.setSmartSearchBatch(!torrentStream.smartSearchBatch)}
                    extraProviderIds={torrentStream.extraProviderIds}
                    onSelectExtraProviderIds={torrentStream.setExtraProviderIds}
                    onSelectStage={torrentStream.setSheetStage}
                    searchQuery={torrentStream.searchQuery}
                    onUpdateSearchQuery={torrentStream.setSearchQuery}
                    onRefetchSearch={torrentStream.refetchSearch}
                />
            )}
        </>
    )
}
