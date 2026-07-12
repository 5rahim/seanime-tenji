const { withAndroidManifest } = require("expo/config-plugins")

const EXTERNAL_PLAYER_PACKAGES = [
    "org.videolan.vlc",
    "is.xyz.mpv",
    "app.marlboroadvance.mpvex",
    "com.mxtech.videoplayer.ad",
    "com.mxtech.videoplayer.pro",
    "com.brouken.player",
]

const STREAM_SCHEMES = ["http", "https"]

function ensureQueries(manifest) {
    const root = manifest.manifest
    if (!Array.isArray(root.queries)) {
        root.queries = [{}]
    }

    if (!root.queries[0]) {
        root.queries[0] = {}
    }

    return root.queries[0]
}

function validatePackageQuery(queries, packageName) {
    if (!Array.isArray(queries.package)) {
        queries.package = []
    }

    const exists = queries.package.some(entry => entry?.$?.["android:name"] === packageName)
    if (!exists) {
        queries.package.push({ $: { "android:name": packageName } })
    }
}

function validateStreamIntentQuery(queries, scheme) {
    if (!Array.isArray(queries.intent)) {
        queries.intent = []
    }

    const exists = queries.intent.some(intent => {
        const hasViewAction = intent.action?.some(action => action?.$?.["android:name"] === "android.intent.action.VIEW")
        const hasScheme = intent.data?.some(data => data?.$?.["android:scheme"] === scheme)
        return hasViewAction && hasScheme
    })

    if (!exists) {
        queries.intent.push({
            action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
            category: [{ $: { "android:name": "android.intent.category.BROWSABLE" } }],
            data: [{ $: { "android:scheme": scheme } }],
        })
    }
}

function withAndroidExternalPlayerQueries(config) {
    return withAndroidManifest(config, config => {
        const queries = ensureQueries(config.modResults)

        EXTERNAL_PLAYER_PACKAGES.forEach(packageName => validatePackageQuery(queries, packageName))
        STREAM_SCHEMES.forEach(scheme => validateStreamIntentQuery(queries, scheme))

        return config
    })
}

module.exports = withAndroidExternalPlayerQueries
