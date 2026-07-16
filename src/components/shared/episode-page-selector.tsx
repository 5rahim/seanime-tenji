import { cn } from "@/lib/utils"
import { logger } from "@/lib/utils/logger"
import * as React from "react"
import { Pressable, ScrollView, Text, View } from "react-native"

export const EPISODE_PAGE_SIZE = 24
const log = logger("pagination")

type EpisodePageSelectorProps = {
    totalCount: number
    pageSize?: number
    currentPage: number
    onPageChange: (page: number) => void
    className?: string
    logName?: string
}

/**
 * Horizontally-scrollable page selector for paginated episode lists.
 * Renders range pills like "1–24", "25–48", etc.
 * Returns null when all episodes fit on a single page.
 */
export function EpisodePageSelector({
    totalCount,
    pageSize = EPISODE_PAGE_SIZE,
    currentPage,
    onPageChange,
    className,
    logName = "episode list",
}: EpisodePageSelectorProps) {
    const pageCount = Math.ceil(totalCount / pageSize)
    if (pageCount <= 1) return null

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className={cn("flex-none", className)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4 }}
        >
            <View className="flex-row gap-2">
                {Array.from({ length: pageCount }).map((_, i) => {
                    const start = i * pageSize + 1
                    const end = Math.min((i + 1) * pageSize, totalCount)
                    const isActive = i === currentPage

                    return (
                        <Pressable
                            key={i}
                            onPress={() => {
                                if (isActive) return
                                log.info(`${logName}: page ${currentPage + 1} -> ${i + 1} of ${pageCount}`, {
                                    range: `${start}-${end}`,
                                    totalCount,
                                })
                                onPageChange(i)
                            }}
                            className={cn(
                                "h-8 items-center justify-center rounded-full border px-3.5",
                                isActive
                                    ? "border-brand-300/40 bg-brand-300/15 active:bg-brand-300/20"
                                    : "border-white/10 bg-white/[0.04] active:bg-white/10",
                            )}
                        >
                            <Text
                                className={cn(
                                    "text-xs font-semibold",
                                    isActive ? "text-brand-300" : "text-white/50",
                                )}
                            >
                                {start}–{end}
                            </Text>
                        </Pressable>
                    )
                })}
            </View>
        </ScrollView>
    )
}
