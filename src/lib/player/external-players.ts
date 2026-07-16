import { ExpoExternalPlayer } from "expo-external-player"
import { Linking, Platform } from "react-native"

export type ExternalPlayerPreset = {
    id: string
    name: string
    platform: "ios" | "android" | "both"
    /**
     * URL template where `{url}` is replaced with the stream URL.
     * For Android intent:// schemes, the `getExternalPlayerURL` helper strips the http(s):// prefix from the embedded URL automatically.
     */
    urlTemplate: string
    /** iOS URL scheme needed in LSApplicationQueriesSchemes for canOpenURL */
    iosScheme?: string
    /** android package name needed for package visibility and explicit intents */
    androidPackage?: string
}

export const EXTERNAL_PLAYER_PRESETS: ExternalPlayerPreset[] = [
    // iOS
    {
        id: "vlc-ios",
        name: "VLC",
        platform: "ios",
        urlTemplate: "vlc://{url}",
        iosScheme: "vlc",
    },
    {
        id: "outplayer",
        name: "OutPlayer",
        platform: "ios",
        urlTemplate: "outplayer://{url}",
        iosScheme: "outplayer",
    },
    {
        id: "infuse",
        name: "Infuse",
        platform: "ios",
        urlTemplate: "infuse://x-callback-url/play?url={url}",
        iosScheme: "infuse",
    },
    {
        id: "nplayer",
        name: "nPlayer",
        platform: "ios",
        // nPlayer prepends "nplayer-" before the full URL (including http://)
        urlTemplate: "nplayer-{url}",
        iosScheme: "nplayer-http",
    },
    {
        id: "oplayer",
        name: "OPlayer",
        platform: "ios",
        urlTemplate: "oplayer://{url}",
        iosScheme: "oplayer",
    },
    {
        id: "mango",
        name: "Mango Player",
        platform: "ios",
        urlTemplate: "mangoplayer://{url}",
        iosScheme: "mangoplayer",
    },
    // Android
    {
        id: "vlc-android",
        name: "VLC",
        platform: "android",
        urlTemplate: "intent://{url}#Intent;package=org.videolan.vlc;scheme=http;end",
        androidPackage: "org.videolan.vlc",
    },
    {
        id: "mpv-android",
        name: "mpv",
        platform: "android",
        urlTemplate: "intent://{url}#Intent;package=is.xyz.mpv;scheme=http;end",
        androidPackage: "is.xyz.mpv",
    },
    {
        id: "mpvex",
        name: "mpvEX",
        platform: "android",
        urlTemplate: "intent://{url}#Intent;package=app.marlboroadvance.mpvex;scheme=http;end",
        androidPackage: "app.marlboroadvance.mpvex",
    },
    {
        id: "mxplayer",
        name: "MX Player",
        platform: "android",
        urlTemplate: "intent://{url}#Intent;package=com.mxtech.videoplayer.ad;scheme=http;end",
        androidPackage: "com.mxtech.videoplayer.ad",
    },
    {
        id: "mxplayer-pro",
        name: "MX Player Pro",
        platform: "android",
        urlTemplate: "intent://{url}#Intent;package=com.mxtech.videoplayer.pro;scheme=http;end",
        androidPackage: "com.mxtech.videoplayer.pro",
    },
    {
        id: "justplayer",
        name: "Just Player",
        platform: "android",
        urlTemplate: "intent://{url}#Intent;package=com.brouken.player;scheme=http;end",
        androidPackage: "com.brouken.player",
    },
]

export const ANDROID_EXTERNAL_PLAYER_PACKAGES = EXTERNAL_PLAYER_PRESETS
    .map(preset => preset.androidPackage)
    .filter((packageName): packageName is string => !!packageName)

/** Returns only the presets that apply to the current platform. */
export function getPlatformExternalPlayers(): ExternalPlayerPreset[] {
    return EXTERNAL_PLAYER_PRESETS.filter(
        (p) => p.platform === "both" || p.platform === Platform.OS,
    )
}

/**
 * Build the final URL to hand to `Linking.openURL`.
 *
 * Handles:
 * - `{url}` template substitution
 * - intent:// scheme: strips http(s):// from the embedded URL so the
 *   final string is `intent://host/path#Intent;...`
 */
export function getExternalPlayerURL(template: string, streamUrl: string): string {
    let result = template.includes("{url}")
        ? template.replace("{url}", streamUrl)
        : streamUrl

    if (template.startsWith("intent://")) {
        const scheme = streamUrl.startsWith("https://") ? "https" : "http"
        result = result
            .replace("intent://http://", "intent://")
            .replace("intent://https://", "intent://")
            .replace("scheme=http;", `scheme=${scheme};`)
    }

    return result
}

export function getExternalPlayerPackageName(template: string): string | null {
    const match = /(?:^|;)package=([^;]+)/.exec(template)
    return match?.[1] ?? null
}

export async function openExternalPlayerURL(template: string, streamUrl: string): Promise<boolean> {
    // a downloaded file URL points into Seanime's private storage. we give the external player temporary access to the file
    if (streamUrl.startsWith("file://")) {
        if (Platform.OS === "android") {
            return ExpoExternalPlayer.openFile(streamUrl, getExternalPlayerPackageName(template))
        }

        if (Platform.OS === "ios") {
            return ExpoExternalPlayer.openFile(streamUrl)
        }
    }

    if (Platform.OS === "android") {
        const packageName = getExternalPlayerPackageName(template)
        if (packageName) {
            return ExpoExternalPlayer.open(streamUrl, packageName)
        }
    }

    const launchUrl = getExternalPlayerURL(template, streamUrl)

    try {
        // android package visibility can make canOpenURL return false for installed intent targets
        if (Platform.OS !== "android") {
            const supported = await Linking.canOpenURL(launchUrl).catch(() => true)
            if (!supported) return false
        }

        await Linking.openURL(launchUrl)
        return true
    }
    catch {
        return false
    }
}
