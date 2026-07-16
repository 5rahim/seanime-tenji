import { Anime_Episode, Continuity_WatchHistory } from "@/api/generated/types"
import { getEpisodePercentageComplete } from "@/api/hooks/continuity.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
import { EpisodeCard } from "@/components/features/anime/episode-card"
import { getEpisodeSpoilerState } from "@/lib/anime-spoilers"
import { getEpisodeCardRowHeight, getEpisodeCardWidth, getHorizontalCardRenderCount } from "@/lib/responsive-card-layout"
import React from "react"
import { ActivityIndicator, FlatList, ListRenderItemInfo, Text, useWindowDimensions, View } from "react-native"

const SPACING = 20
const CONTENT_CONTAINER_STYLE = { paddingHorizontal: SPACING }
const ITEM_SEPARATOR_STYLE = { width: SPACING }

type EpisodeCardListProps = {
    title?: string
    episodes: Anime_Episode[]
    onEpisodePress?: (episode: Anime_Episode) => void
    mediaId?: number
    watchHistory?: Continuity_WatchHistory
    watchedProgress?: number
    spoilerActive?: boolean
    blurAdultContent?: boolean
    disabled?: boolean
    loadingEpisodeNumber?: number | null
    showAnimeTitle?: boolean
}

function EpisodeLoadingBadge() {
    return (
        <View className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/70">
            <ActivityIndicator size="small" color="rgba(255,255,255,0.92)" />
        </View>
    )
}

function EpisodeCardSeparator() {
    return <View style={ITEM_SEPARATOR_STYLE} />
}

export function EpisodeCardList(props: EpisodeCardListProps) {
    const {
        title,
        episodes,
        onEpisodePress,
        mediaId,
        watchHistory,
        watchedProgress,
        spoilerActive,
        blurAdultContent,
        disabled,
        loadingEpisodeNumber,
        showAnimeTitle,
    } = props
    const serverStatus = useServerStatus()
    const { width: screenWidth } = useWindowDimensions()
    const cardWidth = React.useMemo(() => getEpisodeCardWidth(screenWidth), [screenWidth])
    const cardRowHeight = React.useMemo(() => getEpisodeCardRowHeight(cardWidth), [cardWidth])
    const itemFullWidth = cardWidth + SPACING
    const renderCount = React.useMemo(() => getHorizontalCardRenderCount({
        viewportWidth: screenWidth,
        cardWidth,
        spacing: SPACING,
        horizontalPadding: SPACING,
    }), [cardWidth, screenWidth])

    const keyExtractor = React.useCallback((item: Anime_Episode, index: number) => {
        return item.localFile?.path || `${item.baseAnime?.id ?? "episode"}-${item.episodeNumber}-${index}`
    }, [])

    const renderEpisodeCard = React.useCallback(({ item }: ListRenderItemInfo<Anime_Episode>) => {
        const spoiler = getEpisodeSpoilerState(serverStatus, {
            episodeNumber: item.progressNumber || item.episodeNumber,
            watchedProgress,
            spoilerActive,
        })
        const image = item.episodeMetadata?.image || item.baseAnime?.bannerImage || item.baseAnime?.coverImage?.large || ""
        const isLoading = loadingEpisodeNumber === item.episodeNumber
        const animeTitle = showAnimeTitle
            ? (item.baseAnime?.title?.userPreferred || item.baseAnime?.title?.english || item.baseAnime?.title?.romaji || undefined)
            : undefined

        return (
            <EpisodeCard
                cardWidth={cardWidth}
                image={image}
                imageBlurred={spoiler.hideThumbnail || blurAdultContent}
                title={spoiler.hideTitle ? `Episode ${item.episodeNumber}` : item.episodeTitle}
                episodeNumber={item.episodeNumber}
                totalEpisodes={item.baseAnime?.episodes}
                length={item.episodeMetadata?.length}
                progressPercent={(item.baseAnime?.id ?? mediaId)
                    ? getEpisodePercentageComplete(watchHistory, item.baseAnime?.id ?? mediaId ?? 0, item.progressNumber)
                    : 0}
                onPress={() => {
                    onEpisodePress?.(item)
                }}
                disabled={disabled}
                thumbnailOverlay={isLoading ? <EpisodeLoadingBadge /> : undefined}
                animeTitle={animeTitle}
            />
        )
    }, [blurAdultContent, cardWidth, disabled, loadingEpisodeNumber, mediaId, onEpisodePress, serverStatus, spoilerActive, watchedProgress, watchHistory, showAnimeTitle])

    const getItemLayout = React.useCallback((_: ArrayLike<Anime_Episode> | null | undefined, index: number) => ({
        length: itemFullWidth,
        offset: itemFullWidth * index,
        index,
    }), [itemFullWidth])

    return (
        <View>
            {!!title && <View className="p-4">
                <Text className="text-2xl font-bold text-foreground">{title}</Text>
            </View>}
            <View style={{ height: cardRowHeight }}>
                <FlatList
                    data={episodes}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyExtractor={keyExtractor}
                    renderItem={renderEpisodeCard}
                    extraData={cardWidth}
                    contentContainerStyle={CONTENT_CONTAINER_STYLE}
                    ItemSeparatorComponent={EpisodeCardSeparator}
                    getItemLayout={getItemLayout}
                    initialNumToRender={Math.min(episodes.length, renderCount)}
                    maxToRenderPerBatch={renderCount}
                    windowSize={5}
                    removeClippedSubviews
                    snapToInterval={itemFullWidth}
                    snapToAlignment="start"
                    decelerationRate="fast"
                    directionalLockEnabled
                    disableIntervalMomentum
                />
            </View>
        </View>
    )
}
