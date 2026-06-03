export const colors = {
  bg: '#0f0d0c',
  panel: '#1a1715',
  ink: '#f5f1ec',
  muted: '#998f86',
  line: '#2c2724',
  accent: '#ff6b4a',
  accentDim: '#c2553c',
  accentBright: '#ff8a6e',
  onAccent: '#2b0f08',
  warn: '#ff4a4a',
  placeholder: '#6b625a',
  code: '#ffb39e',
  stage: '#ffffff',
} as const;

export const fonts = {
  serif: 'Fraunces_300Light',
  serifItalic: 'Fraunces_400Regular_Italic',
  sans: 'HankenGrotesk_400Regular',
  sansMedium: 'HankenGrotesk_500Medium',
  sansSemiBold: 'HankenGrotesk_600SemiBold',
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
} as const;

export const theme = { colors, fonts, spacing, radius } as const;

export type Theme = typeof theme;
