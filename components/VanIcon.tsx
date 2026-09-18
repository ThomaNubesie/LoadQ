import Svg, { Path, Circle } from "react-native-svg";

// The LoadQ shuttle, drawn rather than an emoji.
//
// 🚐 could not be used: emoji cannot be recoloured to match a theme, cannot be turned round to
// face the way the rider is travelling, and renders as a different vehicle on every platform —
// Apple's is a van, Google's a minibus, Samsung's something else again. A flyer or a route strip
// that has to look the same everywhere cannot depend on it.
//
// Drawn with strokes and no fills, so it is transparent throughout: the wheel arches are cut out
// of the body outline rather than masked with a background-coloured disc, which would show as a
// solid blob the moment the background changed.
//
// `heading` points the nose the way the passenger is going. Route strips are normally drawn
// origin-left to destination-right, so "east" is the default; pass "west" when the strip runs the
// other way, otherwise the vehicle drives backwards down its own line.
//
// The default colour is accentWarm (#FF8A1A) — the LoadQ orange, identical in the light and azure
// themes. Pass `color` only where the orange would not read: on an orange fill, or in one-colour
// print. The canonical standalone copy lives at assets/van.svg; keep the two in step.
export default function VanIcon({
  size = 96,
  color = "#FF8A1A",
  heading = "east",
}: {
  size?: number;
  color?: string;
  heading?: "east" | "west";
}) {
  const h = Math.round((size * 29) / 70); // keep the 70×29 aspect

  return (
    <Svg
      width={size}
      height={h}
      viewBox="0 0 70 29"
      fill="none"
      style={heading === "west" ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      {/* body — the two arcs near the bottom are the wheel arches */}
      <Path
        d="M3.4 20.6V10.6a3.2 3.2 0 0 1 3.2-3.2h28.9c.9 0 1.8.4 2.4 1.1l5.2 5.9h6.6
           a7.3 7.3 0 0 1 7.3 7.3v.6a1.4 1.4 0 0 1-1.4 1.4h-4.5a4.6 4.6 0 0 0-9.2 0H21.1
           a4.6 4.6 0 0 0-9.2 0H4.8a1.4 1.4 0 0 1-1.4-1.4z"
        stroke={color}
        strokeWidth={2.3}
        strokeLinejoin="round"
      />
      {/* window pillars and the windscreen rake */}
      <Path
        d="M10.5 8.2v6.2M19.6 8.2v6.2M28.7 8.2v6.2M36.4 9.4l4.1 4.6"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        opacity={0.5}
      />
      <Path d="M3.4 14.4h39.7" stroke={color} strokeWidth={1.7} opacity={0.5} />
      <Circle cx={16.5} cy={23.6} r={4.3} stroke={color} strokeWidth={2.3} />
      <Circle cx={45.9} cy={23.6} r={4.3} stroke={color} strokeWidth={2.3} />
    </Svg>
  );
}
