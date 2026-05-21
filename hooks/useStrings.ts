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

type StringsBag = ReturnType<typeof getStrings>;
type Interpolate = (key: keyof StringsBag | string, vars?: Record<string, string | number>) => string;
export type TFn = Interpolate & StringsBag;

function buildT(lang: Lang): TFn {
  const bag = getStrings(lang);
  const fn: Interpolate = (key, vars) => {
    let s = (bag as any)[key];
    if (typeof s !== "string") s = String(key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s;
  };
  return Object.assign(fn, bag) as TFn;
}

export function useStrings() {
  const [lang, setLangState] = useState<Lang>(_lang);
  useEffect(() => {
    const update = () => setLangState(_lang);
    _listeners.add(update);
    update();
    return () => { _listeners.delete(update); };
  }, []);
  return { t: buildT(lang), lang, setLang };
}
