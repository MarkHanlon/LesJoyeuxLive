import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { allocationsForMember, roomLabel, type Allocation } from '../../constants/rooms';
import { HOT_DRINKS } from '../../constants/drinks';
import { avatarColor, initials } from '../../utils/ui';

const VISIT_REFRESH_MS = 30000;

type TimeSlot = 'morning' | 'lunchtime' | 'afternoon' | 'dinnertime' | 'evening';

const DRINKS = [
  { key: 'pastis',      label: 'Pastis',           hint: 'Ricard, 51…',              icon: '🌿' },
  { key: 'red_wine',    label: 'Red Wine',         hint: 'un rouge',                  icon: '🍷' },
  { key: 'white_wine',  label: 'White Wine',       hint: 'un blanc',                  icon: '🫗' },
  { key: 'rose',        label: 'Rosé',             hint: 'rosé, bien sûr',            icon: '🌸' },
  { key: 'gt',          label: 'G&T',              hint: 'gin & tonic',               icon: '🧊' },
  { key: 'rum_coke',        label: 'Rum & Coke',        hint: 'dark rum & cola',          icon: '🥃' },
  { key: 'rum_coke_zero',   label: 'Rum & Coke Zero',   hint: 'dark rum & Coke Zero',     icon: '🥃' },
  { key: 'vodka_coke',      label: 'Vodka & Coke',      hint: 'vodka & cola',             icon: '🍹' },
  { key: 'vodka_coke_zero', label: 'Vodka & Coke Zero', hint: 'vodka & Coke Zero',        icon: '🍹' },
  { key: 'gin_orange',      label: 'Gin & Orange',      hint: 'gin & OJ',                 icon: '🍊' },
  { key: 'cuba_libre',      label: 'Cuba Libre',        hint: 'rum, cola & lime',         icon: '🌴' },
  { key: 'cuba_libre_zero', label: 'Cuba Libre (Zero)', hint: 'rum, Coke Zero & lime',    icon: '🌴' },
  { key: 'skinny_bitch', label: 'Skinny Bitch',   hint: 'vodka & soda',              icon: '💅' },
  { key: 'beer',        label: 'Beer',             hint: 'une bière',                 icon: '🍺' },
  { key: 'sparkling',   label: 'Sparkling Water',  hint: 'eau pétillante',            icon: '💧' },
  { key: 'oj',          label: 'Orange Juice',     hint: "jus d'orange",              icon: '🍊' },
  { key: 'mango',       label: 'Mango Juice',      hint: 'jus de mangue',             icon: '🥭' },
  { key: 'lemonade',    label: 'Lemonade',         hint: 'citron pressé',             icon: '🍋' },
  { key: 'cola',        label: 'Cola',             hint: 'Coca, Pepsi…',              icon: '🥤' },
  { key: 'coke_zero',   label: 'Coke Zero',        hint: 'sugar-free cola',           icon: '🥤' },
] as const;

type DrinkKey = typeof DRINKS[number]['key'] | 'later';

function drinkByKey(key: string | null) {
  return DRINKS.find(d => d.key === key) ?? null;
}


function resizeToDataUrl(file: File, size = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new (window as any).Image() as { onload: any; onerror: any; src: string; width: number; height: number };
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const s = Math.min((img as any).width, (img as any).height);
      ctx.drawImage(img as any, ((img as any).width - s) / 2, ((img as any).height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

const SLOTS: { key: TimeSlot; label: string; hint: string }[] = [
  { key: 'morning',    label: 'Morning',     hint: 'before lunch' },
  { key: 'lunchtime',  label: 'Lunchtime',   hint: 'around 1pm' },
  { key: 'afternoon',  label: 'Afternoon',   hint: 'after lunch' },
  { key: 'dinnertime', label: 'Dinner time', hint: 'around 8pm' },
  { key: 'evening',    label: 'Evening',     hint: 'after dinner' },
];

type VisitStatus = 'coming' | 'not_coming' | 'undecided';

type VisitPlan = {
  status: VisitStatus;
  arriveDate: string;   // YYYY-MM-DD
  arriveSlot: TimeSlot;
  saveLunch: boolean;
  saveDinner: boolean;
  departDate: string;
  departSlot: TimeSlot;
  aperitif: DrinkKey | null;
  tonightAperitif: DrinkKey | null; // tonight-only override, null if not set for today
  pickupNeeded: boolean;
  pickupTime: string;
  pickupFrom: string;
  dropoffNeeded: boolean;
  dropoffTime: string;
  dropoffTo: string;
  room: string | null;   // legacy single room (read-only here)
  allocations: Allocation[]; // date-ranged room segments (read-only here)
  lunchAbsences: string[];    // ISO dates away for lunch (today + planned ahead)
  dinnerAbsences: string[];   // ISO dates away for dinner
  skipAperitifToday: boolean; // aperitif stays today-scoped
  lunchDrink: string | null;   // today's single after-lunch / after-dinner hot drink
  dinnerDrink: string | null;
  cheeseNotes: string | null;  // persistent personal note of cheeses they enjoy
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function slotLabel(slot: TimeSlot): string {
  return SLOTS.find(s => s.key === slot)?.label ?? slot;
}

function defaultPlan(): VisitPlan {
  const t = todayStr();
  return { status: 'coming', arriveDate: t, arriveSlot: 'afternoon', saveLunch: false, saveDinner: false, departDate: addDays(t, 7), departSlot: 'morning', aperitif: null, tonightAperitif: null, pickupNeeded: false, pickupTime: '', pickupFrom: '', dropoffNeeded: false, dropoffTime: '', dropoffTo: '', room: null, allocations: [], lunchAbsences: [], dinnerAbsences: [], skipAperitifToday: false, lunchDrink: null, dinnerDrink: null, cheeseNotes: null };
}

// ── Date navigator ──────────────────────────────────────────────────────────

function DateRow({ value, onChange, minDate }: { value: string; onChange: (d: string) => void; minDate?: string }) {
  const canGoBack = !minDate || value > minDate;
  const canGoBackMonth = !minDate || addMonths(value, -1) >= minDate;

  return (
    <View style={styles.dateRow}>
      {Platform.OS !== 'web' && (
        <TouchableOpacity
          style={[styles.navBtn, styles.navBtnMonth, !canGoBackMonth && styles.navBtnDisabled]}
          onPress={() => canGoBackMonth && onChange(addMonths(value, -1))}
          disabled={!canGoBackMonth}
          activeOpacity={0.6}
        >
          <Text style={[styles.navArrow, styles.navArrowMonth, !canGoBackMonth && styles.navArrowDisabled]}>«</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[styles.navBtn, !canGoBack && styles.navBtnDisabled]}
        onPress={() => canGoBack && onChange(addDays(value, -1))}
        disabled={!canGoBack}
        activeOpacity={0.6}
      >
        <Text style={[styles.navArrow, !canGoBack && styles.navArrowDisabled]}>‹</Text>
      </TouchableOpacity>

      <View style={styles.dateTextWrapper}>
        <Text style={styles.dateText}>{formatDate(value)}</Text>
        {Platform.OS === 'web' && (
          // Transparent overlay triggers the browser's native date picker on tap
          <input
            type="date"
            value={value}
            min={minDate ?? ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              if (e.target.value) onChange(e.target.value);
            }}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0,
              cursor: 'pointer',
              width: '100%',
              height: '100%',
              border: 'none',
              padding: 0,
              margin: 0,
            } as React.CSSProperties}
          />
        )}
      </View>

      <TouchableOpacity style={styles.navBtn} onPress={() => onChange(addDays(value, 1))} activeOpacity={0.6}>
        <Text style={styles.navArrow}>›</Text>
      </TouchableOpacity>
      {Platform.OS !== 'web' && (
        <TouchableOpacity
          style={[styles.navBtn, styles.navBtnMonth]}
          onPress={() => onChange(addMonths(value, 1))}
          activeOpacity={0.6}
        >
          <Text style={[styles.navArrow, styles.navArrowMonth]}>»</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Time slot picker ────────────────────────────────────────────────────────

function SlotPicker({ value, onChange }: { value: TimeSlot; onChange: (s: TimeSlot) => void }) {
  return (
    <View style={styles.slotList}>
      {SLOTS.map(s => {
        const active = value === s.key;
        return (
          <TouchableOpacity
            key={s.key}
            style={[styles.slotItem, active && styles.slotItemActive]}
            onPress={() => onChange(s.key)}
            activeOpacity={0.7}
          >
            <View style={[styles.slotRadio, active && styles.slotRadioActive]}>
              {active && <View style={styles.slotRadioDot} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.slotLabel, active && styles.slotLabelActive]}>{s.label}</Text>
              <Text style={styles.slotHint}>{s.hint}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Drink picker ────────────────────────────────────────────────────────────

function DrinkPicker({ value, onChange }: { value: DrinkKey | null; onChange: (d: DrinkKey) => void }) {
  return (
    <View>
      <View style={styles.drinkGrid}>
        {DRINKS.map(d => {
          const active = value === d.key;
          return (
            <TouchableOpacity
              key={d.key}
              style={[styles.drinkCard, active && styles.drinkCardActive]}
              onPress={() => onChange(d.key as DrinkKey)}
              activeOpacity={0.7}
            >
              <Text style={styles.drinkIcon}>{d.icon}</Text>
              <Text style={[styles.drinkLabel, active && styles.drinkLabelActive]}>{d.label}</Text>
              <Text style={styles.drinkHint}>{d.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity
        style={[styles.drinkLater, value === 'later' && styles.drinkLaterActive]}
        onPress={() => onChange('later')}
        activeOpacity={0.7}
      >
        <Text style={styles.drinkLaterIcon}>🎲</Text>
        <Text style={[styles.drinkLaterLabel, value === 'later' && styles.drinkLaterLabelActive]}>
          I'll choose on the day!
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// Simple full-list aperitif picker — tap the shown drink to open it.
function AperitifPickerModal({ open, current, busy, onPick, onClose }: {
  open: boolean;
  current: DrinkKey | null;
  busy: boolean;
  onPick: (d: DrinkKey) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const Row = ({ dkey, icon, label }: { dkey: DrinkKey; icon: string; label: string }) => {
    const active = current === dkey;
    return (
      <TouchableOpacity
        style={[styles.pickerRow, active && styles.pickerRowActive]}
        onPress={() => onPick(dkey)}
        disabled={busy}
        activeOpacity={0.7}
      >
        <Text style={styles.pickerIcon}>{icon}</Text>
        <Text style={[styles.pickerLabel, active && styles.pickerLabelActive]}>{label}</Text>
        {active && <Text style={styles.pickerCheck}>✓</Text>}
      </TouchableOpacity>
    );
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Choose your aperitif</Text>
          <ScrollView style={{ maxHeight: 440 }}>
            {DRINKS.map(d => <Row key={d.key} dkey={d.key as DrinkKey} icon={d.icon} label={d.label} />)}
            <Row dkey={'later'} icon="🎲" label="I'll choose on the day!" />
          </ScrollView>
          {busy && <ActivityIndicator color="#C85A2E" style={{ marginTop: 8 }} />}
          <Text style={styles.pickerDismiss}>Tap outside to close</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// A persistent free-text note of the cheeses this person enjoys. Seeds its draft
// from `value` and re-syncs if `value` changes externally (e.g. background refresh),
// which never clobbers typing since `value` only changes after a save.
function CheeseNote({ value, saving, onSave }: { value: string; saving: boolean; onSave: (t: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const dirty = draft.trim() !== value.trim();
  return (
    <>
      <Text style={[styles.summaryEyebrow, { marginTop: 18 }]}>🧀 CHEESES I LOVE</Text>
      <Text style={styles.skipHint}>Jot down the cheeses you enjoy so you remember your favourites next time.</Text>
      <TextInput
        style={styles.cheeseInput}
        placeholder="e.g. Comté, Roquefort, the soft one from Tuesday…"
        placeholderTextColor="#B8956A"
        value={draft}
        onChangeText={setDraft}
        multiline
        maxLength={500}
      />
      {dirty && (
        <TouchableOpacity
          style={[styles.cheeseSaveBtn, saving && { opacity: 0.6 }]}
          onPress={() => onSave(draft)}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#F5EDD6" size="small" />
            : <Text style={styles.cheeseSaveBtnText}>Save cheeses</Text>}
        </TouchableOpacity>
      )}
    </>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function VisitScreen() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saved, setSaved] = useState<VisitPlan | null>(null);
  const [form, setForm] = useState<VisitPlan>(defaultPlan());
  const [isChangingDrink, setIsChangingDrink] = useState(false);
  const [pendingDrink, setPendingDrink] = useState<DrinkKey | null>(null);
  const [isSavingDrink, setIsSavingDrink] = useState(false);
  const [drinkPickerOpen, setDrinkPickerOpen] = useState(false);
  const [skippingMeal, setSkippingMeal] = useState<null | 'lunch' | 'dinner' | 'aperitif'>(null);
  const [absenceBusy, setAbsenceBusy] = useState(false);
  const [absMeal, setAbsMeal] = useState<'lunch' | 'dinner'>('lunch');
  const [absDate, setAbsDate] = useState('');
  const [savingDrinks, setSavingDrinks] = useState(false);
  const [savingCheese, setSavingCheese] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(user?.avatar ?? null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  function pickAvatar() {
    if (Platform.OS !== 'web' || !user) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setUploadingAvatar(true);
      try {
        const dataUrl = await resizeToDataUrl(file);
        await fetch(`/api/user/${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
          body: JSON.stringify({ avatar: dataUrl }),
        });
        setAvatarUri(dataUrl);
      } catch {
        // silently ignore
      } finally {
        setUploadingAvatar(false);
      }
    };
    input.click();
  }

  const fetchVisit = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/visit/${user.id}`, { headers: { 'x-user-id': user.id } });
      if (res.ok) {
        const d = await res.json();
        const plan: VisitPlan = {
          status:          (d.status as VisitStatus) ?? 'coming',
          arriveDate:      d.arrive_date ? String(d.arrive_date).slice(0, 10) : defaultPlan().arriveDate,
          arriveSlot:      (d.arrive_slot as TimeSlot) ?? 'afternoon',
          saveLunch:       !!d.save_lunch,
          saveDinner:      !!d.save_dinner,
          departDate:      d.depart_date ? String(d.depart_date).slice(0, 10) : defaultPlan().departDate,
          departSlot:      (d.depart_slot as TimeSlot) ?? 'morning',
          aperitif:        (d.aperitif as DrinkKey) ?? null,
          tonightAperitif: (d.tonight_aperitif as DrinkKey) ?? null,
          pickupNeeded:    !!d.pickup_needed,
          pickupTime:      d.pickup_time ?? '',
          pickupFrom:      d.pickup_from ?? '',
          dropoffNeeded:   !!d.dropoff_needed,
          dropoffTime:     d.dropoff_time ?? '',
          dropoffTo:       d.dropoff_to ?? '',
          room:            d.room ?? null,
          allocations:     (d.allocations as Allocation[]) ?? [],
          lunchAbsences:     Array.isArray(d.lunchAbsences) ? d.lunchAbsences.map((s: string) => String(s).slice(0, 10)) : [],
          dinnerAbsences:    Array.isArray(d.dinnerAbsences) ? d.dinnerAbsences.map((s: string) => String(s).slice(0, 10)) : [],
          skipAperitifToday: !!d.skipAperitifToday,
          lunchDrink:        d.lunchDrink ?? null,
          dinnerDrink:       d.dinnerDrink ?? null,
          cheeseNotes:       d.cheeseNotes ?? null,
        };
        setSaved(plan);
        setForm(plan);
      }
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Pause auto-refresh while the user is mid-edit so a poll can't wipe unsaved input.
  useAutoRefresh(fetchVisit, VISIT_REFRESH_MS, !isEditing && !isChangingDrink && !isSaving && !skippingMeal && !savingDrinks && !savingCheese && !absenceBusy);

  // Save the persistent cheese note. Updates `saved` on success so the field settles.
  async function saveCheese(notes: string) {
    if (!user || savingCheese) return;
    const clean = notes.trim().slice(0, 500);
    setSavingCheese(true);
    try {
      const res = await fetch(`/api/visit/cheese/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ notes: clean || null }),
      });
      if (res.ok) setSaved(prev => (prev ? { ...prev, cheeseNotes: clean || null } : prev));
    } finally {
      setSavingCheese(false);
    }
  }

  // Toggle tonight's apéritif opt-out (still today-scoped). Optimistic.
  async function toggleSkip(meal: 'aperitif') {
    if (!user || !saved || skippingMeal) return;
    const next = !saved.skipAperitifToday;
    setSkippingMeal(meal);
    setSaved(prev => (prev ? { ...prev, skipAperitifToday: next } : prev)); // optimistic
    try {
      const res = await fetch(`/api/visit/skip/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ meal, skip: next }),
      });
      if (!res.ok) setSaved(prev => (prev ? { ...prev, skipAperitifToday: !next } : prev)); // revert on failure
    } catch {
      setSaved(prev => (prev ? { ...prev, skipAperitifToday: !next } : prev));
    } finally {
      setSkippingMeal(null);
    }
  }

  // Mark (or clear) a lunch/dinner absence for a specific date. Optimistic. Used
  // by both the "today" quick toggles and the plan-ahead calendar list.
  async function setAbsence(meal: 'lunch' | 'dinner', date: string, absent: boolean) {
    if (!user || !saved || absenceBusy) return;
    const key = meal === 'lunch' ? 'lunchAbsences' : 'dinnerAbsences';
    const has = saved[key].includes(date);
    if (has === absent) return; // no change
    const nextArr = absent ? [...saved[key], date].sort() : saved[key].filter(d => d !== date);
    const prev = saved;
    setAbsenceBusy(true);
    setSaved({ ...saved, [key]: nextArr });
    try {
      const res = await fetch(`/api/visit/absence/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ meal, date, absent }),
      });
      if (!res.ok) setSaved(prev);
    } catch {
      setSaved(prev);
    } finally {
      setAbsenceBusy(false);
    }
  }

  // Pick (or clear, by re-tapping) the single hot drink for a sitting. Optimistic.
  async function chooseDrink(meal: 'lunch' | 'dinner', key: string) {
    if (!user || !saved || savingDrinks) return;
    const field = meal === 'lunch' ? 'lunchDrink' : 'dinnerDrink';
    const next = saved[field] === key ? null : key; // re-tap clears
    const prev = saved;
    const optimistic = { ...saved, [field]: next };
    setSavingDrinks(true);
    setSaved(optimistic);
    try {
      const res = await fetch(`/api/visit/hotdrinks/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ meal, drink: next }),
      });
      if (!res.ok) setSaved(prev); // revert on failure
    } catch {
      setSaved(prev);
    } finally {
      setSavingDrinks(false);
    }
  }

  function updateForm(partial: Partial<VisitPlan>) {
    setForm(prev => {
      const next = { ...prev, ...partial };
      if (next.departDate < next.arriveDate) next.departDate = next.arriveDate;
      // clear plate flags when slot changes away from their trigger
      if (partial.arriveSlot && partial.arriveSlot !== 'lunchtime')                             next.saveLunch  = false;
      if (partial.arriveSlot && partial.arriveSlot !== 'dinnertime' && partial.arriveSlot !== 'evening') next.saveDinner = false;
      return next;
    });
  }

  async function save() {
    if (!user) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/visit/${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({
          status:        form.status,
          arriveDate:    form.arriveDate,
          arriveSlot:    form.arriveSlot,
          saveLunch:     form.saveLunch,
          saveDinner:    form.saveDinner,
          departDate:    form.departDate,
          departSlot:    form.departSlot,
          aperitif:      form.aperitif,
          pickupNeeded:  form.pickupNeeded,
          pickupTime:    form.pickupTime,
          pickupFrom:    form.pickupFrom,
          dropoffNeeded: form.dropoffNeeded,
          dropoffTime:   form.dropoffTime,
          dropoffTo:     form.dropoffTo,
        }),
      });
      if (res.ok) {
        setSaved(form);
        setIsEditing(false);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function cancelEdit() {
    if (saved) setForm(saved);
    setIsEditing(false);
  }

  // Tap a status option: activate it, or return to "coming" if it's already active.
  // From the read-only summary, drop into edit mode so the Save button is visible.
  function selectStatus(next: VisitStatus) {
    updateForm({ status: form.status === next ? 'coming' : next });
    if (saved && !isEditing) setIsEditing(true);
  }

  // Change the selected aperitif for the whole visit (tap the shown drink → simple list).
  async function pickAperitif(key: DrinkKey) {
    if (!user) return;
    setIsSavingDrink(true);
    try {
      const res = await fetch(`/api/visit/drink/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ aperitif: key, tonight: false }),
      });
      if (res.ok) {
        setSaved(prev => prev ? { ...prev, aperitif: key, tonightAperitif: null } : prev);
        setDrinkPickerOpen(false);
      }
    } finally {
      setIsSavingDrink(false);
    }
  }

  async function saveQuickDrink(tonight: boolean) {
    if (!user || !pendingDrink) return;
    setIsSavingDrink(true);
    try {
      const res = await fetch(`/api/visit/drink/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ aperitif: pendingDrink, tonight }),
      });
      if (res.ok) {
        setSaved(prev => prev ? {
          ...prev,
          aperitif:        tonight ? prev.aperitif : pendingDrink,
          tonightAperitif: tonight ? pendingDrink : null,
        } : prev);
        setIsChangingDrink(false);
        setPendingDrink(null);
      }
    } finally {
      setIsSavingDrink(false);
    }
  }

  const today = todayStr();
  const year = new Date().getFullYear();
  const isStaying = !!(saved && saved.status === 'coming' && today >= saved.arriveDate && today <= saved.departDate);
  // The drink to display: tonight override takes precedence while staying
  const effectiveDrink = isStaying && saved?.tonightAperitif ? saved.tonightAperitif : saved?.aperitif ?? null;
  const hasTonightOverride = isStaying && !!saved?.tonightAperitif;

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator color="#C85A2E" size="large" />
      </View>
    );
  }

  // Staff have no visit to plan — a minimal profile screen (photo + "always here").
  if (user?.role === 'staff') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.fleur}>⚜</Text>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={pickAvatar} activeOpacity={0.75} style={styles.avatarBtn} disabled={uploadingAvatar}>
              {avatarUri
                ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
                : <View style={[styles.avatarCircle, { backgroundColor: user ? avatarColor(user.name) : '#C8973D' }]}>
                    {uploadingAvatar
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.avatarInitials}>{user ? initials(user.name) : '?'}</Text>}
                  </View>}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.headline}>{user?.name}</Text>
              <Text style={styles.subline}>Staff · always here 🎩</Text>
            </View>
          </View>
        </View>
        <View style={styles.staffCard}>
          <Text style={styles.staffCardText}>
            You're part of the château team, so there's no visit to plan — you're counted as
            always here. Tap your photo above to change it.
          </Text>
        </View>
      </ScrollView>
    );
  }

  const showForm = isEditing || !saved;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.fleur}>⚜</Text>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.75} style={styles.avatarBtn} disabled={uploadingAvatar}>
            {avatarUri
              ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
              : <View style={[styles.avatarCircle, { backgroundColor: user ? avatarColor(user.name) : '#C8973D' }]}>
                  {uploadingAvatar
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.avatarInitials}>{user ? initials(user.name) : '?'}</Text>
                  }
                </View>
            }
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headline}>My {year} Visit</Text>
            <Text style={styles.subline}>
              {saved ? 'Your current visit plan' : "Let the family know you're coming"}
            </Text>
          </View>
          {saved && !showForm && (
            <TouchableOpacity onPress={() => setIsEditing(true)} activeOpacity={0.7}>
              <Text style={styles.editLink}>Edit plans</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Visit status options ── */}
      <View style={styles.statusRow}>
        <TouchableOpacity
          style={[styles.statusCard, form.status === 'not_coming' && styles.statusCardActive]}
          onPress={() => selectStatus('not_coming')}
          activeOpacity={0.75}
        >
          <Text style={[styles.statusCardText, form.status === 'not_coming' && styles.statusCardTextActive]}>
            🚫  Not coming this year
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statusCard, form.status === 'undecided' && styles.statusCardActive]}
          onPress={() => selectStatus('undecided')}
          activeOpacity={0.75}
        >
          <Text style={[styles.statusCardText, form.status === 'undecided' && styles.statusCardTextActive]}>
            🤔  Not finalised yet
          </Text>
        </TouchableOpacity>
      </View>

      {!showForm && saved ? (
        /* ── View mode ── */
        saved.status !== 'coming' ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEyebrow}>
              {saved.status === 'not_coming' ? 'NOT COMING THIS YEAR' : 'PLANS NOT FINALISED'}
            </Text>
            <Text style={styles.statusSummaryText}>
              {saved.status === 'not_coming'
                ? "You've let the family know you're not coming this year."
                : "You're still deciding — no dates set yet."}
            </Text>
            <Text style={styles.statusSummaryHint}>Tap an option above to change this.</Text>
          </View>
        ) : (
        <View style={styles.summaryCard}>
          <View style={styles.summaryBlock}>
            <Text style={styles.summaryEyebrow}>Arriving</Text>
            <Text style={styles.summaryDate}>{formatDate(saved.arriveDate)}</Text>
            <Text style={styles.summarySlot}>{slotLabel(saved.arriveSlot)}</Text>
            {saved.saveLunch  && <Text style={styles.plateNote}>🍽  Lunch plate saved for you</Text>}
            {saved.saveDinner && <Text style={styles.plateNote}>🍽  Dinner plate saved for you</Text>}
            {saved.pickupNeeded && (
              <Text style={styles.transportNote}>
                🚗  Pick up{saved.pickupTime ? ` at ${saved.pickupTime}` : ''}{saved.pickupFrom ? ` from ${saved.pickupFrom}` : ''}
              </Text>
            )}
            {allocationsForMember(saved.allocations, { name: user?.name, arriveDate: saved.arriveDate, departDate: saved.departDate }).map((s, i, arr) => (
              <Text key={i} style={styles.roomNote}>
                🛏  {arr.length > 1 ? 'Room: ' : 'Your room: '}{roomLabel(s.room)}
                {arr.length > 1 ? `  (${formatDate(s.start)} – ${formatDate(s.end)})` : ''}
              </Text>
            ))}
          </View>

          {saved && (
            <>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryAperitifBlock}>
                <Text style={styles.summaryEyebrow}>
                  {hasTonightOverride ? "TONIGHT'S APÉRITIF ✨" : 'APÉRITIF'}
                </Text>

                <TouchableOpacity onPress={() => setDrinkPickerOpen(true)} activeOpacity={0.7}>
                  {!effectiveDrink ? (
                    <View style={styles.summaryDrinkRow}>
                      <Text style={styles.summaryDrinkIcon}>🍹</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.summaryDrinkName}>Choose your aperitif</Text>
                        <Text style={styles.summaryDrinkHint}>Tap to pick from the list</Text>
                      </View>
                      <Text style={styles.summaryDrinkEdit}>Change ›</Text>
                    </View>
                  ) : effectiveDrink === 'later' ? (
                    <View style={styles.summaryDrinkRow}>
                      <Text style={styles.summaryDrinkIcon}>🎲</Text>
                      <Text style={[styles.summaryDrinkName, { flex: 1 }]}>I'll choose on the day!</Text>
                      <Text style={styles.summaryDrinkEdit}>Change ›</Text>
                    </View>
                  ) : (
                    <View style={styles.summaryDrinkRow}>
                      <Text style={styles.summaryDrinkIcon}>{drinkByKey(effectiveDrink)?.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.summaryDrinkName}>{drinkByKey(effectiveDrink)?.label}</Text>
                        <Text style={styles.summaryDrinkHint}>{drinkByKey(effectiveDrink)?.hint}</Text>
                      </View>
                      <Text style={styles.summaryDrinkEdit}>Change ›</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {hasTonightOverride && saved?.aperitif && saved.aperitif !== saved.tonightAperitif && (
                  <Text style={styles.tonightNote}>
                    Back to {drinkByKey(saved.aperitif)?.label ?? saved.aperitif} {drinkByKey(saved.aperitif)?.icon ?? ''} tomorrow
                  </Text>
                )}

                {/* Quick drink change — only shown while staying */}
                {isStaying && !isChangingDrink && (
                  <TouchableOpacity
                    style={styles.changeDrinkBtn}
                    onPress={() => {
                      setPendingDrink(effectiveDrink);
                      setIsChangingDrink(true);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.changeDrinkBtnText}>
                      {hasTonightOverride ? '🍹 Change my mind again?' : '🍹 Fancy something different tonight?'}
                    </Text>
                  </TouchableOpacity>
                )}

                {isStaying && isChangingDrink && (
                  <View style={styles.quickDrinkPanel}>
                    <DrinkPicker value={pendingDrink} onChange={setPendingDrink} />
                    <TouchableOpacity
                      style={styles.quickDrinkCancel}
                      onPress={() => { setIsChangingDrink(false); setPendingDrink(null); }}
                    >
                      <Text style={styles.quickDrinkCancelText}>
                        Actually, keep my {drinkByKey(effectiveDrink)?.label ?? 'drink'}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.quickDrinkBtnRow}>
                      <TouchableOpacity
                        style={[styles.quickDrinkBtnTonight, (!pendingDrink || isSavingDrink) && styles.quickDrinkBtnDisabled]}
                        onPress={() => saveQuickDrink(true)}
                        disabled={!pendingDrink || isSavingDrink}
                        activeOpacity={0.8}
                      >
                        {isSavingDrink
                          ? <ActivityIndicator color="#1A1209" size="small" />
                          : <Text style={styles.quickDrinkBtnTonightText}>Just for tonight</Text>
                        }
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.quickDrinkBtnStay, (!pendingDrink || isSavingDrink) && styles.quickDrinkBtnDisabled]}
                        onPress={() => saveQuickDrink(false)}
                        disabled={!pendingDrink || isSavingDrink}
                        activeOpacity={0.8}
                      >
                        {isSavingDrink
                          ? <ActivityIndicator color="#F5EDD6" size="small" />
                          : <Text style={styles.quickDrinkBtnStayText}>For my whole stay</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </>
          )}

          {/* Per-day opt-outs — active only while you're actually here today */}
          <View style={styles.summaryDivider} />
          <View style={styles.summaryBlock}>
            <Text style={styles.summaryEyebrow}>TONIGHT AT THE CHÂTEAU</Text>
            <Text style={styles.skipHint}>
              {isStaying ? 'Tap to skip a sitting today — resets tomorrow.' : 'Available while you’re here at the château.'}
            </Text>
            <View style={styles.skipRow}>
              {(() => {
                const today = todayStr();
                return ([
                  { meal: 'lunch' as const,    label: 'No lunch today',      on: saved.lunchAbsences.includes(today),  kind: 'absence' as const },
                  { meal: 'dinner' as const,   label: 'No dinner tonight',   on: saved.dinnerAbsences.includes(today), kind: 'absence' as const },
                  { meal: 'aperitif' as const, label: 'No apéritif tonight', on: saved.skipAperitifToday,               kind: 'skip' as const },
                ]).map(b => (
                  <TouchableOpacity
                    key={b.meal}
                    style={[styles.skipPill, b.on && styles.skipPillOn, !isStaying && styles.skipPillDisabled]}
                    onPress={() => b.kind === 'skip'
                      ? toggleSkip('aperitif')
                      : setAbsence(b.meal as 'lunch' | 'dinner', today, !b.on)}
                    disabled={!isStaying || !!skippingMeal || absenceBusy}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.skipPillText, b.on && styles.skipPillTextOn, !isStaying && styles.skipPillTextDisabled]}>
                      {b.on ? '✓ ' : ''}{b.label}
                    </Text>
                  </TouchableOpacity>
                ));
              })()}
            </View>

            {/* Hot drink — one choice for the current sitting. Before 3pm it's the
                after-lunch drink; from 3pm on it's the after-dinner drink. */}
            {(() => {
              const meal: 'lunch' | 'dinner' = new Date().getHours() < 15 ? 'lunch' : 'dinner';
              const chosen = meal === 'lunch' ? saved.lunchDrink : saved.dinnerDrink;
              return (
                <>
                  <Text style={[styles.summaryEyebrow, { marginTop: 18 }]}>
                    {meal === 'lunch' ? 'AFTER-LUNCH DRINK' : 'AFTER-DINNER DRINK'}
                  </Text>
                  <Text style={styles.skipHint}>
                    {isStaying ? 'Choose one — tap again to clear.' : 'Choose while you’re here at the château.'}
                  </Text>
                  <View style={styles.skipRow}>
                    {HOT_DRINKS.map(d => {
                      const on = chosen === d.key;
                      return (
                        <TouchableOpacity
                          key={d.key}
                          style={[styles.skipPill, on && styles.skipPillOn, !isStaying && styles.skipPillDisabled]}
                          onPress={() => chooseDrink(meal, d.key)}
                          disabled={!isStaying || savingDrinks}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.skipPillText, on && styles.skipPillTextOn, !isStaying && styles.skipPillTextDisabled]}>
                            {on ? '✓ ' : ''}{d.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              );
            })()}
          </View>

          {/* Plan ahead — mark future dates you won't be here for lunch or dinner */}
          <View style={styles.summaryDivider} />
          <View style={styles.summaryBlock}>
            <Text style={styles.summaryEyebrow}>AWAY FOR A MEAL</Text>
            <Text style={styles.skipHint}>Planning ahead? Add a future day you won’t be here for lunch or dinner.</Text>

            <View style={styles.absMealRow}>
              {(['lunch', 'dinner'] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.absMealPill, absMeal === m && styles.absMealPillOn]}
                  onPress={() => setAbsMeal(m)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.absMealPillText, absMeal === m && styles.absMealPillTextOn]}>
                    {m === 'lunch' ? 'Lunch' : 'Dinner'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.absAddRow}>
              <View style={{ flex: 1 }}>
                <DateRow value={absDate || addDays(todayStr(), 1)} onChange={setAbsDate} minDate={addDays(todayStr(), 1)} />
              </View>
              <TouchableOpacity
                style={[styles.absAddBtn, absenceBusy && { opacity: 0.6 }]}
                onPress={() => setAbsence(absMeal, absDate || addDays(todayStr(), 1), true)}
                disabled={absenceBusy}
                activeOpacity={0.85}
              >
                <Text style={styles.absAddBtnText}>+ Add</Text>
              </TouchableOpacity>
            </View>

            {(() => {
              const today = todayStr();
              const upcoming = [
                ...saved.lunchAbsences.filter(d => d > today).map(d => ({ d, meal: 'lunch' as const })),
                ...saved.dinnerAbsences.filter(d => d > today).map(d => ({ d, meal: 'dinner' as const })),
              ].sort((a, b) => a.d.localeCompare(b.d) || a.meal.localeCompare(b.meal));
              if (upcoming.length === 0) {
                return <Text style={styles.absEmpty}>No upcoming absences.</Text>;
              }
              return (
                <View style={styles.absList}>
                  {upcoming.map(({ d, meal }) => (
                    <View key={`${meal}-${d}`} style={styles.absItem}>
                      <Text style={styles.absItemText}>
                        {meal === 'lunch' ? '🥗' : '🍽'}  Away for {meal} — {formatDate(d)}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setAbsence(meal, d, false)}
                        disabled={absenceBusy}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.absItemCancel}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              );
            })()}
          </View>

          <View style={styles.summaryDivider} />
          <View style={styles.summaryBlock}>
            <CheeseNote value={saved.cheeseNotes ?? ''} saving={savingCheese} onSave={saveCheese} />
          </View>

          <View style={styles.summaryDivider} />
          <View style={styles.summaryBlock}>
            <Text style={styles.summaryEyebrow}>Leaving</Text>
            <Text style={styles.summaryDate}>{formatDate(saved.departDate)}</Text>
            <Text style={styles.summarySlot}>{slotLabel(saved.departSlot)}</Text>
            {saved.dropoffNeeded && (
              <Text style={styles.transportNote}>
                🚗  Drop off{saved.dropoffTime ? ` at ${saved.dropoffTime}` : ''}{saved.dropoffTo ? ` to ${saved.dropoffTo}` : ''}
              </Text>
            )}
          </View>
        </View>
        )
      ) : (
        /* ── Edit / form mode ── */
        <>
          {form.status !== 'coming' && (
            <Text style={styles.statusFormNote}>
              {form.status === 'not_coming'
                ? "You're marked as not coming this year — your dates below are disabled. Tap the option again to plan a visit."
                : "You're still deciding — your dates below are disabled until you're ready. Tap the option again to plan a visit."}
            </Text>
          )}

          <View
            style={form.status !== 'coming' ? styles.formDisabled : undefined}
            pointerEvents={form.status !== 'coming' ? 'none' : 'auto'}
          >
          {/* Arrival section */}
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>ARRIVING ON</Text>
            <DateRow value={form.arriveDate} onChange={d => updateForm({ arriveDate: d })} />

            <Text style={styles.sectionSubLabel}>At roughly</Text>
            <SlotPicker value={form.arriveSlot} onChange={s => updateForm({ arriveSlot: s })} />

            {form.arriveSlot === 'lunchtime' && (
              <View style={styles.plateToggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.plateToggleLabel}>Save me a lunch plate?</Text>
                  <Text style={styles.plateToggleHint}>We'll keep one warm for you</Text>
                </View>
                <Switch
                  value={form.saveLunch}
                  onValueChange={v => updateForm({ saveLunch: v })}
                  trackColor={{ true: '#2D5A3D', false: '#D9C9A3' }}
                  thumbColor={Platform.OS === 'ios' ? undefined : form.saveLunch ? '#F5EDD6' : '#F5EDD6'}
                />
              </View>
            )}
            {(form.arriveSlot === 'dinnertime' || form.arriveSlot === 'evening') && (
              <View style={styles.plateToggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.plateToggleLabel}>Save me a dinner plate?</Text>
                  <Text style={styles.plateToggleHint}>
                    {form.arriveSlot === 'evening' ? 'We\'ll save some food for you' : 'We\'ll keep one warm for you'}
                  </Text>
                </View>
                <Switch
                  value={form.saveDinner}
                  onValueChange={v => updateForm({ saveDinner: v })}
                  trackColor={{ true: '#2D5A3D', false: '#D9C9A3' }}
                  thumbColor={Platform.OS === 'ios' ? undefined : form.saveDinner ? '#F5EDD6' : '#F5EDD6'}
                />
              </View>
            )}

            <View style={styles.plateToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.plateToggleLabel}>Need picking up?</Text>
                <Text style={styles.plateToggleHint}>We'll come and collect you</Text>
              </View>
              <Switch
                value={form.pickupNeeded}
                onValueChange={v => updateForm({ pickupNeeded: v })}
                trackColor={{ true: '#2D5A3D', false: '#D9C9A3' }}
                thumbColor={Platform.OS === 'ios' ? undefined : '#F5EDD6'}
              />
            </View>
            {form.pickupNeeded && (
              <View style={styles.transportDetails}>
                <View style={styles.transportField}>
                  <Text style={styles.transportFieldLabel}>Pick-up time</Text>
                  {Platform.OS === 'web' ? (
                    <View style={styles.transportTimeWrapper}>
                      <Text style={styles.transportTimeText}>{form.pickupTime || '-- : --'}</Text>
                      <input
                        type="time"
                        value={form.pickupTime}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm({ pickupTime: e.target.value })}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none' } as React.CSSProperties}
                      />
                    </View>
                  ) : (
                    <TextInput
                      style={styles.transportInput}
                      value={form.pickupTime}
                      onChangeText={t => updateForm({ pickupTime: t })}
                      placeholder="HH:MM"
                      placeholderTextColor="#B8956A"
                      keyboardType="numbers-and-punctuation"
                    />
                  )}
                </View>
                <View style={[styles.transportField, { flex: 1 }]}>
                  <Text style={styles.transportFieldLabel}>Pick-up from</Text>
                  <TextInput
                    style={styles.transportInput}
                    value={form.pickupFrom}
                    onChangeText={t => updateForm({ pickupFrom: t })}
                    placeholder="e.g. Carcassonne Airport"
                    placeholderTextColor="#B8956A"
                  />
                </View>
              </View>
            )}
          </View>

          {/* Apéritif section */}
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>APÉRITIF 🥂</Text>
            <Text style={styles.sectionSubLabel}>What will you be having?</Text>
            <DrinkPicker value={form.aperitif} onChange={d => updateForm({ aperitif: d })} />
          </View>

          {/* Departure section */}
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>LEAVING ON</Text>
            <DateRow
              value={form.departDate}
              onChange={d => updateForm({ departDate: d })}
              minDate={form.arriveDate}
            />

            <Text style={styles.sectionSubLabel}>At roughly</Text>
            <SlotPicker value={form.departSlot} onChange={s => updateForm({ departSlot: s })} />

            <View style={styles.plateToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.plateToggleLabel}>Need dropping off?</Text>
                <Text style={styles.plateToggleHint}>We'll give you a lift</Text>
              </View>
              <Switch
                value={form.dropoffNeeded}
                onValueChange={v => updateForm({ dropoffNeeded: v })}
                trackColor={{ true: '#2D5A3D', false: '#D9C9A3' }}
                thumbColor={Platform.OS === 'ios' ? undefined : '#F5EDD6'}
              />
            </View>
            {form.dropoffNeeded && (
              <View style={styles.transportDetails}>
                <View style={styles.transportField}>
                  <Text style={styles.transportFieldLabel}>Drop-off time</Text>
                  {Platform.OS === 'web' ? (
                    <View style={styles.transportTimeWrapper}>
                      <Text style={styles.transportTimeText}>{form.dropoffTime || '-- : --'}</Text>
                      <input
                        type="time"
                        value={form.dropoffTime}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm({ dropoffTime: e.target.value })}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none' } as React.CSSProperties}
                      />
                    </View>
                  ) : (
                    <TextInput
                      style={styles.transportInput}
                      value={form.dropoffTime}
                      onChangeText={t => updateForm({ dropoffTime: t })}
                      placeholder="HH:MM"
                      placeholderTextColor="#B8956A"
                      keyboardType="numbers-and-punctuation"
                    />
                  )}
                </View>
                <View style={[styles.transportField, { flex: 1 }]}>
                  <Text style={styles.transportFieldLabel}>Drop-off to</Text>
                  <TextInput
                    style={styles.transportInput}
                    value={form.dropoffTo}
                    onChangeText={t => updateForm({ dropoffTo: t })}
                    placeholder="e.g. Carcassonne Airport"
                    placeholderTextColor="#B8956A"
                  />
                </View>
              </View>
            )}
          </View>
          </View>

          {/* Buttons */}
          <View style={styles.buttonRow}>
            {isEditing && saved && (
              <TouchableOpacity style={styles.cancelBtn} onPress={cancelEdit} activeOpacity={0.7}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.saveBtn, isSaving && styles.saveBtnBusy, isEditing && saved ? styles.saveBtnFlex : styles.saveBtnFull]}
              onPress={save}
              disabled={isSaving}
              activeOpacity={0.82}
            >
              {isSaving
                ? <ActivityIndicator color="#F5EDD6" size="small" />
                : <Text style={styles.saveBtnText}>{saved ? 'Update Visit Plan' : 'Save Visit Plan'}</Text>
              }
            </TouchableOpacity>
          </View>
        </>
      )}

      <AperitifPickerModal
        open={drinkPickerOpen}
        current={effectiveDrink}
        busy={isSavingDrink}
        onPick={pickAperitif}
        onClose={() => setDrinkPickerOpen(false)}
      />
    </ScrollView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5EDD6',
  },
  content: {
    paddingBottom: 56,
  },
  centred: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Header
  header: {
    paddingTop: 32,
    paddingHorizontal: 28,
    paddingBottom: 20,
    borderBottomWidth: 1.5,
    borderBottomColor: '#EDD9A3',
  },
  fleur: {
    fontSize: 18,
    color: '#C8973D',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  staffCard: { margin: 20, padding: 18, borderRadius: 16, backgroundColor: '#EEF4F8', borderWidth: 1, borderColor: '#A8C8E8' },
  staffCardText: { fontSize: 15, lineHeight: 22, color: '#3A6B8A', fontFamily: 'Raleway, system-ui, sans-serif' },
  avatarBtn: { marginRight: 14, flexShrink: 0 },
  avatarCircle: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  avatarImg: { width: 52, height: 52, borderRadius: 26 },
  avatarInitials: { fontSize: 18, fontFamily: 'Raleway, system-ui, sans-serif', fontWeight: '700', color: '#fff' },
  headline: {
    fontSize: 32,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    lineHeight: 40,
  },
  subline: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  editLink: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#C85A2E',
    textDecorationLine: 'underline',
    paddingBottom: 4,
  },

  // Visit status options
  statusRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 20,
  },
  statusCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#EDD9A3',
    backgroundColor: '#FAF4E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCardActive: {
    borderColor: '#C85A2E',
    backgroundColor: '#FDF8EF',
  },
  statusCardText: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#5C3D2E',
    textAlign: 'center',
  },
  statusCardTextActive: {
    color: '#C85A2E',
  },
  statusSummaryText: {
    fontSize: 17,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    lineHeight: 26,
    marginTop: 2,
  },
  statusSummaryHint: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 10,
  },
  statusFormNote: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    fontStyle: 'italic',
    marginHorizontal: 20,
    marginTop: 18,
    lineHeight: 20,
  },
  formDisabled: {
    opacity: 0.4,
  },

  // Summary (view mode)
  summaryCard: {
    margin: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 24,
    borderWidth: 1,
    borderColor: '#EDD9A3',
    shadowColor: '#1A1209',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },
  summaryBlock: {
    paddingVertical: 4,
  },
  summaryEyebrow: {
    fontSize: 10,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#C8973D',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  skipHint: {
    fontSize: 12, color: '#8B6245', marginBottom: 10,
    fontFamily: 'Raleway, system-ui, sans-serif',
  },
  skipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skipPill: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 50,
    borderWidth: 1.5, borderColor: '#C8973D', backgroundColor: '#FFFDF5',
  },
  skipPillOn: { backgroundColor: '#C85A2E', borderColor: '#C85A2E' },
  skipPillDisabled: { borderColor: '#E7D6A8', backgroundColor: '#F5EDD6', opacity: 0.6 },
  skipPillText: {
    fontSize: 13, fontWeight: '700', color: '#C8973D',
    fontFamily: 'Raleway, system-ui, sans-serif',
  },
  skipPillTextOn: { color: '#F5EDD6' },
  skipPillTextDisabled: { color: '#B8956A' },
  drinkStepperRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6,
  },
  drinkStepperLabel: {
    fontSize: 15, color: '#1A1209', fontWeight: '600',
    fontFamily: 'Raleway, system-ui, sans-serif',
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#C8973D',
    backgroundColor: '#FFFDF5', alignItems: 'center', justifyContent: 'center',
  },
  stepBtnDisabled: { borderColor: '#E7D6A8', backgroundColor: '#F5EDD6', opacity: 0.5 },
  stepBtnText: { fontSize: 20, fontWeight: '700', color: '#C85A2E', lineHeight: 22 },
  stepCount: {
    fontSize: 17, fontWeight: '700', color: '#1A1209', minWidth: 22, textAlign: 'center',
    fontFamily: 'Raleway, system-ui, sans-serif',
  },
  cheeseInput: {
    borderWidth: 1.5, borderColor: '#EDD9A3', borderRadius: 12, backgroundColor: '#FFFDF5',
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#1A1209', minHeight: 64,
    textAlignVertical: 'top', fontFamily: 'Raleway, system-ui, sans-serif',
  },
  cheeseSaveBtn: {
    marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#C85A2E',
    borderRadius: 50, paddingVertical: 9, paddingHorizontal: 22,
  },
  cheeseSaveBtnText: { fontSize: 14, fontWeight: '700', color: '#F5EDD6', fontFamily: 'Raleway, system-ui, sans-serif' },
  absMealRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  absMealPill: {
    paddingVertical: 7, paddingHorizontal: 18, borderRadius: 50,
    borderWidth: 1.5, borderColor: '#C8973D', backgroundColor: '#FFFDF5',
  },
  absMealPillOn: { backgroundColor: '#8B6245', borderColor: '#8B6245' },
  absMealPillText: { fontSize: 13, fontWeight: '700', color: '#C8973D', fontFamily: 'Raleway, system-ui, sans-serif' },
  absMealPillTextOn: { color: '#F5EDD6' },
  absAddRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  absAddBtn: { backgroundColor: '#C85A2E', borderRadius: 50, paddingVertical: 10, paddingHorizontal: 18 },
  absAddBtnText: { fontSize: 14, fontWeight: '700', color: '#F5EDD6', fontFamily: 'Raleway, system-ui, sans-serif' },
  absEmpty: { fontSize: 13, color: '#B8956A', fontStyle: 'italic', marginTop: 12, fontFamily: 'Raleway, system-ui, sans-serif' },
  absList: { marginTop: 12, gap: 8 },
  absItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFDF5', borderWidth: 1, borderColor: '#EDD9A3', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  absItemText: { fontSize: 14, color: '#1A1209', fontFamily: 'Raleway, system-ui, sans-serif' },
  absItemCancel: { fontSize: 15, fontWeight: '700', color: '#C85A2E', paddingHorizontal: 4 },
  summaryDate: {
    fontSize: 22,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: '700',
    color: '#1A1209',
  },
  summarySlot: {
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#5C3D2E',
    marginTop: 2,
  },
  plateNote: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#2D5A3D',
    fontWeight: '600',
    marginTop: 8,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#EDD9A3',
    marginVertical: 18,
  },

  // Form sections
  section: {
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EDD9A3',
    shadowColor: '#1A1209',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionEyebrow: {
    fontSize: 10,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#C8973D',
    letterSpacing: 1.5,
    marginBottom: 14,
  },
  sectionSubLabel: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 18,
    marginBottom: 10,
    letterSpacing: 0.2,
  },

  // Date navigator
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF4E6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EDD9A3',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  navBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  navBtnDisabled: {
    opacity: 0.3,
  },
  navArrow: {
    fontSize: 28,
    color: '#C85A2E',
    lineHeight: 36,
  },
  navArrowDisabled: {
    color: '#B8956A',
  },
  dateTextWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dateText: {
    fontSize: 18,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: '700',
    color: '#1A1209',
    textAlign: 'center',
  },
  navBtnMonth: {
    opacity: 0.7,
  },
  navArrowMonth: {
    fontSize: 22,
    lineHeight: 30,
  },

  // Slot picker (radio list)
  slotList: {
    gap: 6,
  },
  slotItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EDD9A3',
    backgroundColor: '#FAF4E6',
    gap: 12,
  },
  slotItemActive: {
    borderColor: '#C85A2E',
    backgroundColor: '#FDF8EF',
  },
  slotRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#C8A96A',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  slotRadioActive: {
    borderColor: '#C85A2E',
  },
  slotRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#C85A2E',
  },
  slotLabel: {
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#5C3D2E',
  },
  slotLabelActive: {
    color: '#C85A2E',
  },
  slotHint: {
    fontSize: 12,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#A08060',
    marginTop: 1,
  },

  // Plate save toggle
  plateToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#EDD9A3',
    gap: 12,
  },
  plateToggleLabel: {
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#1A1209',
  },
  plateToggleHint: {
    fontSize: 12,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    marginTop: 2,
  },

  // Drink picker grid
  drinkGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  drinkCard: {
    width: '47%',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EDD9A3',
    backgroundColor: '#FAF4E6',
    alignItems: 'center',
    gap: 3,
  },
  drinkCardActive: {
    borderColor: '#C85A2E',
    backgroundColor: '#FDF8EF',
  },
  drinkIcon: {
    fontSize: 26,
  },
  drinkLabel: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#5C3D2E',
    textAlign: 'center',
  },
  drinkLabelActive: {
    color: '#C85A2E',
  },
  drinkHint: {
    fontSize: 10,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#A08060',
    textAlign: 'center',
  },
  drinkLater: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EDD9A3',
    backgroundColor: '#FAF4E6',
    marginTop: 8,
    gap: 8,
  },
  drinkLaterActive: {
    borderColor: '#C8973D',
    backgroundColor: '#FFF8ED',
  },
  drinkLaterIcon: {
    fontSize: 20,
  },
  drinkLaterLabel: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#8B6245',
    fontStyle: 'italic',
  },
  drinkLaterLabelActive: {
    color: '#C8973D',
  },

  // Summary aperitif block
  summaryAperitifBlock: {
    paddingVertical: 4,
  },
  summaryDrinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
  },
  summaryDrinkIcon: {
    fontSize: 36,
  },
  summaryDrinkName: {
    fontSize: 20,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: '700',
    color: '#1A1209',
  },
  summaryDrinkHint: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    fontStyle: 'italic',
    marginTop: 1,
  },
  summaryDrinkEdit: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#C85A2E',
  },

  // Aperitif picker (tap the drink to change)
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26, 18, 9, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  pickerSheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#F5EDD6',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EDD9A3',
  },
  pickerTitle: {
    fontSize: 20,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: '700',
    color: '#1A1209',
    marginBottom: 12,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EDD9A3',
    backgroundColor: '#FFFDF5',
    marginBottom: 6,
  },
  pickerRowActive: {
    borderColor: '#C85A2E',
    backgroundColor: '#FDF8EF',
  },
  pickerIcon: {
    fontSize: 24,
    width: 30,
    textAlign: 'center',
  },
  pickerLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#5C3D2E',
  },
  pickerLabelActive: {
    color: '#C85A2E',
  },
  pickerCheck: {
    fontSize: 16,
    color: '#C85A2E',
    fontWeight: '700',
  },
  pickerDismiss: {
    fontSize: 12,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#B8956A',
    textAlign: 'center',
    marginTop: 10,
  },

  // Tonight quick-change
  tonightNote: {
    fontSize: 12,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    fontStyle: 'italic',
    marginTop: 6,
  },
  changeDrinkBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: '#C85A2E',
    alignSelf: 'flex-start',
  },
  changeDrinkBtnText: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#C85A2E',
  },
  quickDrinkPanel: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#EDD9A3',
    gap: 12,
  },
  quickDrinkCancel: {
    alignSelf: 'center',
    paddingVertical: 8,
  },
  quickDrinkCancelText: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#B8956A',
    textDecorationLine: 'underline',
    fontStyle: 'italic',
  },
  quickDrinkBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickDrinkBtnTonight: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: '#C85A2E',
    alignItems: 'center',
  },
  quickDrinkBtnTonightText: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#C85A2E',
  },
  quickDrinkBtnStay: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 50,
    backgroundColor: '#2D5A3D',
    alignItems: 'center',
  },
  quickDrinkBtnStayText: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#F5EDD6',
  },
  quickDrinkBtnDisabled: {
    opacity: 0.45,
  },

  // Buttons
  buttonRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 24,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: '#C8973D',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '600',
    color: '#C8973D',
  },
  saveBtn: {
    paddingVertical: 16,
    borderRadius: 50,
    backgroundColor: '#C85A2E',
    alignItems: 'center',
  },
  saveBtnFlex: {
    flex: 2,
  },
  saveBtnFull: {
    flex: 1,
  },
  saveBtnBusy: {
    backgroundColor: '#D4785A',
  },
  saveBtnText: {
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#F5EDD6',
    letterSpacing: 0.3,
  },

  // Transport
  transportNote: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#1A6B8A',
    fontWeight: '600',
    marginTop: 8,
  },
  roomNote: {
    fontSize: 13,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B5E3C',
    fontWeight: '600',
    marginTop: 8,
  },
  transportDetails: {
    marginTop: 12,
    gap: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  transportField: {
    gap: 4,
  },
  transportFieldLabel: {
    fontSize: 11,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#8B6245',
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  transportInput: {
    borderWidth: 1.5,
    borderColor: '#EDD9A3',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#1A1209',
    backgroundColor: '#FAF4E6',
    minWidth: 100,
  },
  transportTimeWrapper: {
    position: 'relative',
    borderWidth: 1.5,
    borderColor: '#EDD9A3',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: '#FAF4E6',
    minWidth: 100,
    alignItems: 'center',
  },
  transportTimeText: {
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#1A1209',
  },
});
