import { TouchableOpacity, Alert, Text, StyleSheet } from "react-native";
import { UserActions } from "../services/userActions";
import { Colors } from "../constants/colors";
import { useStrings } from "../hooks/useStrings";

type Props = {
  userId:    string;
  userName:  string;
  onBlocked?: () => void;
};

export default function UserActionMenu({ userId, userName, onBlocked }: Props) {
  const { t } = useStrings();

  const openMenu = () => {
    Alert.alert(userName, t.chooseAnAction, [
      {
        text: t.reportUser,
        onPress: () => {
          Alert.alert(
            t.reportThisUser,
            t.reportThisUserBody,
            [
              { text: t.cancel, style: "cancel" },
              {
                text: t.reportUser,
                style: "destructive",
                onPress: async () => {
                  const { error } = await UserActions.report(userId);
                  Alert.alert(
                    error ? t.couldNotReport : t.reported,
                    error || t.reportedBody,
                  );
                },
              },
            ],
          );
        },
      },
      {
        text: t.blockUser,
        style: "destructive",
        onPress: () => {
          Alert.alert(
            t.blockThisUser,
            t.blockThisUserBody,
            [
              { text: t.cancel, style: "cancel" },
              {
                text: t.blockUser,
                style: "destructive",
                onPress: async () => {
                  const { error } = await UserActions.block(userId);
                  if (error) { Alert.alert(t.couldNotBlock, error); return; }
                  Alert.alert(t.blocked, t("blockedBody", { name: userName }));
                  onBlocked?.();
                },
              },
            ],
          );
        },
      },
      { text: t.cancel, style: "cancel" },
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
