import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, type PressableProps, type ViewProps } from "react-native";

const ReducedMotion = createContext(true);
export const useReducedMotion = () => useContext(ReducedMotion);

export function MotionProvider({ children }: PropsWithChildren) {
  // Don't animate until the system preference is known.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true;
    let changed = false;
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      setReduced(value);
    });
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive && !changed) setReduced(value);
    }).catch(() => {});
    return () => { alive = false; listener.remove(); };
  }, []);
  return <ReducedMotion.Provider value={reduced}>{children}</ReducedMotion.Provider>;
}

/** Short, interruptible entrances. No layout animation or idle animation loops. */
export function MotionView({ enterKey, fromX = 0, fromY = 0, style, children, ...props }:
  ViewProps & { enterKey: unknown; fromX?: number; fromY?: number }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  useLayoutEffect(() => {
    progress.stopAnimation();
    if (reduced || !enterKey) { progress.setValue(1); return; }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 220, easing: Easing.out(Easing.cubic),
      useNativeDriver: true, isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [enterKey, reduced, progress, fromX, fromY]);
  return <Animated.View {...props} style={[style, {
    opacity: progress,
    transform: [
      { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
    ],
  }]}>{children}</Animated.View>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export function MotionPressable({ style, onPressIn, onPressOut, ...props }: PressableProps) {
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced || props.disabled) { scale.stopAnimation(); scale.setValue(1); }
    return () => scale.stopAnimation();
  }, [reduced, props.disabled, scale]);
  const move = (toValue: number) => {
    scale.stopAnimation();
    if (reduced || props.disabled) { scale.setValue(1); return; }
    Animated.timing(scale, {
      toValue, duration: toValue === 1 ? 150 : 80,
      easing: Easing.out(Easing.quad), useNativeDriver: true, isInteraction: false,
    }).start();
  };
  return <AnimatedPressable {...props}
    onPressIn={(event) => { setPressed(true); move(0.98); onPressIn?.(event); }}
    onPressOut={(event) => { setPressed(false); move(1); onPressOut?.(event); }}
    style={[typeof style === "function" ? style({ pressed }) : style, { transform: [{ scale }] }]}
  />;
}
