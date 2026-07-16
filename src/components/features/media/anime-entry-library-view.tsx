import { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
import { EpisodeCardList } from "@/components/features/anime/episode-card-list"
import { EpisodeListItem } from "@/components/features/anime/episode-list-item"
import { AnimeEntryActionBar } from "@/components/features/media/anime-entry-action-bar"
import { MediaEntryHeaderBackground, MediaEntryHeaderContent } from "@/components/features/media/media-entry-header"
import { EPISODE_PAGE_SIZE, EpisodePageSelector } from "@/components/shared/episode-page-selector"
import { LuffyError } from "@/components/shared/luffy-error"
import { OfflineBanner } from "@/components/shared/offline-banner"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { getSequentialContinueWatchingSpoilerActive } from "@/lib/anime-spoilers"
import * as React from "react"
import { ActivityIndicator, RefreshControlProps, SectionList, Text, useWindowDimensions, View } from "react-native"
import Animated, { SharedValue, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated"

// reanimated drops the SectionList constructor type on rn 0.83
const AnimatedSectionList = Animated.createAnimatedComponent(SectionList) as unknown as typeof SectionList

type AnimeEntryLibraryViewProps = {
    entry: Anime_Entry
    mediaId?: number
    entryProgress: number
    mainEpisodes: Anime_Episode[]
    specialEpisodes: Anime_Episode[]
    ncEpisodes: Anime_Episode[]
    unwatchedMainEpisodes: Anime_Episode[]
    onEpisodePress?: (episode: Anime_Episode) => void
    refreshControl?: React.ReactElement<RefreshControlProps>
    isConnected: boolean
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

export function AnimeEntryLibraryView({
    entry,
    mediaId,
    entryProgress,
    mainEpisodes,
    specialEpisodes,
    ncEpisodes,
    unwatchedMainEpisodes,
    onEpisodePress,
    refreshControl,
    isConnected,
    showDeferredContent = true,
    scrollY: sharedScrollY,
    showHeaderBackground = true,
    onTitlePress,
}: AnimeEntryLibraryViewProps) {
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

    // sectionKey -> 0-based page index
    const [sectionPages, setSectionPages] = React.useState<Record<string, number>>({})

    // Reset pages (and jump main episodes to first-unwatched page) when the entry changes
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
                    logName={`library ${section.title}`}
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

                {isConnected && (
                    <AnimeEntryActionBar
                        entry={entry}
                        nextEpisode={unwatchedMainEpisodes[0]}
                        onContinueWatching={unwatchedMainEpisodes[0] ? () => onEpisodePress?.(unwatchedMainEpisodes[0]) : undefined}
                    />
                )}

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
        [continueWatchingSpoilerActive, entry, entryProgress, isConnected, mediaId, onEpisodePress, unwatchedMainEpisodes, watchHistory,
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
                    <View className="">
                        <LuffyError
                            title="No local files scanned"
                            description=""
                        />
                    </View>
                )}
                refreshControl={refreshControl}
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

type AnimeEpisodeSectionProps = {
    title: string
    episodes: Anime_Episode[]
    progress: number
    mediaId?: number
    onEpisodePress?: (episode: Anime_Episode) => void
    entry: Anime_Entry
    initialActiveEpisodeNumber?: number
    disableEpisodePresses?: boolean
    loadingEpisodeNumber?: number | null
}

export function AnimeEpisodeSection({
    title,
    episodes,
    progress,
    mediaId,
    onEpisodePress,
    entry,
    initialActiveEpisodeNumber,
    disableEpisodePresses,
    loadingEpisodeNumber,
}: AnimeEpisodeSectionProps) {
    const { width: windowWidth } = useWindowDimensions()
    const thumbnailWidth = React.useMemo(() => Math.min(Math.max(windowWidth * 0.4, 128), 160), [windowWidth])

    const [currentPage, setCurrentPage] = React.useState(() => {
        if (!initialActiveEpisodeNumber || episodes.length === 0) return 0
        const idx = episodes.findIndex(ep => ep.episodeNumber === initialActiveEpisodeNumber)
        return idx >= 0 ? Math.floor(idx / EPISODE_PAGE_SIZE) : 0
    })

    const initialPageRef = React.useRef(episodes.length > 0)
    React.useEffect(() => {
        if (!initialPageRef.current && initialActiveEpisodeNumber && episodes.length > 0) {
            initialPageRef.current = true
            const idx = episodes.findIndex(ep => ep.episodeNumber === initialActiveEpisodeNumber)
            if (idx >= 0) setCurrentPage(Math.floor(idx / EPISODE_PAGE_SIZE))
        }
    }, [episodes, initialActiveEpisodeNumber])

    const pagedEpisodes = React.useMemo(() => {
        const start = currentPage * EPISODE_PAGE_SIZE
        return episodes.slice(start, start + EPISODE_PAGE_SIZE)
    }, [episodes, currentPage])

    return (
        <View>
            <Text className="text-xl font-bold text-foreground mb-3">{title}</Text>
            {episodes.length > EPISODE_PAGE_SIZE && (
                <View className="mb-3 -mx-4">
                    <EpisodePageSelector
                        totalCount={episodes.length}
                        currentPage={currentPage}
                        onPageChange={setCurrentPage}
                        logName={title}
                    />
                </View>
            )}
            <View>
                {pagedEpisodes.map((episode, index) => (
                    <EpisodeListItem
                        key={episode.localFile?.path || `${episode.type}-${episode.episodeNumber}-${index}`}
                        episode={episode}
                        mediaId={mediaId}
                        fallbackImage={entry?.media?.bannerImage}
                        isWatched={episode.progressNumber <= progress && (episode.localFile?.metadata?.type === "main" || !episode.localFile)}
                        onEpisodePress={disableEpisodePresses ? undefined : onEpisodePress}
                        thumbnailWidth={thumbnailWidth}
                        isFirst={index === 0}
                        isLast={index === pagedEpisodes.length - 1}
                        watchedProgress={progress}
                        thumbnailOverlay={loadingEpisodeNumber === episode.episodeNumber ? <EpisodeLoadingBadge /> : undefined}
                    />
                ))}
            </View>
        </View>
    )
}
