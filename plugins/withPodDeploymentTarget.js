/**
 * Expo Config Plugin: builds every pod for the app's minimum iOS version.
 *
 * Xcode 27 fails the build when a target is set below iOS 15, which a few pods
 * (RNSVG, ReachabilitySwift, Mute) still do on their resource bundle targets.
 */
const { withDangerousMod } = require("expo/config-plugins")
const fs = require("fs")
const path = require("path")

const POST_INSTALL_ANCHOR = "post_install do |installer|"
const MARKER = "# Build pods for the app's minimum iOS version"
const POST_INSTALL_LINES = `
    ${MARKER}
    app_deployment_target = podfile_properties['ios.deploymentTarget'] || '16.4'
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        deployment_target = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        next if deployment_target.nil? || deployment_target.to_f >= app_deployment_target.to_f
        build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = app_deployment_target
      end
    end
`

function withPodDeploymentTarget(config) {
    return withDangerousMod(config, [
        "ios",
        (config) => {
            const podfilePath = path.join(config.modRequest.platformProjectRoot, "Podfile")
            const podfile = fs.readFileSync(podfilePath, "utf-8")

            if (podfile.includes(MARKER)) return config

            const anchorIndex = podfile.indexOf(POST_INSTALL_ANCHOR)
            if (anchorIndex === -1) {
                throw new Error("[withPodDeploymentTarget] Could not find 'post_install' in Podfile")
            }

            const insertAt = anchorIndex + POST_INSTALL_ANCHOR.length
            fs.writeFileSync(podfilePath, podfile.slice(0, insertAt) + "\n" + POST_INSTALL_LINES + podfile.slice(insertAt))
            return config
        },
    ])
}

module.exports = withPodDeploymentTarget
