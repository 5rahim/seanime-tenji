import { useServerStatus } from "@/atoms/server.atoms"
import { InlineSelect } from "@/components/shared/inline-select"
import { LabeledSwitch } from "@/components/shared/labeled-switch"
import { MultiToggle } from "@/components/shared/multi-toggle"
import { SheetFooter, SheetFooterButton } from "@/components/shared/sheet-footer"
import { SeaBottomSheet } from "@/components/ui/bottom-sheet"
import { FormField } from "@/components/ui/form-field"
import { Text } from "@/components/ui/text"
import { DEFAULT_SEARCH_PARAMS, getActiveFiltersCount, SearchParams } from "@/lib/search/search-atoms"
import {
    SEARCH_COUNTRIES_MANGA,
    SEARCH_FORMATS_ANIME,
    SEARCH_FORMATS_MANGA,
    SEARCH_MEDIA_GENRES,
    SEARCH_SEASONS,
    SEARCH_SORTING_ANIME,
    SEARCH_SORTING_MANGA,
    SEARCH_STATUS,
    SEARCH_YEARS,
} from "@/lib/search/search-constants"
import { cn } from "@/lib/utils"
import Ionicons from "@expo/vector-icons/Ionicons"
import * as React from "react"
import { Pressable, ScrollView, View } from "react-native"

///////////////////////////////////////////////////////////////////////////////
// SearchFilterSheet
///////////////////////////////////////////////////////////////////////////////

type SearchFilterSheetProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    params: SearchParams
    onApply: (params: SearchParams) => void
}

export function SearchFilterSheet({
    open,
    onOpenChange,
    params,
    onApply,
}: SearchFilterSheetProps) {
    const serverStatus = useServerStatus()
    const [draft, setDraft] = React.useState<SearchParams>(params)

    // Keep draft in sync when sheet opens from outside
    React.useEffect(() => {
        if (open) setDraft(params)
    }, [open, params])

    const isAnime = draft.type === "anime"
    const sortingOptions = isAnime ? SEARCH_SORTING_ANIME : SEARCH_SORTING_MANGA

    function toggleGenre(genre: string) {
        setDraft(d => ({
            ...d,
            genre: d.genre.includes(genre)
                ? d.genre.filter(g => g !== genre)
                : [...d.genre, genre],
        }))
    }

    function toggleStatus(status: string) {
        setDraft(d => ({
            ...d,
            status: d.status.includes(status as any)
                ? d.status.filter(s => s !== status)
                : [...d.status, status as any],
        }))
    }

    function reset() {
        setDraft({ ...DEFAULT_SEARCH_PARAMS, type: draft.type })
    }

    function apply() {
        onApply(draft)
        onOpenChange(false)
    }

    const activeCount = getActiveFiltersCount(draft)

    return (
        <SeaBottomSheet
            open={open}
            onOpenChange={onOpenChange}
            snapPoints={["90%"]}
            title="Filters"
            footer={
                <SheetFooter>
                    <SheetFooterButton variant="cancel" onPress={reset}>
                        <View className="flex-row items-center gap-2">
                            <Ionicons name="refresh-outline" size={15} color="rgba(255,255,255,0.6)" />
                            <Text className="text-white/60 text-sm font-semibold">Reset</Text>
                        </View>
                    </SheetFooterButton>
                    <SheetFooterButton onPress={apply}>
                        <Text className="text-sm font-bold">
                            {activeCount > 0 ? `Apply (${activeCount})` : "Apply"}
                        </Text>
                    </SheetFooterButton>
                </SheetFooter>
            }
        >
            <View className="gap-5 pb-2">

                <FormField label="Sort by" icon="swap-vertical-outline">
                    <InlineSelect
                        options={sortingOptions}
                        value={draft.sorting}
                        nullable={false}
                        onSelect={v => v && setDraft(d => ({ ...d, sorting: v as any }))}
                    />
                </FormField>

                <FormField
                    label={isAnime ? "Format" : "Format"}
                    icon="layers-outline"
                >
                    <InlineSelect
                        options={isAnime ? SEARCH_FORMATS_ANIME : SEARCH_FORMATS_MANGA}
                        value={draft.format}
                        onSelect={v => setDraft(d => ({ ...d, format: v }))}
                    />
                </FormField>

                {!isAnime && (
                    <FormField label="Country of origin" icon="globe-outline">
                        <InlineSelect
                            options={SEARCH_COUNTRIES_MANGA}
                            value={draft.countryOfOrigin}
                            onSelect={v => setDraft(d => ({ ...d, countryOfOrigin: v }))}
                        />
                    </FormField>
                )}

                {isAnime && (
                    <FormField label="Season" icon="partly-sunny-outline">
                        <InlineSelect
                            options={[...SEARCH_SEASONS]}
                            value={draft.season}
                            onSelect={v => setDraft(d => ({ ...d, season: v as any }))}
                        />
                    </FormField>
                )}

                <FormField label="Year" icon="calendar-outline">
                    <View
                        style={{ maxHeight: 120 }}
                    >
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{ gap: 8, paddingRight: 4 }}
                            keyboardShouldPersistTaps="handled"
                        >
                            {SEARCH_YEARS.map(year => {
                                const selected = draft.year === year
                                return (
                                    <Pressable
                                        key={year}
                                        onPress={() => setDraft(d => ({
                                            ...d,
                                            year: d.year === year ? null : year,
                                        }))}
                                        className={cn(
                                            "h-9 w-16 rounded-xl border items-center justify-center active:opacity-70",
                                            selected
                                                ? "border-brand-500/70 bg-brand-500/20"
                                                : "border-white/10 bg-white/[0.04]",
                                        )}
                                    >
                                        <Text
                                            className={cn(
                                                "text-sm font-medium",
                                                selected ? "text-brand-400" : "text-white/65",
                                            )}
                                        >
                                            {year}
                                        </Text>
                                    </Pressable>
                                )
                            })}
                        </ScrollView>
                    </View>
                </FormField>

                <FormField label="Status" icon="radio-button-on-outline">
                    <MultiToggle
                        options={SEARCH_STATUS}
                        values={draft.status as string[]}
                        onToggle={toggleStatus}
                    />
                </FormField>

                <FormField label="Genres" icon="pricetag-outline">
                    <MultiToggle
                        options={SEARCH_MEDIA_GENRES.map(g => ({ value: g, label: g }))}
                        values={draft.genre}
                        onToggle={toggleGenre}
                    />
                </FormField>

                {!!serverStatus?.settings?.anilist?.enableAdultContent && (
                    <LabeledSwitch
                        label="Adult Content"
                        checked={draft.isAdult}
                        onToggle={() => setDraft(d => ({ ...d, isAdult: !d.isAdult }))}
                    />
                )}

            </View>
        </SeaBottomSheet>
    )
}

///////////////////////////////////////////////////////////////////////////////

type FilterButtonProps = {
    activeCount: number
    onPress: () => void
}

export function FilterButton({ activeCount, onPress }: FilterButtonProps) {
    const hasFilters = activeCount > 0
    return (
        <Pressable
            onPress={onPress}
            className={cn(
                "h-11 flex-row items-center gap-1.5 rounded-2xl border px-3 active:opacity-70",
                hasFilters
                    ? "border-brand-500/60 bg-brand-500/15"
                    : "border-white/10 bg-white/[0.04]",
            )}
        >
            <Ionicons
                name="options-outline"
                size={16}
                color={hasFilters ? "rgba(130,115,255,0.9)" : "rgba(255,255,255,0.45)"}
            />
            <Text
                className={cn(
                    "text-sm font-semibold",
                    hasFilters ? "text-brand-400" : "text-white/50",
                )}
            >
                {hasFilters ? `Filter (${activeCount})` : "Filter"}
            </Text>
        </Pressable>
    )
}
