// Keep the app locked to portrait, but don't let that lock filter devices out of
// Google Play. A portrait-only activity makes Android imply
// <uses-feature android.hardware.screen.portrait required="true">, and Play now
// blocks releases whose required features some devices lack (tablets, Chromebooks,
// Android XR). Declaring the screen features optional keeps the orientation lock
// and every device eligible. (Play Console, Nov 2026: "Required hardware feature
// declarations are restricting your app's availability".)
const { withAndroidManifest } = require("@expo/config-plugins");

const OPTIONAL = ["android.hardware.screen.portrait", "android.hardware.screen.landscape"];

module.exports = function withOptionalScreenFeatures(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest["uses-feature"] = manifest["uses-feature"] || [];
    for (const name of OPTIONAL) {
      const existing = manifest["uses-feature"].find((f) => f.$ && f.$["android:name"] === name);
      if (existing) existing.$["android:required"] = "false";
      else manifest["uses-feature"].push({ $: { "android:name": name, "android:required": "false" } });
    }
    return cfg;
  });
};
