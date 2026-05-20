import React, { useEffect, useState } from "react";
import { signInWithPopup, GoogleAuthProvider, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth, db, handleFirestoreError, OperationType } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  query, 
  where, 
  getDocs, 
  limit, 
  serverTimestamp, 
  updateDoc,
  orderBy,
  onSnapshot,
  or,
  deleteDoc
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { LogOut, X, Play, Trash2, ArrowLeft, UserPlus, Check } from "lucide-react";
import { ThemeToggle } from "../components/ThemeToggle";
import { cn } from "../lib/utils";

interface LeaderboardUser {
  uid: string;
  displayName: string;
  rating: number;
  connect4_rating?: number;
  gamesPlayed: number;
  wins: number;
  email?: string;
}

interface GameSession {
  id: string;
  status: "waiting" | "playing" | "finished";
  player1Id: string;
  player2Id: string | null;
  updatedAt: any;
  winner: string | null;
}

function getRankStyle(index: number) {
  if (index === 0) return { root: "bg-amber-500/10 border border-amber-500/20", num: "text-amber-500", avatar: "bg-amber-500 text-slate-900" };
  if (index === 1) return { root: "bg-slate-100 dark:bg-slate-800/40 border border-slate-300 dark:border-slate-700/50", num: "text-slate-500 dark:text-slate-400", avatar: "bg-slate-400 text-slate-900" };
  if (index === 2) return { root: "border border-transparent", num: "text-amber-800", avatar: "bg-amber-800/50 border border-amber-800 text-slate-900 dark:text-white" };
  return { root: "border border-transparent", num: "text-slate-600", avatar: "bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-500" };
}

export default function Connect4Lobby() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [isFindingMatch, setIsFindingMatch] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [ownRank, setOwnRank] = useState<number | null>(null);
  const [friendsList, setFriendsList] = useState<string[]>([]);

  useEffect(() => {
    if (!user) {
      setFriendsList([]);
      return;
    }
    const friendsRef = collection(db, "users", user.uid, "friends");
    const unsubscribe = onSnapshot(friendsRef, (snapshot) => {
      const ids = snapshot.docs.map(doc => doc.id);
      setFriendsList(ids);
    }, (error) => {
      console.error("Error listening to friends list:", error);
    });
    return () => unsubscribe();
  }, [user]);
  const [matchmakingSeconds, setMatchmakingSeconds] = useState(0);
  const [activeMatchmakingId, setActiveMatchmakingId] = useState<string | null>(null);
  const [botRatings, setBotRatings] = useState<{ easy: number; medium: number; hard: number }>({
    easy: 800,
    medium: 1000,
    hard: 1200
  });

  useEffect(() => {
    const fetchBotRatings = async () => {
      try {
        const easySnap = await getDoc(doc(db, "users", "bot_connect4_easy"));
        const mediumSnap = await getDoc(doc(db, "users", "bot_connect4_medium"));
        const hardSnap = await getDoc(doc(db, "users", "bot_connect4"));
        
        setBotRatings({
          easy: easySnap.exists() ? (easySnap.data().connect4_rating || 800) : 800,
          medium: mediumSnap.exists() ? (mediumSnap.data().connect4_rating || 1000) : 1000,
          hard: hardSnap.exists() ? (hardSnap.data().connect4_rating || 1200) : 1200
        });
      } catch (e) {
        console.error("Error fetching bot ratings:", e);
      }
    };
    fetchBotRatings();
  }, [activeMatchmakingId]);


  useEffect(() => {
    const checkMatchmaking = () => {
      const savedId = sessionStorage.getItem("active_matchmaking_game_connect4");
      setActiveMatchmakingId(savedId);
    };
    checkMatchmaking();
    const interval = setInterval(checkMatchmaking, 1000);
    return () => clearInterval(interval);
  }, []);

  const startBotMatch = async (difficulty: "easy" | "medium" | "hard" = "medium") => {
    const savedId = sessionStorage.getItem("active_matchmaking_game_connect4");
    if (!savedId) return;
    
    let botId = "bot_connect4";
    let botName = "🤖 Robo-Bot (Schwer)";
    let startRating = 1200;
    
    if (difficulty === "easy") {
      botId = "bot_connect4_easy";
      botName = "🤖 Easy-Bot (Einfach)";
      startRating = 800;
    } else if (difficulty === "medium") {
      botId = "bot_connect4_medium";
      botName = "🤖 Medi-Bot (Mittel)";
      startRating = 1000;
    }
    
    try {
      const gameRef = doc(db, "games_connect4", savedId);
      
      const botUserRef = doc(db, "users", botId);
      const botUserSnap = await getDoc(botUserRef);
      if (!botUserSnap.exists()) {
        await setDoc(botUserRef, {
          uid: botId,
          displayName: botName,
          rating: 1000,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          connect4_rating: startRating,
          connect4_gamesPlayed: 0,
          connect4_wins: 0,
          connect4_losses: 0,
          connect4_draws: 0,
          createdAt: serverTimestamp()
        });
      }
      
      await updateDoc(gameRef, {
        player2Id: botId,
        status: "playing",
        updatedAt: serverTimestamp()
      });
      
      sessionStorage.removeItem("active_matchmaking_game_connect4");
      setActiveMatchmakingId(null);
      navigate("/connect4/game/" + savedId);
    } catch (error: any) {
      console.error("Error starting bot match:", error);
      alert("Fehler beim Starten des Bot-Spiels: " + error.message);
    }
  };

  useEffect(() => {
    if (activeMatchmakingId) {
      setMatchmakingSeconds(0);
      const timer = setInterval(() => {
        setMatchmakingSeconds(prev => {
          const next = prev + 1;
          if (next >= 30) {
            startBotMatch("medium");
          }
          return next;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setMatchmakingSeconds(0);
    }
  }, [activeMatchmakingId]);

  const formatTime = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ":" + seconds.toString().padStart(2, "0");
  };


  const [myGames, setMyGames] = useState<GameSession[]>([]);

  // Auth Modal State
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("connect4_rating", "desc"), limit(50));
    try {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const users = snapshot.docs
          .map(doc => doc.data() as LeaderboardUser)
          .filter(u => !u.uid.startsWith("bot_") || u.uid.startsWith("bot_connect4"));
        setLeaderboard(users);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, "users");
      });
      return () => unsubscribe();
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, "users");
    }
  }, []);

  useEffect(() => {
    if (user && leaderboard.length > 0) {
      const rank = leaderboard.findIndex(u => u.uid === user.uid);
      if (rank !== -1) {
        setOwnRank(rank + 1);
      } else {
        setOwnRank(null);
      }
    } else {
      setOwnRank(null);
    }
  }, [user, leaderboard]);

  useEffect(() => {
    if (!user) {
      setMyGames([]);
      return;
    }
    const q1 = query(collection(db, "games_connect4"), where("player1Id", "==", user.uid));
    const unsubscribe1 = onSnapshot(q1, (snapshot) => {
      const games1 = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GameSession));
      
      // Auto-redirect if a game we created is now active and we are actively waiting for it in matchmaking
      const activeGame = games1.find(g => g.status === 'playing');
      const expectedMatchmakingId = sessionStorage.getItem("active_matchmaking_game_connect4");
      if (activeGame && activeGame.id === expectedMatchmakingId) {
        sessionStorage.removeItem("active_matchmaking_game_connect4");
        navigate(`/connect4/game/${activeGame.id}`);
        return;
      }
      setMyGames(prev => {
        const otherGames = prev.filter(g => g.player1Id !== user.uid);
        const combined = [...otherGames, ...games1].filter(g => g.status !== 'finished').sort((a, b) => {
          const timeA = a.updatedAt?.toMillis() || 0;
          const timeB = b.updatedAt?.toMillis() || 0;
          return timeB - timeA;
        });
        return combined.slice(0, 10); // keep last 10
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, "games_connect4"));

    const q2 = query(collection(db, "games_connect4"), where("player2Id", "==", user.uid));
    const unsubscribe2 = onSnapshot(q2, (snapshot) => {
      const games2 = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GameSession));
      setMyGames(prev => {
        const otherGames = prev.filter(g => g.player2Id !== user.uid);
        const combined = [...otherGames, ...games2].filter(g => g.status !== 'finished').sort((a, b) => {
          const timeA = a.updatedAt?.toMillis() || 0;
          const timeB = b.updatedAt?.toMillis() || 0;
          return timeB - timeA;
        });
        return combined.slice(0, 10);
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, "games_connect4"));

    return () => {
      unsubscribe1();
      unsubscribe2();
    };
  }, [user]);

  const ensureUserProfile = async (uid: string, name: string, email?: string) => {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    const lowerEmail = (email || "").toLowerCase();
    
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: uid,
        displayName: name || "Unknown Player",
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
        createdAt: serverTimestamp()
      });
    } else {
      const data = userSnap.data();
      if (data && data.email !== lowerEmail && lowerEmail) {
        await setDoc(userRef, { email: lowerEmail }, { merge: true });
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

  const findMatch = async () => {
    if (!user) return;
    setIsFindingMatch(true);
    
    try {
      const q = query(
        collection(db, "games_connect4"),
        where("status", "==", "waiting"),
        limit(1)
      );
      
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const gameDoc = querySnapshot.docs[0];
        const gameRef = doc(db, "games_connect4", gameDoc.id);
        
        if (gameDoc.data().player1Id !== user.uid) {
          await updateDoc(gameRef, {
            status: "playing",
            player2Id: user.uid,
            updatedAt: serverTimestamp()
          });
          navigate(`/connect4/game/${gameDoc.id}`);
          return;
        }
      }
      
      const newGameRef = doc(collection(db, "games_connect4"));
      await setDoc(newGameRef, {
        player1Id: user.uid,
        player2Id: null,
        board: Array(42).fill(""),
        turn: "red",
        status: "waiting",
        winner: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      sessionStorage.setItem("active_matchmaking_game_connect4", newGameRef.id);
      // Do not navigate yet, stay on home page
      setIsFindingMatch(false);
      
    } catch (error) {
      setIsFindingMatch(false);
      handleFirestoreError(error, OperationType.WRITE, "games_connect4");
    }
  };

  const cancelMatchmaking = async (gameId: string) => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "games_connect4", gameId));
      sessionStorage.removeItem("active_matchmaking_game_connect4");
    } catch (error: any) {
      if (error.code !== 'permission-denied' && error.code !== 'not-found') {
        alert("Fehler beim Löschen des Spiels: " + error.message);
      }
      handleFirestoreError(error, OperationType.DELETE, "games_connect4");
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return <div className="h-full flex items-center justify-center">Loading...</div>;
  }

  const currentUserData = user ? leaderboard.find(u => u.uid === user.uid) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <nav className="shrink-0 h-16 border-b border-slate-200 dark:border-slate-800 px-4 md:px-8 flex items-center justify-between bg-white/80 dark:bg-slate-900/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate("/")}
            className="p-1 mr-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            title="Zurück zum Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-xl text-slate-900 dark:text-white">#</div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">C4<span className="text-indigo-500">ELITE</span></span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <ThemeToggle />
          {user ? (
            <>
              {currentUserData && (
                <div className="hidden md:flex flex-col items-end">
                  <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest">Globales Rating</span>
                  <span className="text-lg font-mono font-bold text-indigo-400">{currentUserData.connect4_rating} ELO</span>
                </div>
              )}
              <div className="hidden md:block h-10 w-px bg-slate-100 dark:bg-slate-800"></div>
              <button 
                onClick={() => navigate("/profile")}
                className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800 py-1 pl-3 pr-1 rounded-full border border-slate-300 dark:border-slate-700 transition-colors"
                title="Profil öffnen"
              >
                <span className="text-sm font-medium truncate max-w-[80px] sm:max-w-[150px]">{user.displayName || user.email}</span>
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 border border-slate-400 dark:border-slate-600 flex items-center justify-center text-xs font-bold shrink-0 uppercase text-slate-900 dark:text-white">
                  {(user.displayName || user.email)?.substring(0, 2)}
                </div>
              </button>
              <button 
                onClick={() => signOut(auth)}
                className="p-2 hover:bg-slate-100 dark:bg-slate-800 rounded-full transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200"
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

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden bg-slate-50 dark:bg-slate-950">
        
        {/* Left Sidebar: Meine Spiele */}
        <aside className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 p-6 flex flex-col gap-6 lg:overflow-y-auto overflow-visible shrink-0">
          {user && (
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Meine Spiele</h3>
              {myGames.length === 0 ? (
                <div className="p-4 text-center text-slate-500 text-sm border border-slate-200 dark:border-slate-800 rounded-xl border-dashed">
                  Keine aktiven Spiele.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {myGames.map(game => {
                    const isWaiting = game.status === "waiting";
                    const isPlaying = game.status === "playing";
                    const myTurnSymbol = game.player1Id === user.uid ? "red" : "yellow";
                    const isMyTurn = isPlaying && game.turn === myTurnSymbol;
                    const opponentName = game.player1Id === user.uid ? (game.player2Name || "Gegner") : (game.player1Name || "Gegner");

                    return (
                      <div key={game.id} className={cn(
                        "bg-white dark:bg-slate-900 border rounded-xl p-3 shadow-md flex items-center justify-between gap-2 transition-all duration-200",
                        isMyTurn ? "border-emerald-500/50 shadow-emerald-500/5 dark:shadow-emerald-500/10 ring-1 ring-emerald-500/20 bg-emerald-500/[0.02] dark:bg-emerald-500/[0.01]" : "border-slate-200 dark:border-slate-800"
                      )}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                            {isWaiting ? (
                              <span className="text-[10px] px-2 py-0.5 font-bold uppercase rounded bg-amber-500/10 text-amber-500">Wartet...</span>
                            ) : isPlaying ? (
                              isMyTurn ? (
                                <span className="text-[10px] px-2 py-0.5 font-bold uppercase rounded bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 flex items-center gap-1 shadow-sm border border-emerald-500/20 animate-pulse">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                                  Du bist dran
                                </span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 font-bold uppercase rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700/50">
                                  Gegner am Zug
                                </span>
                              )
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 font-bold uppercase rounded bg-slate-100 dark:bg-slate-800 text-slate-500">Beendet</span>
                            )}
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">#{game.id.substring(0, 5)}</span>
                          </div>
                          <div className="text-xs font-semibold truncate text-slate-600 dark:text-slate-400">
                            {isWaiting ? "Offene Lobby" : `vs. ${opponentName}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isWaiting && game.player1Id === user.uid && (
                            <button
                              disabled={isDeleting}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                cancelMatchmaking(game.id);
                              }}
                              className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-full transition-colors"
                              title="Abbrechen"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          {!isWaiting && (
                            <button
                              onClick={() => navigate(`/connect4/game/${game.id}`)}
                              className="p-2 text-indigo-400 hover:bg-indigo-500/10 rounded-full transition-colors flex items-center gap-1 text-xs font-bold"
                              title="Beitreten"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                          {isWaiting && game.player1Id !== user.uid && (
                            <button
                              onClick={() => navigate(`/connect4/game/${game.id}`)}
                              className="p-2 text-indigo-400 hover:bg-indigo-500/10 rounded-full transition-colors flex items-center gap-1 text-xs font-bold"
                            >
                              <Play className="w-4 h-4" />
                              Beitreten
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Center Section: Matchmaking Radar or Lobby Welcome */}
        <section className="lg:col-span-6 p-6 flex flex-col justify-center items-center relative overflow-y-auto min-h-[400px]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-amber-500/5 via-transparent to-transparent pointer-events-none"></div>
          
          {activeMatchmakingId ? (
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-3xl shadow-xl flex flex-col items-center gap-6 relative z-10 animate-in zoom-in-95 duration-200">
              <div className="relative w-24 h-24 flex items-center justify-center">
                <div className="absolute inset-0 border-4 border-amber-500/20 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-t-amber-500 rounded-full animate-spin"></div>
                <span className="text-xl font-bold text-slate-900 dark:text-white font-mono">{formatTime(matchmakingSeconds)}</span>
              </div>
              <div className="text-center">
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Spielersuche läuft...</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-[280px]">Wir suchen nach einem ebenbürtigen Gegner.</p>
              </div>

              <div className="w-full h-px bg-slate-100 dark:bg-slate-800 my-2"></div>
              
              <div className="w-full flex flex-col gap-3">
                {matchmakingSeconds >= 1 && (
                  <div className="flex flex-col gap-2 w-full animate-in slide-in-from-bottom-2 fade-in duration-300">
                    <p className="text-xs uppercase font-bold text-slate-500 tracking-wider text-center mb-1">Kein Spieler online? Fordere einen Bot heraus:</p>
                    <button
                      onClick={() => startBotMatch("easy")}
                      className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold py-2.5 rounded-xl transition-all duration-200 border border-emerald-500/20 text-sm"
                    >
                      🟢 Einfach (Bot-ELO: {botRatings.easy})
                    </button>
                    <button
                      onClick={() => startBotMatch("medium")}
                      className="w-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold py-2.5 rounded-xl transition-all duration-200 border border-amber-500/20 text-sm"
                    >
                      🟡 Mittel (Bot-ELO: {botRatings.medium})
                    </button>
                    <button
                      onClick={() => startBotMatch("hard")}
                      className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold py-2.5 rounded-xl transition-all duration-200 border border-rose-500/20 text-sm"
                    >
                      🔴 Schwer (Bot-ELO: {botRatings.hard})
                    </button>
                  </div>
                )}
                <button
                  onClick={() => cancelMatchmaking(activeMatchmakingId)}
                  className="w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-xl transition-all duration-200 active:scale-95 border border-slate-300 dark:border-slate-700"
                >
                  Suche abbrechen
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center gap-8 relative z-10 w-full max-w-lg">
              <div>
                <div className="text-amber-500 text-sm font-semibold mb-1 uppercase tracking-widest">4 Gewinnt</div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white leading-tight">Willkommen im C4 Elite</h2>
                <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium max-w-sm mx-auto">
                  Tritt in der Vier-Gewinnt-Arena an. Lass deine Steine geschickt fallen und blocke deinen Gegner!
                </p>
              </div>

              <div className="w-64 h-56 opacity-20 border-[4px] border-slate-200 dark:border-slate-800 grid grid-cols-7 grid-rows-6 gap-1 p-2 rounded-2xl pointer-events-none transition-all duration-500 hover:scale-105">
                 {[...Array(42)].map((_, i) => (
                   <div key={i} className="bg-slate-200 dark:bg-slate-800 rounded-full"></div>
                 ))}
              </div>

              <button
                onClick={findMatch}
                disabled={isFindingMatch}
                className="group flex items-center justify-center gap-3 bg-amber-600 hover:bg-amber-500 text-white font-extrabold text-lg py-4 px-10 rounded-2xl shadow-xl shadow-amber-900/20 active:scale-95 transition-all duration-200 w-full max-w-xs disabled:opacity-50"
              >
                <Play className="w-5 h-5 fill-current" />
                Spiel suchen
              </button>
            </div>
          )}
        </section>

        <aside className="md:col-span-12 lg:col-span-3 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/30 flex flex-col h-auto md:h-full md:overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 shrink-0">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Rangliste (Global)</h3>
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col p-2 gap-1 min-h-[300px]">
            {leaderboard.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                Keine Spieler gefunden.
              </div>
            ) : (
              leaderboard.map((u, i) => {
                const style = getRankStyle(i);
                const isMe = user && u.uid === user.uid;
                const isFriend = friendsList.includes(u.uid);

                return (
                  <div key={u.uid} className={cn("flex items-center gap-4 p-3 rounded-xl", style.root)}>
                    <span className={cn("font-black text-center w-4", style.num)}>{i + 1}</span>
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs uppercase shrink-0", style.avatar)}>
                      {u.displayName?.substring(0, 2) || "U"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate text-slate-700 dark:text-slate-200">{u.displayName}</div>
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Rating</div>
                    </div>
                    <span className="font-mono font-bold text-sm text-slate-600 dark:text-slate-300 shrink-0">{u.connect4_rating}</span>
                    
                    {/* Add Friend Action */}
                    {user && !isMe && (
                      <div className="shrink-0 ml-1">
                        {isFriend ? (
                          <div 
                            className="p-1.5 bg-green-500/10 text-green-500 rounded-lg"
                            title="Bereits befreundet"
                          >
                            <Check className="w-4 h-4" />
                          </div>
                        ) : (
                          <button
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              try {
                                await setDoc(doc(db, "users", user.uid, "friends", u.uid), {
                                  displayName: u.displayName || "Spieler",
                                  email: u.email || "",
                                  addedAt: serverTimestamp()
                                });
                              } catch (error) {
                                console.error("Error adding friend from leaderboard:", error);
                              }
                            }}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-500 dark:hover:text-slate-200 rounded-lg transition-colors"
                            title="Als Freund hinzufügen"
                          >
                            <UserPlus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            <div className="flex-1 min-h-4"></div>
            
            {user && currentUserData && (
              <div className="p-3 mt-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-4 bg-indigo-600/10 rounded-xl shrink-0">
                <span className="font-black text-indigo-400 text-center w-4">{ownRank || "-"}</span>
                <span className="text-sm flex-1 font-bold text-indigo-100 truncate">Du ({user.displayName})</span>
                <span className="font-mono font-bold text-sm text-indigo-400">{currentUserData.connect4_rating}</span>
              </div>
            )}
          </div>
        </aside>
      </main>

      <footer className="shrink-0 h-8 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-6 sm:flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500 font-bold hidden">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Online</span>
          <span>Server: EU-West</span>
        </div>
        <div>© {new Date().getFullYear()} TTT ELITE SYSTEM</div>
      </footer>
    </div>
  );
}
