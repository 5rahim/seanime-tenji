import { Anime_Entry, Manga_Entry } from "@/api/generated/types"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import * as React from "react"
import { RefreshControlProps, StyleProp, View, ViewStyle } from "react-native"
import Animated, { SharedValue, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated"
import { MediaEntryHeaderBackground, MediaEntryHeaderContent } from "./media-entry-header"

type MediaEntryScrollShellProps = {
    entry: Anime_Entry | Manga_Entry
    type: "anime" | "manga"
    children: React.ReactNode
    refreshControl?: React.ReactElement<RefreshControlProps>
    contentContainerStyle?: StyleProp<ViewStyle>
    scrollY?: SharedValue<number>
    showHeaderBackground?: boolean
    onTitlePress?: () => void
}

export function MediaEntryScrollShell({
    entry,
    type,
    children,
    refreshControl,
    contentContainerStyle,
    scrollY: sharedScrollY,
    showHeaderBackground = true,
    onTitlePress,
}: MediaEntryScrollShellProps) {
    const localScrollY = useSharedValue(0)
    const scrollY = sharedScrollY ?? localScrollY

    useIOSScrollRefreshRateWorkaround(true)

    const onScroll = useAnimatedScrollHandler({
        onScroll: event => {
            scrollY.value = event.contentOffset.y
        },
    })

    return (
        <View className={showHeaderBackground ? "flex-1 bg-background" : "flex-1 bg-transparent"}>

            {showHeaderBackground ? <MediaEntryHeaderBackground entry={entry} scrollY={scrollY} /> : null}

            <Animated.ScrollView
                contentInsetAdjustmentBehavior="never"
                refreshControl={refreshControl}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={onScroll}
                contentContainerStyle={[{ paddingBottom: 110 }, contentContainerStyle]}
            >
                <MediaEntryHeaderContent entry={entry} type={type} onTitlePress={onTitlePress} />
                <View style={{ width: "100%", alignSelf: "stretch" }}>
                    {children}
                </View>
            </Animated.ScrollView>
        </View>
    )
}
