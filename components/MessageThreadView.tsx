import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from "react-native";
import { supabase } from "../services/supabase";
import { MessagesAPI, Message } from "../services/messages";
import { Colors } from "../constants/colors";

type Props = {
  otherId:   string;
  otherName: string;
};

export default function MessageThreadView({ otherId, otherName }: Props) {
  const [me, setMe]         = useState<string | null>(null);
  const [msgs, setMsgs]     = useState<Message[]>([]);
  const [body, setBody]     = useState("");
  const [sending, setSend]  = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user?.id ?? null);
    })();
  }, []);

  const load = useCallback(async () => {
    const list = await MessagesAPI.getThreadWith(otherId);
    setMsgs(list);
    await MessagesAPI.markRead(otherId);
  }, [otherId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const sub = MessagesAPI.subscribeToThread(otherId, async (m) => {
      setMsgs(prev => prev.some(p => p.id === m.id) ? prev : [...prev, m]);
      if (me && m.recipient_id === me) await MessagesAPI.markRead(otherId);
    });
    return () => { sub.unsubscribe(); };
  }, [otherId, me]);

  useEffect(() => {
    if (msgs.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [msgs.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSend(true);
    const { data, error } = await MessagesAPI.send(otherId, text);
    setSend(false);
    if (error) return;
    setBody("");
    if (data) setMsgs(prev => prev.some(p => p.id === data.id) ? prev : [...prev, data]);
  };

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
    >
      <FlatList
        ref={listRef}
        data={msgs}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: 14, paddingBottom: 14 }}
        ListEmptyComponent={<Text style={s.empty}>Start the conversation with {otherName}.</Text>}
        renderItem={({ item }) => {
          const mine = me && item.sender_id === me;
          return (
            <View style={[s.bubbleRow, mine ? s.right : s.left]}>
              <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
                <Text style={[s.bubbleText, mine ? s.textMine : s.textTheirs]}>{item.body}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={s.composer}>
        <TextInput
          style={s.input}
          value={body}
          onChangeText={setBody}
          placeholder={`Message ${otherName}…`}
          placeholderTextColor={Colors.t3}
          multiline
        />
        <TouchableOpacity style={[s.sendBtn, !body.trim() && s.sendBtnOff]} onPress={send} disabled={!body.trim() || sending} activeOpacity={0.85}>
          <Text style={s.sendBtnText}>{sending ? "…" : "Send"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  empty:       { color: Colors.t3, textAlign: "center", marginTop: 40 },
  bubbleRow:   { flexDirection: "row", marginVertical: 3 },
  left:        { justifyContent: "flex-start" },
  right:       { justifyContent: "flex-end" },
  bubble:      { maxWidth: "78%", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14 },
  bubbleMine:  { backgroundColor: Colors.accent, borderBottomRightRadius: 4 },
  bubbleTheirs:{ backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, borderBottomLeftRadius: 4 },
  bubbleText:  { fontSize: 14, lineHeight: 19 },
  textMine:    { color: Colors.accentText },
  textTheirs:  { color: Colors.t1 },
  composer:    { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: 0.5, borderTopColor: Colors.border, backgroundColor: Colors.bg },
  input:       { flex: 1, backgroundColor: Colors.card, borderRadius: 18, borderWidth: 0.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 10, color: Colors.t1, maxHeight: 110, fontSize: 14 },
  sendBtn:     { backgroundColor: Colors.accent, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 11, alignItems: "center" },
  sendBtnOff:  { opacity: 0.4 },
  sendBtnText: { color: Colors.accentText, fontSize: 14, fontWeight: "800" },
});
