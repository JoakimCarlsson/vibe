import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useAnimatedValue,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import EventSource from 'react-native-sse';
import * as Haptics from 'expo-haptics';

import { GeneratedApp } from '@/components/generated-app';
import { API_URL } from '@/lib/api';
import { installRuntimeErrorTrap } from '@/lib/runtime-errors';
import { colors as C, fonts } from '@/theme';

type Phase = 'landing' | 'loading' | 'result';

type GeneratedFile = { path: string; content: string };
type VibedApp = { files: GeneratedFile[]; hbc: string };

// Status mirrors the backend's StatusEvent: a real pipeline stage update.
type Status = {
  phase: string;
  message?: string;
  attempt?: number;
  brief?: string;
  error?: string;
};

// vibeApp streams the generation over SSE: onStatus fires for each pipeline
// stage, and the promise resolves with the compiled app on the final result
// event (or rejects on a failure / transport error).
function vibeApp(
  wish: string,
  files: GeneratedFile[] | undefined,
  error: string | undefined,
  onStatus: (s: Status) => void
): Promise<VibedApp> {
  return new Promise((resolve, reject) => {
    const es = new EventSource<'status' | 'result' | 'failure'>(
      `${API_URL}/api/v1/generate/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: wish, files, error }),
        pollingInterval: 0, // one-shot: never auto-reconnect
        timeout: 1000 * 60 * 11, // just beyond the backend's 10-minute cap
      }
    );

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      es.removeAllEventListeners();
      es.close();
      fn();
    };

    es.addEventListener('status', (e) => {
      try {
        if (e.data) onStatus(JSON.parse(e.data) as Status);
      } catch {
        // ignore a malformed status frame; the next one will arrive
      }
    });

    es.addEventListener('result', (e) => {
      let data: VibedApp | null = null;
      try {
        data = e.data ? (JSON.parse(e.data) as VibedApp) : null;
      } catch {
        data = null;
      }
      if (!data?.hbc || !data.files?.length) {
        finish(() => reject(new Error('backend returned an empty app')));
      } else {
        finish(() => resolve(data));
      }
    });

    es.addEventListener('failure', (e) => {
      let detail = 'generation failed';
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        detail = d?.detail ?? d?.title ?? detail;
      } catch {
        // keep the default detail
      }
      finish(() => reject(new Error(detail)));
    });

    // Built-in transport error (connection refused, timeout, dropped socket) —
    // distinct from our named "failure" event above.
    es.addEventListener('error', (e) => {
      const message = 'message' in e && e.message ? e.message : 'connection error';
      finish(() => reject(new Error(message)));
    });
  });
}

/** Staggered rise-in wrapper, mirrors the landing entrance animation. */
function Rise({
  delay,
  style,
  children,
}: {
  delay: number;
  style?: object;
  children: React.ReactNode;
}) {
  const v = useAnimatedValue(0);
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 700,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [v, delay]);
  return (
    <Animated.View
      style={[
        {
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

/** The sliding spark progress bar. */
function Spark() {
  const x = useAnimatedValue(0);
  useEffect(() => {
    Animated.loop(
      Animated.timing(x, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    ).start();
  }, [x]);
  return (
    <View style={styles.spark}>
      <Animated.View
        style={[
          styles.sparkFill,
          {
            transform: [
              { translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-80, 200] }) },
            ],
          },
        ]}
      />
    </View>
  );
}

function LoadingView({ status, brief }: { status: Status | null; brief: string }) {
  const [dots, setDots] = useState('…');
  useEffect(() => {
    let d = 0;
    const dotTimer = setInterval(() => {
      d = (d + 1) % 4;
      setDots('.'.repeat(d));
    }, 350);
    return () => clearInterval(dotTimer);
  }, []);

  const message = status?.message ?? 'sending your wish to vibe';
  const showAttempt = (status?.attempt ?? 0) > 1;

  return (
    <View style={styles.loading}>
      <View style={styles.vibingRow}>
        <Text style={styles.anvil}>vibing</Text>
        <Text style={[styles.anvil, styles.dots]}>{dots}</Text>
      </View>
      <Spark />
      <Text style={styles.status}>
        {message}
        {showAttempt ? `  ·  attempt ${status?.attempt}` : ''}
      </Text>
      {status?.phase === 'retrying' && status.error ? (
        <Text style={styles.statusError} numberOfLines={2}>
          {status.error}
        </Text>
      ) : null}
      {brief ? (
        <Rise delay={0} style={styles.briefWrap}>
          <Text style={styles.briefLabel}>DESIGN BRIEF</Text>
          <ScrollView style={styles.briefScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.briefText}>{brief.trim()}</Text>
          </ScrollView>
        </Rise>
      ) : null}
    </View>
  );
}

/**
 * The result-screen action button. A tap toggles the menu; a press-and-hold
 * (~220ms, confirmed with a haptic) picks it up so it can be dragged anywhere,
 * clamped to stay within the safe area.
 */
function MovableFab({
  open,
  onToggle,
  onChat,
  onReset,
}: {
  open: boolean;
  onToggle: () => void;
  onChat: () => void;
  onReset: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');
  const minX = -(width - 92);
  const maxX = 0;
  const minY = -(height - 150 - insets.top);
  const maxY = 0;

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const offset = useRef({ x: 0, y: 0 }).current;
  const dragging = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const clearHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => dragging.current,
      onPanResponderGrant: () => {
        holdTimer.current = setTimeout(() => {
          dragging.current = true;
          setIsDragging(true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        }, 220);
      },
      onPanResponderMove: (_, g) => {
        if (!dragging.current) {
          // Finger moved before the hold registered: it's not a tap, so drop
          // the pending pick-up rather than jumping the button.
          if (Math.hypot(g.dx, g.dy) > 8) clearHold();
          return;
        }
        pan.setValue({
          x: clamp(offset.x + g.dx, minX, maxX),
          y: clamp(offset.y + g.dy, minY, maxY),
        });
      },
      onPanResponderRelease: (_, g) => {
        clearHold();
        if (dragging.current) {
          offset.x = clamp(offset.x + g.dx, minX, maxX);
          offset.y = clamp(offset.y + g.dy, minY, maxY);
          dragging.current = false;
          setIsDragging(false);
        } else if (Math.hypot(g.dx, g.dy) < 8) {
          onToggle();
        }
      },
      onPanResponderTerminate: () => {
        clearHold();
        if (dragging.current) {
          pan.setValue({ x: offset.x, y: offset.y });
          dragging.current = false;
          setIsDragging(false);
        }
      },
    })
  ).current;

  return (
    <Animated.View
      style={[styles.fabWrap, { transform: pan.getTranslateTransform() }]}
      pointerEvents="box-none">
      {open && !isDragging && (
        <View style={styles.fabMenu}>
          <Pressable style={styles.fabItem} onPress={onChat}>
            <Text style={styles.fabItemText}>✦  Keep chatting</Text>
          </Pressable>
          <Pressable style={styles.fabItem} onPress={onReset}>
            <Text style={styles.fabItemText}>←  Go home</Text>
          </Pressable>
        </View>
      )}
      <Animated.View
        {...responder.panHandlers}
        style={[styles.fab, isDragging && styles.fabDragging]}>
        <Text style={styles.fabIcon}>{open ? '×' : '◆'}</Text>
      </Animated.View>
    </Animated.View>
  );
}

export default function VibeScreen() {
  const [phase, setPhase] = useState<Phase>('landing');
  const [wish, setWish] = useState('');
  const [app, setApp] = useState<VibedApp | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [chatText, setChatText] = useState('');
  const [kbHeight, setKbHeight] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [brief, setBrief] = useState('');
  const inputRef = useRef<TextInput>(null);
  const chatRef = useRef<TextInput>(null);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setKbHeight(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // While a generated app is mounted, trap async/uncaught errors the render
  // boundary can't see and surface the first one for repair.
  useEffect(() => {
    if (phase !== 'result' || !app) return;
    setRuntimeError(null);
    const uninstall = installRuntimeErrorTrap((report) =>
      setRuntimeError((prev) => prev ?? report)
    );
    return uninstall;
  }, [phase, app]);

  // generate builds a fresh app, edits the current project when files are passed,
  // or repairs it when a runtime crash report is passed.
  async function generate(prompt: string, files?: GeneratedFile[], error?: string) {
    const w = prompt.trim();
    const isRepair = !!error && !!files?.length;
    if (!w && !isRepair) return;
    const returnTo: Phase = phase;
    setRuntimeError(null);
    setStatus(null);
    setBrief('');
    setPhase('loading');
    try {
      const vibed = await vibeApp(w, files, error, (s) => {
        setStatus(s);
        if (s.brief) setBrief(s.brief);
      });
      setApp(vibed);
      setChatting(false);
      setChatText('');
      setFabOpen(false);
      setPhase('result');
    } catch (err) {
      setPhase(returnTo);
      Alert.alert(
        "Couldn't build that one",
        'The model call failed or returned nothing. Try again or rephrase.\n\n' +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  // repair sends a device-side runtime crash back to the generator for a fix.
  function repair(report: string) {
    generate('', app?.files, report);
  }

  function vibe() {
    if (!wish.trim()) {
      inputRef.current?.focus();
      return;
    }
    generate(wish);
  }

  function reset() {
    setWish('');
    setChatText('');
    setChatting(false);
    setFabOpen(false);
    setStatus(null);
    setBrief('');
    setPhase('landing');
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        {phase === 'landing' && (
          <View style={[styles.shell, { paddingBottom: 24 + kbHeight }]}>
            <Rise delay={50}>
              <Text style={styles.brand}>
                <Text style={{ color: C.accent }}>◆</Text>
                {'  V I B E'}
              </Text>
            </Rise>
            <Rise delay={150}>
              <Text style={styles.h1}>
                Describe an app.{'\n'}
                <Text style={styles.h1Em}>Get the app.</Text>
              </Text>
            </Rise>
            <Rise delay={250} style={styles.fullWidth}>
              <View style={styles.bar}>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  value={wish}
                  onChangeText={setWish}
                  placeholder="I want a calculator…"
                  placeholderTextColor={C.placeholder}
                  returnKeyType="go"
                  onSubmitEditing={vibe}
                  autoCorrect={false}
                />
                <Pressable
                  style={({ pressed }) => [styles.go, pressed && styles.goPressed]}
                  onPress={vibe}>
                  <Text style={styles.goText}>VIBE →</Text>
                </Pressable>
              </View>
            </Rise>
          </View>
        )}

        {phase === 'loading' && <LoadingView status={status} brief={brief} />}

        {phase === 'result' && (
          <View style={styles.result}>
            <View style={styles.stage}>
              {app && <GeneratedApp hbc={app.hbc} onRepair={repair} />}
            </View>

            {runtimeError && !chatting && (
              <View style={[styles.errorBar, { bottom: 28 + kbHeight }]}>
                <View style={styles.errorTextWrap}>
                  <Text style={styles.errorTitle}>Runtime error</Text>
                  <Text style={styles.errorMessage} numberOfLines={2}>
                    {runtimeError.split('\n')[0]}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.errorFix, pressed && styles.goPressed]}
                  onPress={() => repair(runtimeError)}>
                  <Text style={styles.errorFixText}>✦ Fix</Text>
                </Pressable>
                <Pressable style={styles.errorDismiss} onPress={() => setRuntimeError(null)}>
                  <Text style={styles.errorDismissText}>×</Text>
                </Pressable>
              </View>
            )}

            {chatting && (
              <View style={[styles.chatBar, { bottom: 16 + kbHeight }]}>
                <TextInput
                  ref={chatRef}
                  style={styles.chatInput}
                  value={chatText}
                  onChangeText={setChatText}
                  placeholder="Describe a change…"
                  placeholderTextColor={C.placeholder}
                  returnKeyType="send"
                  onSubmitEditing={() => generate(chatText, app?.files)}
                  autoFocus
                />
                <Pressable
                  style={({ pressed }) => [styles.chatSend, pressed && styles.goPressed]}
                  onPress={() => generate(chatText, app?.files)}>
                  <Text style={styles.chatSendText}>→</Text>
                </Pressable>
              </View>
            )}

            <MovableFab
              open={fabOpen}
              onToggle={() => setFabOpen((o) => !o)}
              onChat={() => {
                setFabOpen(false);
                setChatting(true);
                setTimeout(() => chatRef.current?.focus(), 50);
              }}
              onReset={reset}
            />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  fullWidth: { alignSelf: 'stretch' },
  safe: { flex: 1 },

  // landing
  shell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  brand: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 6,
    color: C.accentDim,
    textTransform: 'uppercase',
    marginBottom: 30,
    textAlign: 'center',
  },
  h1: {
    fontFamily: fonts.serif,
    fontSize: 42,
    lineHeight: 44,
    letterSpacing: -0.8,
    color: C.ink,
    textAlign: 'center',
    marginBottom: 32,
  },
  h1Em: {
    fontFamily: fonts.serifItalic,
    color: C.accent,
  },
  bar: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    color: C.ink,
    fontFamily: fonts.sans,
    fontSize: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  go: {
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goPressed: { backgroundColor: C.accentBright },
  goText: {
    fontFamily: fonts.monoBold,
    fontSize: 13,
    letterSpacing: 0.7,
    color: C.onAccent,
  },
  // loading
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    padding: 24,
  },
  vibingRow: { flexDirection: 'row' },
  anvil: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: C.ink,
  },
  dots: { color: C.accent, width: 28, textAlign: 'left' },
  spark: {
    width: 200,
    height: 3,
    backgroundColor: C.line,
    borderRadius: 3,
    overflow: 'hidden',
  },
  sparkFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: C.accent,
    borderRadius: 3,
  },
  status: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: C.muted,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  statusError: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 15,
    color: C.accentDim,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: -12,
  },
  briefWrap: {
    width: '100%',
    maxWidth: 420,
    maxHeight: 260,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    padding: 16,
    marginTop: 6,
  },
  briefLabel: {
    fontFamily: fonts.monoBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: C.accent,
    marginBottom: 10,
  },
  briefScroll: { flexGrow: 0 },
  briefText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    color: C.muted,
  },

  // result
  result: { flex: 1 },
  stage: { flex: 1, backgroundColor: C.stage },

  // floating action button (bottom-right)
  fabWrap: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    alignItems: 'flex-end',
    gap: 10,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  fabDragging: {
    backgroundColor: C.accentBright,
    transform: [{ scale: 1.12 }],
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 10,
  },
  fabIcon: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: C.onAccent,
  },
  fabMenu: { gap: 8, alignItems: 'flex-end' },
  fabItem: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fabItemText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: C.ink,
  },

  // runtime error banner
  errorBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 10,
    paddingVertical: 10,
  },
  errorTextWrap: { flex: 1 },
  errorTitle: {
    fontFamily: fonts.monoBold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: C.accent,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  errorMessage: {
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 16,
    color: C.muted,
  },
  errorFix: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorFixText: {
    fontFamily: fonts.monoBold,
    fontSize: 13,
    color: C.onAccent,
  },
  errorDismiss: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorDismissText: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: C.muted,
  },

  // chat-to-edit overlay
  chatBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 10,
  },
  chatInput: {
    flex: 1,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    color: C.ink,
    fontFamily: fonts.sans,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  chatSend: {
    width: 52,
    backgroundColor: C.accent,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendText: {
    fontFamily: fonts.monoBold,
    fontSize: 20,
    color: C.onAccent,
  },
});
