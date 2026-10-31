import { NavigationBar } from "expo-navigation-bar"
import { Platform } from "react-native"

export function setAndroidNavigationBar(theme: "light" | "dark") {
    if (Platform.OS !== "android" || Platform.isTV) return
    NavigationBar.setStyle(theme === "dark" ? "light" : "dark")
}
