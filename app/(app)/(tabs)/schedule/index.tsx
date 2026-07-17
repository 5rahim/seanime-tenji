import { AL_BaseAnime, AL_MediaListStatus, Anime_ScheduleItem } from "@/api/generated/types"
import { useGetAnimeCollectionSchedule } from "@/api/hooks/anime_collection.hooks"
import { useGetMissingEpisodes, useGetUpcomingEpisodes } from "@/api/hooks/anime_entries.hooks"
import { useAnilistAnimeEntryListDataAtom } from "@/atoms/anilist-collection.atoms"
import { ScheduleSettings, scheduleSettingsAtom } from "@/atoms/schedule.atoms"
import { useServerStatus } from "@/atoms/server.atoms"
import { EpisodeCard } from "@/components/features/anime/episode-card"
import { MediaEntryCard } from "@/components/features/media/media-entry-card"
import { SafeView } from "@/components/layout/layout-view"
import { TabFadeView } from "@/components/layout/tab-fade-view"
import { LabeledSwitch } from "@/components/shared/labeled-switch"
import { OfflineBanner } from "@/components/shared/offline-banner"
import { RowDivider } from "@/components/shared/row-divider"
import { Surface } from "@/components/shared/surface"
import { SeaBottomSheet } from "@/components/ui/bottom-sheet"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { getEpisodeSpoilerState, getSpoilerSafeAnimeImage } from "@/lib/anime-spoilers"
import { useIsServerConnected } from "@/lib/offline"
import { getHorizontalCardRenderCount, getMediaGridLayout } from "@/lib/responsive-card-layout"
import { getShelfBadge, getShelfTitle, type ShelfEpisode } from "@/lib/schedule-episodes"
import { cn } from "@/lib/utils"
import Ionicons from "@expo/vector-icons/Ionicons"
import { addDays, addWeeks, format, isSameDay, setMonth, setYear, startOfWeek, subWeeks } from "date-fns"
import { router } from "expo-router"
import { useAtom } from "jotai/react"
import sortBy from "lodash/sortBy"
import * as React from "react"
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const GRID_SPACING = 10
const GRID_PADDING = 14
const SHELF_SPACING = 12
const SHELF_PADDING = 16

export default function ScheduleScreen() {
    const isConnected = useIsServerConnected()
    const {
        data: schedule,
        isLoading,
        isFetching,
        refetch,
    } = useGetAnimeCollectionSchedule({ enabled: isConnected })
    const {
        data: missingEpisodes,
        isFetching: missingFetching,
        refetch: refetchMissing,
    } = useGetMissingEpisodes(isConnected)
    const {
        data: upcomingEpisodes,
        isFetching: upcomingFetching,
        refetch: refetchUpcoming,
    } = useGetUpcomingEpisodes(isConnected)

    useIOSScrollRefreshRateWorkaround()

    const [settings, setSettings] = useAtom(scheduleSettingsAtom)
    const { animeEntryListData } = useAnilistAnimeEntryListDataAtom()

    const [settingsOpen, setSettingsOpen] = React.useState(false)
    const [monthPickerOpen, setMonthPickerOpen] = React.useState(false)

    // week navigation
    const [currentWeekStart, setCurrentWeekStart] = React.useState(() =>
        startOfWeek(new Date(), { weekStartsOn: 1 }),
    )
    const [selectedDate, setSelectedDate] = React.useState(() => new Date())

    const weekDays = React.useMemo(() => {
        return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))
    }, [currentWeekStart])

    // filter by list status and group by date
    const eventsByDate = React.useMemo(() => {
        if (!schedule) return new Map<string, ScheduleEvent[]>()
        const map = new Map<string, ScheduleEvent[]>()

        for (const item of schedule) {
            if (!item.dateTime) continue

            // status filter
            const entryData = animeEntryListData?.[String(item.mediaId)]
            if (entryData?.status && !settings.listStatuses.includes(entryData.status)) {
                continue
            }

            const localDate = format(new Date(item.dateTime), "yyyy-MM-dd")
            const existing = map.get(localDate) ?? []

            const isWatched = entryData?.progress
                ? entryData.progress >= item.episodeNumber
                : false

            existing.push({ ...item, isWatched })
            map.set(localDate, existing)
        }

        for (const [key, items] of map) {
            map.set(key, sortBy(items, [(i) => i.dateTime, (i) => i.episodeNumber]))
        }
        return map
    }, [schedule, settings.listStatuses, animeEntryListData])

    const selectedDateKey = format(selectedDate, "yyyy-MM-dd")
    const selectedDayEvents = eventsByDate.get(selectedDateKey) ?? []
    const missing = settings.hideMissingEpisodes
        ? []
        : missingEpisodes?.episodes?.filter(episode => !!episode.baseAnime) ?? []
    const upcoming = settings.hideUpcomingEpisodes
        ? []
        : upcomingEpisodes?.episodes?.filter(episode => !!episode.baseAnime) ?? []

    const monthYearLabel = format(addDays(currentWeekStart, 3), "yyyy MMMM")

    function goToPreviousWeek() {
        setCurrentWeekStart((prev) => subWeeks(prev, 1))
    }

    function goToNextWeek() {
        setCurrentWeekStart((prev) => addWeeks(prev, 1))
    }

    function getEventCount(date: Date): number {
        const key = format(date, "yyyy-MM-dd")
        return eventsByDate.get(key)?.length ?? 0
    }

    function jumpToMonth(year: number, month: number) {
        const target = setYear(setMonth(new Date(), month), year)
        // select the first monday of that month's week
        const weekStart = startOfWeek(target, { weekStartsOn: 1 })
        setCurrentWeekStart(weekStart)
        setSelectedDate(target)
        setMonthPickerOpen(false)
    }

    function goToToday() {
        const today = new Date()
        setCurrentWeekStart(startOfWeek(today, { weekStartsOn: 1 }))
        setSelectedDate(today)
    }

    const refreshControl = isConnected ? (
        <RefreshControl
            refreshing={(isFetching || missingFetching || upcomingFetching) && !isLoading}
            onRefresh={() => void Promise.all([refetch(), refetchMissing(), refetchUpcoming()])}
            tintColor="rgba(255,255,255,0.45)"
        />
    ) : undefined

    const listHeader = (
        <>
            <View className="flex-row items-center justify-between px-4 pt-2 pb-1">
                <Pressable onPress={goToToday} className="p-2" hitSlop={12}>
                    <Ionicons name="today-outline" size={22} color="rgba(255,255,255,0.8)" />
                </Pressable>

                <View className="flex-row items-center gap-3">
                    <Pressable onPress={goToPreviousWeek} hitSlop={12} className="p-1">
                        <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.6)" />
                    </Pressable>
                    <Pressable onPress={() => setMonthPickerOpen(true)} hitSlop={8}>
                        <Text className="text-base font-semibold text-white/90">{monthYearLabel}</Text>
                    </Pressable>
                    <Pressable onPress={goToNextWeek} hitSlop={12} className="p-1">
                        <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
                    </Pressable>
                </View>

                <Pressable onPress={() => setSettingsOpen(true)} className="p-2" hitSlop={12}>
                    <Ionicons name="options-outline" size={22} color="rgba(255,255,255,0.8)" />
                </Pressable>
            </View>

            <WeekDaySelector
                weekDays={weekDays}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                getEventCount={getEventCount}
            />
        </>
    )
    const listFooter = missing.length > 0 || upcoming.length > 0
        ? (
            <View className="gap-5 pt-6 pb-8">
                <ScheduleEpisodeShelf title="Missing Episodes" episodes={missing} />
                <ScheduleEpisodeShelf title="Upcoming Episodes" episodes={upcoming} />
            </View>
        )
        : null

    return (
        <TabFadeView>
            <SafeView>
                <OfflineBanner />

                {!isConnected ? (
                    <View className="flex-1 items-center justify-center px-8">
                        <Ionicons name="cloud-offline-outline" size={40} color="rgba(255,255,255,0.2)" />
                        <Text className="text-white/30 text-sm mt-3 text-center">
                            Connect to your server to see your schedule
                        </Text>
                    </View>
                ) : isLoading ? (
                    <View className="flex-1 items-center justify-center">
                        <ActivityIndicator color="rgba(255,255,255,0.4)" />
                    </View>
                ) : (
                    <ScheduleGrid
                        events={selectedDayEvents}
                        settings={settings}
                        refreshControl={refreshControl}
                        header={listHeader}
                        footer={listFooter}
                        emptyLabel={`Nothing scheduled for ${format(selectedDate, "EEEE, MMM d")}`}
                    />
                )}

                <ScheduleSettingsSheet
                    open={settingsOpen}
                    onOpenChange={setSettingsOpen}
                    settings={settings}
                    onSettingsChange={setSettings}
                />

                <MonthYearPicker
                    open={monthPickerOpen}
                    onOpenChange={setMonthPickerOpen}
                    currentDate={selectedDate}
                    onSelect={jumpToMonth}
                />
            </SafeView>
        </TabFadeView>
    )
}

type ScheduleEvent = Anime_ScheduleItem & {
    isWatched: boolean
}

///////////////////////////////////////////////////////////////////////////////
// Helpers
///////////////////////////////////////////////////////////////////////////////

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function WeekDaySelector({
    weekDays,
    selectedDate,
    onSelectDate,
    getEventCount,
}: {
    weekDays: Date[]
    selectedDate: Date
    onSelectDate: (date: Date) => void
    getEventCount: (date: Date) => number
}) {
    const today = new Date()

    return (
        <View className="flex-row justify-around px-2 py-3">
            {weekDays.map((day, i) => {
                const isToday = isSameDay(day, today)
                const isSelected = isSameDay(day, selectedDate)
                const count = getEventCount(day)
                const dayNumber = format(day, "d")

                return (
                    <Pressable
                        key={i}
                        className="items-center flex-1"
                        onPress={() => onSelectDate(day)}
                        hitSlop={4}
                    >
                        <Text
                            className={cn(
                                "text-xs font-medium mb-1.5",
                                isSelected ? "text-white" : "text-white/40",
                            )}
                        >
                            {DAY_LABELS[i]}
                        </Text>

                        <View
                            className={cn(
                                "size-9 items-center justify-center border border-transparent",
                                isSelected && isToday && "bg-white",
                                isSelected && !isToday && "bg-white/40",
                                !isSelected && isToday && "border-white/30",
                                "rounded-full",
                            )}
                        >
                            <Text
                                className={cn(
                                    "text-sm font-bold",
                                    !isSelected ? (isToday ? "text-white" : "text-white/60") : "text-black",
                                )}
                            >
                                {dayNumber}
                            </Text>
                        </View>

                        {count > 0 && (
                            <Text
                                className={cn(
                                    "text-[10px] mt-1 font-semibold",
                                    isSelected ? "text-brand-300" : "text-white/30",
                                )}
                            >
                                {count}
                            </Text>
                        )}
                        {count === 0 && <View className="h-3.5" />}
                    </Pressable>
                )
            })}
        </View>
    )
}


function ScheduleGrid({
    events,
    settings,
    refreshControl,
    header,
    footer,
    emptyLabel,
}: {
    events: ScheduleEvent[]
    settings: ScheduleSettings
    refreshControl: React.ReactElement<React.ComponentProps<typeof RefreshControl>> | undefined
    header: React.ReactElement
    footer: React.ReactElement | null
    emptyLabel: string
}) {
    const { width: screenWidth } = useWindowDimensions()
    const insets = useSafeAreaInsets()
    const usableWidth = Math.max(1, screenWidth - insets.left - insets.right)
    const { cardWidth, numColumns } = React.useMemo(
        () => getMediaGridLayout({
            screenWidth: usableWidth,
            horizontalPadding: GRID_PADDING,
            spacing: GRID_SPACING,
        }),
        [usableWidth],
    )
    const rowHeight = React.useMemo(() => cardWidth * 1.5 + GRID_SPACING, [cardWidth])

    const getItemLayout = React.useCallback((_: ArrayLike<ScheduleEvent> | null | undefined, index: number) => {
        const rowIndex = Math.floor(index / numColumns)

        return {
            length: rowHeight,
            offset: 8 + (rowIndex * rowHeight),
            index,
        }
    }, [numColumns, rowHeight])

    return (
        <Animated.View entering={FadeIn.duration(200)} className="flex-1">
            <FlatList
                key={`schedule-grid-${numColumns}`}
                data={events}
                numColumns={numColumns}
                showsVerticalScrollIndicator={false}
                keyExtractor={(item) => `${item.mediaId}-${item.episodeNumber}-${item.dateTime}`}
                renderItem={({ item }) => (
                    <ScheduleCardWrapper item={item} settings={settings} cardWidth={cardWidth} />
                )}
                ListHeaderComponent={header}
                ListFooterComponent={footer}
                ListEmptyComponent={(
                    <View className="items-center justify-center px-8 py-14">
                        <Ionicons name="calendar-outline" size={40} color="rgba(255,255,255,0.15)" />
                        <Text className="text-white/30 text-sm mt-3 text-center">{emptyLabel}</Text>
                    </View>
                )}
                getItemLayout={getItemLayout}
                initialNumToRender={numColumns * 3}
                maxToRenderPerBatch={numColumns * 2}
                updateCellsBatchingPeriod={16}
                windowSize={7}
                removeClippedSubviews
                contentContainerStyle={{
                    gap: GRID_SPACING,
                    paddingHorizontal: GRID_PADDING,
                    paddingBottom: 80,
                    paddingTop: 8,
                }}
                columnWrapperStyle={{ gap: GRID_SPACING }}
                refreshControl={refreshControl}
            />
        </Animated.View>
    )
}


function ScheduleCardWrapper({
    item,
    settings,
    cardWidth,
}: {
    item: ScheduleEvent
    settings: ScheduleSettings
    cardWidth: number
}) {
    const media: AL_BaseAnime = React.useMemo(() => ({
        id: item.mediaId,
        coverImage: { large: item.image, extraLarge: item.image },
        title: { userPreferred: item.title },
        format: item.isMovie ? "MOVIE" : undefined,
    }), [item.mediaId, item.image, item.title, item.isMovie])

    const localTime = item.dateTime
        ? format(new Date(item.dateTime), "HH:mm")
        : item.time

    const isWatchedAndDimmed = item.isWatched && settings.indicateWatchedEpisodes

    return (
        <View style={{ width: cardWidth, opacity: isWatchedAndDimmed ? 0.45 : 1 }}>
            <MediaEntryCard
                type="anime"
                media={media}
                cardWidth={cardWidth}
                hideProgress
                preferFetchedSheetMedia
                hideLibraryBadge
                onPress={() => router.push(`/(app)/entry/anime/${item.mediaId}`)}
                overlay={<View className="absolute top-0 left-0 right-0 z-10" style={{ height: cardWidth * 1.275 }} pointerEvents="none">
                    <View className="absolute top-1.5 left-1.5 flex-row items-center gap-1">
                        <View className="bg-black/70 rounded px-1.5 py-0.5">
                            <Text className="text-[11px] font-bold text-gray-200">
                                {localTime}
                            </Text>
                        </View>
                    </View>

                    <View className="absolute top-1.5 right-1.5 bg-black/70 rounded px-1.5 py-0.5">
                        <Text className="text-[11px] font-bold text-white/80">
                            {item.isSeasonFinale && !item.isMovie && "FIN. "}{item.isMovie ? "Movie" : "Ep. " + item.episodeNumber}
                        </Text>
                    </View>

                    {isWatchedAndDimmed && (
                        <View className="absolute bottom-1.5 right-1.5 bg-black/70 rounded-full p-1">
                            <Ionicons name="checkmark" size={12} color="rgba(255,255,255,0.5)" />
                        </View>
                    )}
                </View>}
            />
        </View>
    )
}

function ScheduleEpisodeShelf({ title, episodes }: { title: string; episodes: ShelfEpisode[] }) {
    const { width } = useWindowDimensions()
    const serverStatus = useServerStatus()
    const blurAdultContent = !!serverStatus?.settings?.anilist?.blurAdultContent
    const { animeEntryListData } = useAnilistAnimeEntryListDataAtom()
    const cardWidth = React.useMemo(() => Math.max(160, Math.floor(Math.min(width * 0.54, 240))), [width])
    const initialCount = React.useMemo(() => getHorizontalCardRenderCount({
        viewportWidth: width,
        cardWidth,
        spacing: SHELF_SPACING,
        horizontalPadding: SHELF_PADDING,
    }), [cardWidth, width])

    if (episodes.length === 0) return null

    return (
        <View className="gap-3">
            <Text className="px-4 text-lg font-bold text-white">{title}</Text>
            <FlatList
                horizontal
                data={episodes}
                keyExtractor={(item) => `${title}-${item.baseAnime?.id}-${item.episodeNumber}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: SHELF_SPACING, paddingHorizontal: SHELF_PADDING }}
                initialNumToRender={initialCount}
                maxToRenderPerBatch={initialCount}
                windowSize={5}
                snapToInterval={cardWidth + SHELF_SPACING}
                decelerationRate="fast"
                disableIntervalMomentum
                renderItem={({ item }) => {
                    const media = item.baseAnime
                    if (!media) return null

                    const progress = animeEntryListData?.[String(media.id)]?.progress ?? 0
                    const spoiler = getEpisodeSpoilerState(serverStatus, {
                        episodeNumber: item.episodeNumber,
                        watchedProgress: progress,
                    })
                    const episodeMeta = item.episodeMetadata
                    const image = (spoiler.hideThumbnail
                        ? getSpoilerSafeAnimeImage(media)
                        : episodeMeta?.image || getSpoilerSafeAnimeImage(media)) || ""
                    const badge = getShelfBadge(item)
                    const episodeTitle = getShelfTitle(item, spoiler.hideTitle)
                    const animeTitle = media.title?.userPreferred || media.title?.english || media.title?.romaji || ""

                    return (
                        <EpisodeCard
                            cardWidth={cardWidth}
                            image={image}
                            imageBlurred={blurAdultContent && !!media.isAdult}
                            title={episodeTitle}
                            episodeNumber={item.episodeNumber}
                            totalEpisodes={media.episodes}
                            length={episodeMeta?.length}
                            animeTitle={animeTitle}
                            small
                            onPress={() => router.push(`/(app)/entry/anime/${media.id}`)}
                            thumbnailOverlay={badge ? (
                                <View className="absolute left-2 top-2 rounded-md bg-black/75 px-2 py-1">
                                    <Text className="text-[10px] font-semibold text-white/70">{badge}</Text>
                                </View>
                            ) : undefined}
                        />
                    )
                }}
            />
        </View>
    )
}


const STATUS_OPTIONS: { label: string; value: AL_MediaListStatus }[] = [
    { label: "Watching", value: "CURRENT" },
    { label: "Planning", value: "PLANNING" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Paused", value: "PAUSED" },
    { label: "Repeating", value: "REPEATING" },
]

function ScheduleSettingsSheet({
    open,
    onOpenChange,
    settings,
    onSettingsChange,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    settings: ScheduleSettings
    onSettingsChange: (update: ScheduleSettings | ((prev: ScheduleSettings) => ScheduleSettings)) => void
}) {
    function toggleStatus(status: AL_MediaListStatus) {
        onSettingsChange((prev) => {
            const current = prev.listStatuses
            const next = current.includes(status)
                ? current.filter((s) => s !== status)
                : [...current, status]
            return { ...prev, listStatuses: next }
        })
    }

    function toggleIndicateWatched() {
        onSettingsChange((prev) => ({
            ...prev,
            indicateWatchedEpisodes: !prev.indicateWatchedEpisodes,
        }))
    }

    function toggleMissingEpisodes() {
        onSettingsChange((prev) => ({
            ...prev,
            hideMissingEpisodes: !(prev.hideMissingEpisodes ?? false),
        }))
    }

    function toggleUpcomingEpisodes() {
        onSettingsChange((prev) => ({
            ...prev,
            hideUpcomingEpisodes: !(prev.hideUpcomingEpisodes ?? false),
        }))
    }

    return (
        <SeaBottomSheet
            open={open}
            onOpenChange={onOpenChange}
            title="Schedule settings"
            snapPoints={["65%"]}
        >
            <View className="gap-5">
                <View className="gap-2">
                    <Text className="text-sm font-medium text-white/50">Filter by status</Text>
                    <Surface variant="muted" className="overflow-hidden">
                        {STATUS_OPTIONS.map((opt, i) => {
                            const active = settings.listStatuses.includes(opt.value)
                            return (
                                <React.Fragment key={opt.value}>
                                    {i > 0 && <RowDivider />}
                                    <Pressable
                                        onPress={() => toggleStatus(opt.value)}
                                        className="flex-row items-center justify-between px-4 py-3"
                                    >
                                        <Text className={cn("text-sm", active ? "text-white" : "text-white/50")}>
                                            {opt.label}
                                        </Text>
                                        {active && (
                                            <Ionicons name="checkmark" size={18} color="rgb(97,82,223)" />
                                        )}
                                    </Pressable>
                                </React.Fragment>
                            )
                        })}
                    </Surface>
                </View>

                <View className="gap-3 px-1">
                    <LabeledSwitch
                        label="Indicate watched episodes"
                        helper="Dim episodes you've already watched"
                        checked={settings.indicateWatchedEpisodes}
                        onToggle={toggleIndicateWatched}
                    />
                    <LabeledSwitch
                        label="Hide missing episodes"
                        checked={settings.hideMissingEpisodes ?? false}
                        onToggle={toggleMissingEpisodes}
                    />
                    <LabeledSwitch
                        label="Hide upcoming episodes"
                        checked={settings.hideUpcomingEpisodes ?? false}
                        onToggle={toggleUpcomingEpisodes}
                    />
                </View>
            </View>
        </SeaBottomSheet>
    )
}

const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

function MonthYearPicker({
    open,
    onOpenChange,
    currentDate,
    onSelect,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentDate: Date
    onSelect: (year: number, month: number) => void
}) {
    const [displayYear, setDisplayYear] = React.useState(() => currentDate.getFullYear())

    // reset to the current date's year when the sheet opens
    React.useEffect(() => {
        if (open) setDisplayYear(currentDate.getFullYear())
    }, [open, currentDate])

    const currentMonth = currentDate.getMonth()
    const currentYear = currentDate.getFullYear()
    const today = new Date()
    const todayMonth = today.getMonth()
    const todayYear = today.getFullYear()

    return (
        <SeaBottomSheet
            open={open}
            onOpenChange={onOpenChange}
            snapPoints={["40%"]}
        >
            <View className="gap-4">
                <View className="flex-row items-center justify-center gap-5">
                    <Pressable onPress={() => setDisplayYear((y) => y - 1)} hitSlop={12} className="p-2">
                        <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.6)" />
                    </Pressable>
                    <Text className="text-xl font-bold text-white min-w-[60px] text-center">
                        {displayYear}
                    </Text>
                    <Pressable onPress={() => setDisplayYear((y) => y + 1)} hitSlop={12} className="p-2">
                        <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.6)" />
                    </Pressable>
                </View>

                <View className="flex-row flex-wrap justify-center gap-2 px-2">
                    {MONTHS.map((label, monthIndex) => {
                        const isCurrentSelection = displayYear === currentYear && monthIndex === currentMonth
                        const isToday = displayYear === todayYear && monthIndex === todayMonth

                        return (
                            <Pressable
                                key={monthIndex}
                                onPress={() => onSelect(displayYear, monthIndex)}
                                className={cn(
                                    "w-[23%] items-center justify-center rounded-lg py-3",
                                    isCurrentSelection && "bg-brand-500",
                                    !isCurrentSelection && isToday && "border border-white/20",
                                    !isCurrentSelection && !isToday && "bg-white/[0.04]",
                                )}
                            >
                                <Text
                                    className={cn(
                                        "text-sm font-semibold",
                                        isCurrentSelection ? "text-black" : isToday ? "text-black" : "text-white/60",
                                    )}
                                >
                                    {label}
                                </Text>
                            </Pressable>
                        )
                    })}
                </View>
            </View>
        </SeaBottomSheet>
    )
}
