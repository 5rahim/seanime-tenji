import { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
import { EpisodeCardList } from "@/components/features/anime/episode-card-list"
import { EpisodeListItem } from "@/components/features/anime/episode-list-item"
import { MediaEntryHeaderBackground, MediaEntryHeaderContent } from "@/components/features/media/media-entry-header"
import { EPISODE_PAGE_SIZE, EpisodePageSelector } from "@/components/shared/episode-page-selector"
import { LuffyError } from "@/components/shared/luffy-error"
import { OfflineBanner } from "@/components/shared/offline-banner"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { getSequentialContinueWatchingSpoilerActive } from "@/lib/anime-spoilers"
import * as React from "react"
import { ActivityIndicator, SectionList, Text, useWindowDimensions, View } from "react-native"
import Animated, { SharedValue, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated"

const AnimatedSectionList = Animated.createAnimatedComponent(SectionList) as unknown as typeof SectionList

type AnimeEntryServerLocalViewProps = {
    entry: Anime_Entry
    mediaId?: number
    entryProgress: number
    mainEpisodes: Anime_Episode[]
    specialEpisodes: Anime_Episode[]
    ncEpisodes: Anime_Episode[]
    unwatchedMainEpisodes: Anime_Episode[]
    onEpisodePress?: (episode: Anime_Episode) => void
    showDeferredContent?: boolean
    scrollY?: SharedValue<number>
    showHeaderBackground?: boolean
    onTitlePress?: () => void
}

type EpisodeSection = {
    key: string
    title: string
    data: Anime_Episode[]
    totalCount: number
}

function EpisodeLoadingBadge() {
    return (
        <View className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/70">
            <ActivityIndicator size="small" color="rgba(255,255,255,0.92)" />
        </View>
    )
}

export function AnimeEntryServerLocalView({
    entry,
    mediaId,
    entryProgress,
    mainEpisodes,
    specialEpisodes,
    ncEpisodes,
    unwatchedMainEpisodes,
    onEpisodePress,
    showDeferredContent = true,
    scrollY: sharedScrollY,
    showHeaderBackground = true,
    onTitlePress,
}: AnimeEntryServerLocalViewProps) {
    const hasEpisodes = mainEpisodes.length > 0 || specialEpisodes.length > 0 || ncEpisodes.length > 0
    const entryKey = entry.media?.id ?? mediaId ?? entry.mediaId
    const { width: windowWidth } = useWindowDimensions()
    const thumbnailWidth = React.useMemo(() => Math.min(Math.max(windowWidth * 0.4, 128), 160), [windowWidth])

    const { data: watchHistory } = useGetContinuityWatchHistory()
    const serverStatus = useServerStatus()
    const continueWatchingSpoilerActive = getSequentialContinueWatchingSpoilerActive(serverStatus)

    const localScrollY = useSharedValue(0)
    const scrollY = sharedScrollY ?? localScrollY

    useIOSScrollRefreshRateWorkaround()

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: event => {
            scrollY.value = event.contentOffset.y
        },
    })

    React.useEffect(() => {
        scrollY.set(0)
    }, [entryKey, scrollY])

    const fullSections = React.useMemo(() => {
        const nextSections: Array<Omit<EpisodeSection, "totalCount"> & { totalCount: number }> = []

        if (mainEpisodes.length > 0) {
            nextSections.push({ key: "episodes", title: "Episodes", data: mainEpisodes, totalCount: mainEpisodes.length })
        }
        if (specialEpisodes.length > 0) {
            nextSections.push({ key: "specials", title: "Specials", data: specialEpisodes, totalCount: specialEpisodes.length })
        }
        if (ncEpisodes.length > 0) {
            nextSections.push({ key: "nc", title: "NC", data: ncEpisodes, totalCount: ncEpisodes.length })
        }

        return nextSections
    }, [mainEpisodes, specialEpisodes, ncEpisodes])

    const [sectionPages, setSectionPages] = React.useState<Record<string, number>>({})

    React.useEffect(() => {
        const initial: Record<string, number> = {}
        for (const s of fullSections) {
            if (s.key === "episodes" && entryProgress > 0) {
                const firstUnwatchedIdx = s.data.findIndex(ep => ep.progressNumber > entryProgress)
                initial[s.key] = firstUnwatchedIdx >= 0 ? Math.floor(firstUnwatchedIdx / EPISODE_PAGE_SIZE) : 0
            } else {
                initial[s.key] = 0
            }
        }
        setSectionPages(initial)
    }, [entryKey])

    const setSectionPage = React.useCallback((key: string, page: number) => {
        setSectionPages(prev => ({ ...prev, [key]: page }))
    }, [])

    const sections = React.useMemo<EpisodeSection[]>(() => {
        return fullSections.map(s => {
            const page = sectionPages[s.key] ?? 0
            const start = page * EPISODE_PAGE_SIZE
            return { ...s, data: s.data.slice(start, start + EPISODE_PAGE_SIZE) }
        })
    }, [fullSections, sectionPages])

    const visibleSections = React.useMemo(() => showDeferredContent ? sections : [], [sections, showDeferredContent])

    const initialRenderItemCount = React.useMemo(() => {
        if (!showDeferredContent) return 1

        const totalEpisodeCount = visibleSections.reduce((count, section) => count + section.data.length, 0)
        const totalStructuredItems = totalEpisodeCount + visibleSections.length + 1

        return Math.min(Math.max(totalStructuredItems, 8), 12)
    }, [showDeferredContent, visibleSections])

    const maxRenderPerBatch = React.useMemo(() => Math.min(initialRenderItemCount, 8), [initialRenderItemCount])

    const renderEpisode = React.useCallback(({ item, index, section }: { item: Anime_Episode, index: number, section: EpisodeSection }) => {
        const pct = mediaId ? getEpisodePercentageComplete(watchHistory, mediaId, item.progressNumber) : 0
        return (
            <View className="px-4">
                <EpisodeListItem
                    episode={item}
                    mediaId={mediaId}
                    fallbackImage={entry.media?.bannerImage}
                    isWatched={item.progressNumber <= entryProgress && item.localFile?.metadata?.type === "main"}
                    onEpisodePress={onEpisodePress}
                    thumbnailWidth={thumbnailWidth}
                    isFirst={index === 0}
                    isLast={index === section.data.length - 1}
                    progressPercent={pct}
                    watchedProgress={entryProgress}
                />
            </View>
        )
    }, [entryProgress, mediaId, onEpisodePress, thumbnailWidth, watchHistory])

    const renderSectionHeader = React.useCallback(({ section }: { section: EpisodeSection }) => {
        const page = sectionPages[section.key] ?? 0
        return (
            <View className="pt-6 pb-2">
                <View className="px-4 mb-2">
                    <Text className="text-xl font-bold text-foreground">{section.title}</Text>
                </View>
                <EpisodePageSelector
                    totalCount={section.totalCount}
                    currentPage={page}
                    onPageChange={p => setSectionPage(section.key, p)}
                    logName={`server-local ${section.title}`}
                />
            </View>
        )
    }, [sectionPages])

    const keyExtractor = React.useCallback((episode: Anime_Episode, index: number) => {
        return episode.localFile?.path || `${episode.type}-${episode.episodeNumber}-${index}`
    }, [])

    const listHeader = React.useMemo(() => (
            <>
                <MediaEntryHeaderContent entry={entry} type="anime" onTitlePress={onTitlePress} />
                <OfflineBanner />

                <View className="px-4 py-2 items-center mb-4">
                    <Text className="text-xs font-medium text-foreground/40 tracking-wider">
                        Available on Local Server
                    </Text>
                </View>

                {showDeferredContent && unwatchedMainEpisodes.length > 0 && (
                    <View className="mb-1">
                        <EpisodeCardList
                            title="Continue Watching"
                            episodes={unwatchedMainEpisodes}
                            onEpisodePress={onEpisodePress}
                            mediaId={mediaId}
                            watchHistory={watchHistory}
                            watchedProgress={entryProgress}
                            spoilerActive={continueWatchingSpoilerActive}
                        />
                    </View>
                )}
            </>
        ),
        [continueWatchingSpoilerActive, entry, entryProgress, mediaId, onEpisodePress, unwatchedMainEpisodes, watchHistory,
            showDeferredContent, onTitlePress])

    return (
        <View className={showHeaderBackground ? "flex-1 bg-background" : "flex-1 bg-transparent"}>
            {showHeaderBackground ? <MediaEntryHeaderBackground entry={entry} scrollY={scrollY} /> : null}
            <AnimatedSectionList
                key={String(entryKey)}
                sections={visibleSections as any}
                renderItem={renderEpisode}
                renderSectionHeader={renderSectionHeader}
                keyExtractor={keyExtractor}
                ListHeaderComponent={listHeader}
                initialNumToRender={initialRenderItemCount}
                maxToRenderPerBatch={maxRenderPerBatch}
                windowSize={9}
                updateCellsBatchingPeriod={16}
                onScroll={scrollHandler}
                ListEmptyComponent={hasEpisodes ? null : (
                    <View className="py-12">
                        <LuffyError
                            title="No files found on server"
                            description="Make sure the files are scanned and updated on the mobile server catalog."
                        />
                    </View>
                )}
                removeClippedSubviews={false}
                stickySectionHeadersEnabled={false}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                contentInsetAdjustmentBehavior="never"
                contentContainerStyle={{ paddingBottom: 180 }}
            />
        </View>
    )
}
