import { Anime_Entry, Anime_Episode, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { useDebridAddTorrents } from "@/api/hooks/debrid.hooks"
import { useTorrentClientDownload } from "@/api/hooks/torrent_client.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
import { TorrentStreamPickerSheet } from "@/components/features/torrentstream/torrent-stream-picker-sheet"
import { useTorrentStreamController } from "@/components/features/torrentstream/use-torrent-stream-controller"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaBottomSheet } from "@/components/ui/bottom-sheet"
import { getEpisodeSpoilerState, getSpoilerSafeAnimeImage } from "@/lib/anime-spoilers"
import { useIsLocalServer } from "@/lib/downloads"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/utils/toast"
import { Ionicons } from "@expo/vector-icons"
import React, { useCallback, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"

const MODAL_PAGE_SIZE = 40

type ServerDownloadModalProps = {
    entry: Anime_Entry
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function sanitizeDirectoryName(input: string): string {
    const disallowedChars = /[<>:"/\\|?*\x00-\x1F]/g
    const sanitized = input.replace(disallowedChars, " ")
    const trimmed = sanitized.trim().replace(/^\.+|\.+$/g, "").replace(/\s+/g, " ")
    return trimmed || "Untitled"
}

export function getDefaultDestination(entry: Anime_Entry, libraryPath?: string, os?: string): string {
    const isWindows = os?.toLowerCase() === "windows"
    const separator = isWindows ? "\\" : "/"

    let base = ""
    const fPath = entry.localFiles?.find(n => !!n.path)?.path
    if (fPath) {
        const lastSlash = Math.max(fPath.lastIndexOf("/"), fPath.lastIndexOf("\\"))
        if (lastSlash !== -1) {
            base = fPath.substring(0, lastSlash)
        } else {
            base = fPath
        }
    } else if (libraryPath) {
        base = libraryPath
    }

    if (!base) return ""

    if (!isWindows) {
        base = base.replace(/\\/g, "/")
    } else {
        base = base.replace(/\//g, "\\")
    }

    const folderName = sanitizeDirectoryName(
        entry.media?.title?.romaji || entry.media?.title?.english || entry.media?.title?.userPreferred || "",
    )

    const hasTrailing = base.endsWith("/") || base.endsWith("\\")
    let result = hasTrailing ? `${base}${folderName}` : `${base}${separator}${folderName}`

    if (!isWindows) {
        result = result.replace(/\\/g, "/")
    } else {
        result = result.replace(/\//g, "\\")
    }
    return result
}

function getFileSelectionValue(file: any): string {
    return "fileId" in file ? file.fileId : String(file.index)
}

export function ServerDownloadModal({ entry, open, onOpenChange }: ServerDownloadModalProps) {
    const [page, setPage] = useState(0)
    const [destination, setDestination] = useState("")
    const serverStatus = useServerStatus()
    const torrentStream = useTorrentStreamController({ entry, mode: "download" })
    const isLocalServer = useIsLocalServer()

    const { mutate: downloadTorrent, isPending: isDownloadingTorrent } = useTorrentClientDownload(() => {
        torrentStream.setPickerOpen(false)
        onOpenChange(false)
    })

    const { mutate: debridAddTorrents, isPending: isDownloadingDebrid } = useDebridAddTorrents(() => {
        torrentStream.setPickerOpen(false)
        onOpenChange(false)
    })

    const isDownloading = isDownloadingTorrent || isDownloadingDebrid
    const hasTorrentClient = !!serverStatus?.settings?.torrent?.defaultTorrentClient && serverStatus?.settings?.torrent?.defaultTorrentClient !== "none"

    React.useEffect(() => {
        if (open) {
            const libraryPath = serverStatus?.settings?.library?.libraryPath
            setDestination(getDefaultDestination(entry, libraryPath, serverStatus?.os))
        }
    }, [open, entry, serverStatus])

    const handleDownloadTorrent = useCallback((torrent: HibikeTorrent_AnimeTorrent, smartSelect: boolean = false) => {
        if (!entry.media) return
            const dest = destination || getDefaultDestination(entry, serverStatus?.settings?.library?.libraryPath, serverStatus?.os)
        if (!dest) {
            toast.error("Library path not configured on server")
            return
        }

        if (torrentStream.streamMode === "debrid") {
            debridAddTorrents({
                torrents: [torrent],
                destination: dest,
                media: entry.media,
            })
        } else {
            downloadTorrent({
                torrents: [torrent],
                destination: dest,
                smartSelect: {
                    enabled: smartSelect,
                    missingEpisodeNumbers: smartSelect ? entry.downloadInfo?.episodesToDownload?.map(n => n.episodeNumber) || [] : [],
                },
                media: entry.media,
            })
        }
        },
        [debridAddTorrents, downloadTorrent, entry, serverStatus?.settings?.library?.libraryPath, serverStatus?.os, torrentStream.streamMode,
            destination])

    const handleDownloadFile = useCallback((torrent: HibikeTorrent_AnimeTorrent, selectedFileId: string | null) => {
            if (!entry.media || !selectedFileId) return
            const dest = destination || getDefaultDestination(entry, serverStatus?.settings?.library?.libraryPath, serverStatus?.os)
            if (!dest) {
                toast.error("Library path not configured on server")
                return
            }

            const selectedFile = torrentStream.filePreviews.find(f => getFileSelectionValue(f) === selectedFileId)
            if (!selectedFile) return

            if (torrentStream.streamMode === "debrid") {
                debridAddTorrents({
                    torrents: [torrent],
                    destination: dest,
                    media: entry.media,
                })
            } else {
                const selectedIndex = selectedFile.index
                const deselectIndices = torrentStream.filePreviews
                    .map(f => f.index)
                    .filter(idx => idx !== selectedIndex)

                downloadTorrent({
                    torrents: [torrent],
                    destination: dest,
                    smartSelect: {
                        enabled: false,
                        missingEpisodeNumbers: [],
                    },
                    deselect: {
                        enabled: true,
                        indices: deselectIndices,
                    },
                    media: entry.media,
                })
            }
        },
        [debridAddTorrents, downloadTorrent, entry, serverStatus?.settings?.library?.libraryPath, serverStatus?.os, torrentStream.filePreviews,
            torrentStream.streamMode, destination])

    const episodes = useMemo(() => {
        const presentEpisodeKeys = new Set(
            (entry.episodes ?? [])
                .filter(ep => ep.localFile?.path)
                .map(ep => `${ep.type}-${ep.episodeNumber}`),
        )
        return torrentStream.episodes.filter(ep => !presentEpisodeKeys.has(`${ep.type}-${ep.episodeNumber}`))
    }, [torrentStream.episodes, entry.episodes])
    const totalPages = Math.max(1, Math.ceil(episodes.length / MODAL_PAGE_SIZE))
    const pagedEpisodes = episodes.slice(page * MODAL_PAGE_SIZE, (page + 1) * MODAL_PAGE_SIZE)

    React.useEffect(() => {
        if (open) {
            if (episodes.length > 0) {
                const progress = entry.listData?.progress ?? 0
                const nextEpIndex = episodes.findIndex(ep => (ep.progressNumber || ep.episodeNumber) > progress)
                console.log(entry.listData?.progress, nextEpIndex, episodes)
                if (nextEpIndex !== -1) {
                    setPage(Math.floor(nextEpIndex / MODAL_PAGE_SIZE))
                } else {
                    setPage(0)
                }
            } else {
                setPage(0)
            }
        }
    }, [open, episodes, entry.listData?.progress])

    const handleEpisodePress = useCallback((episode: Anime_Episode) => {
        torrentStream.handleEpisodePress(episode)
    }, [torrentStream])

    return (
        <>
            <SeaBottomSheet
                open={open}
                onOpenChange={onOpenChange}
                title="Download on Server"
                snapPoints={["70%", "92%"]}
            >
                <View className="mb-4">
                    <Text className="text-xs text-white/40 leading-relaxed">
                        {!isLocalServer
                            ? "Add anime releases to your server's library. Select an episode below to search and download torrents or debrid files."
                            :
                            "Select an episode below to search and download torrents. Downloaded episodes will automatically be available for offline playback."}
                    </Text>
                </View>

                {episodes.length === 0 ? (
                    <View className="py-8 items-center">
                        <Ionicons name="cloud-offline-outline" size={40} color="rgba(255,255,255,0.3)" />
                        <Text className="text-white/40 text-sm mt-3">
                            No episodes available
                        </Text>
                    </View>
                ) : (
                    <>
                        {episodes.length > MODAL_PAGE_SIZE && (
                            <View className="flex-row items-center justify-center gap-3 pb-3">
                                <Pressable
                                    onPress={() => setPage(Math.max(0, page - 1))}
                                    disabled={page === 0}
                                    className={cn(
                                        "w-8 h-8 rounded-lg items-center justify-center",
                                        page === 0 ? "opacity-25" : "bg-white/5",
                                    )}
                                >
                                    <Ionicons name="chevron-back" size={16} color="white" />
                                </Pressable>
                                <Text className="min-w-12 text-center text-xs font-medium text-white/40">
                                    {page + 1} / {totalPages}
                                </Text>
                                <Pressable
                                    onPress={() => setPage(Math.min(totalPages - 1, page + 1))}
                                    disabled={page === totalPages - 1}
                                    className={cn(
                                        "w-8 h-8 rounded-lg items-center justify-center",
                                        page === totalPages - 1 ? "opacity-25" : "bg-white/5",
                                    )}
                                >
                                    <Ionicons name="chevron-forward" size={16} color="white" />
                                </Pressable>
                            </View>
                        )}

                        <ScrollView className="gap-1.5" showsVerticalScrollIndicator={false}>
                            {pagedEpisodes.map(episode => {
                                return (
                                    <EpisodeDownloadRow
                                        key={episode.episodeNumber}
                                        episode={episode}
                                        watchedProgress={entry.listData?.progress ?? 0}
                                        onPress={() => handleEpisodePress(episode)}
                                    />
                                )
                            })}
                        </ScrollView>
                    </>
                )}
            </SeaBottomSheet>

            <TorrentStreamPickerSheet
                mode="download"
                onDownloadTorrent={handleDownloadTorrent}
                onDownloadFile={handleDownloadFile}
                isDownloading={isDownloading}
                hasTorrentClient={hasTorrentClient}
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
                destination={destination}
                onChangeDestination={setDestination}
                onSelectEpisodeNumber={torrentStream.setSelectedEpisodeNumber}
            />
        </>
    )
}

type EpisodeDownloadRowProps = {
    episode: Anime_Episode
    watchedProgress: number
    onPress: () => void
}

function EpisodeDownloadRow({ episode, watchedProgress, onPress }: EpisodeDownloadRowProps) {
    const serverStatus = useServerStatus()
    const thumbnailWidth = 80
    const isOnServer = !!episode.localFile?.path
    const isWatched = episode.progressNumber <= watchedProgress

    const spoiler = getEpisodeSpoilerState(serverStatus, {
        episodeNumber: episode.progressNumber || episode.episodeNumber,
        watchedProgress,
    })
    const spoilerSafeImage = getSpoilerSafeAnimeImage(episode.baseAnime)
    const originalImage = episode.episodeMetadata?.image || episode.baseAnime?.bannerImage
    const image = spoiler.hideThumbnail ? (spoilerSafeImage || originalImage) : originalImage
    const blurAdultContent = !!serverStatus?.settings?.anilist?.blurAdultContent && !!episode.baseAnime?.isAdult

    return (
        <Pressable
            onPress={onPress}
            className="flex-row items-center py-2.5 px-3 rounded-2xl bg-white/[0.03] border border-white/5 mb-2 active:bg-white/10"
        >
            <View
                className={cn("rounded-lg overflow-hidden bg-white/5", isWatched && "opacity-45")}
                style={{ width: thumbnailWidth, aspectRatio: 16 / 9 }}
            >
                <SeaImage
                    source={{ uri: image }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="cover"
                    transition={100}
                    blurRadius={(spoiler.hideThumbnail && !spoilerSafeImage) || blurAdultContent ? 18 : 0}
                />
            </View>

            <View className="flex-1 ml-3 justify-center">
                <Text className="text-sm font-semibold text-white" numberOfLines={1}>
                    {episode.type !== "main" && (
                        <Text className="text-white/40">
                            {episode.type === "special" ? "SP " : "NC "}
                        </Text>
                    )}
                    Episode {episode.episodeNumber}
                </Text>
                {!!episode.episodeTitle && !spoiler.hideTitle && (
                    <Text className="text-xs text-white/40 mt-0.5" numberOfLines={1}>
                        {episode.episodeTitle}
                    </Text>
                )}
                {isWatched && (
                    <Text className="text-[10px] text-muted-foreground/60 mt-0.5 font-bold">
                        Watched
                    </Text>
                )}
            </View>

            <View className="items-end justify-center pr-1">
                {isOnServer ? (
                    <View className="flex-row items-center gap-1 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-md">
                        <Ionicons name="checkmark" size={10} color="#4ade80" />
                    </View>
                ) : null}
            </View>
        </Pressable>
    )
}
