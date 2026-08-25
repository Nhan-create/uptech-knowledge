export const MOTION_TOKENS = {
  duration: {
    micro: 150, // 120-180ms: micro-interactions (hover, press, toggle)
    normal: 250, // 200-300ms: panel transitions, dropdowns, dialogs
    reveal: 450, // 350-500ms: page/section entry reveals
  },
  easing: {
    standard: "cubic-bezier(0.16, 1, 0.3, 1)", // Snappy start, smooth deceleration
    inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
    spring: "cubic-bezier(0.175, 0.885, 0.32, 1.1)",
  },
} as const;
