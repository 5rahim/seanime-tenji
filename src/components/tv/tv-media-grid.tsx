import type { AL_BaseAnime } from "@/api/generated/types"
import { TVMediaCard } from "@/components/tv/tv-media-card"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { router } from "expo-router"
import * as React from "react"
import { FlatList, Text, useWindowDimensions, View } from "react-native"

type Props = {
    media: AL_BaseAnime[]
    query?: string
    loadingMore?: boolean
    onEndReached?: () => void
    onMediaPress?: (media: AL_BaseAnime) => void
    showAudienceScore?: boolean
    emptyTitle?: string
    emptyText?: string
    emptyComponent?: React.ReactElement
    header?: React.ReactElement
    topInset?: number
}

export function TVMediaGrid({
    media,
    query,
    loadingMore,
    onEndReached,
    onMediaPress,
    showAudienceScore,
    emptyTitle,
    emptyText,
    emptyComponent,
    header,
    topInset,
}: Props) {
    const { width } = useWindowDimensions()
    const gap = tvSize(22)
    const gridTop = topInset ?? tvSize(28)
    const columns = Math.max(4, Math.floor((width - (TV.gutter * 2)) / tvSize(190)))
    const cardWidth = Math.floor((width - (TV.gutter * 2) - ((columns - 1) * gap)) / columns)

    const open = React.useCallback((item: AL_BaseAnime) => {
        if (onMediaPress) {
            onMediaPress(item)
            return
        }
        router.push(`/(app)/entry/anime/${item.id}`)
    }, [onMediaPress])

    const renderItem = React.useCallback(({ item, index }: { item: AL_BaseAnime; index: number }) => (
        <TVMediaCard
            media={item}
            width={cardWidth}
            preferred={index === 0}
            showAudienceScore={showAudienceScore}
            onPress={() => open(item)}
        />
    ), [cardWidth, open, showAudienceScore])

    return (
        <FlatList
            key={`tv-media-grid-${columns}`}
            data={media}
            fadingEdgeLength={{
                start: header ? TV.navInset + tvSize(18) : gridTop + tvSize(18),
                end: 0,
            }}
            renderItem={renderItem}
            keyExtractor={item => String(item.id)}
            numColumns={columns}
            columnWrapperStyle={{
                gap,
                justifyContent: "center",
                paddingHorizontal: TV.gutter,
            }}
            contentContainerStyle={{
                paddingTop: header ? 0 : gridTop,
                paddingBottom: tvSize(90),
                gap: tvSize(30),
                flexGrow: 1,
            }}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
            initialNumToRender={columns * 3}
            maxToRenderPerBatch={columns * 2}
            windowSize={7}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.45}
            ListHeaderComponent={header}
            ListEmptyComponent={emptyComponent ?? (
                <View
                    style={{
                        flex: 1,
                        minHeight: tvSize(320),
                        alignItems: "center",
                        justifyContent: "center",
                        gap: tvSize(8),
                        paddingHorizontal: TV.gutter,
                    }}
                >
                    <Text className="font-bold text-white" style={{ fontSize: tvSize(28) }}>
                        {emptyTitle ?? (query ? `No results for “${query}”` : "Nothing here yet")}
                    </Text>
                    <Text className="text-white/40" style={{ fontSize: tvSize(18) }}>
                        {emptyText ?? "Try another title or change the filters."}
                    </Text>
                </View>
            )}
            ListFooterComponent={loadingMore ? (
                <View style={{ paddingVertical: tvSize(30), alignItems: "center" }}>
                    <Text className="font-medium text-white/40" style={{ fontSize: tvSize(18) }}>
                        Loading more…
                    </Text>
                </View>
            ) : undefined}
        />
    )
}
