import React from "react";
import { View } from "react-native";
import Svg, { Polygon, Polyline } from "react-native-svg";
import { Colors } from "../constants/colors";

type Props = {
  size?: number;
  color?: string;
};

export default function VerifiedBadge({ size = 20, color = Colors.green }: Props) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Polygon
          points="29,2 71,2 98,29 98,71 71,98 29,98 2,71 2,29"
          fill={color}
        />
        <Polyline
          points="30,52 45,67 72,38"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={11}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
