const isTV = process.env.EXPO_TV === "1"
const off = { platforms: { ios: null } }

module.exports = {
    dependencies: {
        "@react-native-menu/menu": off,
        ...(isTV
            ? {
                "@react-native-community/datetimepicker": off,
                "@react-native-community/slider": off,
                "react-native-volume-manager": off,
            }
            : {}),
    },
}
