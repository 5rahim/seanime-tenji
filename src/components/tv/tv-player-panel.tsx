import type { Anime_Episode, Onlinestream_VideoSource } from "@/api/generated/types"
import {
    AUDIO_DELAY_STEP,
    BRAND_ACCENT,
    BRAND_ACCENT_TINT,
    BUTTON_SEEK_OPTIONS,
    SPEED_OPTIONS,
    SUBTITLE_DELAY_STEP,
    SUBTITLE_FONT_SIZE_OPTIONS,
} from "@/components/features/player/constants"
import { formatSecondsLabel, getBackPanel } from "@/components/features/player/helpers"
import type { PlayerPanel } from "@/components/features/player/types"
import { TVDrawer } from "@/components/tv/tv-drawer"
import { TVButton, useTVFocus } from "@/components/tv/tv-focus"
import { tvSize } from "@/components/tv/tv-scale"
import type { PlayerPreferences } from "@/lib/player/player-preferences"
import type { PlayerState, PlayerTrack } from "@/lib/player/types"
import type { MpvVideoOutput } from "expo-mpv-player"
import Activity from "lucide-react-native/icons/activity"
import Captions from "lucide-react-native/icons/captions"
import Check from "lucide-react-native/icons/check"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import Clapperboard from "lucide-react-native/icons/clapperboard"
import Cpu from "lucide-react-native/icons/cpu"
import Gauge from "lucide-react-native/icons/gauge"
import List from "lucide-react-native/icons/list"
import Mic2 from "lucide-react-native/icons/mic-vocal"
import RotateCw from "lucide-react-native/icons/rotate-cw"
import SkipForward from "lucide-react-native/icons/skip-forward"
import Timer from "lucide-react-native/icons/timer"
import Type from "lucide-react-native/icons/type"
import * as React from "react"
import { Animated, FlatList, Platform, Pressable, ScrollView, Text, TVFocusGuideView, View } from "react-native"

type Props = {
    panel: PlayerPanel
    onNavigate: (panel: PlayerPanel) => void
    onClose: () => void
    state: PlayerState
    prefs: PlayerPreferences
    updatePrefs: (prefs: Partial<PlayerPreferences>) => void
    episodes?: Anime_Episode[]
    currentEpisodeNumber?: number
    onPlayEpisode?: (episode: Anime_Episode) => void
    videoSources?: Onlinestream_VideoSource[]
    videoSource?: Onlinestream_VideoSource
    onSetVideoSource?: (source: Onlinestream_VideoSource) => void
    onSetSpeed: (speed: number) => void
    onSubDelayChange: (delta: number) => void
    onSubDelayReset: () => void
    onAudioDelayChange: (delta: number) => void
    onAudioDelayReset: () => void
    onSetSubFontSize: (size: number) => void
    onSetAudioTrack: (id: number) => void
    onSetSubtitleTrack: (id: number) => void
    onToggleAutoNext: () => void
    onToggleAutoSkipOpEd: () => void
}

const TITLES: Partial<Record<PlayerPanel, string>> = {
    main: "Player settings",
    episodes: "Episodes",
    "audio-subtitles": "Audio & subtitles",
    speed: "Playback speed",
    "seek-buttons": "D-pad seek",
    "video-sources": "Video source",
    "video-output": "Video renderer",
    "subtitle-delay": "Subtitle delay",
    "audio-delay": "Audio delay",
    "subtitle-size": "Subtitle size",
    "audio-tracks": "Audio tracks",
    "subtitle-tracks": "Subtitle tracks",
}

const ICON = tvSize(21)

export function TVPlayerPanel(props: Props) {
    const back = getBackPanel(props.panel)
    const title = TITLES[props.panel] ?? "Player settings"

    return (
        <TVDrawer
            open
            // RNM uses another window. Closing it over SurfaceView can leave focus in the dismissed window.
            inline={Platform.OS === "android"}
            onOpenChange={(open) => {
                if (!open) props.onClose()
            }}
            onRequestClose={() => {
                if (back) {
                    props.onNavigate(back)
                    return
                }
                props.onClose()
            }}
            title={title}
            subtitle="Now playing"
            width={tvSize(720)}
            focusKey={props.panel}
        >
            {back !== null ? (
                <View style={{ paddingHorizontal: tvSize(30), paddingTop: tvSize(2) }}>
                    <TVButton
                        label="Back"
                        icon={<ChevronLeft size={ICON} color="#ffffff" />}
                        size="compact"
                        hasTVPreferredFocus
                        onPress={() => props.onNavigate(back)}
                    />
                </View>
            ) : null}
            <PanelContent {...props} preferred={back === null} />
        </TVDrawer>
    )
}

function PanelContent(props: Props & { preferred: boolean }) {
    switch (props.panel) {
        case "main":
            return <Main {...props} />
        case "episodes":
            return <Episodes {...props} />
        case "audio-subtitles":
            return <TracksHome {...props} />
        case "speed":
            return <ChoiceList
                values={SPEED_OPTIONS}
                active={(speed) => Math.abs(speed - props.state.speed) < 0.01}
                label={(speed) => speed === 1 ? "Normal" : `${speed}x`}
                onPress={(speed) => {
                    props.onSetSpeed(speed)
                    props.onClose()
                }}
                preferred={props.preferred}
            />
        case "seek-buttons":
            return <ChoiceList
                values={BUTTON_SEEK_OPTIONS}
                active={(seconds) => seconds === props.prefs.buttonSeekSec}
                label={formatSecondsLabel}
                onPress={(seconds) => {
                    props.updatePrefs({ buttonSeekSec: seconds })
                    props.onClose()
                }}
                preferred={props.preferred}
                text="Left and right use this amount while the controls are open or hidden."
            />
        case "video-output":
            return <VideoOutput {...props} />
        case "video-sources":
            return <VideoSources {...props} />
        case "audio-tracks":
            return <TrackList
                tracks={props.state.audioTracks}
                onPress={(id) => {
                    props.onSetAudioTrack(id)
                    props.onClose()
                }}
                preferred={props.preferred}
            />
        case "subtitle-tracks":
            return <TrackList
                tracks={props.state.subtitleTracks}
                allowOff
                onPress={(id) => {
                    props.onSetSubtitleTrack(id)
                    props.onClose()
                }}
                preferred={props.preferred}
            />
        case "subtitle-delay":
            return <Delay
                label="Subtitle"
                value={props.state.subtitleDelay}
                step={SUBTITLE_DELAY_STEP}
                onChange={props.onSubDelayChange}
                onReset={props.onSubDelayReset}
            />
        case "audio-delay":
            return <Delay
                label="Audio"
                value={props.state.audioDelay}
                step={AUDIO_DELAY_STEP}
                onChange={props.onAudioDelayChange}
                onReset={props.onAudioDelayReset}
            />
        case "subtitle-size":
            return <ChoiceList
                values={SUBTITLE_FONT_SIZE_OPTIONS}
                active={(size) => size === props.prefs.subtitleFontSize}
                label={(size) => `${size}`}
                onPress={(size) => {
                    props.onSetSubFontSize(size)
                    props.onClose()
                }}
                preferred={props.preferred}
            />
        default:
            return (
                <View style={{ padding: tvSize(30) }}>
                    <Text className="text-white/50" style={{ fontSize: tvSize(20) }}>
                        This option is not available on TV.
                    </Text>
                </View>
            )
    }
}

function Main(props: Props & { preferred: boolean }) {
    const rows = [
        {
            label: "Playback speed",
            detail: props.state.speed === 1 ? "Normal" : `${props.state.speed}x`,
            icon: <Gauge size={ICON} color="#ffffff" />,
            press: () => props.onNavigate("speed"),
        },
        {
            label: "Seek",
            detail: formatSecondsLabel(props.prefs.buttonSeekSec),
            icon: <RotateCw size={ICON} color="#ffffff" />,
            press: () => props.onNavigate("seek-buttons"),
        },
        {
            label: "Audio & subtitles",
            detail: "Tracks, delay and subtitle size",
            icon: <Captions size={ICON} color="#ffffff" />,
            press: () => props.onNavigate("audio-subtitles"),
        },
        {
            label: "Auto next episode",
            detail: props.prefs.autoNextEpisode ? "On" : "Off",
            icon: <SkipForward size={ICON} color="#ffffff" />,
            press: props.onToggleAutoNext,
        },
        {
            label: "Auto skip OP / ED",
            detail: props.prefs.autoSkipOpEd ? "On" : "Off",
            icon: <SkipForward size={ICON} color="#ffffff" />,
            press: props.onToggleAutoSkipOpEd,
        },
        {
            label: "Playback stats",
            detail: props.prefs.showStats ? "On" : "Off",
            icon: <Activity size={ICON} color="#ffffff" />,
            press: () => props.updatePrefs({ showStats: !props.prefs.showStats }),
        },
    ]

    if ((props.videoSources?.length ?? 0) > 1 && props.videoSource) {
        rows.push({
            label: "Video source",
            detail: [props.videoSource.server, props.videoSource.quality].filter(Boolean).join(" · "),
            icon: <Clapperboard size={ICON} color="#ffffff" />,
            press: () => props.onNavigate("video-sources"),
        })
    }

    rows.push({
        label: "Video renderer",
        detail: props.prefs.androidVideoOutput === "gpu-next" ? "Modern" : "Compatibility",
        icon: <Cpu size={ICON} color="#ffffff" />,
        press: () => props.onNavigate("video-output"),
    })

    return <ButtonList rows={rows} preferred={props.preferred} />
}

function TracksHome(props: Props & { preferred: boolean }) {
    const audio = props.state.audioTracks.find(track => track.selected)
    const subtitle = props.state.subtitleTracks.find(track => track.selected)
    const rows = [
        {
            label: "Audio track",
            detail: trackName(audio, "No audio tracks"),
            icon: <Mic2 size={ICON} color="#ffffff" />,
            press: () => props.onNavigate("audio-tracks"),
        },
        {
            label: "Subtitle track",
            detail: trackName(subtitle, "Off"),
            icon: <Captions size={ICON} color="#ffffff" />,
            press: () => props.onNavigate("subtitle-tracks"),
        },
        {
            label: "Subtitle delay",
            detail: delayLabel(props.state.subtitleDelay),
            icon: <Timer size={ICON} color="#ffffff" />,
            press: () => props.onNavigate("subtitle-delay"),
        },
        {
            label: "Audio delay",
            detail: delayLabel(props.state.audioDelay),
            icon: <Timer size={ICON} color="#ffffff" />,
            press: () => props.onNavigate("audio-delay"),
        },
        {
            label: "Subtitle size",
            detail: `${props.prefs.subtitleFontSize}`,
            icon: <Type size={ICON} color="#ffffff" />,
            press: () => props.onNavigate("subtitle-size"),
        },
    ]

    return <ButtonList rows={rows} preferred={props.preferred} />
}

type Row = {
    label: string
    detail?: string
    icon?: React.ReactNode
    press: () => void
}

type PanelRowProps = {
    label: string
    detail?: string
    icon?: React.ReactNode
    active?: boolean
    preferred?: boolean
    onPress: () => void
}

function TVPanelRow({
    label,
    detail,
    icon,
    active,
    preferred,
    onPress,
}: PanelRowProps) {
    const focus = useTVFocus(1.015)

    return (
        <Pressable
            onPress={onPress}
            hasTVPreferredFocus={preferred}
            onFocus={focus.focus}
            onBlur={focus.blur}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{ padding: tvSize(5) }}
        >
            <Animated.View
                style={[
                    focus.style,
                    {
                        minHeight: tvSize(72),
                        borderRadius: tvSize(13),
                        borderWidth: tvSize(2),
                        borderColor: focus.focused ? "#ffffff" : "transparent",
                        backgroundColor: active
                            ? BRAND_ACCENT_TINT
                            : focus.focused
                                ? "rgba(255,255,255,0.1)"
                                : "transparent",
                        paddingHorizontal: tvSize(18),
                        paddingVertical: tvSize(12),
                        flexDirection: "row",
                        alignItems: "center",
                        gap: tvSize(15),
                    },
                ]}
            >
                {icon ? (
                    <View
                        style={{
                            width: tvSize(28),
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        {icon}
                    </View>
                ) : null}
                <View style={{ flex: 1, gap: tvSize(2) }}>
                    <Text
                        className="font-semibold"
                        style={{
                            color: active ? "#c5c0ff" : "#ffffff",
                            fontSize: tvSize(21),
                        }}
                        numberOfLines={1}
                    >
                        {label}
                    </Text>
                    {detail ? (
                        <Text
                            className="text-white/45"
                            style={{ fontSize: tvSize(17) }}
                            numberOfLines={1}
                        >
                            {detail}
                        </Text>
                    ) : null}
                </View>
            </Animated.View>
        </Pressable>
    )
}

function TVPanelCard({ children }: { children: React.ReactNode }) {
    return (
        <View
            style={{
                borderRadius: tvSize(16),
                borderWidth: tvSize(1),
                borderColor: "rgba(255,255,255,0.06)",
                backgroundColor: "rgba(255,255,255,0.025)",
                padding: tvSize(3),
            }}
        >
            {children}
        </View>
    )
}

function ButtonList({ rows, preferred }: { rows: Row[]; preferred: boolean }) {
    return (
        <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
                padding: tvSize(30),
                paddingTop: tvSize(18),
                paddingBottom: tvSize(60),
            }}
        >
            <TVPanelCard>
                {rows.map((row, index) => (
                    <TVPanelRow
                        key={row.label}
                        label={row.label}
                        detail={row.detail}
                        icon={row.icon}
                        preferred={preferred && index === 0}
                        onPress={row.press}
                    />
                ))}
            </TVPanelCard>
        </ScrollView>
    )
}

function Episodes(props: Props & { preferred: boolean }) {
    const episodes = props.episodes ?? []

    if (episodes.length === 0) {
        return <Empty text="No episodes available" />
    }

    return (
        <FlatList
            data={episodes}
            keyExtractor={(episode) => `${episode.episodeNumber}`}
            contentContainerStyle={{
                padding: tvSize(30),
                paddingTop: tvSize(18),
                paddingBottom: tvSize(60),
            }}
            renderItem={({ item, index }) => {
                const current = item.episodeNumber === props.currentEpisodeNumber
                return (
                    <TVPanelRow
                        label={item.displayTitle || `Episode ${item.episodeNumber}`}
                        detail={[
                            current ? "Now playing" : "",
                            item.episodeTitle ?? "",
                        ].filter(Boolean).join(" · ")}
                        icon={current
                            ? <Check size={ICON} color={BRAND_ACCENT} />
                            : <List size={ICON} color="#ffffff" />}
                        preferred={props.preferred && index === 0}
                        active={current}
                        onPress={() => props.onPlayEpisode?.(item)}
                    />
                )
            }}
        />
    )
}

function ChoiceList<T extends number>({
    values,
    active,
    label,
    onPress,
    preferred,
    text,
}: {
    values: readonly T[]
    active: (value: T) => boolean
    label: (value: T) => string
    onPress: (value: T) => void
    preferred: boolean
    text?: string
}) {
    return (
        <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
                padding: tvSize(30),
                paddingTop: tvSize(18),
                paddingBottom: tvSize(60),
            }}
        >
            {text ? (
                <Text
                    className="text-white/55"
                    style={{ fontSize: tvSize(18), lineHeight: tvSize(26), marginBottom: tvSize(4) }}
                >
                    {text}
                </Text>
            ) : null}
            <TVPanelCard>
                {values.map((value, index) => (
                    <TVPanelRow
                        key={value}
                        label={label(value)}
                        icon={active(value) ? <Check size={ICON} color={BRAND_ACCENT} /> : undefined}
                        active={active(value)}
                        preferred={preferred && index === 0}
                        onPress={() => onPress(value)}
                    />
                ))}
            </TVPanelCard>
        </ScrollView>
    )
}

function TrackList({
    tracks,
    allowOff,
    onPress,
    preferred,
}: {
    tracks: PlayerTrack[]
    allowOff?: boolean
    onPress: (id: number) => void
    preferred: boolean
}) {
    const rows = allowOff
        ? [{ id: -1, type: "subtitle" as const, title: "Off", selected: !tracks.some(track => track.selected) }, ...tracks]
        : tracks

    if (rows.length === 0) return <Empty text="No tracks available" />

    return (
        <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
                padding: tvSize(30),
                paddingTop: tvSize(18),
                paddingBottom: tvSize(60),
            }}
        >
            <TVPanelCard>
                {rows.map((track, index) => (
                    <TVPanelRow
                        key={track.id}
                        label={track.title || track.language || `Track ${track.id}`}
                        detail={track.title && track.language ? track.language : undefined}
                        icon={track.selected ? <Check size={ICON} color={BRAND_ACCENT} /> : undefined}
                        active={track.selected}
                        preferred={preferred && index === 0}
                        onPress={() => onPress(track.id)}
                    />
                ))}
            </TVPanelCard>
        </ScrollView>
    )
}

function Delay({
    label,
    value,
    step,
    onChange,
    onReset,
}: {
    label: string
    value: number
    step: number
    onChange: (delta: number) => void
    onReset: () => void
}) {
    return (
        <View
            style={{
                padding: tvSize(30),
                paddingTop: tvSize(28),
                gap: tvSize(28),
            }}
        >
            <View style={{ gap: tvSize(4), alignItems: "center" }}>
                <Text
                    className="font-black text-white"
                    style={{ fontSize: tvSize(48), fontVariant: ["tabular-nums"] }}
                >
                    {value > 0 ? "+" : ""}{value.toFixed(1)}s
                </Text>
                <Text className="text-white/45" style={{ fontSize: tvSize(18) }}>
                    {value === 0 ? `No ${label.toLowerCase()} delay` : value > 0 ? "Delayed" : "Earlier"}
                </Text>
            </View>
            <TVFocusGuideView
                trapFocusLeft
                trapFocusRight
                style={{ flexDirection: "row", justifyContent: "center", gap: tvSize(12) }}
            >
                <TVButton
                    label={`Earlier ${step.toFixed(1)}s`}
                    onPress={() => onChange(-step)}
                />
                <TVButton
                    label="Reset"
                    variant={value === 0 ? "ghost" : "danger"}
                    disabled={value === 0}
                    onPress={onReset}
                />
                <TVButton
                    label={`Later ${step.toFixed(1)}s`}
                    onPress={() => onChange(step)}
                />
            </TVFocusGuideView>
        </View>
    )
}

function VideoOutput(props: Props & { preferred: boolean }) {
    const rows: Array<{ value: MpvVideoOutput; label: string; detail: string }> = [
        {
            value: "gpu-next",
            label: "Modern",
            detail: "Recommended for current Android TV devices.",
        },
        {
            value: "gpu",
            label: "Compatibility",
            detail: "Use if the modern renderer has visual problems.",
        },
    ]

    return (
        <ScrollView
            contentContainerStyle={{
                padding: tvSize(30),
                paddingTop: tvSize(18),
            }}
        >
            <TVPanelCard>
                {rows.map((row, index) => {
                    const active = row.value === props.prefs.androidVideoOutput
                    return (
                        <TVPanelRow
                            key={row.value}
                            label={row.label}
                            detail={row.detail}
                            icon={active
                                ? <Check size={ICON} color={BRAND_ACCENT} />
                                : <Cpu size={ICON} color="#ffffff" />}
                            active={active}
                            preferred={props.preferred && index === 0}
                            onPress={() => {
                                props.updatePrefs({ androidVideoOutput: row.value })
                                props.onClose()
                            }}
                        />
                    )
                })}
            </TVPanelCard>
        </ScrollView>
    )
}

function VideoSources(props: Props & { preferred: boolean }) {
    const sources = props.videoSources ?? []
    if (sources.length === 0) return <Empty text="No other video sources available" />

    return (
        <ScrollView
            contentContainerStyle={{
                padding: tvSize(30),
                paddingTop: tvSize(18),
                paddingBottom: tvSize(60),
            }}
        >
            <TVPanelCard>
                {sources.map((source, index) => {
                    const active = source.url === props.videoSource?.url
                    const detail = [source.label, source.quality]
                        .filter((value, valueIndex, values) => value && values.indexOf(value) === valueIndex)
                        .join(" · ")
                    return (
                        <TVPanelRow
                            key={`${source.url}-${source.server}-${source.quality}`}
                            label={source.server || `Source ${index + 1}`}
                            detail={detail}
                            icon={active
                                ? <Check size={ICON} color={BRAND_ACCENT} />
                                : <Clapperboard size={ICON} color="#ffffff" />}
                            active={active}
                            preferred={props.preferred && index === 0}
                            onPress={() => {
                                props.onSetVideoSource?.(source)
                                props.onClose()
                            }}
                        />
                    )
                })}
            </TVPanelCard>
        </ScrollView>
    )
}

function Empty({ text }: { text: string }) {
    return (
        <View style={{ padding: tvSize(50), alignItems: "center" }}>
            <Text className="font-medium text-white/45" style={{ fontSize: tvSize(20) }}>
                {text}
            </Text>
        </View>
    )
}

function trackName(track: PlayerTrack | undefined, fallback: string) {
    return track?.title || track?.language || fallback
}

function delayLabel(value: number) {
    if (value === 0) return "Off"
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}s`
}
