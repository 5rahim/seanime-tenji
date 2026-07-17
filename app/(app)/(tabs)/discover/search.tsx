import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { useInfiniteAnimeSearch, useInfiniteMangaSearch } from "@/api/hooks/search.hooks"
import { FilterButton, SearchFilterSheet } from "@/components/features/discover/search-filter-sheet"
import { MediaEntryCard } from "@/components/features/media/media-entry-card"
import { SafeView } from "@/components/layout/layout-view"
import { LibrarySearchBar } from "@/components/shared/library-search-bar"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { getMediaGridLayout } from "@/lib/responsive-card-layout"
import { DEFAULT_SEARCH_PARAMS, getActiveFiltersCount, isSearchActive, SearchParams, searchParamsAtom } from "@/lib/search/search.atoms"
import Ionicons from "@expo/vector-icons/Ionicons"
import { router, useLocalSearchParams } from "expo-router"
import { useAtom } from "jotai"
import * as React from "react"
import { ActivityIndicator, FlatList, Pressable, Text, useWindowDimensions, View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { DiscoverModeToggle } from "."

const H_PADDING = 14
const GAP = 10
const SEARCH_INITIAL_ROWS = 4

function EmptyState({ query }: { query: string }) {
    return (
        <Animated.View
            entering={FadeIn.duration(200)}
            className="flex-1 items-center justify-center pt-20 gap-3"
        >
            <Ionicons name="search-outline" size={40} color="rgba(255,255,255,0.12)" />
            <Text className="text-center text-sm text-white/30">
                {query.trim() ? `No results for "${query}"` : "Use the search bar or filters above"}
            </Text>
        </Animated.View>
    )
}

function FooterLoader({ isLoading }: { isLoading: boolean }) {
    if (!isLoading) return null
    return (
        <View className="py-6 items-center">
            <ActivityIndicator size="small" color="rgba(255,255,255,0.3)" />
        </View>
    )
}

///////////////////////////////////////////////////////////////////////////////
// Search screen
///////////////////////////////////////////////////////////////////////////////

export default function SearchScreen() {
    const insets = useSafeAreaInsets()
    const { type: initialType } = useLocalSearchParams<{ type?: string }>()
    const { width: screenWidth } = useWindowDimensions()
    const usableWidth = Math.max(1, screenWidth - insets.left - insets.right)
    const { cardWidth, numColumns } = React.useMemo(
        () => getMediaGridLayout({
            screenWidth: usableWidth,
            horizontalPadding: H_PADDING,
            spacing: GAP,
        }),
        [usableWidth],
    )
    const searchRowHeight = React.useMemo(() => cardWidth * 1.5 + GAP + 8, [cardWidth])

    useIOSScrollRefreshRateWorkaround()

    const [params, setParams] = useAtom(searchParamsAtom)
    const [filterOpen, setFilterOpen] = React.useState(false)

    React.useEffect(() => {
        if (initialType === "anime" || initialType === "manga") {
            setParams(p => ({ ...p, type: initialType }))
        }
    }, [initialType])

    const activeFilters = getActiveFiltersCount(params)

    const [titleInput, setTitleInput] = React.useState(params.title ?? "")
    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    function handleTitleChange(text: string) {
        setTitleInput(text)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            setParams(p => ({ ...p, title: text.trim() || null }))
        }, 350)
    }

    // Keep title input in sync if params reset from outside
    React.useEffect(() => {
        if (params.title === null && titleInput !== "") {
            setTitleInput("")
        }
    }, [params.title])

    function handleTypeChange(t: "anime" | "manga") {
        setParams(p => ({
            ...DEFAULT_SEARCH_PARAMS,
            type: t,
            title: p.title,
        }))
        setTitleInput(params.title ?? "")
    }

    function handleApplyFilters(newParams: SearchParams) {
        setParams(newParams)
    }

    const shouldQuery = isSearchActive(params)
    const animeQuery = useInfiniteAnimeSearch(params, params.type === "anime" && shouldQuery)
    const mangaQuery = useInfiniteMangaSearch(params, params.type === "manga" && shouldQuery)

    const activeQuery = params.type === "anime" ? animeQuery : mangaQuery

    const items = React.useMemo(() => {
        return activeQuery.data?.pages
            .filter(Boolean)
            .flatMap(page => page?.Page?.media)
            .filter(Boolean) ?? []
    }, [activeQuery.data])

    function handleLoadMore() {
        if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
            activeQuery.fetchNextPage()
        }
    }

    const handlePress = React.useCallback((item: AL_BaseAnime | AL_BaseManga) => {
        router.push(`/(app)/entry/${params.type}/${item.id}`)
    }, [params.type])

    const keyExtractor = React.useCallback((item: AL_BaseAnime | AL_BaseManga, index: number) => `${item.id}-${index}`, [])

    const getItemLayout = React.useCallback((_: ArrayLike<AL_BaseAnime | AL_BaseManga> | null | undefined, index: number) => {
        const rowIndex = Math.floor(index / numColumns)

        return {
            length: searchRowHeight,
            offset: 12 + (rowIndex * searchRowHeight),
            index,
        }
    }, [numColumns, searchRowHeight])

    const renderSearchItem = React.useCallback(({ item }: { item: AL_BaseAnime | AL_BaseManga }) => (
        <MediaEntryCard
            type={params.type}
            cardWidth={cardWidth}
            media={item as any}
            onPress={() => handlePress(item)}
            showAudienceScore
        />
    ), [cardWidth, handlePress, params.type])

    const isLoading = activeQuery.isLoading
    const isFetchingMore = activeQuery.isFetchingNextPage

    return (
        <SafeView className="flex-1 bg-background">
            <View
                className="gap-2.5 border-b border-white/5 bg-background px-3.5 py-2"
            >
                <View className="flex-row items-center gap-2">
                    <Pressable
                        onPress={() => router.back()}
                        className="w-10 h-10 rounded-full items-center justify-center bg-white/[0.06] active:opacity-60"
                    >
                        <Ionicons name="arrow-back" size={20} color="rgba(255,255,255,0.8)" />
                    </Pressable>
                    <View className="flex-1">
                        <LibrarySearchBar
                            value={titleInput}
                            onChangeText={handleTitleChange}
                            placeholder={params.type === "anime" ? "Search anime\u2026" : "Search manga\u2026"}
                        />
                    </View>
                </View>

                <View className="flex-row items-center justify-between">
                    <DiscoverModeToggle mode={params.type} onChangeMode={handleTypeChange} />
                    <FilterButton
                        activeCount={activeFilters}
                        onPress={() => setFilterOpen(true)}
                    />
                </View>
            </View>

            {isLoading ? (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="large" color="rgba(255,255,255,0.3)" />
                </View>
            ) : (
                <FlatList
                    key={`search-grid-${numColumns}`}
                    data={items as (AL_BaseAnime | AL_BaseManga)[]}
                    numColumns={numColumns}
                    keyExtractor={keyExtractor}
                    showsVerticalScrollIndicator={false}
                    onEndReached={handleLoadMore}
                    onEndReachedThreshold={0.4}
                    getItemLayout={getItemLayout}
                    initialNumToRender={numColumns * SEARCH_INITIAL_ROWS}
                    maxToRenderPerBatch={numColumns * 2}
                    updateCellsBatchingPeriod={16}
                    windowSize={7}
                    removeClippedSubviews
                    contentContainerStyle={{
                        paddingHorizontal: H_PADDING,
                        paddingTop: 12,
                        paddingBottom: insets.bottom + 80,
                        gap: GAP,
                        flexGrow: 1,
                    }}
                    columnWrapperStyle={{ gap: GAP }}
                    ListEmptyComponent={<EmptyState query={titleInput} />}
                    ListFooterComponent={<FooterLoader isLoading={isFetchingMore} />}
                    renderItem={renderSearchItem}
                />
            )}

            <SearchFilterSheet
                open={filterOpen}
                onOpenChange={setFilterOpen}
                params={params}
                onApply={handleApplyFilters}
            />
        </SafeView>
    )
}
