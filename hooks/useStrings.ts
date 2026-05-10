import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { getStrings, Lang } from "../constants/i18n";

let _lang: Lang = "en";
const _listeners = new Set<() => void>();

export async function initLang(): Promise<void> {
  const stored = await AsyncStorage.getItem("userLang");
  if (stored === "en" || stored === "fr") {
    _lang = stored;
    _listeners.forEach(fn => fn());
  }
}

export async function setLang(lang: Lang): Promise<void> {
  _lang = lang;
  await AsyncStorage.setItem("userLang", lang);
  _listeners.forEach(fn => fn());
}

export function getCurrentLang(): Lang {
  return _lang;
}

export function useStrings() {
  const [lang, setLangState] = useState<Lang>(_lang);
  useEffect(() => {
    const update = () => setLangState(_lang);
    _listeners.add(update);
    update();
    return () => { _listeners.delete(update); };
  }, []);
  return { t: getStrings(lang), lang, setLang };
}
