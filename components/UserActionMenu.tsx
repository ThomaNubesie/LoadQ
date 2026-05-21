import { TouchableOpacity, Alert, Text, StyleSheet } from "react-native";
import { UserActions } from "../services/userActions";
import { Colors } from "../constants/colors";

type Props = {
  userId:    string;
  userName:  string;
  onBlocked?: () => void;
};

export default function UserActionMenu({ userId, userName, onBlocked }: Props) {
  const openMenu = () => {
    Alert.alert(userName, "Choose an action", [
      {
        text: "Report",
        onPress: () => {
          Alert.alert(
            "Report this user?",
            "An admin will review your report and take action if needed.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Report",
                style: "destructive",
                onPress: async () => {
                  const { error } = await UserActions.report(userId);
                  Alert.alert(
                    error ? "Couldn't report" : "Reported",
                    error || "Thanks. An admin will review.",
                  );
                },
              },
            ],
          );
        },
      },
      {
        text: "Block",
        style: "destructive",
        onPress: () => {
          Alert.alert(
            "Block this user?",
            "You won't see their content or receive messages from them.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Block",
                style: "destructive",
                onPress: async () => {
                  const { error } = await UserActions.block(userId);
                  if (error) { Alert.alert("Couldn't block", error); return; }
                  Alert.alert("Blocked", `You won't see content from ${userName}.`);
                  onBlocked?.();
                },
              },
            ],
          );
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <TouchableOpacity
      onPress={openMenu}
      style={s.btn}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Text style={s.dots}>⋯</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn:  { paddingHorizontal: 6, paddingVertical: 2 },
  dots: { color: Colors.t3, fontSize: 18, fontWeight: "800", lineHeight: 18 },
});
