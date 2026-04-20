import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// On web (PWA) use localStorage directly — AsyncStorage v3 web layer is unreliable across app launches
const storage = Platform.OS === 'web'
  ? {
      getItem: (k: string) => Promise.resolve(typeof window !== 'undefined' ? window.localStorage.getItem(k) : null),
      setItem: (k: string, v: string) => { if (typeof window !== 'undefined') window.localStorage.setItem(k, v); return Promise.resolve(); },
      removeItem: (k: string) => { if (typeof window !== 'undefined') window.localStorage.removeItem(k); return Promise.resolve(); },
    }
  : AsyncStorage;

export type User = {
  id: string;
  name: string;
  status: 'pending' | 'approved';
  isAdmin: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  register: (name: string, pin: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_KEY = 'ljl_user_id';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    try {
      const userId = await storage.getItem(STORAGE_KEY);
      if (userId) {
        const res = await fetch(`/api/status/${userId}`);
        if (res.ok) {
          setUser(await res.json());
        } else {
          await storage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      // Network error on startup — show enter-name screen
    } finally {
      setIsLoading(false);
    }
  }

  async function register(name: string, pin: string) {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Registration failed');
    }
    const data: User & { createdAt: string } = await res.json();
    await storage.setItem(STORAGE_KEY, data.id);
    setUser(data);
  }

  async function refreshStatus() {
    if (!user) return;
    try {
      const res = await fetch(`/api/status/${user.id}`);
      if (res.ok) setUser(await res.json());
    } catch {
      // Silently ignore polling errors
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, register, refreshStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
