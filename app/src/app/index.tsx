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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { colors as C, fonts } from '@/theme';

const STATUS_STEPS = [
  'sending your request to Claude',
  'Claude is writing the code',
  'assembling a self-contained app',
  'wiring up the interactions',
  'rendering it live',
];

const SYSTEM_PROMPT =
  'You are an app builder. The user describes an app they want. ' +
  'Respond with ONE complete, self-contained HTML document and NOTHING else — no explanation, no markdown fences. ' +
  'Inline all CSS in a <style> tag and all JS in a <script> tag. Do not load external resources. ' +
  'It must be fully functional and interactive on its own. Keep it compact but polished: clean layout, ' +
  'good spacing, a considered color palette, and working logic. It will be rendered inside a mobile WebView, ' +
  'so design for a phone-sized touch screen. Start your response with <!DOCTYPE html>.';

type Phase = 'landing' | 'loading' | 'result';

async function forgeApp(wish: string): Promise<string> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey
        ? {
            'x-api-key': apiKey,
            'anthropic-dangerous-direct-browser-access': 'true',
          }
        : {}),
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: wish }],
    }),
  });
  const data = await res.json();
  let code = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
    .trim();
  code = code.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!code || !code.includes('<')) {
    throw new Error(data.error?.message ?? 'empty response');
  }
  return code;
}

/** Faint background grid that fades out toward the edges. */
function GridBackdrop() {
  const { width, height } = useWindowDimensions();
  const cell = 46;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: cols }, (_, i) => (
        <View
          key={`v${i}`}
          style={[styles.gridLine, { left: i * cell, top: 0, bottom: 0, width: 1 }]}
        />
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={`h${i}`}
          style={[styles.gridLine, { top: i * cell, left: 0, right: 0, height: 1 }]}
        />
      ))}
    </View>
  );
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
  const v = useRef(new Animated.Value(0)).current;
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
  const x = useRef(new Animated.Value(0)).current;
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
  const [code, setCode] = useState('');
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
      const html = await forgeApp(w);
      setBuiltFrom(w);
      setCode(html);
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
      <GridBackdrop />
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
                  "{builtFrom}"
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
                <WebView
                  originWhitelist={['*']}
                  source={{ html: code }}
                  style={styles.webview}
                  javaScriptEnabled
                />
              ) : (
                <ScrollView style={styles.sourceScroll}>
                  <Text style={styles.sourceText} selectable>
                    {code}
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
  gridLine: { position: 'absolute', backgroundColor: C.line, opacity: 0.5 },

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
  webview: { flex: 1 },
  sourceScroll: { flex: 1, backgroundColor: C.bg },
  sourceText: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    lineHeight: 20,
    color: C.code,
    padding: 20,
  },
});
