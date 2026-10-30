import { Manga_Entry } from "@/api/generated/types"
import { SeaImage } from "@/components/shared/sea-image"
import { COLORS } from "@/constants/colors"
import { ContinueWatchingItem } from "@/hooks/use-anime-library-collection"
import { cn } from "@/lib/utils"
import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"
import { router } from "expo-router"
import * as React from "react"
import { Platform, Pressable, ScrollView, type ScrollViewInstance, Text, useWindowDimensions, View } from "react-native"
import { runAfterInteractions } from "@/lib/run-after-interactions"
import Animated, {
    Extrapolation,
    interpolate,
    runOnJS,
    SharedValue,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated"

const AUTO_ROTATE_INTERVAL = 20000
const MAX_ITEMS = 12
const HERO_BACKGROUND = COLORS.background
const HERO_BACKDROP = COLORS.mediaHeaderBackdrop
const HERO_GRADIENT_TRANSPARENT = "rgba(17,17,17,0)"
const HERO_GRADIENT_SOFT = "rgba(17,17,17,0.4)"
const HERO_GRADIENT_HEAVY = "rgba(17,17,17,0.9)"
const ABSOLUTE_FILL_STYLE = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const

const HERO_VISUAL_LAYER_STYLE = { ...ABSOLUTE_FILL_STYLE, backgroundColor: HERO_BACKDROP } as const
const HERO_TOP_GRADIENT_COLORS = ["rgba(0,0,0,0.85)", "rgba(0,0,0,0.35)", "transparent"] as const
const HERO_TOP_GRADIENT_LOCATIONS = [0, 0.5, 1] as const
const HERO_BOTTOM_GRADIENT_COLORS = [HERO_GRADIENT_TRANSPARENT, HERO_GRADIENT_SOFT, HERO_GRADIENT_HEAVY, HERO_BACKGROUND] as const
const HERO_BOTTOM_GRADIENT_LOCATIONS = [0, 0.32, 0.72, 1] as const
const HERO_BACKDROP_OVERLAY_STYLE = { ...ABSOLUTE_FILL_STYLE, backgroundColor: "rgba(0,0,0,0.2)" } as const
const HERO_IMAGE_MOUNT_DELAY_MS = 160
const HERO_BACKDROP_IMAGE_WINDOW = 3

type UnifiedHeroItem = {
    id: number
    title: string
    bannerImage: string
    coverImage: string
    genres: string[]
    // Anime fields
    episodeNumber?: number
    animeRawItem?: ContinueWatchingItem
    // Manga fields
    progress?: number
    mangaRawItem?: Manga_Entry
}

export type LibraryHeroCarouselProps = {
    type: "anime" | "manga"
    animeItems?: ContinueWatchingItem[]
    mangaItems?: Manga_Entry[]
    isFocused: boolean
    scrollY: SharedValue<number>
    onWatchPress?: (item: ContinueWatchingItem) => void
}

export function LibraryHeroCarousel({
    type,
    animeItems = [],
    mangaItems = [],
    isFocused,
    scrollY,
    onWatchPress,
}: LibraryHeroCarouselProps) {
    const { height: screenHeight, width: screenWidth } = useWindowDimensions()

    const isTablet = Platform.OS === "ios" ? Platform.isPad : Math.min(screenWidth, screenHeight) >= 600
    const isSmallScreen = !isTablet && screenHeight < 750
    const heroHeight = isSmallScreen ? 260 : isTablet ? 380 : 310
    const titleFontSize = isSmallScreen ? 22 : isTablet ? 30 : 26

    const items = React.useMemo<UnifiedHeroItem[]>(() => {
        if (type === "anime") {
            return animeItems
                .filter((item) => !!item.episode.baseAnime?.bannerImage)
                .slice(0, MAX_ITEMS)
                .map((item) => {
                    const media = item.episode.baseAnime
                    return {
                        id: media?.id ?? 0,
                        title: media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || "Unknown Anime",
                        bannerImage: media?.bannerImage ?? "",
                        coverImage: media?.coverImage?.extraLarge ?? "",
                        genres: media?.genres?.slice(0, 3) ?? [],
                        episodeNumber: item.episode.episodeNumber,
                        animeRawItem: item,
                    }
                })
                .filter(item => item.id > 0)
        } else {
            return mangaItems
                .filter((entry) => !!entry.media?.bannerImage)
                .slice(0, MAX_ITEMS)
                .map((entry) => {
                    const media = entry.media
                    return {
                        id: entry.mediaId,
                        title: media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || "Unknown Manga",
                        bannerImage: media?.bannerImage ?? "",
                        coverImage: media?.coverImage?.extraLarge ?? "",
                        genres: media?.genres?.slice(0, 3) ?? [],
                        progress: entry.listData?.progress,
                        mangaRawItem: entry,
                    }
                })
                .filter(item => item.id > 0)
        }
    }, [type, animeItems, mangaItems])

    const [currentIndex, setCurrentIndex] = React.useState(0)
    const scrollRef = React.useRef<ScrollViewInstance | null>(null)
    const scrollX = useSharedValue(0)
    const isInteracting = React.useRef(false)

    const itemsKey = React.useMemo(() => items.map(item => String(item.id)).join(":"), [items])

    const scrollToIndex = React.useCallback(
        (index: number, animated = true) => {
            if (items.length === 0) return
            const safeIndex = Math.max(0, Math.min(index, items.length - 1))
            scrollRef.current?.scrollTo({ x: safeIndex * screenWidth, animated })
            if (!animated) {
                scrollX.set(safeIndex * screenWidth)
            }
            setCurrentIndex(safeIndex)
        },
        [items.length, screenWidth, scrollX],
    )

    React.useEffect(() => {
        if (items.length === 0) {
            scrollX.set(0)
            setCurrentIndex(0)
            return
        }
        scrollToIndex(0, false)
    }, [itemsKey, items.length, scrollToIndex, scrollX])

    React.useEffect(() => {
        if (!isFocused || items.length <= 1) return

        const interval = setInterval(() => {
            if (isInteracting.current) return
            scrollToIndex((currentIndex + 1) % items.length)
        }, AUTO_ROTATE_INTERVAL)

        return () => clearInterval(interval)
    }, [currentIndex, isFocused, items.length, scrollToIndex])

    React.useEffect(() => {
        if (!isFocused) {
            isInteracting.current = false
        }
    }, [isFocused])

    const handleDotPress = React.useCallback(
        (index: number) => {
            if (index === currentIndex) return
            scrollToIndex(index)
        },
        [currentIndex, scrollToIndex],
    )

    const handleScrollBeginDrag = React.useCallback(() => {
        isInteracting.current = true
    }, [])

    const handleScrollEnd = React.useCallback(
        (event: any) => {
            if (items.length === 0) return
            const offsetX = event.nativeEvent?.contentOffset?.x ?? event.contentOffset?.x ?? 0
            const nextIndex = Math.round(offsetX / screenWidth)

            scrollX.set(offsetX)
            const clamped = Math.max(0, Math.min(nextIndex, items.length - 1))
            setCurrentIndex(clamped)
            isInteracting.current = false
        },
        [items.length, screenWidth, scrollX],
    )

    const syncIndex = React.useCallback((nextIndex: number) => {
        setCurrentIndex(nextIndex)
    }, [])

    const handleHorizontalScroll = useAnimatedScrollHandler({
        onScroll: event => {
            scrollX.value = event.contentOffset.x

            const nextIndex = Math.round(event.contentOffset.x / Math.max(screenWidth, 1))
            const clamped = Math.max(0, Math.min(nextIndex, items.length - 1))
            runOnJS(syncIndex)(clamped)
        },
        onBeginDrag: () => {
            runOnJS(handleScrollBeginDrag)()
        },
        onEndDrag: (event: any) => {
            runOnJS(handleScrollEnd)(event)
        },
        onMomentumEnd: (event: any) => {
            runOnJS(handleScrollEnd)(event)
        },
    })

    const handleActionPress = React.useCallback(
        (item: UnifiedHeroItem) => {
            if (type === "anime" && item.animeRawItem && onWatchPress) {
                onWatchPress(item.animeRawItem)
            } else if (type === "manga") {
                router.push(`/(app)/entry/manga/${item.id}`)
            }
        },
        [type, onWatchPress],
    )

    if (items.length === 0) return null

    return (
        <View style={{ height: heroHeight }} className="relative bg-background">
            <LibraryHeroBackdrop
                items={items}
                currentIndex={currentIndex}
                screenWidth={screenWidth}
                scrollX={scrollX}
                scrollY={scrollY}
                heroHeight={heroHeight}
            />

            <Animated.ScrollView
                ref={scrollRef}
                horizontal
                pagingEnabled
                nestedScrollEnabled
                directionalLockEnabled
                scrollEnabled={items.length > 1}
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={handleHorizontalScroll}
                onScrollBeginDrag={handleHorizontalScroll}
                onScrollEndDrag={handleHorizontalScroll}
                onMomentumScrollEnd={handleHorizontalScroll}
                style={ABSOLUTE_FILL_STYLE}
            >
                {items.map((item, idx) => (
                    <LibraryHeroSlide
                        key={`${item.id}-${idx}`}
                        item={item}
                        index={idx}
                        scrollX={scrollX}
                        screenWidth={screenWidth}
                        type={type}
                        onActionPress={handleActionPress}
                        heroHeight={heroHeight}
                        titleFontSize={titleFontSize}
                    />
                ))}
            </Animated.ScrollView>

            {items.length > 1 && (
                <View
                    className="absolute bottom-6 left-5 flex-row items-center gap-1.5"
                    pointerEvents="none"
                >
                    {items.map((_, idx) => (
                        <Pressable key={idx} onPress={() => handleDotPress(idx)} hitSlop={10} pointerEvents="auto">
                            <View
                                className={cn(
                                    "height-1 rounded-full transition-all duration-300",
                                    idx === currentIndex ? "w-6 bg-white" : "w-2 bg-white/35",
                                )}
                                style={{ height: 3.5 }}
                            />
                        </Pressable>
                    ))}
                </View>
            )}
        </View>
    )
}

function LibraryHeroSlide({
    item,
    index,
    scrollX,
    screenWidth,
    type,
    onActionPress,
    heroHeight,
    titleFontSize,
}: {
    item: UnifiedHeroItem
    index: number
    scrollX: SharedValue<number>
    screenWidth: number
    type: "anime" | "manga"
    onActionPress: (item: UnifiedHeroItem) => void
    heroHeight: number
    titleFontSize: number
}) {
    const buttonLabel = type === "anime"
        ? `Watch Episode ${item.episodeNumber}`
        : item.progress && item.progress > 0
            ? `Read Ch. ${item.progress + 1}`
            : "Start Reading"

    const iconName = type === "anime" ? "play" : "book"

    const animatedContentStyle = useAnimatedStyle(() => {
        const pageOffset = scrollX.value / Math.max(screenWidth, 1) - index
        const distance = Math.abs(pageOffset)

        return {
            opacity: interpolate(distance, [0, 0.6], [1, 0], Extrapolation.CLAMP),
            transform: [
                {
                    translateX: interpolate(
                        pageOffset,
                        [-1, 0, 1],
                        [50, 0, -50],
                        Extrapolation.CLAMP,
                    ),
                },
            ],
        }
    })

    return (
        <View
            style={{ width: screenWidth, height: heroHeight }}
            className="relative flex justify-end"
        >
            <Pressable
                style={ABSOLUTE_FILL_STYLE}
                onPress={() => {
                    router.push(`/(app)/entry/${type}/${item.id}`)
                }}
            />

            <Animated.View
                pointerEvents="box-none"
                style={animatedContentStyle}
                className="px-5 pb-16 flex flex-col gap-2.5 justify-end"
            >
                <Pressable
                    onPress={() => {
                        router.push(`/(app)/entry/${type}/${item.id}`)
                    }}
                >
                    <Text
                        numberOfLines={2}
                        style={{ fontSize: titleFontSize }}
                        className="text-white font-extrabold tracking-tight leading-9"
                    >
                        {item.title}
                    </Text>
                </Pressable>

                <View className="flex-row items-center gap-1.5 flex-wrap">
                    {item.genres.map((genre, idx) => (
                        <React.Fragment key={genre}>
                            {idx > 0 && (
                                <Text className="text-white/20 text-[10px] font-bold"> • </Text>
                            )}
                            <Text className="text-white/55 text-[11px] font-semibold tracking-wider uppercase">
                                {genre}
                            </Text>
                        </React.Fragment>
                    ))}
                </View>

                <View className="flex-row mt-1" pointerEvents="box-none">
                    <Pressable
                        onPress={() => onActionPress(item)}
                        className="flex-row items-center bg-white active:bg-white/85 px-4.5 py-2.5 rounded-xl gap-2 shadow-md transition-all"
                        android_ripple={{ color: "rgba(0,0,0,0.1)" }}
                    >
                        <Ionicons name={iconName} size={13} color="black" />
                        <Text className="text-black text-xs font-bold tracking-tight">
                            {buttonLabel}
                        </Text>
                    </Pressable>
                </View>
            </Animated.View>
        </View>
    )
}

function LibraryHeroBackdrop({
    items,
    currentIndex,
    screenWidth,
    scrollX,
    scrollY,
    heroHeight,
}: {
    items: UnifiedHeroItem[]
    currentIndex: number
    screenWidth: number
    scrollX: SharedValue<number>
    scrollY: SharedValue<number>
    heroHeight: number
}) {
    const [shouldRenderImages, setShouldRenderImages] = React.useState(false)
    const itemsKey = React.useMemo(() => items.map(item => String(item.id)).join(":"), [items])

    React.useEffect(() => {
        if (items.length === 0) {
            setShouldRenderImages(false)
            return
        }

        setShouldRenderImages(false)
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        const task = runAfterInteractions(() => {
            timeoutId = setTimeout(() => {
                setShouldRenderImages(true)
            }, HERO_IMAGE_MOUNT_DELAY_MS)
        })

        return () => {
            task.cancel()
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
        }
    }, [items.length, itemsKey])

    const backgroundStyle = useAnimatedStyle(() => {
        const y = scrollY.value
        const scale = y < 0 ? 1 + Math.abs(y) / (heroHeight * 2) : 1
        const offset = Math.min(Math.max(y, 0), 200)

        return {
            opacity: interpolate(offset, [0, 200], [1, 0], Extrapolation.CLAMP),
            transform: [{ scale }],
        }
    })

    return (
        <View
            pointerEvents="none"
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: heroHeight,
                overflow: "hidden",
                backgroundColor: HERO_BACKGROUND,
            }}
        >
            <Animated.View style={[HERO_VISUAL_LAYER_STYLE, backgroundStyle]}>
                {shouldRenderImages && (
                    <View style={ABSOLUTE_FILL_STYLE}>
                        {items.map((item, index) => {
                            if (Math.abs(index - currentIndex) > HERO_BACKDROP_IMAGE_WINDOW) {
                                return null
                            }

                            return (
                                <LibraryHeroBackdropImage
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
                )}

                <View pointerEvents="none" style={HERO_BACKDROP_OVERLAY_STYLE} />

                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 120,
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
                    height: heroHeight * 0.75,
                }}
            />
        </View>
    )
}

function LibraryHeroBackdropImage({
    index,
    item,
    scrollX,
    screenWidth,
    isActive,
}: {
    index: number
    item: UnifiedHeroItem
    scrollX: SharedValue<number>
    screenWidth: number
    isActive: boolean
}) {
    const uri = item.bannerImage || item.coverImage || ""
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
