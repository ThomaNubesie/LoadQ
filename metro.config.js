// Expo's default Metro config + one redirect: app code's `react-native` imports go
// through utils/react-native-capped.js so every Text/TextInput caps the phone's
// text-size setting (components/CappedText.tsx). node_modules and the shim itself
// still get the real react-native.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const SHIM = path.resolve(__dirname, "utils/react-native-capped.js");
const CAPPED = path.resolve(__dirname, "components/CappedText.tsx");
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

const previous = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const from = context.originModulePath;
  if (moduleName === "react-native" && !from.includes(NODE_MODULES) && from !== SHIM && from !== CAPPED) {
    return { type: "sourceFile", filePath: SHIM };
  }
  return (previous ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
