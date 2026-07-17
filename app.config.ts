import { ConfigContext, ExpoConfig } from "expo/config"

export default ({ config }: ConfigContext): ExpoConfig => ({
    ...config,
    name: "Seanime",
    slug: "seanime-app",
    version: "0.1.21",
    orientation: "portrait",
    icon: "./src/assets/images/icon.png",
    scheme: "seanime",
    userInterfaceStyle: "automatic",
    jsEngine: "hermes",
    runtimeVersion: {
        policy: "appVersion",
    },
    updates: {
        enabled: true,
        url: "https://seanime.app/api/ota/manifest",
        checkAutomatically: "NEVER",
        fallbackToCacheTimeout: 0,
        requestHeaders: {
            "expo-channel-name": "stable",
        },
    },
    ios: {
        buildNumber: "21",
        appleTeamId: process.env.EXPO_APPLE_TEAM_ID || "",
        supportsTablet: true,
        bundleIdentifier: process.env.EXPO_IOS_BUNDLE_ID || "app.seanime.tenji",
        infoPlist: {
            NSLocalNetworkUsageDescription: "Seanime needs local network access to connect to your server on your home network.",
            UIBackgroundModes: [
                "audio",
            ],
            LSApplicationQueriesSchemes: [
                "vlc",
                "outplayer",
                "infuse",
                "nplayer-http",
                "oplayer",
                "mangoplayer",
            ],
            UISupportedInterfaceOrientations: [
                "UIInterfaceOrientationPortrait",
                "UIInterfaceOrientationPortraitUpsideDown",
                "UIInterfaceOrientationLandscapeLeft",
                "UIInterfaceOrientationLandscapeRight",
            ],
            "UISupportedInterfaceOrientations~ipad": [
                "UIInterfaceOrientationPortrait",
                "UIInterfaceOrientationPortraitUpsideDown",
                "UIInterfaceOrientationLandscapeLeft",
                "UIInterfaceOrientationLandscapeRight",
            ],
        },
    },
    android: {
        jsEngine: "hermes",
        versionCode: 21,
        usesCleartextTraffic: true,
        adaptiveIcon: {
            foregroundImage: "./src/assets/images/adaptive-icon.png",
            backgroundColor: "#171140",
        },
        permissions: [
            "WRITE_SETTINGS",
        ],
        package: "app.seanime.tenji",
    } as any,
    plugins: [
        "expo-router",
        [
            "expo-splash-screen",
            {
                image: "./src/assets/images/splash-logo.png",
                resizeMode: "contain",
                backgroundColor: "#070707",
                android: {
                    imageWidth: 200,
                    resizeMode: "contain",
                },
                ios: {
                    imageWidth: 100,
                    resizeMode: "contain",
                },
            },
        ],
        "@react-native-community/datetimepicker",
        "./plugins/withAndroidExternalPlayerQueries",
        "./plugins/withAndroidLanCleartext",
        "./plugins/withAndroidReactNativeArchitectures",
        "./plugins/withLibcppPickFirst",
        "./plugins/withPiPSupport",
        "./plugins/withMPVKitiOS",
        "./plugins/withExpoDownloadManageriOS",
        "./plugins/withExpoOfflineLoggeriOS",
        "expo-updates",
        "expo-image",
    ],
    experiments: {
        typedRoutes: true,
        reactCompiler: true,
    },
});
