import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { __media_listPageContentAtom } from "@/atoms/media-list"
import { MediaEntryCard } from "@/components/features/media/media-entry-card"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { Ionicons } from "@/lib/icons/Ionicons"
import { buildMediaEntryHref, getMediaEntryKind } from "@/lib/media-entry-route"
import { getHorizontalCardRenderCount, getHorizontalMediaCardRowHeight, getHorizontalMediaCardWidth } from "@/lib/responsive-card-layout"
import { router } from "expo-router"
import { useAtom } from "jotai/react"
import React from "react"
import { FlatList, ListRenderItemInfo, useWindowDimensions, View } from "react-native"

const SPACING = 10
const PADDING_HORIZONTAL = 20

type HorizontalMediaCardListProps<T extends "anime" | "manga"> = {
    title: string
    type: T,
    media: T extends "anime" ? AL_BaseAnime[] : AL_BaseManga[]
    onMediaPress?: (media: T extends "anime" ? AL_BaseAnime : AL_BaseManga) => void
    limit?: number
    sectionIndex?: number
    showAudienceScore?: boolean
    hideCount?: boolean
    hideLibraryBadge?: boolean
}

export function HorizontalMediaCardList<T extends "anime" | "manga">(props: HorizontalMediaCardListProps<T>) {

    const {
        title,
        media,
        type,
        onMediaPress,
        limit = 9,
        showAudienceScore = false,
        hideCount = false,
        hideLibraryBadge = false,
    } = props

    const { width: screenWidth } = useWindowDimensions()
    const [, setMediaListPageContent] = useAtom(__media_listPageContentAtom)
    const cardWidth = React.useMemo(() => getHorizontalMediaCardWidth(screenWidth), [screenWidth])
    const cardRowHeight = React.useMemo(() => getHorizontalMediaCardRowHeight(cardWidth), [cardWidth])
    const itemFullWidth = cardWidth + SPACING
    const initialRenderCount = React.useMemo(() => getHorizontalCardRenderCount({
        viewportWidth: screenWidth,
        cardWidth,
        spacing: SPACING,
        horizontalPadding: PADDING_HORIZONTAL,
    }), [cardWidth, screenWidth])
    const visibleMedia = React.useMemo(
        () => !limit ? media : media.slice(0, limit),
        [limit, media],
    )

    const keyExtractor = React.useCallback((item: AL_BaseAnime | AL_BaseManga, index: number) => `${item.id}-${index}`, [])

    const getItemLayout = React.useCallback((_: ArrayLike<AL_BaseAnime | AL_BaseManga> | null | undefined, index: number) => ({
        length: itemFullWidth,
        offset: itemFullWidth * index,
        index,
    }), [itemFullWidth])

    const renderItem = React.useCallback(({ item, index }: ListRenderItemInfo<AL_BaseAnime | AL_BaseManga>) => {
        if (index === limit - 1) {
            return (
                <View
                    style={{ width: cardWidth, height: cardWidth * 1.5 }}
                    className="rounded-md flex justify-center items-center"
                >
                    <Button
                        variant="secondary" className="text-xl text-muted-foreground p-4"
                        onPress={() => {
                            setMediaListPageContent({
                                title,
                                type,
                                media,
                            })
                            router.push("/(app)/(media)/media-list")
                        }}
                    >
                        <Text className="text-xl">
                            See all ({media.length})
                        </Text>
                    </Button>
                </View>
            )
        }

        const itemType = getMediaEntryKind(item, type)

        if (itemType === "manga") {
            return <MediaEntryCard
                key={index}
                type="manga"
                cardWidth={cardWidth}
                media={item as AL_BaseManga}
                showAudienceScore={showAudienceScore}
                onPress={() => {
                    if (onMediaPress) onMediaPress(item as T extends "anime" ? AL_BaseAnime : AL_BaseManga)
                    else router.push(buildMediaEntryHref(item, type))
                }}
                hideLibraryBadge={hideLibraryBadge}
            />
        }

        return <MediaEntryCard
            key={index}
            type="anime"
            cardWidth={cardWidth}
            media={item as AL_BaseAnime}
            showAudienceScore={showAudienceScore}
            onPress={() => {
                if (onMediaPress) onMediaPress(item as T extends "anime" ? AL_BaseAnime : AL_BaseManga)
                else router.push(buildMediaEntryHref(item, type))
            }}
            hideLibraryBadge={hideLibraryBadge}
        />
    }, [cardWidth, limit, media, onMediaPress, setMediaListPageContent, showAudienceScore, title, type, hideLibraryBadge])

    if (media.length === 0) return null

    return (
        <View
            className="flex-col gap-4"
        >

            <View className="flex-row w-full justify-between items-center">
                <Text className="text-xl font-bold text-foreground p-4">
                    {title} {!hideCount && <Text className="text-xl text-muted-foreground ml-4">{media.length}</Text>}
                </Text>

                {(media.length > limit) && <Button
                    variant="link" size="icon" className="text-lg text-muted-foreground"
                    onPress={() => {
                        setMediaListPageContent({
                            title,
                            type,
                            media,
                        })
                        router.push("/(app)/(media)/media-list")
                    }}
                >
                    <Ionicons name="arrow-forward" size={18} colorClassName="accent-foreground" />
                </Button>}
            </View>

            <View className="w-full" style={{ height: cardRowHeight }}>
                <FlatList
                    data={visibleMedia as (AL_BaseAnime | AL_BaseManga)[]}
                    horizontal
                    style={{ height: cardRowHeight, width: "100%" }}
                    showsHorizontalScrollIndicator={false}
                    keyExtractor={keyExtractor}
                    renderItem={renderItem}
                    extraData={cardWidth}
                    getItemLayout={getItemLayout}
                    initialNumToRender={Math.min(visibleMedia.length, initialRenderCount)}
                    maxToRenderPerBatch={initialRenderCount}
                    windowSize={5}
                    removeClippedSubviews
                    contentContainerStyle={{ gap: SPACING, paddingHorizontal: PADDING_HORIZONTAL }}
                    decelerationRate="normal"
                />
            </View>
        </View>
    )
}
