import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

export type RouteParams = Record<string, unknown>;

export type Route = { name: string; params?: RouteParams };

export type Screens = Record<string, React.ComponentType<Record<string, never>>>;

type Navigation = {
  navigate: (name: string, params?: RouteParams) => void;
  replace: (name: string, params?: RouteParams) => void;
  goBack: () => void;
  canGoBack: boolean;
  route: Route;
};

const NavigationContext = createContext<Navigation | null>(null);

/** Access the navigator. Must be rendered inside a NavigationContainer. */
export function useNavigation(): Navigation {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useNavigation must be used inside a NavigationContainer');
  }
  return ctx;
}

/** The current route, including any params passed to navigate(). */
export function useRoute(): Route {
  return useNavigation().route;
}

/**
 * A minimal pure-JS stack navigator. Pass a map of screen name to component
 * and the navigator renders the top of the stack with a push/pop transition.
 */
export function NavigationContainer({
  screens,
  initialRouteName,
}: {
  screens: Screens;
  initialRouteName?: string;
}) {
  const names = Object.keys(screens);
  const initial = initialRouteName && screens[initialRouteName] ? initialRouteName : names[0];
  const [stack, setStack] = useState<Route[]>([{ name: initial }]);

  const navigate = useCallback(
    (name: string, params?: RouteParams) => {
      setStack((s) => (screens[name] ? [...s, { name, params }] : s));
    },
    [screens]
  );

  const replace = useCallback(
    (name: string, params?: RouteParams) => {
      setStack((s) => (screens[name] ? [...s.slice(0, -1), { name, params }] : s));
    },
    [screens]
  );

  const goBack = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const current = stack[stack.length - 1];
  const nav = useMemo<Navigation>(
    () => ({ navigate, replace, goBack, canGoBack: stack.length > 1, route: current }),
    [navigate, replace, goBack, stack.length, current]
  );

  const Screen = screens[current.name];

  return (
    <NavigationContext.Provider value={nav}>
      <View style={styles.root}>
        {Screen ? (
          <Transition routeKey={`${stack.length}:${current.name}`}>
            <Screen />
          </Transition>
        ) : null}
      </View>
    </NavigationContext.Provider>
  );
}

function Transition({ routeKey, children }: { routeKey: string; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [routeKey, v]);
  return (
    <Animated.View
      style={[
        styles.root,
        {
          opacity: v,
          transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
