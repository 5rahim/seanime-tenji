import { Stack } from "expo-router"

export default function ProfileLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="server-downloads" />
            <Stack.Screen name="unmatched" />
            <Stack.Screen name="download-settings" />
            <Stack.Screen name="my-lists" />
            <Stack.Screen name="active-stream" />
            <Stack.Screen name="logs" />
        </Stack>
    )
}
