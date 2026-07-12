import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { __media_listPageContentAtom } from "@/atoms/media-list"
import { MediaEntryCard } from "@/components/features/media/media-entry-card"
import { SafeView } from "@/components/layout/layout-view"
import { Button } from "@/components/ui/button"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { Ionicons } from "@/lib/icons/Ionicons"
import { buildMediaEntryHref, getMediaEntryKind } from "@/lib/media-entry-route"
import { getMediaGridLayout } from "@/lib/responsive-card-layout"
import { FlashList } from "@shopify/flash-list"
import { router } from "expo-router"
import { useAtom } from "jotai/react"
import React from "react"
import { Text, useWindowDimensions, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const SPACING = 10
const PADDING_HORIZONTAL = 8


export default function MediaList() {
    const canGoBack = router.canGoBack()
    const { width: screenWidth } = useWindowDimensions()
    const insets = useSafeAreaInsets()
    const usableWidth = Math.max(1, screenWidth - insets.left - insets.right)
    const { cardWidth, numColumns } = React.useMemo(
        () => getMediaGridLayout({
            screenWidth: usableWidth,
            horizontalPadding: PADDING_HORIZONTAL,
            spacing: SPACING,
        }),
        [usableWidth],
    )

    useIOSScrollRefreshRateWorkaround()

    const [mediaListPageContent] = useAtom(__media_listPageContentAtom)

    if (!mediaListPageContent) return null

    const keyExtractor = React.useCallback((item: AL_BaseAnime | AL_BaseManga, index: number) => `${item.id}-${index}`, [])

    const renderItem = React.useCallback(({ item, index }: { item: AL_BaseAnime | AL_BaseManga, index: number }) => {
        const itemType = getMediaEntryKind(item, mediaListPageContent.type)

        if (itemType === "manga") {
            return <MediaEntryCard
                type="manga"
                cardWidth={cardWidth}
                media={item as AL_BaseManga}
                onPress={() => router.push(buildMediaEntryHref(item, mediaListPageContent.type))}
            />
        }

        return <MediaEntryCard
            type="anime"
            cardWidth={cardWidth}
            media={item as AL_BaseAnime}
            onPress={() => router.push(buildMediaEntryHref(item, mediaListPageContent.type))}
        />
    }, [cardWidth, mediaListPageContent.type])

    return (
        <SafeView>
            <View className="flex flex-row gap-0 items-center px-4">
                {canGoBack && <Button
                    variant="secondary" size="icon" className="rounded-full"
                    onPress={() => router.back()}
                >
                    <Ionicons name="arrow-back" size={18} colorClassName="accent-foreground" />
                </Button>}
                <Text className="text-xl font-bold text-foreground p-4">
                    <Text>{mediaListPageContent?.title}</Text>
                    <Text className="text-xl text-muted-foreground">&nbsp;&nbsp;{mediaListPageContent?.media.length}</Text>
                </Text>
            </View>
            <View
                className="flex-1"
            >
                <FlashList
                    key={`media-list-${numColumns}`}
                    data={mediaListPageContent?.media}
                    numColumns={numColumns}
                    showsVerticalScrollIndicator={false}
                    keyExtractor={keyExtractor}
                    renderItem={renderItem}
                    drawDistance={320}
                    contentContainerStyle={{ paddingHorizontal: PADDING_HORIZONTAL, paddingBottom: 50 }}
                    ItemSeparatorComponent={() => <View style={{ height: SPACING }} />}
                    decelerationRate="normal"
                />
            </View>
        </SafeView>
    )

}
