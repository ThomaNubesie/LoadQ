// Text and TextInput with a ceiling on the phone's text-size setting.
//
// Drivers on older/smaller phones often turn system text size way up; LoadQ followed
// it without limit, so text outgrew its boxes and screens fell apart (lot names
// stacking letter-by-letter, buttons running into each other). Text still grows for
// readability, but never past MAX_FONT_SCALE. A screen can pass its own
// maxFontSizeMultiplier to override.
//
// Every `import { Text, TextInput } from "react-native"` in app code gets these via
// metro.config.js → utils/react-native-capped.js (React 19 ignores defaultProps on
// function components, so Text.defaultProps no longer works).
import { forwardRef, type ComponentProps, type ElementRef } from "react";
import { Text as RNText, TextInput as RNTextInput } from "react-native";

export const MAX_FONT_SCALE = 1.3;

export const Text = forwardRef<ElementRef<typeof RNText>, ComponentProps<typeof RNText>>((props, ref) => (
  <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} ref={ref} />
));
Text.displayName = "Text";

export const TextInput = forwardRef<ElementRef<typeof RNTextInput>, ComponentProps<typeof RNTextInput>>((props, ref) => (
  <RNTextInput maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} ref={ref} />
));
TextInput.displayName = "TextInput";
