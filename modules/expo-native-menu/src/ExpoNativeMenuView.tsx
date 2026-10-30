import { requireNativeViewManager } from "expo-modules-core"
import type { ComponentType } from "react"
import { Platform } from "react-native"
import type { ExpoNativeMenuViewProps } from "./ExpoNativeMenu.types"

export const ExpoNativeMenuView: ComponentType<ExpoNativeMenuViewProps> =
    Platform.OS === "ios" && !Platform.isTV
        ? requireNativeViewManager<ExpoNativeMenuViewProps>("ExpoNativeMenu")
        : () => null
