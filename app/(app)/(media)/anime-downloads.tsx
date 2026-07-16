import { EpisodePageSelector } from "@/components/shared/episode-page-selector"
import { RowDivider } from "@/components/shared/row-divider"
import { Surface } from "@/components/shared/surface"
import { FormSectionLabel } from "@/components/ui/form-field"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { usePaginatedItems } from "@/hooks/use-paginated-items"
import {
    type DownloadedAnimeInfo,
    useActiveAnimeDownloads,
    useAllDownloadedAnime,
    useAnimeDownloadDiskUsage,
    useAnimeTotalDownloadSize,
    useClearAllAnimeDownloads,
    useDeleteAllAnimeDownloadsForMedia,
    useDownloadedEpisodeCount,
    useFailedAnimeDownloads,
} from "@/lib/downloads"
import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { router } from "expo-router"
import React from "react"
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const DOWNLOADED_ANIME_PAGE_SIZE = 24

export default function AnimeDownloadsScreen() {
    const insets = useSafeAreaInsets()
    const downloadedAnime = useAllDownloadedAnime()
    const activeDownloads = useActiveAnimeDownloads()
    const failedDownloads = useFailedAnimeDownloads()
    const episodeCount = useDownloadedEpisodeCount()
    const totalSize = useAnimeTotalDownloadSize()
    const diskUsage = useAnimeDownloadDiskUsage()
    const clearAll = useClearAllAnimeDownloads()
    const downloadedAnimePagination = usePaginatedItems({
        items: downloadedAnime,
        pageSize: DOWNLOADED_ANIME_PAGE_SIZE,
    })
    useIOSScrollRefreshRateWorkaround()

    const handleClearAll = () => {
        if (downloadedAnime.length === 0) return
        Alert.alert(
            "Clear all downloads",
            `This will delete all ${downloadedAnime.length} downloaded anime (${episodeCount} episodes, ${totalSize.formatted}) from your device. This cannot be undone.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete All",
                    style: "destructive",
                    onPress: () => clearAll(),
                },
            ],
        )
    }

    return (
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>

            <View className="flex-row items-center gap-3 px-4 py-3">
                <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
                    <Ionicons name="chevron-back" size={24} color="white" />
                </TouchableOpacity>
                <Text className="text-xl font-bold text-foreground">Anime Downloads</Text>
            </View>

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
            >

                <Surface variant="muted" className="p-4 gap-3">
                    <FormSectionLabel>Storage</FormSectionLabel>

                    <View className="flex-row justify-between items-center">
                        <Text className="text-white/70 text-sm">Disk usage</Text>
                        <Text className="text-foreground text-sm font-medium">{diskUsage.formatted}</Text>
                    </View>

                    <View className="flex-row justify-between items-center">
                        <Text className="text-white/70 text-sm">Downloaded episodes</Text>
                        <Text className="text-foreground text-sm font-medium">{episodeCount}</Text>
                    </View>

                    <View className="flex-row justify-between items-center">
                        <Text className="text-white/70 text-sm">Downloaded anime</Text>
                        <Text className="text-foreground text-sm font-medium">{downloadedAnime.length}</Text>
                    </View>
                </Surface>

                <Surface
                    variant={failedDownloads.length > 0 ? "danger" : activeDownloads.length > 0 ? "brand" : "muted"}
                    className="overflow-hidden"
                >
                    <TouchableOpacity
                        className="flex-row items-center justify-between px-4 py-4"
                        activeOpacity={0.75}
                        onPress={() => router.push("/(app)/(media)/anime-download-queue" as never)}
                    >
                        <View className="flex-1 pr-3">
                            <FormSectionLabel>Queue</FormSectionLabel>
                            <Text className="text-sm text-white/70">
                                {formatQueueSummary(activeDownloads.length, failedDownloads.length, "episode")}
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
                    </TouchableOpacity>
                </Surface>


                {downloadedAnime.length > 0 && (
                    <Surface variant="muted" className="overflow-hidden">
                        <View className="px-4 pt-4 pb-2">
                            <FormSectionLabel>Downloaded Anime</FormSectionLabel>
                        </View>

                        {downloadedAnimePagination.hasMultiplePages && (
                            <View className="pb-2">
                                <EpisodePageSelector
                                    totalCount={downloadedAnimePagination.totalCount}
                                    pageSize={DOWNLOADED_ANIME_PAGE_SIZE}
                                    currentPage={downloadedAnimePagination.page}
                                    onPageChange={downloadedAnimePagination.setPage}
                                    logName="downloaded anime"
                                />
                            </View>
                        )}

                        {downloadedAnimePagination.pagedItems.map((anime, idx) => (
                            <React.Fragment key={anime.mediaId}>
                                {idx > 0 && <RowDivider />}
                                <AnimeDownloadRow anime={anime} />
                            </React.Fragment>
                        ))}
                    </Surface>
                )}

                {downloadedAnime.length === 0 && activeDownloads.length === 0 && (
                    <View className="py-16 items-center gap-3">
                        <Ionicons name="tv-outline" size={40} color="rgba(255,255,255,0.2)" />
                        <Text className="text-white/40 text-sm">No anime downloads yet</Text>
                    </View>
                )}


                {downloadedAnime.length > 0 && (
                    <Surface variant="danger" className="p-4 gap-3">
                        <FormSectionLabel>Danger Zone</FormSectionLabel>
                        <TouchableOpacity
                            className="flex-row items-center justify-between py-2"
                            onPress={handleClearAll}
                        >
                            <View className="flex-1">
                                <Text className="text-white text-sm font-medium">Clear all anime downloads</Text>
                                <Text className="text-white/40 text-xs mt-0.5">
                                    Remove all downloaded episodes and free up {totalSize.formatted}
                                </Text>
                            </View>
                            <Ionicons name="trash-outline" size={18} color="rgba(239,68,68,0.7)" />
                        </TouchableOpacity>
                    </Surface>
                )}
            </ScrollView>
        </View>
    )
}

////////////////////////// Anime row, navigates to entry, long-press deletes

function AnimeDownloadRow({ anime }: { anime: DownloadedAnimeInfo }) {
    const deleteAllForMedia = useDeleteAllAnimeDownloadsForMedia()

    return (
        <TouchableOpacity
            className="flex-row items-center px-4 py-3"
            activeOpacity={0.7}
            onLongPress={() => {
                Alert.alert(
                    "Delete downloads",
                    `Remove all ${anime.downloadedCount} downloaded episodes for "${anime.title}"?`,
                    [
                        { text: "Cancel", style: "cancel" },
                        {
                            text: "Delete",
                            style: "destructive",
                            onPress: () => deleteAllForMedia(anime.mediaId),
                        },
                    ],
                )
            }}
            onPress={() => router.push({
                pathname: "/(app)/entry/anime/[id]",
                params: { id: String(anime.mediaId), initialView: "downloaded" },
            })}
        >
            {anime.coverImageUrl ? (
                <Image
                    source={{ uri: anime.coverImageUrl }}
                    style={{ width: 36, height: 50, borderRadius: 6 }}
                    contentFit="cover"
                />
            ) : (
                <View className="h-12 w-9 items-center justify-center rounded-md bg-white/10">
                    <Ionicons name="tv" size={16} color="rgba(255,255,255,0.3)" />
                </View>
            )}
            <View className="flex-1 ml-3 mr-3">
                <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                    {anime.title}
                </Text>
                <Text className="text-white/40 text-xs mt-0.5">
                    {anime.downloadedCount} episode{anime.downloadedCount !== 1 ? "s" : ""}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.25)" />
        </TouchableOpacity>
    )
}

function formatQueueSummary(activeCount: number, failedCount: number, itemLabel: string): string {
    const parts: string[] = []
    if (activeCount > 0) {
        parts.push(`${activeCount} ${itemLabel}${activeCount === 1 ? "" : "s"} in queue`)
    }
    if (failedCount > 0) {
        parts.push(`${failedCount} failed`)
    }
    return parts.join(" · ") || `No active ${itemLabel}s or failures`
}
