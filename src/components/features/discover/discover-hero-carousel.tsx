import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { useServerStatus } from "@/atoms/server.atoms"
import { MediaEntryAudienceScore } from "@/components/features/media/media-entry-score"
import { SeaImage } from "@/components/shared/sea-image"
import { COLORS } from "@/constants/colors"
import { LinearGradient } from "expo-linear-gradient"
import { router } from "expo-router"
import React from "react"
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, type ScrollViewInstance, Text, useWindowDimensions, View } from "react-native"
import { runAfterInteractions } from "@/lib/run-after-interactions"
import Animated, {
    Extrapolation,
    interpolate,
    SharedValue,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

export const HERO_HEIGHT = 320
const AUTO_ROTATE_INTERVAL = 10000
const MAX_ITEMS = 12
const HERO_BACKGROUND = COLORS.background
const HERO_BACKDROP = COLORS.mediaHeaderBackdrop
const HERO_GRADIENT_TRANSPARENT = "rgba(17,17,17,0)"
const HERO_GRADIENT_SOFT = "rgba(17,17,17,0.4)"
const HERO_GRADIENT_MEDIUM = "rgba(17,17,17,0.55)"
const HERO_GRADIENT_HEAVY = "rgba(17,17,17,0.9)"
const ABSOLUTE_FILL_STYLE = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const
const HERO_BACKGROUND_STYLE = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HERO_HEIGHT,
    overflow: "hidden",
    backgroundColor: HERO_BACKGROUND,
} as const
const HERO_VISUAL_LAYER_STYLE = { ...ABSOLUTE_FILL_STYLE, backgroundColor: HERO_BACKDROP } as const
const HERO_TOP_GRADIENT_COLORS = ["rgba(0,0,0,0.72)", "rgba(0,0,0,0.22)", "transparent"] as const
const HERO_TOP_GRADIENT_LOCATIONS = [0, 0.4, 1] as const
const HERO_BOTTOM_GRADIENT_COLORS = [HERO_GRADIENT_TRANSPARENT, HERO_GRADIENT_SOFT, HERO_GRADIENT_HEAVY, HERO_BACKGROUND] as const
const HERO_BOTTOM_GRADIENT_LOCATIONS = [0, 0.32, 0.72, 1] as const
const HERO_FOOT_GRADIENT_COLORS = [HERO_GRADIENT_TRANSPARENT, HERO_GRADIENT_MEDIUM, HERO_BACKGROUND] as const
const HERO_FOOT_GRADIENT_LOCATIONS = [0, 0.45, 1] as const
const HERO_BACKDROP_OVERLAY_STYLE = { ...ABSOLUTE_FILL_STYLE, backgroundColor: "rgba(0,0,0,0.16)" } as const
const HERO_IMAGE_MOUNT_DELAY_MS = 160
const HERO_BACKDROP_IMAGE_WINDOW = 3

type DiscoverHeroItem = AL_BaseAnime | AL_BaseManga

export type DiscoverHeroCarouselController = {
    currentIndex: number
    screenWidth: number
    scrollRef: React.RefObject<ScrollViewInstance | null>
    scrollX: SharedValue<number>
    handleDotPress: (index: number) => void
    handleScrollBeginDrag: () => void
    handleScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
}

type DiscoverHeroCarouselBackdropProps = {
    media: DiscoverHeroItem[]
    currentIndex: number
    screenWidth: number
    scrollX: SharedValue<number>
    scrollY?: SharedValue<number>
}

type DiscoverHeroCarouselInteractionLayerProps = {
    media: DiscoverHeroItem[]
    type: "anime" | "manga"
    controller: DiscoverHeroCarouselController
}

export function useDiscoverHeroItems(media: DiscoverHeroItem[]) {
    return React.useMemo(
        () => media.filter(item => !!item.bannerImage).slice(0, MAX_ITEMS),
        [media],
    )
}

export function useDiscoverHeroCarouselController(media: DiscoverHeroItem[], isActive: boolean): DiscoverHeroCarouselController {
    const { width: screenWidth } = useWindowDimensions()
    const [currentIndex, setCurrentIndex] = React.useState(0)
    const scrollRef = React.useRef<ScrollViewInstance | null>(null)
    const scrollX = useSharedValue(0)
    const isInteracting = React.useRef(false)
    const mediaKey = React.useMemo(() => media.map(item => String(item.id)).join(":"), [media])

    const scrollToIndex = React.useCallback(
        (index: number, animated = true) => {
            if (media.length === 0) return

            const safeIndex = Math.max(0, Math.min(index, media.length - 1))
            scrollRef.current?.scrollTo({ x: safeIndex * screenWidth, animated })
            if (!animated) {
                scrollX.set(safeIndex * screenWidth)
            }
            setCurrentIndex(safeIndex)
        },
        [media.length, screenWidth, scrollX],
    )

    React.useEffect(() => {
        if (media.length === 0) {
            scrollX.set(0)
            setCurrentIndex(0)
            return
        }

        scrollToIndex(0, false)
    }, [mediaKey, media.length, scrollToIndex, scrollX])

    React.useEffect(() => {
        if (!isActive || media.length <= 1) return

        const interval = setInterval(() => {
            if (isInteracting.current) return

            scrollToIndex((currentIndex + 1) % media.length)
        }, AUTO_ROTATE_INTERVAL)

        return () => clearInterval(interval)
    }, [currentIndex, isActive, media.length, scrollToIndex])

    React.useEffect(() => {
        if (isActive) return

        isInteracting.current = false
    }, [isActive])

    const handleDotPress = React.useCallback((index: number) => {
        if (index === currentIndex) return

        scrollToIndex(index)
    }, [currentIndex, scrollToIndex])

    const handleScrollBeginDrag = React.useCallback(() => {
        isInteracting.current = true
    }, [])

    const handleScrollEnd = React.useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (media.length === 0) return

            const offsetX = event.nativeEvent.contentOffset.x
            const nextIndex = Math.round(offsetX / screenWidth)

            scrollX.set(offsetX)
            setCurrentIndex(Math.max(0, Math.min(nextIndex, media.length - 1)))
            isInteracting.current = false
        },
        [media.length, screenWidth, scrollX],
    )

    return {
        currentIndex,
        screenWidth,
        scrollRef,
        scrollX,
        handleDotPress,
        handleScrollBeginDrag,
        handleScrollEnd,
    }
}

export function DiscoverHeroCarouselBackdrop({ media, currentIndex, screenWidth, scrollX, scrollY: _scrollY }: DiscoverHeroCarouselBackdropProps) {
    const insets = useSafeAreaInsets()
    const localScrollY = useSharedValue(0)
    const scrollY = _scrollY ?? localScrollY
    const [shouldRenderHeroImages, setShouldRenderHeroImages] = React.useState(false)
    const mediaKey = React.useMemo(() => media.map(item => String(item.id)).join(":"), [media])

    React.useEffect(() => {
        if (media.length === 0) {
            setShouldRenderHeroImages(false)
            return
        }

        setShouldRenderHeroImages(false)

        let timeoutId: ReturnType<typeof setTimeout> | undefined
        const task = runAfterInteractions(() => {
            timeoutId = setTimeout(() => {
                setShouldRenderHeroImages(true)
            }, HERO_IMAGE_MOUNT_DELAY_MS)
        })

        return () => {
            task.cancel()
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
        }
    }, [media.length, mediaKey])

    const heroBackgroundStyle = useAnimatedStyle(() => {
        const y = scrollY.value
        const scale = y < 0 ? 1 + Math.abs(y) / (HERO_HEIGHT * 2) : 1

        const offset = Math.min(Math.max(y, 0), 180)
        return {
            opacity: interpolate(offset, [0, 180], [1, 0], Extrapolation.CLAMP),
            transform: [{ scale }],
        }
    })

    if (media.length === 0) return null

    return (
        <View
            pointerEvents="none"
            style={HERO_BACKGROUND_STYLE}
        >
            <Animated.View
                style={[
                    HERO_VISUAL_LAYER_STYLE,
                    heroBackgroundStyle,
                ]}
            >
                {shouldRenderHeroImages ? (
                    <View style={ABSOLUTE_FILL_STYLE}>
                        {media.map((item, index) => {
                            if (Math.abs(index - currentIndex) > HERO_BACKDROP_IMAGE_WINDOW) {
                                return null
                            }

                            return (
                                <DiscoverHeroBackdropImage
                                    key={item.id}
                                    index={index}
                                    item={item}
                                    scrollX={scrollX}
                                    screenWidth={screenWidth}
                                    isActive={index === currentIndex}
                                />
                            )
                        })}
                    </View>
                ) : null}

                <View
                    pointerEvents="none"
                    style={HERO_BACKDROP_OVERLAY_STYLE}
                />

                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: insets.top + 92,
                    }}
                >
                    <LinearGradient
                        colors={HERO_TOP_GRADIENT_COLORS}
                        locations={HERO_TOP_GRADIENT_LOCATIONS}
                        style={{ flex: 1 }}
                    />
                </View>
            </Animated.View>

            <LinearGradient
                pointerEvents="none"
                colors={HERO_BOTTOM_GRADIENT_COLORS}
                locations={HERO_BOTTOM_GRADIENT_LOCATIONS}
                style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: HERO_HEIGHT * 0.62,
                }}
            />

            <LinearGradient
                pointerEvents="none"
                colors={HERO_FOOT_GRADIENT_COLORS}
                locations={HERO_FOOT_GRADIENT_LOCATIONS}
                style={{
                    position: "absolute",
                    bottom: -1,
                    left: 0,
                    right: 0,
                    height: 72,
                }}
            />
        </View>
    )
}

function DiscoverHeroBackdropImage({
    index,
    item,
    scrollX,
    screenWidth,
    isActive,
}: {
    index: number
    item: DiscoverHeroItem
    scrollX: SharedValue<number>
    screenWidth: number
    isActive: boolean
}) {
    const uri = item.bannerImage || item.coverImage?.extraLarge || ""
    const translationX = useSharedValue(0)

    React.useEffect(() => {
        const PAN_LIMIT = screenWidth * 0.12
        if (isActive) {
            translationX.value = withRepeat(
                withSequence(
                    withTiming(-PAN_LIMIT, { duration: AUTO_ROTATE_INTERVAL }),
                    withTiming(PAN_LIMIT, { duration: AUTO_ROTATE_INTERVAL }),
                ),
                -1,
                true,
            )
        } else {
            translationX.value = withTiming(PAN_LIMIT, { duration: 400 })
        }
    }, [isActive, translationX, screenWidth])

    const animatedStyle = useAnimatedStyle(() => {
        const pageOffset = scrollX.value / Math.max(screenWidth, 1) - index
        const distance = Math.abs(pageOffset)

        const swipeTranslateX = interpolate(pageOffset, [-1, 0, 1], [-18, 0, 18], Extrapolation.CLAMP)
        const totalTranslateX = swipeTranslateX + translationX.value

        return {
            opacity: interpolate(distance, [0, 1], [1, 0], Extrapolation.CLAMP),
            transform: [
                { translateX: totalTranslateX },
                { scale: interpolate(distance, [0, 1], [1.0, 1.05], Extrapolation.CLAMP) },
            ],
        }
    })

    return (
        <Animated.View style={[ABSOLUTE_FILL_STYLE, animatedStyle]}>
            <SeaImage
                source={{ uri }}
                contentFit="cover"
                cachePolicy="disk"
                priority="low"
                allowDownscaling
                transition={0}
                style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    width: screenWidth * 1.35,
                    left: -(screenWidth * 0.35) / 2,
                }}
            />
        </Animated.View>
    )
}

export function DiscoverHeroCarouselInteractionLayer({ media, type, controller }: DiscoverHeroCarouselInteractionLayerProps) {
    const serverStatus = useServerStatus()
    const handleHorizontalScroll = useAnimatedScrollHandler({
        onScroll: event => {
            controller.scrollX.value = event.contentOffset.x
        },
    })

    if (media.length === 0) return null

    const current = media[controller.currentIndex]
    const title = current?.title?.userPreferred || current?.title?.english || current?.title?.romaji || ""
    const genres = current?.genres?.slice(0, 3) ?? []
    const score = current?.meanScore
    const hideAudienceScore = serverStatus?.settings?.anilist?.hideAudienceScore ?? false

    return (
        <View style={{ height: HERO_HEIGHT }}>
            <Animated.ScrollView
                ref={controller.scrollRef}
                horizontal
                pagingEnabled
                nestedScrollEnabled
                directionalLockEnabled
                scrollEnabled={media.length > 1}
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={handleHorizontalScroll}
                onScrollBeginDrag={controller.handleScrollBeginDrag}
                onMomentumScrollEnd={controller.handleScrollEnd}
            >
                {media.map((item) => (
                    <Pressable
                        key={item.id}
                        style={{ width: controller.screenWidth, height: HERO_HEIGHT }}
                        onPress={() => {
                            if (type === "anime") {
                                router.push(`/(app)/entry/anime/${item.id}`)
                            } else {
                                router.push(`/(app)/entry/manga/${item.id}`)
                            }
                        }}
                    />
                ))}
            </Animated.ScrollView>

            <View
                pointerEvents="none"
                style={{
                    position: "absolute",
                    bottom: 44,
                    left: 0,
                    right: 0,
                    paddingHorizontal: 20,
                }}
            >
                <Text
                    numberOfLines={2}
                    style={{
                        color: "white",
                        fontSize: 26,
                        fontWeight: "800",
                        lineHeight: 32,
                        marginBottom: 10,
                        textShadowColor: "rgba(0,0,0,0.55)",
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 6,
                    }}
                >
                    {title}
                </Text>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {!!score && !hideAudienceScore && (
                        <View style={{ marginLeft: 2, marginRight: 4 }}>
                            <MediaEntryAudienceScore score={score} />
                        </View>
                    )}
                    {genres.map((genre, idx) => (
                        <React.Fragment key={genre}>
                            {idx > 0 && (
                                <Text style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, fontWeight: "bold" }}> • </Text>
                            )}
                            <Text
                                style={{
                                    color: "rgba(255,255,255,0.55)",
                                    fontSize: 10,
                                    fontWeight: "600",
                                    textTransform: "uppercase",
                                    letterSpacing: 0.5,
                                }}
                            >
                                {genre}
                            </Text>
                        </React.Fragment>
                    ))}
                </View>

            </View>

            {media.length > 1 && (
                <View
                    style={{
                        position: "absolute",
                        bottom: 16,
                        left: 20,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                    }}
                >
                    {media.map((_, idx) => (
                        <Pressable key={idx} onPress={() => controller.handleDotPress(idx)} hitSlop={10}>
                            <View
                                style={{
                                    width: idx === controller.currentIndex ? 22 : 8,
                                    height: 3,
                                    borderRadius: 2,
                                    backgroundColor:
                                        idx === controller.currentIndex
                                            ? "rgba(255,255,255,0.9)"
                                            : "rgba(255,255,255,0.28)",
                                }}
                            />
                        </Pressable>
                    ))}
                </View>
            )}
        </View>
    )
}
