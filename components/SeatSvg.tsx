import React from "react";
import { TouchableOpacity, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { Colors } from "../constants/colors";

interface SeatSvgProps {
  filled:    boolean;
  locked?:   boolean;
  disputed?: boolean;
  color?:    string;
  size?:     "full" | "mini";
  onPress?:  () => void;
  disabled?: boolean;
}

export default function SeatSvg({
  filled,
  locked,
  disputed,
  color = Colors.accent,
  size = "full",
  onPress,
  disabled,
}: SeatSvgProps) {
  const isMini = size === "mini";
  const w = isMini ? 14 : 36;
  const h = isMini ? 18 : 44;

  const c  = disputed ? Colors.red
           : locked   ? Colors.yellow
           : filled   ? color
           : Colors.border;

  const bg = disputed ? Colors.red    + "20"
           : locked   ? Colors.yellow + "20"
           : filled   ? color         + "20"
           : "transparent";

  const seat = (
    <Svg width={w} height={h} viewBox="0 0 36 44">
      <Rect x="7"  y="0"  width="22" height="7"  rx={3.5} fill={filled ? c : "transparent"} stroke={c} strokeWidth={1.5} />
      <Rect x="0"  y="9"  width="5"  height="14" rx={2.5} fill={filled ? c : "transparent"} stroke={c} strokeWidth={1.5} />
      <Rect x="7"  y="8"  width="22" height="18" rx={3}   fill={bg}                         stroke={c} strokeWidth={1.5} />
      <Rect x="31" y="9"  width="5"  height="14" rx={2.5} fill={filled ? c : "transparent"} stroke={c} strokeWidth={1.5} />
      <Rect x="3"  y="28" width="30" height="7"  rx={3}   fill={filled ? c : "transparent"} stroke={c} strokeWidth={1.5} />
    </Svg>
  );

  if (!onPress || disabled) {
    return <View style={{ opacity: disabled ? 0.35 : 1 }}>{seat}</View>;
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} disabled={disabled}>
      {seat}
    </TouchableOpacity>
  );
}
