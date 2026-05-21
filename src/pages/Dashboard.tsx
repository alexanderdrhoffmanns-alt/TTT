import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { ThemeToggle } from "../components/ThemeToggle";
import { LogOut, Gamepad2, Grid3X3, LayoutGrid, Square, X, Car, User, Calendar, Trophy, ChevronRight, Activity, Clock, CircleDot, Milestone, Sparkles } from "lucide-react";
import React, { useState, useEffect } from "react";
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp, collection, onSnapshot, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { cn } from "../lib/utils";
import { auth } from "../lib/firebase";
import { signOut } from "firebase/auth";

const formatMs = (ms: number | null) => {
  if (ms === null || ms === undefined) return "--:--";
  const totalSec = ms / 1000;
  const sec = Math.floor(totalSec);
  const fract = Math.floor((totalSec - sec) * 100);
  return `${sec}.${fract.toString().padStart(2, "0")}s`;
};

const formatDate = (timestamp: any) => {
  if (!timestamp) return "Unbekannt";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
};

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

  // Presence & Active Users State
  const [usersList, setUsersList] = useState<any[]>([]);
  const [tick, setTick] = useState(0);

  // Selected Player Profile Modal State
  const [selectedPlayer, setSelectedPlayer] = useState<any | null>(null);
  const [selectedPlayerTimes, setSelectedPlayerTimes] = useState<{
    "neon-gp": number | null;
    "drift-canyon": number | null;
  } | null>(null);
  const [selectedPlayerRiderStats, setSelectedPlayerRiderStats] = useState<{
    "neon-loop": number | null;
    "gravity-drop": number | null;
    "endless-grid": number | null;
  } | null>(null);
  const [isLoadingTimes, setIsLoadingTimes] = useState(false);

  // Subscribe to users collection for presence
  useEffect(() => {
    const q = collection(db, "users");
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users: any[] = [];
      snapshot.forEach((docSnap) => {
        users.push(docSnap.data());
      });
      setUsersList(users);
    }, (error) => {
      console.error("Error fetching users list:", error);
    });
    return () => unsubscribe();
  }, []);

  // Tick interval to force re-evaluation of online status every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Filter and sort online players
  const isOnline = (lastActive: any) => {
    if (!lastActive) return false;
    const lastActiveMillis = lastActive.toMillis ? lastActive.toMillis() : new Date(lastActive).getTime();
    const diff = Date.now() - lastActiveMillis;
    // Accept if active within last 90 seconds (plus 10s grace for server drift)
    return diff >= -10000 && diff <= 90000;
  };

  const onlinePlayers = usersList
    .filter(u => u.uid && !u.uid.startsWith("bot_") && isOnline(u.lastActive))
    .sort((a, b) => (b.rating || 1000) - (a.rating || 1000));

  const handlePlayerClick = async (player: any) => {
    setSelectedPlayer(player);
    setSelectedPlayerTimes(null);
    setSelectedPlayerRiderStats(null);
    setIsLoadingTimes(true);
    try {
      const q = query(
        collection(db, "games_racing"),
        where("player1Id", "==", player.uid),
        where("player2Id", "==", null),
        where("status", "==", "finished")
      );
      const snap = await getDocs(q);
      let neonGpBest: number | null = null;
      let driftCanyonBest: number | null = null;
      
      snap.docs.forEach(docSnap => {
        const data = docSnap.data();
        const time = data.player1Time;
        if (time != null) {
          if (data.trackId === "neon-gp") {
            if (neonGpBest === null || time < neonGpBest) neonGpBest = time;
          } else if (data.trackId === "drift-canyon") {
            if (driftCanyonBest === null || time < driftCanyonBest) driftCanyonBest = time;
          }
        }
      });
      
      setSelectedPlayerTimes({
        "neon-gp": neonGpBest,
        "drift-canyon": driftCanyonBest
      });

      // Query Neon Rider best runs dynamically
      const qRider = query(
        collection(db, "games_rider"),
        where("playerId", "==", player.uid),
        where("status", "==", "finished")
      );
      const snapRider = await getDocs(qRider);
      let neonLoopBest: number | null = null;
      let gravityDropBest: number | null = null;
      let endlessGridBest: number | null = null;

      snapRider.docs.forEach(docSnap => {
        const data = docSnap.data();
        const trackId = data.trackId;
        if (trackId === "neon-loop") {
          const t = data.time;
          if (t != null && (neonLoopBest === null || t < neonLoopBest)) {
            neonLoopBest = t;
          }
        } else if (trackId === "gravity-drop") {
          const t = data.time;
          if (t != null && (gravityDropBest === null || t < gravityDropBest)) {
            gravityDropBest = t;
          }
        } else if (trackId === "endless-grid") {
          const s = data.score;
          if (s != null && (endlessGridBest === null || s > endlessGridBest)) {
            endlessGridBest = s;
          }
        }
      });

      setSelectedPlayerRiderStats({
        "neon-loop": neonLoopBest,
        "gravity-drop": gravityDropBest,
        "endless-grid": endlessGridBest
      });
    } catch (error) {
      console.error("Error fetching player racing best times/rider stats:", error);
    } finally {
      setIsLoadingTimes(false);
    }
  };

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

          {/* Two-Column Responsive Dashboard Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-in slide-in-from-bottom-8 fade-in duration-1000">
            
            {/* Left Column: Games Grid (8 of 12 columns) */}
            <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
              
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
                className="group relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 overflow-hidden cursor-pointer hover:border-emerald-500/50 dark:hover:border-emerald-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-emerald-500/10 hover:-translate-y-1 col-span-1 sm:col-span-2"
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

              {/* Neon Rider Card */}
              <div 
                onClick={() => navigate("/rider")}
                className="group relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 overflow-hidden cursor-pointer hover:border-rose-500/50 dark:hover:border-rose-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-rose-500/10 hover:-translate-y-1 col-span-1 sm:col-span-2"
              >
                <div className="absolute top-0 right-0 p-6 opacity-5 dark:opacity-20 transform group-hover:scale-110 group-hover:-rotate-12 transition-transform duration-500">
                  <Sparkles className="w-32 h-32 text-rose-500" />
                </div>
                <div className="relative z-10">
                  <div className="w-16 h-16 bg-rose-500/10 dark:bg-rose-500/20 rounded-2xl flex items-center justify-center mb-6 text-rose-600 dark:text-rose-400 shadow-inner">
                    <Sparkles className="w-8 h-8" />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Neon Rider Elite</h3>
                    <span className="px-2.5 py-0.5 bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] font-black rounded-full uppercase tracking-wider animate-pulse">NEU</span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 mb-8 line-clamp-3 font-medium">
                    Das ultimative 2D-Physik-Stunt-Spiel. Schlage waghalsige Saltos, löse Zeitlupen-Effekte aus und dominiere die weltweiten Leaderboards auf abwechslungsreichen Strecken und im Endless-Grid!
                  </p>
                  <div className="flex items-center text-sm font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest group-hover:translate-x-2 transition-transform">
                    Spielen <Gamepad2 className="w-5 h-5 ml-2" />
                  </div>
                </div>
              </div>

            </div>

            {/* Right Column: Online Players Sidebar (4 of 12 columns) */}
            <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col h-[560px]">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none"></div>
              
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 dark:border-slate-800 relative z-10 shrink-0">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-emerald-500 animate-pulse" />
                  <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Online-Spieler</h2>
                </div>
                <div className="flex items-center gap-1.5 bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  {onlinePlayers.length} Aktiv
                </div>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar relative z-10">
                {onlinePlayers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12 text-slate-400 dark:text-slate-500">
                    <User className="w-12 h-12 mb-3 text-slate-300 dark:text-slate-700" />
                    <p className="font-medium">Niemand ist online</p>
                    <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">Sei der Erste, der andere herausfordert!</p>
                  </div>
                ) : (
                  onlinePlayers.map((p) => {
                    const avatarText = (p.displayName || "Spieler").substring(0, 2).toUpperCase();
                    return (
                      <button
                        key={p.uid}
                        onClick={() => handlePlayerClick(p)}
                        className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-slate-50/50 dark:bg-slate-950/30 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 border border-slate-100 dark:border-slate-800/50 hover:border-indigo-500/30 dark:hover:border-indigo-500/30 transition-all text-left group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500/80 to-purple-500/80 flex items-center justify-center text-white text-xs font-bold uppercase shadow-md">
                              {avatarText}
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 rounded-full border-2 border-white dark:border-slate-900 bg-emerald-500">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            </span>
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate max-w-[140px]">
                              {p.displayName || "Spieler"}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                              TTT Elo: {p.rating || 1000}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center text-xs font-bold text-slate-400 dark:text-slate-500 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 uppercase tracking-wider transition-colors gap-1">
                          Profil <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* Player Stats Popup Modal */}
      {selectedPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 md:p-8 rounded-3xl w-full max-w-2xl shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent pointer-events-none"></div>
            
            {/* Close Button */}
            <button 
              onClick={() => {
                setSelectedPlayer(null);
                setSelectedPlayerTimes(null);
                setSelectedPlayerRiderStats(null);
              }}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header: Player Info */}
            <div className="flex flex-col sm:flex-row items-center gap-4 pb-6 mb-6 border-b border-slate-100 dark:border-slate-800">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xl font-bold uppercase shadow-lg shadow-indigo-500/20">
                {(selectedPlayer.displayName || "Spieler").substring(0, 2).toUpperCase()}
              </div>
              <div className="text-center sm:text-left">
                <h2 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center justify-center sm:justify-start gap-2">
                  {selectedPlayer.displayName || "Spieler"}
                  {isOnline(selectedPlayer.lastActive) && (
                    <span className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500" title="Online">
                      <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-400 opacity-75"></span>
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5 justify-center sm:justify-start font-medium">
                  <Calendar className="w-3.5 h-3.5" />
                  Mitglied seit: {formatDate(selectedPlayer.createdAt)}
                </p>
              </div>
            </div>

            {/* ELO Ratings Grid */}
            <div className="mb-8">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" />
                ELO-Rankings &amp; Statistiken
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* TicTacToe */}
                <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      <Grid3X3 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-900 dark:text-white">TicTacToe Elite</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        {selectedPlayer.wins || 0}S / {selectedPlayer.losses || 0}N / {selectedPlayer.draws || 0}U
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-lg text-indigo-600 dark:text-indigo-400">{selectedPlayer.rating || 1000}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">ELO</div>
                  </div>
                </div>

                {/* Connect 4 */}
                <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      <LayoutGrid className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-900 dark:text-white">4 Gewinnt Elite</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        {selectedPlayer.connect4_wins || 0}S / {selectedPlayer.connect4_losses || 0}N / {selectedPlayer.connect4_draws || 0}U
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-lg text-indigo-600 dark:text-indigo-400">{selectedPlayer.connect4_rating || 1000}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">ELO</div>
                  </div>
                </div>

                {/* Dots & Boxes */}
                <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      <Square className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-900 dark:text-white">Käsekästchen Elite</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        {selectedPlayer.dots_wins || 0}S / {selectedPlayer.dots_losses || 0}N / {selectedPlayer.dots_draws || 0}U
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-lg text-indigo-600 dark:text-indigo-400">{selectedPlayer.dots_rating || 1000}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">ELO</div>
                  </div>
                </div>

                {/* Ultimate TTT */}
                <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                      <Grid3X3 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-900 dark:text-white">Ultimate TTT Elite</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        {selectedPlayer.utictactoe_wins || 0}S / {selectedPlayer.utictactoe_losses || 0}N / {selectedPlayer.utictactoe_draws || 0}U
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-lg text-purple-600 dark:text-purple-400">{selectedPlayer.utictactoe_rating || 1000}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">ELO</div>
                  </div>
                </div>

                {/* Retro Racer */}
                <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-4 flex items-center justify-between sm:col-span-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                      <Car className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-900 dark:text-white">Retro Racer Elite</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        Rennen gefahren: {selectedPlayer.racing_gamesPlayed || 0}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-lg text-emerald-600 dark:text-emerald-400">{selectedPlayer.racing_rating || 1000}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">ELO</div>
                  </div>
                </div>

              </div>
            </div>

            {/* Racing Best Times Section */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-500" />
                Retro Racer Zeitrekorde (Solo)
              </h3>
              
              {isLoadingTimes ? (
                <div className="flex items-center justify-center py-6 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-2xl">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="ml-3 text-sm text-slate-500 dark:text-slate-400 font-medium">Lade Bestzeiten...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 flex flex-col gap-1.5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] pointer-events-none">
                      <Car className="w-16 h-16 text-emerald-500" />
                    </div>
                    <span className="text-[10px] uppercase font-black tracking-widest text-emerald-500">Track 1</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">Neon GP</span>
                    <span className="font-black text-2xl text-slate-800 dark:text-emerald-400 tracking-tight mt-1">
                      {selectedPlayerTimes ? formatMs(selectedPlayerTimes["neon-gp"]) : "--:--"}
                    </span>
                  </div>

                  <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 flex flex-col gap-1.5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] pointer-events-none">
                      <Car className="w-16 h-16 text-emerald-500" />
                    </div>
                    <span className="text-[10px] uppercase font-black tracking-widest text-emerald-500">Track 2</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">Drift Canyon</span>
                    <span className="font-black text-2xl text-slate-800 dark:text-emerald-400 tracking-tight mt-1">
                      {selectedPlayerTimes ? formatMs(selectedPlayerTimes["drift-canyon"]) : "--:--"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Neon Rider Bestleistungen Section */}
            <div className="mt-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-rose-500" />
                Neon Rider Bestleistungen (Solo)
              </h3>
              
              {isLoadingTimes ? (
                <div className="flex items-center justify-center py-6 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-2xl">
                  <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="ml-3 text-sm text-slate-500 dark:text-slate-400 font-medium">Lade Bestleistungen...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 flex flex-col gap-1.5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] pointer-events-none">
                      <CircleDot className="w-16 h-16 text-rose-500/10" />
                    </div>
                    <span className="text-[10px] uppercase font-black tracking-widest text-rose-500">Looping Valley</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">Neon Loop</span>
                    <span className="font-black text-2xl text-slate-800 dark:text-rose-400 tracking-tight mt-1">
                      {selectedPlayerRiderStats ? formatMs(selectedPlayerRiderStats["neon-loop"]) : "--:--"}
                    </span>
                  </div>

                  <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 flex flex-col gap-1.5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] pointer-events-none">
                      <Milestone className="w-16 h-16 text-rose-500/10" />
                    </div>
                    <span className="text-[10px] uppercase font-black tracking-widest text-rose-500">Gravity Leap</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">Gravity Drop</span>
                    <span className="font-black text-2xl text-slate-800 dark:text-rose-400 tracking-tight mt-1">
                      {selectedPlayerRiderStats ? formatMs(selectedPlayerRiderStats["gravity-drop"]) : "--:--"}
                    </span>
                  </div>

                  <div className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 flex flex-col gap-1.5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] pointer-events-none">
                      <Sparkles className="w-16 h-16 text-rose-500/10" />
                    </div>
                    <span className="text-[10px] uppercase font-black tracking-widest text-rose-500">Endless Grid</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">Highscore</span>
                    <span className="font-black text-2xl text-slate-800 dark:text-rose-400 tracking-tight mt-1">
                      {selectedPlayerRiderStats && selectedPlayerRiderStats["endless-grid"] !== null ? `${selectedPlayerRiderStats["endless-grid"]} pts` : "---"}
                    </span>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
