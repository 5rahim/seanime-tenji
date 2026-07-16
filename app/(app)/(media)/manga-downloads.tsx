import { EpisodePageSelector } from "@/components/shared/episode-page-selector"
import { RowDivider } from "@/components/shared/row-divider"
import { Surface } from "@/components/shared/surface"
import { FormSectionLabel } from "@/components/ui/form-field"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { usePaginatedItems } from "@/hooks/use-paginated-items"
import {
    useActiveMangaDownloads,
    useAllDownloadedManga,
    useClearAllMangaDownloads,
    useFailedMangaDownloads,
    useMangaDownloadDiskUsage,
} from "@/lib/downloads"
import { type DownloadedMangaInfo } from "@/lib/downloads/manga-download-store"
import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { router } from "expo-router"
import React from "react"
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const DOWNLOADED_MANGA_PAGE_SIZE = 24

export default function MangaDownloadsScreen() {
    const insets = useSafeAreaInsets()
    const downloadedManga = useAllDownloadedManga()
    const activeDownloads = useActiveMangaDownloads()
    const failedDownloads = useFailedMangaDownloads()
    const diskUsage = useMangaDownloadDiskUsage()
    const clearAll = useClearAllMangaDownloads()
    const downloadedMangaPagination = usePaginatedItems({
        items: downloadedManga,
        pageSize: DOWNLOADED_MANGA_PAGE_SIZE,
    })

    useIOSScrollRefreshRateWorkaround()

    const handleClearAll = () => {
        if (downloadedManga.length === 0) return
        Alert.alert(
            "Clear all manga downloads",
            `This will delete all downloaded manga chapters (${diskUsage.formatted}) from your device. This cannot be undone.`,
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
                <Text className="text-xl font-bold text-foreground">Manga Downloads</Text>
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
                        <Text className="text-white/70 text-sm">Downloaded chapters</Text>
                        <Text className="text-foreground text-sm font-medium">
                            {downloadedManga.reduce((sum, m) => sum + m.downloadedCount, 0)}
                        </Text>
                    </View>

                    <View className="flex-row justify-between items-center">
                        <Text className="text-white/70 text-sm">Downloaded manga</Text>
                        <Text className="text-foreground text-sm font-medium">{downloadedManga.length}</Text>
                    </View>
                </Surface>

                <Surface
                    variant={failedDownloads.length > 0 ? "danger" : activeDownloads.length > 0 ? "brand" : "muted"}
                    className="overflow-hidden"
                >
                    <TouchableOpacity
                        className="flex-row items-center justify-between px-4 py-4"
                        activeOpacity={0.75}
                        onPress={() => router.push("/(app)/(media)/manga-download-queue" as never)}
                    >
                        <View className="flex-1 pr-3">
                            <FormSectionLabel>Queue</FormSectionLabel>
                            <Text className="text-sm text-white/70">
                                {formatQueueSummary(activeDownloads.length, failedDownloads.length, "chapter")}
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
                    </TouchableOpacity>
                </Surface>


                {downloadedManga.length > 0 && (
                    <Surface variant="muted" className="overflow-hidden">
                        <View className="px-4 pt-4 pb-2">
                            <FormSectionLabel>Downloaded Manga</FormSectionLabel>
                        </View>

                        {downloadedMangaPagination.hasMultiplePages && (
                            <View className="pb-2">
                                <EpisodePageSelector
                                    totalCount={downloadedMangaPagination.totalCount}
                                    pageSize={DOWNLOADED_MANGA_PAGE_SIZE}
                                    currentPage={downloadedMangaPagination.page}
                                    onPageChange={downloadedMangaPagination.setPage}
                                    logName="downloaded manga"
                                />
                            </View>
                        )}

                        {downloadedMangaPagination.pagedItems.map((manga, idx) => (
                            <React.Fragment key={manga.mediaId}>
                                {idx > 0 && <RowDivider />}
                                <MangaDownloadRow manga={manga} />
                            </React.Fragment>
                        ))}
                    </Surface>
                )}

                {downloadedManga.length === 0 && activeDownloads.length === 0 && (
                    <View className="py-16 items-center gap-3">
                        <Ionicons name="book-outline" size={40} color="rgba(255,255,255,0.2)" />
                        <Text className="text-white/40 text-sm">No manga downloads yet</Text>
                    </View>
                )}


                {downloadedManga.length > 0 && (
                    <Surface variant="danger" className="p-4 gap-3">
                        <FormSectionLabel>Danger Zone</FormSectionLabel>
                        <TouchableOpacity
                            className="flex-row items-center justify-between py-2"
                            onPress={handleClearAll}
                        >
                            <View className="flex-1">
                                <Text className="text-white text-sm font-medium">Clear all manga downloads</Text>
                                <Text className="text-white/40 text-xs mt-0.5">
                                    Remove all downloaded chapters and free up {diskUsage.formatted}
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

////////////////////////// Manga row, navigates to entry Downloads tab

function MangaDownloadRow({ manga }: { manga: DownloadedMangaInfo }) {
    return (
        <TouchableOpacity
            className="flex-row items-center px-4 py-3"
            activeOpacity={0.7}
            onPress={() =>
                router.push({
                    pathname: "/(app)/entry/manga/[id]",
                    params: { id: String(manga.mediaId), initialView: "downloaded" },
                } as never)
            }
        >
            {manga.coverImageUrl ? (
                <Image
                    source={{ uri: manga.coverImageUrl }}
                    style={{ width: 36, height: 50, borderRadius: 6 }}
                    contentFit="cover"
                />
            ) : (
                <View className="h-12 w-9 items-center justify-center rounded-md bg-white/10">
                    <Ionicons name="book" size={16} color="rgba(255,255,255,0.3)" />
                </View>
            )}
            <View className="flex-1 ml-3 mr-3">
                <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                    {manga.title}
                </Text>
                <Text className="text-white/40 text-xs mt-0.5">
                    {manga.downloadedCount} chapter{manga.downloadedCount !== 1 ? "s" : ""}
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
