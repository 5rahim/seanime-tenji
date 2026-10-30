import { MpvPlayerModule } from "expo-mpv-player"
import React from "react"
import { AppState, Platform } from "react-native"
import { runAfterInteractions } from "@/lib/run-after-interactions"

type ScreenOrientationModule = typeof import("expo-screen-orientation")
type Orientation = import("expo-screen-orientation").Orientation
type OrientationLock = import("expo-screen-orientation").OrientationLock

const ScreenOrientation = Platform.isTV
    ? null
    : require("expo-screen-orientation") as ScreenOrientationModule
const Accelerometer = Platform.isTV
    ? null
    : (require("expo-sensors") as typeof import("expo-sensors")).Accelerometer

type UseLandscapeOrientationLockParams = {
    restoreLock?: OrientationLock
}

export function useLandscapeOrientationLock({
    restoreLock,
}: UseLandscapeOrientationLockParams = {}) {
    const currentLockRef = React.useRef<OrientationLock | null>(
        ScreenOrientation
            ? Platform.OS === "ios"
                ? ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT
                : ScreenOrientation.OrientationLock.LANDSCAPE
            : null,
    )

    React.useEffect(() => {
        if (!ScreenOrientation || !Accelerometer || currentLockRef.current === null) return

        let accelerometerSubscription: { remove: () => void } | null = null
        let currentLock = currentLockRef.current
        const portraitOrientations = new Set<Orientation>([
            ScreenOrientation.Orientation.PORTRAIT_DOWN,
            ScreenOrientation.Orientation.PORTRAIT_UP,
            ScreenOrientation.Orientation.UNKNOWN,
        ])

        const lockNativeLandscape = () => {
            if (Platform.OS !== "ios") return

            try {
                MpvPlayerModule.lockLandscape()
            }
            catch {
            }
        }

        const unlockNativeOrientation = () => {
            if (Platform.OS !== "ios") return

            try {
                MpvPlayerModule.unlockOrientation()
            }
            catch {
            }
        }

        const lockLandscape = async (
            lockType: OrientationLock = currentLock,
        ) => {
            try {
                lockNativeLandscape()
                await ScreenOrientation.lockAsync(lockType)
                currentLock = lockType
                currentLockRef.current = lockType
            }
            catch {
            }
        }

        void lockLandscape(currentLock)

        const orientationSubscription = Platform.OS === "ios"
            ? ScreenOrientation.addOrientationChangeListener(({ orientationInfo }) => {
                if (!portraitOrientations.has(orientationInfo.orientation)) return
                void lockLandscape(currentLock)
            })
            : null

        if (Platform.OS === "ios") {
            Accelerometer.setUpdateInterval(500)
            accelerometerSubscription = Accelerometer.addListener(({ x }) => {
                if (x > 0.6 && currentLock !== ScreenOrientation.OrientationLock.LANDSCAPE_LEFT) {
                    void lockLandscape(ScreenOrientation.OrientationLock.LANDSCAPE_LEFT)
                } else if (x < -0.6 && currentLock !== ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT) {
                    void lockLandscape(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT)
                }
            })
        }

        const appStateSubscription = AppState.addEventListener("change", nextState => {
            if (nextState === "active") {
                void lockLandscape(currentLock)
            }
        })

        return () => {
            accelerometerSubscription?.remove()
            orientationSubscription?.remove()
            appStateSubscription.remove()
            unlockNativeOrientation()

            requestAnimationFrame(() => {
                runAfterInteractions(() => {
                    void ScreenOrientation.lockAsync(
                        restoreLock ?? ScreenOrientation.OrientationLock.PORTRAIT_UP,
                    )
                })
            })
        }
    }, [restoreLock])
}
