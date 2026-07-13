import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Google OAuth client credentials kept in localStorage for this device. */
type GmailCredentialsState = {
  clientId: string;
  clientSecret: string;
  setClientId: (clientId: string) => void;
  setClientSecret: (clientSecret: string) => void;
};

export const useGmailCredentialsStore = create<GmailCredentialsState>()(
  persist(
    (set) => ({
      clientId: '',
      clientSecret: '',
      setClientId: (clientId) => set({ clientId }),
      setClientSecret: (clientSecret) => set({ clientSecret }),
    }),
    {
      name: 'kokoro-gmail-credentials',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
