import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { doc, getDocFromServer, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, isLoading: true });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Only test connection once on boot
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, "test", "connection"));
      } catch (error) {
        if (error instanceof Error && error.message.includes("client is offline")) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsLoading(false);
      if (currentUser) {
        try {
          const userRef = doc(db, "users", currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const data = userSnap.data();
            const lowerEmail = (currentUser.email || "").toLowerCase();
            if (lowerEmail && data.email !== lowerEmail) {
              await setDoc(userRef, { email: lowerEmail }, { merge: true });
            }
          }
        } catch (e) {
          console.error("Error silently updating user email on auth state change:", e);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Presence Heartbeat
  useEffect(() => {
    if (!user) return;

    const updatePresence = async () => {
      try {
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, { lastActive: serverTimestamp() }, { merge: true });
      } catch (error) {
        console.error("Error updating presence heartbeat:", error);
      }
    };

    updatePresence();
    const interval = setInterval(updatePresence, 40000);

    return () => clearInterval(interval);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}
