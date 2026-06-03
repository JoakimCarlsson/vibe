const PORT = 1337;

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');
