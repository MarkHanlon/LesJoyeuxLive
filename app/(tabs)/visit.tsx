import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';

type TimeSlot = 'morning' | 'lunchtime' | 'afternoon' | 'dinnertime' | 'evening';

const SLOTS: { key: TimeSlot; label: string; hint: string }[] = [
  { key: 'morning',    label: 'Morning',     hint: 'before lunch' },
  { key: 'lunchtime',  label: 'Lunchtime',   hint: 'around 1pm' },
  { key: 'afternoon',  label: 'Afternoon',   hint: 'after lunch' },
  { key: 'dinnertime', label: 'Dinner time', hint: 'around 8pm' },
  { key: 'evening',    label: 'Evening',     hint: 'after dinner' },
];

type VisitPlan = {
  arriveDate: string;   // YYYY-MM-DD
  arriveSlot: TimeSlot;
  saveLunch: boolean;
  saveDinner: boolean;
  departDate: string;
  departSlot: TimeSlot;
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
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
  return { arriveDate: t, arriveSlot: 'afternoon', saveLunch: false, saveDinner: false, departDate: addDays(t, 7), departSlot: 'morning' };
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

// ── Main screen ─────────────────────────────────────────────────────────────

export default function VisitScreen() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saved, setSaved] = useState<VisitPlan | null>(null);
  const [form, setForm] = useState<VisitPlan>(defaultPlan());

  const fetchVisit = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/visit/${user.id}`);
      if (res.ok) {
        const d = await res.json();
        const plan: VisitPlan = {
          arriveDate: String(d.arrive_date).slice(0, 10),
          arriveSlot: d.arrive_slot as TimeSlot,
          saveLunch:  !!d.save_lunch,
          saveDinner: !!d.save_dinner,
          departDate: String(d.depart_date).slice(0, 10),
          departSlot: d.depart_slot as TimeSlot,
        };
        setSaved(plan);
        setForm(plan);
      }
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchVisit(); }, [fetchVisit]);

  function updateForm(partial: Partial<VisitPlan>) {
    setForm(prev => {
      const next = { ...prev, ...partial };
      if (next.departDate < next.arriveDate) next.departDate = next.arriveDate;
      // clear plate flags when slot changes away from their trigger
      if (partial.arriveSlot && partial.arriveSlot !== 'lunchtime')  next.saveLunch  = false;
      if (partial.arriveSlot && partial.arriveSlot !== 'dinnertime') next.saveDinner = false;
      return next;
    });
  }

  async function save() {
    if (!user) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/visit/${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arriveDate: form.arriveDate,
          arriveSlot: form.arriveSlot,
          saveLunch:  form.saveLunch,
          saveDinner: form.saveDinner,
          departDate: form.departDate,
          departSlot: form.departSlot,
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

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator color="#C85A2E" size="large" />
      </View>
    );
  }

  const showForm = isEditing || !saved;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.fleur}>⚜</Text>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headline}>My Visit</Text>
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

      {!showForm && saved ? (
        /* ── View mode ── */
        <View style={styles.summaryCard}>
          <View style={styles.summaryBlock}>
            <Text style={styles.summaryEyebrow}>Arriving</Text>
            <Text style={styles.summaryDate}>{formatDate(saved.arriveDate)}</Text>
            <Text style={styles.summarySlot}>{slotLabel(saved.arriveSlot)}</Text>
            {saved.saveLunch  && <Text style={styles.plateNote}>🍽  Lunch plate saved for you</Text>}
            {saved.saveDinner && <Text style={styles.plateNote}>🍽  Dinner plate saved for you</Text>}
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryBlock}>
            <Text style={styles.summaryEyebrow}>Leaving</Text>
            <Text style={styles.summaryDate}>{formatDate(saved.departDate)}</Text>
            <Text style={styles.summarySlot}>{slotLabel(saved.departSlot)}</Text>
          </View>
        </View>
      ) : (
        /* ── Edit / form mode ── */
        <>
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
            {form.arriveSlot === 'dinnertime' && (
              <View style={styles.plateToggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.plateToggleLabel}>Save me a dinner plate?</Text>
                  <Text style={styles.plateToggleHint}>We'll keep one warm for you</Text>
                </View>
                <Switch
                  value={form.saveDinner}
                  onValueChange={v => updateForm({ saveDinner: v })}
                  trackColor={{ true: '#2D5A3D', false: '#D9C9A3' }}
                  thumbColor={Platform.OS === 'ios' ? undefined : form.saveDinner ? '#F5EDD6' : '#F5EDD6'}
                />
              </View>
            )}
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
    paddingTop: 64,
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
});
