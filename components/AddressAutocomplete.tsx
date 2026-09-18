// Address field with live Google Places suggestions (via the loadq-address-
// autocomplete edge fn — the Maps key stays server-side). Debounced; tapping a
// suggestion fills the field. Reusable on any pickup/ride address input.
import { useEffect, useRef, useState } from "react";
import { View, TextInput, TouchableOpacity, Text, StyleSheet, ActivityIndicator } from "react-native";
import { MapPin } from "lucide-react-native";
import { Colors } from "../constants/colors";
import { useStrings } from "../hooks/useStrings";
import { addressAutocomplete, addressDetails, type AddressDetails } from "../services/pickup";

export default function AddressAutocomplete({
  value, onChangeText, onPick, onResolved, placeholder, accent = Colors.accent, leftIcon = true, rightSlot,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onPick?: (desc: string) => void;
  onResolved?: (d: AddressDetails) => void;   // fires with full address + postal + lat/lng
  placeholder?: string;
  accent?: string;
  leftIcon?: boolean;
  rightSlot?: React.ReactNode;
}) {
  const { lang } = useStrings();
  const [preds, setPreds] = useState<{ description: string; place_id: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const skip = useRef(false);
  // Every lookup takes a ticket. A response whose ticket is no longer current is thrown away.
  //
  // Clearing the timeout is not enough: once the debounce has fired and we are awaiting Google,
  // the effect cleanup can no longer stop it. Tapping a suggestion used to close the list and
  // then have that in-flight response reopen it — showing the very address just chosen, sitting
  // under the filled field.
  const seq = useRef(0);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    if (value.trim().length < 3) { setPreds([]); setOpen(false); return; }
    setLoading(true);
    const mine = ++seq.current;
    const id = setTimeout(async () => {
      const p = await addressAutocomplete(value, lang);
      if (mine !== seq.current) return;   // superseded by a newer keystroke, or by a selection
      setPreds(p); setOpen(p.length > 0); setLoading(false);
    }, 320);
    return () => { clearTimeout(id); setLoading(false); };
  }, [value, lang]);

  async function pick(desc: string, placeId: string) {
    seq.current++;                        // retire anything already in flight
    setPreds([]); setOpen(false); setLoading(false);

    // Only claim a skip when the value actually changes, otherwise the effect never runs to
    // consume it and the flag sits true — swallowing the next keystroke the rider types.
    if (desc !== value) skip.current = true;
    onChangeText(desc); onPick?.(desc);

    if (placeId && onResolved) {
      const d = await addressDetails(placeId);
      if (d) {
        if (d.formatted_address && d.formatted_address !== desc) {
          skip.current = true; onChangeText(d.formatted_address);
        }
        onResolved(d);
      }
    }
  }

  const elevated = open && preds.length > 0;
  return (
    <View style={{ position: "relative", zIndex: elevated ? 9999 : 1, elevation: elevated ? 24 : 0 }}>
      <View style={[s.field, open && preds.length > 0 && s.fieldOpen]}>
        {leftIcon && <MapPin size={16} color={Colors.t3} />}
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.t3}
          autoCorrect={false}
        />
        {loading && <ActivityIndicator size="small" color={accent} />}
        {rightSlot}
      </View>
      {open && preds.length > 0 && (
        <View style={s.drop}>
          {preds.map((p) => (
            <TouchableOpacity key={p.place_id || p.description} style={s.row} onPress={() => pick(p.description, p.place_id)} activeOpacity={0.7}>
              <MapPin size={14} color={Colors.t3} />
              <Text style={s.rowTxt} numberOfLines={1}>{p.description}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 13 },
  fieldOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  input: { flex: 1, color: Colors.t1, fontSize: 15, paddingVertical: 13 },
  drop: { position: "absolute", top: "100%", left: 0, right: 0, backgroundColor: Colors.card, borderWidth: 1, borderTopWidth: 0, borderColor: Colors.border, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, overflow: "hidden", zIndex: 9999, elevation: 24, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  row: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  rowTxt: { flex: 1, color: Colors.t1, fontSize: 13.5 },
});
