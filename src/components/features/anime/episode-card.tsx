import { SeaImage } from "@/components/shared/sea-image"
import { getEpisodeCardWidth } from "@/lib/responsive-card-layout"
import * as React from "react"
import { Pressable, Text, useWindowDimensions, View } from "react-native"

type EpisodeCardProps = {
    cardWidth?: number
    image: string
    imageBlurred?: boolean
    title: string
    episodeNumber: number
    totalEpisodes: number | undefined
    length: number | undefined
    onPress?: () => void
    progressPercent?: number
    disabled?: boolean
    thumbnailOverlay?: React.ReactNode
    animeTitle?: string
}

export const EpisodeCard = React.memo(function EpisodeCard(props: EpisodeCardProps) {
    const {
        cardWidth,
        image,
        imageBlurred,
        title,
        episodeNumber,
        totalEpisodes,
        length,
        onPress,
        progressPercent,
        disabled,
        thumbnailOverlay,
        animeTitle,
    } = props
    const { width: screenWidth } = useWindowDimensions()
    const resolvedCardWidth = cardWidth ?? getEpisodeCardWidth(screenWidth)

    return (
        <Pressable
            onPress={disabled ? undefined : onPress}
            disabled={disabled || !onPress}
        >
            <View style={{ width: resolvedCardWidth }}>
                <View className="relative mb-2" style={{ borderRadius: 12, overflow: "hidden" }}>
                    <SeaImage
                        source={{ uri: image }}
                        style={{ width: "100%", aspectRatio: 16 / 9 }}
                        contentFit="cover"
                        transition={120}
                        blurRadius={imageBlurred ? 18 : 0}
                    />
                    {!!progressPercent && progressPercent > 0 && (
                        <View className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 rounded-b-xl overflow-hidden">
                            <View
                                className="h-full bg-brand-400 rounded-bl-xl"
                                style={{ width: `${Math.min(progressPercent, 100)}%` }}
                            />
                        </View>
                    )}
                    {thumbnailOverlay}
                </View>

                <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    className="text-lg tracking-tight text-foreground font-semibold mb-1"
                >
                    {title}
                </Text>

                <View
                    className="flex flex-row justify-between items-center"
                >
                    <View
                        className="flex flex-row flex-1 mr-2"
                    >
                        <Text
                            className="text-foreground"
                            numberOfLines={1}
                        >
                            Episode {episodeNumber}
                            {totalEpisodes && (
                                <Text className="text-muted-foreground">
                                    /{totalEpisodes}
                                </Text>
                            )}
                            {animeTitle && (
                                <Text className="text-muted-foreground">
                                    {` - ${animeTitle}`}
                                </Text>
                            )}
                        </Text>
                    </View>

                    {length && <Text
                        className="text-muted-foreground shrink-0"
                    >{length}m</Text>}
                </View>
            </View>
        </Pressable>
    )
})
