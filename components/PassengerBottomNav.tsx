import BottomNav, { NavItem } from "./BottomNav";
import { useStrings } from "../hooks/useStrings";

export default function PassengerBottomNav() {
  const { t } = useStrings();
  const items: NavItem[] = [
    { icon: "📋", label: t.queue,        route: "/(passenger)/queue",     match: "/queue"     },
    { icon: "🚌", label: t.loadingNowTitle, route: "/(passenger)/loading", match: "/loading" },
    { icon: "📊", label: t.analytics,    route: "/(passenger)/analytics", match: "/analytics" },
    { icon: "👤", label: t.profile,      route: "/(passenger)/profile",   match: "/profile", isProfile: true },
  ];
  return <BottomNav items={items} />;
}
