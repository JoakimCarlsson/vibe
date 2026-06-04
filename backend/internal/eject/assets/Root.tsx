import { Fraunces_300Light, Fraunces_400Regular_Italic } from '@expo-google-fonts/fraunces';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
} from '@expo-google-fonts/hanken-grotesk';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { useFonts } from 'expo-font';
import { ActivityIndicator, View } from 'react-native';

import App from './App';

/**
 * Loads the font families VIBE apps expect, then renders the generated App.
 * In the live VIBE host these fonts are preloaded; an ejected project loads
 * them itself.
 */
export default function Root() {
  const [loaded] = useFonts({
    Fraunces_300Light,
    Fraunces_400Regular_Italic,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <App />;
}
