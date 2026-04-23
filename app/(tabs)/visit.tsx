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

const DRINKS = [
  { key: 'pastis',     label: 'Pastis',           hint: 'Ricard, 51…',              icon: '🌿' },
  { key: 'kir',        label: 'Kir',              hint: 'white wine & cassis',       icon: '💜' },
  { key: 'kir_royale', label: 'Kir Royale',       hint: 'crémant & cassis',          icon: '🥂' },
  { key: 'cremant',    label: 'Crémant',          hint: 'or champagne',              icon: '🍾' },
  { key: 'lillet',     label: 'Lillet Blanc',     hint: 'sur glace',                 icon: '🍸' },
  { key: 'suze',       label: 'Suze',             hint: 'gentiane — très français',  icon: '🌼' },
  { key: 'red_wine',   label: 'Red Wine',         hint: 'un rouge',                  icon: '🍷' },
  { key: 'white_wine', label: 'White Wine',       hint: 'un blanc',                  icon: '🫗' },
  { key: 'rose',       label: 'Rosé',             hint: 'rosé, bien sûr',            icon: '🌸' },
  { key: 'gt',         label: 'G&T',              hint: 'gin & tonic',               icon: '🧊' },
  { key: 'beer',       label: 'Beer',             hint: 'une bière',                 icon: '🍺' },
  { key: 'sparkling',  label: 'Sparkling Water',  hint: 'eau pétillante',            icon: '💧' },
  { key: 'oj',         label: 'Orange Juice',     hint: "jus d'orange",              icon: '🍊' },
  { key: 'lemonade',   label: 'Lemonade',         hint: 'citron pressé',             icon: '🍋' },
  { key: 'cola',       label: 'Cola',             hint: 'Coca, Pepsi…',              icon: '🥤' },
] as const;

type DrinkKey = typeof DRINKS[number]['key'] | 'later';

function drinkByKey(key: string | null) {
  return DRINKS.find(d => d.key === key) ?? null;
}

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
  aperitif: DrinkKey | null;
  tonightAperitif: DrinkKey | null; // tonight-only override, null if not set for today
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
  return { arriveDate: t, arriveSlot: 'afternoon', saveLunch: false, saveDinner: false, departDate: addDays(t, 7), departSlot: 'morning', aperitif: null, tonightAperitif: null };
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

  const fetchVisit = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/visit/${user.id}`);
      if (res.ok) {
        const d = await res.json();
        const plan: VisitPlan = {
          arriveDate:      String(d.arrive_date).slice(0, 10),
          arriveSlot:      d.arrive_slot as TimeSlot,
          saveLunch:       !!d.save_lunch,
          saveDinner:      !!d.save_dinner,
          departDate:      String(d.depart_date).slice(0, 10),
          departSlot:      d.depart_slot as TimeSlot,
          aperitif:        (d.aperitif as DrinkKey) ?? null,
          tonightAperitif: (d.tonight_aperitif as DrinkKey) ?? null,
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
          aperitif:   form.aperitif,
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
  const isStaying = !!(saved && today >= saved.arriveDate && today <= saved.departDate);
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

          {(effectiveDrink || isStaying) && (
            <>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryAperitifBlock}>
                <Text style={styles.summaryEyebrow}>
                  {hasTonightOverride ? "TONIGHT'S APÉRITIF ✨" : 'APÉRITIF'}
                </Text>

                {effectiveDrink && (
                  effectiveDrink === 'later' ? (
                    <View style={styles.summaryDrinkRow}>
                      <Text style={styles.summaryDrinkIcon}>🎲</Text>
                      <Text style={styles.summaryDrinkName}>I'll choose on the day!</Text>
                    </View>
                  ) : (
                    <View style={styles.summaryDrinkRow}>
                      <Text style={styles.summaryDrinkIcon}>{drinkByKey(effectiveDrink)?.icon}</Text>
                      <View>
                        <Text style={styles.summaryDrinkName}>{drinkByKey(effectiveDrink)?.label}</Text>
                        <Text style={styles.summaryDrinkHint}>{drinkByKey(effectiveDrink)?.hint}</Text>
                      </View>
                    </View>
                  )
                )}

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
});
