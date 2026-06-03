import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useAnimatedValue,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GeneratedApp } from '@/components/generated-app';
import { API_URL } from '@/lib/api';
import { colors as C, fonts } from '@/theme';

const STATUS_STEPS = [
  'sending your wish to the forge',
  'Claude is writing React Native',
  'transpiling with esbuild',
  'validating against hermes',
  'mounting it natively',
];

type Phase = 'landing' | 'loading' | 'result';

type ForgedApp = { tsx: string; hbc: string };

async function forgeApp(wish: string): Promise<ForgedApp> {
  const res = await fetch(`${API_URL}/api/v1/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: wish }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail ?? data?.title ?? `backend returned ${res.status}`);
  }
  if (!data.hbc || !data.tsx) {
    throw new Error('backend returned an empty app');
  }
  return { tsx: data.tsx, hbc: data.hbc };
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

function LoadingView() {
  const [dots, setDots] = useState('…');
  const [status, setStatus] = useState(STATUS_STEPS[0]);
  useEffect(() => {
    let step = 0;
    const statusTimer = setInterval(() => {
      step = Math.min(step + 1, STATUS_STEPS.length - 1);
      setStatus(STATUS_STEPS[step]);
    }, 1400);
    let d = 0;
    const dotTimer = setInterval(() => {
      d = (d + 1) % 4;
      setDots('.'.repeat(d));
    }, 350);
    return () => {
      clearInterval(statusTimer);
      clearInterval(dotTimer);
    };
  }, []);
  return (
    <View style={styles.loading}>
      <Text style={styles.anvil}>
        vibing<Text style={{ color: C.accent }}>{dots}</Text>
      </Text>
      <Spark />
      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

export default function ForgeScreen() {
  const [phase, setPhase] = useState<Phase>('landing');
  const [wish, setWish] = useState('');
  const [builtFrom, setBuiltFrom] = useState('');
  const [app, setApp] = useState<ForgedApp | null>(null);
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const inputRef = useRef<TextInput>(null);

  async function forge() {
    const w = wish.trim();
    if (!w) {
      inputRef.current?.focus();
      return;
    }
    setPhase('loading');
    try {
      const forged = await forgeApp(w);
      setBuiltFrom(w);
      setApp(forged);
      setView('preview');
      setPhase('result');
    } catch (err) {
      setPhase('landing');
      Alert.alert(
        "Couldn't build that one",
        'The model call failed or returned nothing. Try again or rephrase.\n\n' +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  function reset() {
    setWish('');
    setPhase('landing');
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        {phase === 'landing' && (
          <KeyboardAvoidingView
            style={styles.shell}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
                  onSubmitEditing={forge}
                  autoCorrect={false}
                />
                <Pressable
                  style={({ pressed }) => [styles.go, pressed && styles.goPressed]}
                  onPress={forge}>
                  <Text style={styles.goText}>VIBE →</Text>
                </Pressable>
              </View>
            </Rise>
          </KeyboardAvoidingView>
        )}

        {phase === 'loading' && <LoadingView />}

        {phase === 'result' && (
          <View style={styles.result}>
            <View style={styles.topbar}>
              <View style={styles.req}>
                <Text style={styles.reqLabel}>BUILT FROM</Text>
                <Text style={styles.reqText} numberOfLines={1}>
                  &ldquo;{builtFrom}&rdquo;
                </Text>
              </View>
              <View style={styles.toggle}>
                <Pressable
                  style={[styles.toggleBtn, view === 'preview' && styles.toggleOn]}
                  onPress={() => setView('preview')}>
                  <Text
                    style={[
                      styles.toggleText,
                      view === 'preview' && styles.toggleTextOn,
                    ]}>
                    preview
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleBtn, view === 'source' && styles.toggleOn]}
                  onPress={() => setView('source')}>
                  <Text
                    style={[
                      styles.toggleText,
                      view === 'source' && styles.toggleTextOn,
                    ]}>
                    source
                  </Text>
                </Pressable>
              </View>
              <Pressable style={styles.newBtn} onPress={reset}>
                <Text style={styles.newBtnText}>+ new</Text>
              </Pressable>
            </View>
            <View style={styles.stage}>
              {view === 'preview' ? (
                app && <GeneratedApp hbc={app.hbc} />
              ) : (
                <ScrollView style={styles.sourceScroll}>
                  <Text style={styles.sourceText} selectable>
                    {app?.tsx}
                  </Text>
                </ScrollView>
              )}
            </View>
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
  anvil: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: C.ink,
  },
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
  },

  // result
  result: { flex: 1 },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    backgroundColor: C.panel,
  },
  req: { flex: 1 },
  reqLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: C.accentDim,
  },
  reqText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: C.ink,
  },
  toggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    overflow: 'hidden',
  },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  toggleOn: { backgroundColor: C.accent },
  toggleText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: C.muted,
  },
  toggleTextOn: { color: C.onAccent },
  newBtn: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  newBtnText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: C.ink,
  },
  stage: { flex: 1, backgroundColor: C.stage },
  sourceScroll: { flex: 1, backgroundColor: C.bg },
  sourceText: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    lineHeight: 20,
    color: C.code,
    padding: 20,
  },
});
