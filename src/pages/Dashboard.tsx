import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { ThemeToggle } from "../components/ThemeToggle";
import { LogOut, Gamepad2, Grid3X3, LayoutGrid, Square, X, Car } from "lucide-react";
import React, { useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { cn } from "../lib/utils";
import { auth } from "../lib/firebase";
import { signOut } from "firebase/auth";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Auth Modal State
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  const ensureUserProfile = async (uid: string, name: string, email?: string) => {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    const lowerEmail = (email || "").toLowerCase();
    
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: uid,
        displayName: name || "Spieler",
        email: lowerEmail,
        rating: 1000,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        connect4_rating: 1000,
        connect4_gamesPlayed: 0,
        connect4_wins: 0,
        connect4_losses: 0,
        connect4_draws: 0,
        dots_rating: 1000,
        dots_gamesPlayed: 0,
        dots_wins: 0,
        dots_losses: 0,
        dots_draws: 0,
        utictactoe_rating: 1000,
        utictactoe_gamesPlayed: 0,
        utictactoe_wins: 0,
        utictactoe_losses: 0,
        utictactoe_draws: 0,
        racing_rating: 1000,
        racing_gamesPlayed: 0,
        racing_wins: 0,
        racing_losses: 0,
        racing_draws: 0,
        createdAt: serverTimestamp()
      });
    } else {
      const data = userSnap.data();
      if (data && data.email !== lowerEmail && lowerEmail) {
        await setDoc(userRef, { email: lowerEmail }, { merge: true });
      }
      if (data && data.displayName && auth.currentUser && !auth.currentUser.displayName) {
        try {
          await updateProfile(auth.currentUser, { displayName: data.displayName });
        } catch (e) {
          console.error("Error updating auth profile in ensureUserProfile:", e);
        }
      }
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError("");
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const currentUser = result.user;
      if (currentUser) {
        await ensureUserProfile(currentUser.uid, currentUser.displayName || "", currentUser.email || "");
        setShowAuthModal(false);
      }
    } catch (error: any) {
      console.error("Google sign in failed", error);
      setAuthError(error.message || "Google Sign In failed.");
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setIsAuthLoading(true);

    try {
      if (authMode === "register") {
        if (!displayName) {
          throw new Error("Bitte wähle einen Spielernamen.");
        }
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName: displayName });
        await ensureUserProfile(result.user.uid, displayName, result.user.email || "");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setShowAuthModal(false);
    } catch (error: any) {
      console.error("Auth Error", error);
      setAuthError(error.message || "Authentication failed.");
    } finally {
      setIsAuthLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50 dark:bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl relative">
            <button 
              onClick={() => setShowAuthModal(false)}
              className="absolute top-4 right-4 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            
            <h2 className="text-2xl font-bold mb-6 text-slate-900 dark:text-white">
              {authMode === "login" ? "Willkommen zurück" : "Account erstellen"}
            </h2>

            {authError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-full text-sm mb-4">
                {authError}
              </div>
            )}

            <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
              {authMode === "register" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400">Spielername</label>
                  <input 
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    required
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                    placeholder="Dein Name"
                  />
                </div>
              )}
              
              <div className="flex flex-col gap-1">
                <label className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400">Email</label>
                <input 
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                  placeholder="name@beispiel.de"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400">Passwort</label>
                <input 
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                  placeholder="••••••••"
                />
              </div>

              <button 
                type="submit"
                disabled={isAuthLoading}
                className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-slate-900 dark:text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-900/20"
              >
                {isAuthLoading ? "Lädt..." : (authMode === "login" ? "Einloggen" : "Registrieren")}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 text-center">
              <button 
                onClick={handleGoogleSignIn}
                type="button"
                className="w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-bold py-3 rounded-xl transition-colors mb-4 flex items-center justify-center gap-2"
              >
                Mit Google anmelden
              </button>

              <button 
                type="button"
                onClick={() => {
                  setAuthMode(authMode === "login" ? "register" : "login");
                  setAuthError("");
                }}
                className="text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-400"
              >
                {authMode === "login" 
                  ? "Noch keinen Account? Registrieren" 
                  : "Bereits einen Account? Einloggen"}
              </button>
            </div>
          </div>
        </div>
      )}
      <nav className="shrink-0 h-16 border-b border-slate-200 dark:border-slate-800 px-4 md:px-8 flex items-center justify-between bg-white/80 dark:bg-slate-900/50 backdrop-blur-md z-10 relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-xl text-white">#</div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            ELITE<span className="text-indigo-500">GAMES</span>
          </span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <ThemeToggle />
          {user ? (
            <>
              <button 
                onClick={() => navigate("/profile")}
                className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800 py-1 pl-3 pr-1 rounded-full border border-slate-300 dark:border-slate-700 transition-colors"
                title="Profil öffnen"
              >
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate max-w-[80px] sm:max-w-[150px]">{user.displayName || user.email}</span>
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 border border-slate-400 dark:border-slate-600 flex items-center justify-center text-xs font-bold shrink-0 uppercase text-white shadow-inner">
                  {(user.displayName || user.email)?.substring(0, 2)}
                </div>
              </button>
              <button 
                onClick={() => signOut(auth)}
                className="p-2 hover:bg-slate-100 dark:bg-slate-800 rounded-full transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </>
          ) : (
             <button 
              onClick={() => setShowAuthModal(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-slate-900 dark:text-white font-bold rounded-xl transition-colors shadow-lg shadow-indigo-900/20 text-sm"
            >
              Sign In
            </button>
          )}
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-4 md:p-8 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent pointer-events-none"></div>
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="mb-12 text-center mt-8 sm:mt-16 animate-in slide-in-from-bottom-4 fade-in duration-700">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black mb-6 text-slate-900 dark:text-white tracking-tight">
              Wähle dein <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-500">Spiel</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto text-lg sm:text-xl font-medium">
              Tritt gegen andere Spieler an, sammle ELO-Punkte und steige in den globalen Rängen auf.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-8 fade-in duration-1000">
            
            {/* TicTacToe Card */}
            <div 
              onClick={() => navigate("/tictactoe")}
              className="group relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 overflow-hidden cursor-pointer hover:border-indigo-500/50 dark:hover:border-indigo-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10 hover:-translate-y-1"
            >
              <div className="absolute top-0 right-0 p-6 opacity-5 dark:opacity-20 transform group-hover:scale-110 group-hover:rotate-12 transition-transform duration-500">
                <Grid3X3 className="w-32 h-32 text-indigo-500" />
              </div>
              <div className="relative z-10">
                <div className="w-16 h-16 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-2xl flex items-center justify-center mb-6 text-indigo-600 dark:text-indigo-400 shadow-inner">
                  <Grid3X3 className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white tracking-tight">TicTacToe Elite</h3>
                <p className="text-slate-500 dark:text-slate-400 mb-8 line-clamp-3 font-medium">
                  Der Klassiker. 3 gewinnt. Taktisches Vorgehen auf dem 3x3 Feld im Ranked-Modus mit Elo-System.
                </p>
                <div className="flex items-center text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest group-hover:translate-x-2 transition-transform">
                  Spielen <Gamepad2 className="w-5 h-5 ml-2" />
                </div>
              </div>
            </div>

            {/* Connect 4 Card */}
            <div 
              onClick={() => navigate("/connect4")}
              className="group relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 overflow-hidden cursor-pointer hover:border-indigo-500/50 dark:hover:border-indigo-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10 hover:-translate-y-1"
            >
              <div className="absolute top-0 right-0 p-6 opacity-5 dark:opacity-20 transform group-hover:scale-110 group-hover:-rotate-12 transition-transform duration-500">
                <LayoutGrid className="w-32 h-32 text-indigo-500" />
              </div>
              <div className="relative z-10">
                <div className="w-16 h-16 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-2xl flex items-center justify-center mb-6 text-indigo-600 dark:text-indigo-400 shadow-inner">
                  <LayoutGrid className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white tracking-tight">4 Gewinnt Elite</h3>
                <p className="text-slate-500 dark:text-slate-400 mb-8 line-clamp-3 font-medium">
                  Taktik pur. 4 Steine in einer Reihe auf dem 7x6 Feld. Werfe deine Steine mit Bedacht ein, um im Ranked-Modus zu triumphieren.
                </p>
                <div className="flex items-center text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest group-hover:translate-x-2 transition-transform">
                  Spielen <Gamepad2 className="w-5 h-5 ml-2" />
                </div>
              </div>
            </div>

            {/* Dots and Boxes Card */}
            <div 
              onClick={() => navigate("/dots")}
              className="group relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 overflow-hidden cursor-pointer hover:border-indigo-500/50 dark:hover:border-indigo-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10 hover:-translate-y-1"
            >
              <div className="absolute top-0 right-0 p-6 opacity-5 dark:opacity-20 transform group-hover:scale-110 group-hover:rotate-12 transition-transform duration-500">
                <Square className="w-32 h-32 text-indigo-500" />
              </div>
              <div className="relative z-10">
                <div className="w-16 h-16 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-2xl flex items-center justify-center mb-6 text-indigo-600 dark:text-indigo-400 shadow-inner">
                  <Square className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white tracking-tight">Käsekästchen Elite</h3>
                <p className="text-slate-500 dark:text-slate-400 mb-8 line-clamp-3 font-medium">
                  Das clevere Punkte-Verbinden. Schließe Kästchen und verdiene Extrazüge, um dir den Sieg zu sichern.
                </p>
                <div className="flex items-center text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest group-hover:translate-x-2 transition-transform">
                  Spielen <Gamepad2 className="w-5 h-5 ml-2" />
                </div>
              </div>
            </div>

            {/* Ultimate Tic Tac Toe Card */}
            <div 
              onClick={() => navigate("/utictactoe")}
              className="group relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 overflow-hidden cursor-pointer hover:border-indigo-500/50 dark:hover:border-indigo-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10 hover:-translate-y-1"
            >
              <div className="absolute top-0 right-0 p-6 opacity-5 dark:opacity-20 transform group-hover:scale-110 group-hover:-rotate-12 transition-transform duration-500">
                <Grid3X3 className="w-32 h-32 text-purple-500" />
              </div>
              <div className="relative z-10">
                <div className="w-16 h-16 bg-purple-500/10 dark:bg-purple-500/20 rounded-2xl flex items-center justify-center mb-6 text-purple-600 dark:text-purple-400 shadow-inner">
                  <Grid3X3 className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white tracking-tight">Ultimate TTT Elite</h3>
                <p className="text-slate-500 dark:text-slate-400 mb-8 line-clamp-3 font-medium">
                  Tic-Tac-Toe im Großformat. Gewinne kleine Teilfelder, um das große Spielfeld zu erobern. Taktik und Weitsicht auf 81 Feldern!
                </p>
                <div className="flex items-center text-sm font-bold text-purple-600 dark:text-purple-400 uppercase tracking-widest group-hover:translate-x-2 transition-transform">
                  Spielen <Gamepad2 className="w-5 h-5 ml-2" />
                </div>
              </div>
            </div>

            {/* Retro Racer Card */}
            <div 
              onClick={() => navigate("/racing")}
              className="group relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 overflow-hidden cursor-pointer hover:border-emerald-500/50 dark:hover:border-emerald-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-emerald-500/10 hover:-translate-y-1 col-span-1 sm:col-span-2 lg:col-span-1"
            >
              <div className="absolute top-0 right-0 p-6 opacity-5 dark:opacity-20 transform group-hover:scale-110 group-hover:rotate-12 transition-transform duration-500">
                <Car className="w-32 h-32 text-emerald-500" />
              </div>
              <div className="relative z-10">
                <div className="w-16 h-16 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-2xl flex items-center justify-center mb-6 text-emerald-600 dark:text-emerald-400 shadow-inner">
                  <Car className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white tracking-tight">Retro Racer Elite</h3>
                <p className="text-slate-500 dark:text-slate-400 mb-8 line-clamp-3 font-medium">
                  Das 2D Zeitrennen. Drifte durch anspruchsvolle Kurven, optimiere deine Ideallinie und brich den Streckenrekord im Solo-Zeitfahren!
                </p>
                <div className="flex items-center text-sm font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest group-hover:translate-x-2 transition-transform">
                  Spielen <Gamepad2 className="w-5 h-5 ml-2" />
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
