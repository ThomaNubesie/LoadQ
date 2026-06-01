// Global setup file for Jest tests.
// Silences React Native's "useNativeDriver is not supported" warnings
// that occasionally surface even from pure utility code paths.
import { jest } from "@jest/globals";

// Mock AsyncStorage so zoneStore tests don't try to hit native module.
jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    setItem:    jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    getItem:    jest.fn(async (k: string) => store.get(k) ?? null),
    removeItem: jest.fn(async (k: string) => { store.delete(k); }),
    clear:      jest.fn(async () => { store.clear(); }),
    _store:     store, // exposed for tests to inspect / reset
  };
});

// Mock expo-location so gpsTimeout tests can stub permission + coords.
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getForegroundPermissionsAsync:     jest.fn(async () => ({ status: "granted" })),
  getCurrentPositionAsync:           jest.fn(async () => ({ coords: { latitude: 45.4215, longitude: -75.6972 } })),
  Accuracy: { Balanced: 3, Lowest: 1, Low: 2, High: 4, Highest: 5, BestForNavigation: 6 },
  LocationAccuracy: 3,
}));

// Mock react-native-purchases (RevenueCat) — pulled in via services/billing.
// We default to null (no entitlement) so each test starts from a clean
// state; tests that need entitlement override via the explicit mock.
jest.mock("react-native-purchases", () => ({
  __esModule: true,
  default: {
    configure:                jest.fn(),
    getCustomerInfo:          jest.fn(async () => ({ entitlements: { active: {} } })),
    getOfferings:             jest.fn(async () => ({ current: null })),
    purchasePackage:          jest.fn(),
    restorePurchases:         jest.fn(async () => ({ entitlements: { active: {} } })),
    setLogLevel:              jest.fn(),
    setEmail:                 jest.fn(),
    setAttributes:            jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
    logIn:                    jest.fn(),
    logOut:                   jest.fn(),
  },
  LOG_LEVEL: { ERROR: "ERROR", WARN: "WARN", INFO: "INFO", DEBUG: "DEBUG", VERBOSE: "VERBOSE" },
}));

// Mock expo-notifications (used by services/push and services/messageEvents).
jest.mock("expo-notifications", () => ({
  setNotificationHandler:   jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync:      jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync:  jest.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync:    jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
  scheduleNotificationAsync: jest.fn(async () => "notif-id"),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 3, MIN: 1, LOW: 2, HIGH: 4, MAX: 5 },
}));
