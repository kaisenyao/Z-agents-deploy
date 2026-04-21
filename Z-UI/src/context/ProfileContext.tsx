import { createContext, useContext, useState, ReactNode } from 'react';

const STORAGE_KEY = 'clearpath_account_profile_v1';

export interface ProfileData {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

function loadProfile(): ProfileData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { firstName: '', lastName: '', avatarUrl: null };
}

interface ProfileContextValue {
  profile: ProfileData;
  setProfile: (p: ProfileData) => void;
  saveProfile: (p: ProfileData) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<ProfileData>(loadProfile);

  const setProfile = (p: ProfileData) => setProfileState(p);

  const saveProfile = (p: ProfileData) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    setProfileState(p);
  };

  return (
    <ProfileContext.Provider value={{ profile, setProfile, saveProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider');
  return ctx;
}
