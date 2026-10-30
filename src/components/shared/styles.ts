import { COLORS } from "@/constants/colors"
import type { NativeStackNavigationOptions } from "expo-router"
import { Platform } from "react-native"

export const Styles = {
    Container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
} satisfies Record<string, any>

export const StackScreen_MainStyle: NativeStackNavigationOptions = {
    headerLargeTitleEnabled: true,
    headerLargeTitleStyle: {
        color: COLORS.text,
        fontSize: 32,
    },
    headerLargeStyle: {
        backgroundColor: COLORS.background,
    },
    headerTitleStyle: {
        color: COLORS.text,
        fontSize: 32,
    },
    headerTintColor: COLORS.text,
    headerTransparent: Platform.OS === "ios",
    headerBlurEffect: "prominent",
    headerShadowVisible: false,
    animation: "slide_from_bottom",
}
