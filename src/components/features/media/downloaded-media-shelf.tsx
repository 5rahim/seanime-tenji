import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { MediaEntryCard } from "@/components/features/media/media-entry-card"
import { Animations } from "@/components/shared/animations"
import { getHorizontalCardRenderCount, getHorizontalMediaCardWidth } from "@/lib/responsive-card-layout"
import { Ionicons } from "@expo/vector-icons"
import { router } from "expo-router"
import React from "react"
import { FlatList, ListRenderItemInfo, Text, useWindowDimensions, View } from "react-native"
import Animated from "react-native-reanimated"

const SPACING = 10
const PADDING_HORIZONTAL = 20

type DownloadedMediaShelfItem = {
    mediaId: number
    title: string
    coverImageUrl?: string
    downloadedCount: number
}

type DownloadedMediaShelfProps<T extends "anime" | "manga"> = {
    type: T
    items: Array<DownloadedMediaShelfItem>
}

function fromDownloadedAnimeMedia(item: DownloadedMediaShelfItem): AL_BaseAnime {
    return {
        id: item.mediaId,
        type: "ANIME",
        title: {
            userPreferred: item.title,
        },
        coverImage: {
            extraLarge: item.coverImageUrl,
            large: item.coverImageUrl,
            medium: item.coverImageUrl,
        },
    }
}

function fromDownloadedMangaMedia(item: DownloadedMediaShelfItem): AL_BaseManga {
    return {
        id: item.mediaId,
        type: "MANGA",
        title: {
            userPreferred: item.title,
        },
        coverImage: {
            extraLarge: item.coverImageUrl,
            large: item.coverImageUrl,
            medium: item.coverImageUrl,
        },
    }
}

function DownloadCountOverlay({ count }: { count: number }) {
    return (
        <View style={{ position: "absolute", top: 0, left: 0, zIndex: 10 }} pointerEvents="none">
            <View className="h-7 rounded-br-lg bg-gray-900/80 px-2 flex-row items-center justify-center">
                <Ionicons name="arrow-down-circle" size={14} color="rgba(120,200,120,0.9)" />
                <Text className="ml-1 text-xs font-bold text-white">{count}</Text>
            </View>
        </View>
    )
}

export function DownloadedMediaShelf<T extends "anime" | "manga">({ type, items }: DownloadedMediaShelfProps<T>) {
    const { width: screenWidth } = useWindowDimensions()
    const cardWidth = React.useMemo(() => getHorizontalMediaCardWidth(screenWidth), [screenWidth])
    const itemFullWidth = cardWidth + SPACING
    const initialRenderCount = React.useMemo(() => getHorizontalCardRenderCount({
        viewportWidth: screenWidth,
        cardWidth,
        spacing: SPACING,
        horizontalPadding: PADDING_HORIZONTAL,
    }), [cardWidth, screenWidth])

    if (items.length === 0) return null

    const keyExtractor = React.useCallback((item: DownloadedMediaShelfItem) => String(item.mediaId), [])

    const getItemLayout = React.useCallback((_: ArrayLike<DownloadedMediaShelfItem> | null | undefined, index: number) => ({
        length: itemFullWidth,
        offset: itemFullWidth * index,
        index,
    }), [itemFullWidth])

    const renderItem = React.useCallback(({ item }: ListRenderItemInfo<DownloadedMediaShelfItem>) => {
        const media = type === "anime"
            ? fromDownloadedAnimeMedia(item)
            : fromDownloadedMangaMedia(item)

        return (
            <MediaEntryCard
                type={type}
                media={media}
                cardWidth={cardWidth}
                hideProgress
                overlay={<DownloadCountOverlay count={item.downloadedCount} />}
                onPress={() => {
                    router.push({
                        pathname: type === "anime" ? "/(app)/entry/anime/[id]" : "/(app)/entry/manga/[id]",
                        params: { id: String(item.mediaId), initialView: "downloaded" },
                    })
                }}
            />
        )
    }, [cardWidth, type])

    return (
        <Animated.View
            className="flex flex-col gap-4"
            entering={Animations.FadeInDown}
            exiting={Animations.FadeOutDown}
        >
            <View className="flex flex-row items-center justify-between w-full">
                <Text className="p-4 text-xl font-bold text-foreground">
                    Downloads{" "}
                    <Text className="ml-4 text-xl text-muted-foreground">{items.length}</Text>
                </Text>
            </View>

            <FlatList
                data={items}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                extraData={cardWidth}
                getItemLayout={getItemLayout}
                initialNumToRender={Math.min(items.length, initialRenderCount)}
                maxToRenderPerBatch={initialRenderCount}
                windowSize={5}
                removeClippedSubviews
                contentContainerStyle={{ paddingHorizontal: PADDING_HORIZONTAL, gap: SPACING }}
            />
        </Animated.View>
    )
}
