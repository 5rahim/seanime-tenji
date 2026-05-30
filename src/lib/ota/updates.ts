import { getStoredString, setStoredString } from "@/atoms/storage"
import { isManualOfflineModeEnabled } from "@/lib/connection-state"
import { toast } from "@/lib/utils/toast"
import Constants from "expo-constants"
import * as Updates from "expo-updates"
import * as React from "react"
import { Alert } from "react-native"

type SeanimeUpdateExtra = {
    otaVersion?: string
    updateGroup?: string
    channel?: string
    platform?: string
    appVersion?: string
    publishedAt?: string
}

type OtaVersionInfo = {
    appVersion: string
    otaVersion: string
    detail: string
}

const CHECK_DELAY_MS = 1200
const DISMISSED_OTA_ID_KEY = "sea-ota-dismissed-id"

export function OtaUpdatePrompt() {
    const promptShownRef = React.useRef(false)

    React.useEffect(() => {
        if (__DEV__ || !Updates.isEnabled || isManualOfflineModeEnabled()) {
            return
        }

        let cancelled = false

        const checkTimeout = setTimeout(() => {
            void checkForPromptableUpdate({
                shouldCancel: () => cancelled,
                markPromptShown: () => {
                    promptShownRef.current = true
                },
                hasPromptShown: () => promptShownRef.current,
            })
        }, CHECK_DELAY_MS)

        return () => {
            cancelled = true
            clearTimeout(checkTimeout)
        }
    }, [])

    return null
}

export function getOtaVersionInfo(): OtaVersionInfo {
    const appVersion = Constants.expoConfig?.version ?? "unknown"
    const extra = getSeanimeUpdateExtra(Updates.manifest)
    const channel = extra.channel ?? Updates.channel ?? "stable"
    const fallbackVersion = Updates.isEmbeddedLaunch
        ? "embedded"
        : Updates.updateId
            ? shortUpdateId(Updates.updateId)
            : "development"
    const otaVersion = extra.otaVersion ?? fallbackVersion
    const runtimeVersion = Updates.runtimeVersion ?? appVersion

    return {
        appVersion,
        otaVersion,
        detail: `${channel} · runtime ${runtimeVersion}`,
    }
}

export async function checkForOtaUpdateManually(): Promise<void> {
    if (__DEV__ || !Updates.isEnabled) {
        toast.info("OTA updates are available in release builds")
        return
    }

    if (isManualOfflineModeEnabled()) {
        toast.info("Disable offline mode to check for updates")
        return
    }

    try {
        const result = await Updates.checkForUpdateAsync()
        if (!result.isAvailable || result.isRollBackToEmbedded) {
            toast.info("Seanime is up to date")
            return
        }

        promptInstallUpdate(result.manifest)
    }
    catch (error: any) {
        console.error(error)
        toast.error(`Failed to check for updates`)
    }
}

async function checkForPromptableUpdate({
    shouldCancel,
    markPromptShown,
    hasPromptShown,
}: {
    shouldCancel: () => boolean
    markPromptShown: () => void
    hasPromptShown: () => boolean
}) {
    if (hasPromptShown()) {
        return
    }

    try {
        const result = await Updates.checkForUpdateAsync()
        if (shouldCancel() || hasPromptShown() || !result.isAvailable || result.isRollBackToEmbedded) {
            return
        }

        const updateId = result.manifest && typeof (result.manifest as any).id === "string" ? (result.manifest as any).id : undefined
        if (updateId && getStoredString(DISMISSED_OTA_ID_KEY) === updateId) {
            return
        }

        markPromptShown()
        promptInstallUpdate(result.manifest)
    }
    catch {
        // expected when the update server is unreachable
    }
}

function promptInstallUpdate(manifest: unknown) {
    const extra = getSeanimeUpdateExtra(manifest)
    const versionLabel = extra.otaVersion ? `OTA ${extra.otaVersion}` : "A new update"
    const updateId = isRecord(manifest) && typeof manifest.id === "string" ? manifest.id : undefined

    Alert.alert(
        "Update available",
        `${versionLabel} is ready to install.`,
        [
            {
                text: "Later",
                style: "cancel",
                onPress: () => {
                    if (updateId) {
                        setStoredString(DISMISSED_OTA_ID_KEY, updateId)
                    }
                },
            },
            {
                text: "Install",
                onPress: () => {
                    void fetchAndPromptReload(updateId, extra.otaVersion)
                },
            },
        ],
    )
}

async function fetchAndPromptReload(updateId: string | undefined, otaVersion: string | undefined) {
    try {
        const result = await Updates.fetchUpdateAsync()
        if (!result.isNew && !result.isRollBackToEmbedded) {
            toast.info("Seanime is already up to date")
            return
        }

        const versionLabel = otaVersion ? `OTA ${otaVersion}` : "The update"
        Alert.alert(
            "Restart Seanime?",
            `${versionLabel} has been downloaded and will load after restart.`,
            [
                { text: "Later", style: "cancel" },
                {
                    text: "Restart",
                    onPress: () => {
                        void Updates.reloadAsync()
                    },
                },
            ],
        )
    }
    catch (error: any) {
        console.error(error)
        if (updateId) {
            setStoredString(DISMISSED_OTA_ID_KEY, updateId)
        }
        toast.error(`Failed to download update: ${error?.message || error}`)
    }
}

function getSeanimeUpdateExtra(manifest: unknown): SeanimeUpdateExtra {
    if (!isRecord(manifest)) {
        return {}
    }

    const extra = manifest.extra
    if (!isRecord(extra)) {
        return {}
    }

    const seanime = extra.seanime
    if (!isRecord(seanime)) {
        return {}
    }

    return {
        otaVersion: readString(seanime.otaVersion),
        updateGroup: readString(seanime.updateGroup),
        channel: readString(seanime.channel),
        platform: readString(seanime.platform),
        appVersion: readString(seanime.appVersion),
        publishedAt: readString(seanime.publishedAt),
    }
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function shortUpdateId(updateId: string): string {
    return updateId.slice(0, 8)
}
