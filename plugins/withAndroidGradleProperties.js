const { withGradleProperties } = require("expo/config-plugins")

const PROPS = {
    reactNativeArchitectures: "arm64-v8a,armeabi-v7a",
    "org.gradle.jvmargs": "-Xmx2048m -XX:MaxMetaspaceSize=1024m",
    "android.enableMinifyInReleaseBuilds": "false",
}

function setProp(props, key, value) {
    const prop = props.find(item => item.type === "property" && item.key === key)
    if (prop) {
        prop.value = value
        return
    }
    props.push({ type: "property", key, value })
}

function withAndroidGradleProperties(config) {
    return withGradleProperties(config, config => {
        for (const [key, value] of Object.entries(PROPS)) {
            setProp(config.modResults, key, value)
        }
        return config
    })
}

module.exports = withAndroidGradleProperties
