import { useGetMangaEntry } from "@/api/hooks/manga.hooks"
import { MangaEntryActionBar } from "@/components/features/manga/manga-entry-action-bar"
import { MangaEntryChaptersView } from "@/components/features/manga/manga-entry-chapters-view"
import { MangaEntryDownloadedView } from "@/components/features/manga/manga-entry-downloaded-view"
import { MangaEntryInfoView } from "@/components/features/manga/manga-entry-info-view"
import { MangaEntryView, MangaEntryViewSwitcher } from "@/components/features/manga/manga-entry-view-switcher"
import { MediaEntryHeaderBackground, MediaEntryHeaderContent } from "@/components/features/media/media-entry-header"
import { MediaEntryScrollShell } from "@/components/features/media/media-entry-scroll-shell"
import { SafeView } from "@/components/layout/layout-view"
import { CenteredSpinner } from "@/components/shared/centered-spinner"
import { LuffyError } from "@/components/shared/luffy-error"
import { OfflineBanner } from "@/components/shared/offline-banner"
import { Styles } from "@/components/shared/styles"
import { useDevScreenProfiler } from "@/hooks/use-dev-screen-profiler"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { useHandleMangaChapters } from "@/hooks/use-manga-chapters"
import { getAllDownloadedChaptersForMediaAllProviders } from "@/lib/downloads/manga-download-store"
import { useIsServerConnected, useServerConnectionState } from "@/lib/offline"
import { saveMangaDownloadEntrySnapshot } from "@/lib/offline/download-entry-snapshot-store"
import { resolveOfflineMangaEntry } from "@/lib/offline/offline-entry-resolver"
import { useIsFocused } from "@react-navigation/native"
import { router, useLocalSearchParams } from "expo-router"
import * as React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { InteractionManager, RefreshControl, Text, TouchableOpacity, View } from "react-native"
import Animated, { FadeIn, useSharedValue } from "react-native-reanimated"
import Reanimated, { useAnimatedScrollHandler } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"


type MangaEntryScreenProps = {
    initialView?: MangaEntryView
}

export function MangaEntryScreen({ initialView = "chapters" }: MangaEntryScreenProps) {
    const { id } = useLocalSearchParams<{ id: string }>()
    const mediaId = Number(id)
    const { data: remoteEntry, isFetching, isLoading, refetch } = useGetMangaEntry(id)
    const offlineEntry = React.useMemo(() => resolveOfflineMangaEntry(mediaId), [mediaId])
    const entry = remoteEntry?.media ? remoteEntry : offlineEntry

    React.useEffect(() => {
        if (!remoteEntry?.media) return
        if (getAllDownloadedChaptersForMediaAllProviders(remoteEntry.mediaId).length === 0) return

        saveMangaDownloadEntrySnapshot(remoteEntry)
    }, [remoteEntry])
    const isFocused = useIsFocused()
    const insets = useSafeAreaInsets()
    const connectionState = useServerConnectionState()
    const isConnected = useIsServerConnected()
    const isOffline = connectionState === "disconnected"
    const [currentView, setCurrentView] = useState<MangaEntryView>(initialView)
    const [isPrimaryBodyReady, setIsPrimaryBodyReady] = useState(false)
    const chaptersScrollY = useSharedValue(0)
    const infoScrollY = useSharedValue(0)
    const downloadedScrollY = useSharedValue(0)
    const [mountedViews, setMountedViews] = React.useState<Record<MangaEntryView, boolean>>({
        chapters: initialView === "chapters",
        info: initialView === "info",
        downloaded: initialView === "downloaded",
    })
    const activeScrollY = useMemo(() => {
        switch (currentView) {
            case "info":
                return infoScrollY
            case "downloaded":
                return downloadedScrollY
            case "chapters":
            default:
                return chaptersScrollY
        }
    }, [chaptersScrollY, currentView, downloadedScrollY, infoScrollY])

    const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set())
    const selectionMode = selectedChapterIds.size > 0

    useIOSScrollRefreshRateWorkaround(true)

    const toggleChapter = useCallback((chapterId: string) => {
        setSelectedChapterIds(prev => {
            const next = new Set(prev)
            if (next.has(chapterId)) {
                next.delete(chapterId)
            } else {
                next.add(chapterId)
            }
            return next
        })
    }, [])

    const onScroll = useAnimatedScrollHandler({
        onScroll: event => {
            chaptersScrollY.value = event.contentOffset.y
        },
    })

    useEffect(() => {
        setMountedViews(prev => prev[currentView] ? prev : { ...prev, [currentView]: true })
    }, [currentView])

    useEffect(() => {
        setIsPrimaryBodyReady(false)

        const task = InteractionManager.runAfterInteractions(() => {
            setIsPrimaryBodyReady(true)
        })

        return () => {
            task.cancel()
        }
    }, [id])

    useDevScreenProfiler(`manga-entry:${id ?? "unknown"}`, isPrimaryBodyReady)

    useEffect(() => {
        if (isFocused) return

        setMountedViews({
            chapters: currentView === "chapters",
            info: currentView === "info",
            downloaded: currentView === "downloaded",
        })
    }, [currentView, isFocused])

    // when offline, force to downloads view
    useEffect(() => {
        if (isOffline && currentView === "chapters") {
            setCurrentView("downloaded")
        }
    }, [isOffline, currentView])

    if (isLoading && !entry?.media) {
        return (
            <View style={[Styles.Container, { justifyContent: "center", alignItems: "center" }]}>
                <CenteredSpinner />
            </View>
        )
    }

    if (!entry?.media) {
        return (
            <SafeView>
                <LuffyError
                    title="Unavailable offline"
                    description="This manga's data isn't cached on your device. Connect to your server then try again."
                />
                <View className="items-center mt-4">
                    <TouchableOpacity onPress={() => router.back()} className="px-6 py-3 rounded-full bg-white/10">
                        <Text className="text-foreground font-medium">Go back</Text>
                    </TouchableOpacity>
                </View>
            </SafeView>
        )
    }

    return (
        <Animated.View entering={FadeIn.duration(180)} className="flex-1 bg-background">
            <View className="flex-1">
                <MediaEntryHeaderBackground entry={entry} scrollY={activeScrollY} />

                {mountedViews.chapters && (
                    <View style={{ flex: currentView === "chapters" ? 1 : 0, display: currentView === "chapters" ? "flex" : "none" }}>
                        <View className="flex-1 bg-transparent">
                            <Reanimated.ScrollView
                                contentInsetAdjustmentBehavior="never"
                                showsVerticalScrollIndicator={false}
                                scrollEventThrottle={16}
                                onScroll={onScroll}
                                refreshControl={isConnected ? (
                                    <RefreshControl
                                        refreshing={isFetching}
                                        onRefresh={() => { refetch() }}
                                        tintColor="rgba(255,255,255,0.45)"
                                    />
                                ) : undefined}
                                contentContainerStyle={{ paddingBottom: 110 }}
                                nestedScrollEnabled
                            >
                                <MediaEntryHeaderContent entry={entry} type="manga" onTitlePress={() => setCurrentView("info")} />
                                <OfflineBanner />
                                {isPrimaryBodyReady ? (
                                    <MangaEntryPrimaryContent
                                        mediaId={id ?? String(entry.mediaId)}
                                        entry={entry}
                                        selectedChapterIds={selectedChapterIds}
                                        selectionMode={selectionMode}
                                        onToggleChapter={toggleChapter}
                                    />
                                ) : (
                                    <View className="py-10">
                                        <CenteredSpinner />
                                    </View>
                                )}
                            </Reanimated.ScrollView>
                        </View>
                    </View>
                )}

                {mountedViews.info && (
                    <View style={{ flex: currentView === "info" ? 1 : 0, display: currentView === "info" ? "flex" : "none" }}>
                        <MediaEntryScrollShell
                            entry={entry}
                            type="manga"
                            contentContainerStyle={{ paddingBottom: 180 }}
                            scrollY={infoScrollY}
                            showHeaderBackground={false}
                            onTitlePress={() => setCurrentView("info")}
                        >
                            <OfflineBanner />
                            <MangaEntryInfoView mediaId={entry.media.id} fallbackDescription={entry.media.description} />
                        </MediaEntryScrollShell>
                    </View>
                )}

                {mountedViews.downloaded && (
                    <View style={{ flex: currentView === "downloaded" ? 1 : 0, display: currentView === "downloaded" ? "flex" : "none" }}>
                        <MediaEntryScrollShell
                            entry={entry}
                            type="manga"
                            contentContainerStyle={{ paddingBottom: 180 }}
                            scrollY={downloadedScrollY}
                            showHeaderBackground={false}
                            onTitlePress={() => setCurrentView("info")}
                        >
                            <MangaEntryDownloadedView media={entry.media} />
                        </MediaEntryScrollShell>
                    </View>
                )}
            </View>

            <MangaEntryViewSwitcher
                currentView={currentView}
                onViewChange={setCurrentView}
                bottomInset={insets.bottom}
                isOffline={isOffline}
            />
        </Animated.View>
    )
}

type MangaEntryData = NonNullable<ReturnType<typeof useGetMangaEntry>["data"]>

function MangaEntryPrimaryContent({
    mediaId,
    entry,
    selectedChapterIds,
    selectionMode,
    onToggleChapter,
}: {
    mediaId: string
    entry: MangaEntryData
    selectedChapterIds: Set<string>
    selectionMode: boolean
    onToggleChapter: (chapterId: string) => void
}) {
    const {
        selectedProvider,
        chapterContainer,
    } = useHandleMangaChapters(mediaId)

    const chapters = chapterContainer?.chapters ?? []

    return (
        <>
            <MangaEntryActionBar
                entry={entry}
                provider={selectedProvider}
                chapters={chapters}
            />
            <MangaEntryChaptersView
                mediaId={entry.mediaId}
                listData={entry.listData}
                mediaTitle={
                    entry.media?.title?.userPreferred
                    ?? entry.media?.title?.english
                    ?? entry.media?.title?.romaji
                    ?? ""
                }
                selectedChapterIds={selectedChapterIds}
                selectionMode={selectionMode}
                onToggleChapter={onToggleChapter}
            />
        </>
    )
}
