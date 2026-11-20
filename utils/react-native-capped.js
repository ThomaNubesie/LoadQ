// What app code gets for `import … from "react-native"` (see metro.config.js):
// everything from react-native, except Text/TextInput, which cap the system
// text-size setting (components/CappedText.tsx).
export * from "react-native";
export { Text, TextInput } from "../components/CappedText";
