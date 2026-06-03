export const colors = {
  bg: '#0d0b07',
  panel: '#15120c',
  ink: '#f4efe3',
  muted: '#8c8472',
  line: '#2a2519',
  accent: '#d6ff2b',
  accentDim: '#9bb820',
  accentBright: '#e6ff5e',
  onAccent: '#15120c',
  warn: '#ff6b4a',
  placeholder: '#5f5949',
  code: '#cfe87a',
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
