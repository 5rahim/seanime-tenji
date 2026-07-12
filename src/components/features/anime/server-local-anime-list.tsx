import { MediaEntryCard } from "@/components/features/media/media-entry-card"
import { Animations } from "@/components/shared/animations"
import { getServerLocalEpisodeCount, parseServerLocalAnimeEntry, type ServerLocalAnimeRecord, useServerLocalAnimeRecords } from "@/lib/offline"
import { getHorizontalCardRenderCount, getHorizontalMediaCardWidth } from "@/lib/responsive-card-layout"
import { Ionicons } from "@expo/vector-icons"
import { router } from "expo-router"
import React from "react"
import { FlatList, ListRenderItemInfo, Text, useWindowDimensions, View } from "react-native"
import Animated from "react-native-reanimated"

const SPACING = 10
const PADDING_HORIZONTAL = 20

function ServerEpisodeCountOverlay({ count }: { count: number }) {
    return (
        <View className="absolute left-0 top-0 z-10" pointerEvents="none">
            <View className="h-7 flex-row items-center justify-center rounded-br-lg bg-gray-900/80 px-2">
                <Ionicons name="server-outline" size={14} color="rgba(165,180,252,0.95)" />
                <Text className="ml-1 text-xs font-bold text-white">{count}</Text>
            </View>
        </View>
    )
}

export function ServerLocalAnimeList() {
    const records = useServerLocalAnimeRecords()
    const { width: screenWidth } = useWindowDimensions()
    const cardWidth = React.useMemo(() => getHorizontalMediaCardWidth(screenWidth), [screenWidth])
    const itemFullWidth = cardWidth + SPACING
    const initialRenderCount = React.useMemo(() => getHorizontalCardRenderCount({
        viewportWidth: screenWidth,
        cardWidth,
        spacing: SPACING,
        horizontalPadding: PADDING_HORIZONTAL,
    }), [cardWidth, screenWidth])

    const visibleRecords = React.useMemo(
        () => records.filter(record => !!parseServerLocalAnimeEntry(record)?.media),
        [records],
    )

    const keyExtractor = React.useCallback((item: ServerLocalAnimeRecord) => String(item.mediaId), [])
    const getItemLayout = React.useCallback((_: ArrayLike<ServerLocalAnimeRecord> | null | undefined, index: number) => ({
        length: itemFullWidth,
        offset: itemFullWidth * index,
        index,
    }), [itemFullWidth])

    const renderItem = React.useCallback(({ item }: ListRenderItemInfo<ServerLocalAnimeRecord>) => {
        const entry = parseServerLocalAnimeEntry(item)
        if (!entry?.media) return null

        return (
            <MediaEntryCard
                type="anime"
                media={entry.media}
                listData={entry.listData}
                cardWidth={cardWidth}
                hideLibraryBadge
                overlay={<ServerEpisodeCountOverlay count={getServerLocalEpisodeCount(item)} />}
                onPress={() => {
                    router.push({
                        pathname: "/(app)/entry/anime/[id]",
                        params: { id: String(item.mediaId), initialView: "server-local" },
                    })
                }}
            />
        )
    }, [cardWidth])

    if (visibleRecords.length === 0) return null

    return (
        <Animated.View
            className="flex flex-col gap-4"
            entering={Animations.FadeInDown}
            exiting={Animations.FadeOutDown}
        >
            <View className="flex-row items-center justify-between">
                <Text className="p-4 text-xl font-bold text-foreground">
                    On Seanime Server{" "}
                    <Text className="ml-4 text-xl text-muted-foreground">{visibleRecords.length}</Text>
                </Text>
            </View>

            <FlatList
                data={visibleRecords}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                extraData={cardWidth}
                getItemLayout={getItemLayout}
                initialNumToRender={Math.min(visibleRecords.length, initialRenderCount)}
                maxToRenderPerBatch={initialRenderCount}
                windowSize={5}
                removeClippedSubviews
                contentContainerStyle={{ paddingHorizontal: PADDING_HORIZONTAL, gap: SPACING }}
            />
        </Animated.View>
    )
}
