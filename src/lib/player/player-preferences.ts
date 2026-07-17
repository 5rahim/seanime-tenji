import type { MpvVideoOutput } from "expo-mpv-player"
import React from "react"
import { createMMKV } from "react-native-mmkv"

const storage = createMMKV({ id: "seanime-player-prefs" })

/**
 * Player preferences persisted across sessions via MMKV.
 */
export type PlayerPreferences = {
    /** Playback speed multiplier (0.25 – 4.0). Default 1.0. */
    speed: number
    /** Subtitle delay in seconds. Positive = later, negative = earlier. Default 0. */
    subtitleDelay: number
    /** Audio delay in seconds. Default 0. */
    audioDelay: number
    /** Subtitle font size override (20 – 100). Default 48. */
    subtitleFontSize: number
    /** Whether to auto-play when source loads. Default true. */
    autoPlay: boolean
    /** Skip intro/outro seconds. Default 85. */
    skipDurationSec: number
    /** Whether to show subtitles by default. Default true. */
    showSubtitles: boolean
    /**
     * Comma-separated language tags to prefer for the default audio track.
     * e.g. "jpn, jp, ja, japanese". First match wins.
     */
    preferredAudioLanguages: string
    /**
     * Comma-separated language tags to prefer for the default subtitle track.
     * e.g. "eng, en, english". First match wins.
     */
    preferredSubtitleLanguages: string
    ignoredSubtitleLabels: string
    /** Seek amount in seconds for double-tap gestures. Default 3. */
    doubleTapSeekSec: number
    /** Seek amount in seconds for forward/back controls. Default 3. */
    buttonSeekSec: number
    /** Speed multiplier for long-press fast forward. Default 2.0. */
    longPressFastForwardSpeed: number
    /** Whether the player should automatically advance near the end of an episode. */
    autoNextEpisode: boolean
    /** Whether tapping the center of the screen toggles play/pause. */
    centerTapPlayPause: boolean
    /** Whether side vertical swipes adjust brightness and volume. */
    sideSwipeBrightnessVolume: boolean
    // playbackBrightness: number | null
    autoSkipOpEd: boolean
    /** User-provided Wyzie Subs API key for external subtitle search. */
    wyzieApiKey: string
    /**
     * URL template for an external player, e.g. `vlc://{url}` or a custom scheme.
     * Null means use the built-in mpv player.
     */
    externalPlayerTemplate: string | null
    /** mpv video output. gpu-next is the default. */
    androidVideoOutput: MpvVideoOutput
}

const DEFAULTS: PlayerPreferences = {
    speed: 1.0,
    subtitleDelay: 0,
    audioDelay: 0,
    subtitleFontSize: 48,
    autoPlay: true,
    skipDurationSec: 85,
    showSubtitles: true,
    preferredAudioLanguages: "jpn, jp, ja, japanese",
    preferredSubtitleLanguages: "eng, en, english",
    ignoredSubtitleLabels: "signs & songs, signs, songs, sign, song",
    doubleTapSeekSec: 3,
    buttonSeekSec: 3,
    longPressFastForwardSpeed: 2.0,
    autoNextEpisode: true,
    centerTapPlayPause: true,
    sideSwipeBrightnessVolume: true,
    // playbackBrightness: null,
    autoSkipOpEd: false,
    wyzieApiKey: "",
    externalPlayerTemplate: null,
    androidVideoOutput: "gpu-next",
}

const STORAGE_KEY = "player-prefs"

/**
 * Read persisted player preferences. Missing keys are filled with defaults.
 */
export function getPlayerPreferences(): PlayerPreferences {
    const raw = storage.getString(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    try {
        const parsed = JSON.parse(raw) as Partial<PlayerPreferences>
        return { ...DEFAULTS, ...parsed }
    }
    catch {
        return { ...DEFAULTS }
    }
}

/**
 * Persist a partial update to player preferences.
 */
export function setPlayerPreferences(update: Partial<PlayerPreferences>) {
    const current = getPlayerPreferences()
    const next = { ...current, ...update }
    storage.set(STORAGE_KEY, JSON.stringify(next))
}

export function usePlayerPreferences() {
    const [prefs, setPrefsState] = React.useState(getPlayerPreferences)

    const updatePrefs = React.useCallback((update: Partial<PlayerPreferences>) => {
        setPrefsState((prev: PlayerPreferences) => {
            const next = { ...prev, ...update }
            setPlayerPreferences(next)
            return next
        })
    }, [])

    return [prefs, updatePrefs] as const
}

///////////////////////////////////////////////////////////////////////////////
// Track matching
///////////////////////////////////////////////////////////////////////////////

/**
 * e.g. "jpn, jp, ja, japanese" -> ["jpn", "jp", "ja", "japanese"]
 */
function parseLanguageTags(pref: string): string[] {
    return pref
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(Boolean)
}

/**
 * for each preferred tag (in order), check each track's
 * `language` and `title` fields (case-insensitive, substring match).
 */
export function findPreferredTrack(
    tracks: Array<{ id: number; language?: string; title?: string }>,
    preferenceString: string,
    ignoredString?: string,
): number | null {
    if (!tracks.length || !preferenceString.trim()) return null

    const tags = parseLanguageTags(preferenceString)
    const ignoredTags = ignoredString ? parseLanguageTags(ignoredString) : []

    for (const tag of tags) {
        for (const track of tracks) {
            const lang = (track.language ?? "").toLowerCase()
            const title = (track.title ?? "").toLowerCase()

            const isIgnored = ignoredTags.some(iTag => {
                return lang.includes(iTag) || title.includes(iTag)
            })
            if (isIgnored) continue

            if (lang.includes(tag) || title.includes(tag)) {
                return track.id
            }
        }
    }
    return null
}
