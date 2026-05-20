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
  utictactoe_rating?: number;
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

export default function UltimateLobby() {
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
        const easySnap = await getDoc(doc(db, "users", "bot_utictactoe_easy"));
        const mediumSnap = await getDoc(doc(db, "users", "bot_utictactoe_medium"));
        const hardSnap = await getDoc(doc(db, "users", "bot_utictactoe"));
        
        setBotRatings({
          easy: easySnap.exists() ? (easySnap.data().utictactoe_rating || 800) : 800,
          medium: mediumSnap.exists() ? (mediumSnap.data().utictactoe_rating || 1000) : 1000,
          hard: hardSnap.exists() ? (hardSnap.data().utictactoe_rating || 1200) : 1200
        });
      } catch (e) {
        console.error("Error fetching bot ratings:", e);
      }
    };
    fetchBotRatings();
  }, [activeMatchmakingId]);

  useEffect(() => {
    const checkMatchmaking = () => {
      const savedId = sessionStorage.getItem("active_matchmaking_game_utictactoe");
      setActiveMatchmakingId(savedId);
    };
    checkMatchmaking();
    const interval = setInterval(checkMatchmaking, 1000);
    return () => clearInterval(interval);
  }, []);

  const startBotMatch = async (difficulty: "easy" | "medium" | "hard" = "medium") => {
    const savedId = sessionStorage.getItem("active_matchmaking_game_utictactoe");
    if (!savedId) return;
    
    let botId = "bot_utictactoe";
    let botName = "🤖 Robo-Bot (Schwer)";
    let startRating = 1200;
    
    if (difficulty === "easy") {
      botId = "bot_utictactoe_easy";
      botName = "🤖 Easy-Bot (Einfach)";
      startRating = 800;
    } else if (difficulty === "medium") {
      botId = "bot_utictactoe_medium";
      botName = "🤖 Medi-Bot (Mittel)";
      startRating = 1000;
    }

    try {
      const gameRef = doc(db, "games_utictactoe", savedId);
      
      const botRef = doc(db, "users", botId);
      const botSnap = await getDoc(botRef);
      
      if (!botSnap.exists()) {
        await setDoc(botRef, {
          uid: botId,
          displayName: botName,
          rating: 1000,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          utictactoe_rating: startRating,
          utictactoe_gamesPlayed: 0,
          utictactoe_wins: 0,
          utictactoe_losses: 0,
          utictactoe_draws: 0,
          createdAt: serverTimestamp()
        });
      }
      
      await updateDoc(gameRef, {
        player2Id: botId,
        status: "playing",
        updatedAt: serverTimestamp()
      });
      
      sessionStorage.removeItem("active_matchmaking_game_utictactoe");
      setActiveMatchmakingId(null);
      navigate("/utictactoe/game/" + savedId);
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
  const [userNames, setUserNames] = useState<{[uid: string]: string}>({});

  useEffect(() => {
    if (!user || myGames.length === 0) return;
    const uidsToFetch = new Set<string>();
    myGames.forEach(g => {
      if (g.player1Id && !userNames[g.player1Id]) uidsToFetch.add(g.player1Id);
      if (g.player2Id && !userNames[g.player2Id]) uidsToFetch.add(g.player2Id);
    });
    
    if (uidsToFetch.size === 0) return;
    
    uidsToFetch.forEach(async (uid) => {
      if (uid.startsWith("bot_")) {
        let name = "🤖 Robo-Bot";
        if (uid.includes("easy")) name = "🤖 Easy-Bot";
        else if (uid.includes("medium")) name = "🤖 Medi-Bot";
        setUserNames(prev => ({ ...prev, [uid]: name }));
        return;
      }
      try {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (uSnap.exists()) {
          setUserNames(prev => ({ ...prev, [uid]: uSnap.data().displayName || "Spieler" }));
        }
      } catch (e) {
        console.error("Error fetching username:", e);
      }
    });
  }, [myGames, userNames, user]);

  // Auth Modal State
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("utictactoe_rating", "desc"), limit(50));
    try {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const users = snapshot.docs
          .map(doc => doc.data() as LeaderboardUser)
          .filter(u => !u.uid.startsWith("bot_") || u.uid.startsWith("bot_utictactoe"));
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
    const q1 = query(collection(db, "games_utictactoe"), where("player1Id", "==", user.uid));
    const unsubscribe1 = onSnapshot(q1, (snapshot) => {
      const games1 = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GameSession));
      
      const activeGame = games1.find(g => g.status === 'playing');
      const expectedMatchmakingId = sessionStorage.getItem("active_matchmaking_game_utictactoe");
      if (activeGame && activeGame.id === expectedMatchmakingId) {
        sessionStorage.removeItem("active_matchmaking_game_utictactoe");
        navigate(`/utictactoe/game/${activeGame.id}`);
        return;
      }
      setMyGames(prev => {
        const otherGames = prev.filter(g => g.player1Id !== user.uid);
        const combined = [...otherGames, ...games1].filter(g => g.status !== 'finished').sort((a, b) => {
          const timeA = a.updatedAt?.toMillis() || 0;
          const timeB = b.updatedAt?.toMillis() || 0;
          return timeB - timeA;
        });
        return combined.slice(0, 10);
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, "games_utictactoe"));

    const q2 = query(collection(db, "games_utictactoe"), where("player2Id", "==", user.uid));
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
    }, (error) => handleFirestoreError(error, OperationType.LIST, "games_utictactoe"));

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
        utictactoe_rating: 1000,
        utictactoe_gamesPlayed: 0,
        utictactoe_wins: 0,
        utictactoe_losses: 0,
        utictactoe_draws: 0,
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
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    
    setIsFindingMatch(true);
    try {
      const gamesRef = collection(db, "games_utictactoe");
      
      const q = query(
        gamesRef, 
        where("status", "==", "waiting"), 
        limit(1)
      );
      
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const joinableGame = snapshot.docs[0];
        const gameData = joinableGame.data();
        
        if (gameData.player1Id === user.uid) {
          sessionStorage.setItem("active_matchmaking_game_utictactoe", joinableGame.id);
          setActiveMatchmakingId(joinableGame.id);
          setIsFindingMatch(false);
          return;
        }
        
        await updateDoc(doc(db, "games_utictactoe", joinableGame.id), {
          player2Id: user.uid,
          status: "playing",
          updatedAt: serverTimestamp()
        });
        
        sessionStorage.removeItem("active_matchmaking_game_utictactoe");
        navigate("/utictactoe/game/" + joinableGame.id);
      } else {
        const newGameRef = doc(collection(db, "games_utictactoe"));
        
        // Structure for Ultimate Tic-Tac-Toe
        const initialSmallBoards = Array(9).fill(null).map(() => ({"0": "", "1": "", "2": "", "3": "", "4": "", "5": "", "6": "", "7": "", "8": ""}));
        const initialMacroBoard = Array(9).fill("");
        
        await setDoc(newGameRef, {
          player1Id: user.uid,
          player2Id: null,
          smallBoards: initialSmallBoards,
          macroBoard: initialMacroBoard,
          activeBoard: null,
          turn: "X",
          status: "waiting",
          winner: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        
        sessionStorage.setItem("active_matchmaking_game_utictactoe", newGameRef.id);
        setActiveMatchmakingId(newGameRef.id);
      }
    } catch (error) {
      console.error("Matchmaking error", error);
      alert("Fehler bei der Spielersuche.");
    } finally {
      setIsFindingMatch(false);
    }
  };

  const cancelMatchmaking = async (gameId: string) => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "games_utictactoe", gameId));
      sessionStorage.removeItem("active_matchmaking_game_utictactoe");
      setActiveMatchmakingId(null);
    } catch (error: any) {
      if (error.code !== 'permission-denied' && error.code !== 'not-found') {
        alert("Fehler beim Löschen des Spiels: " + error.message);
      }
      handleFirestoreError(error, OperationType.DELETE, "games_utictactoe");
    } finally {
      setIsDeleting(false);
    }
  };

  const addFriend = async (friendId: string) => {
    if (!user) return;
    try {
      const friendUserRef = doc(db, "users", friendId);
      const friendSnap = await getDoc(friendUserRef);
      if (!friendSnap.exists()) return;
      const friendData = friendSnap.data();

      const myFriendRef = doc(db, "users", user.uid, "friends", friendId);
      await setDoc(myFriendRef, {
        displayName: friendData.displayName || "Unknown Friend",
        email: friendData.email || "",
        addedAt: serverTimestamp()
      });
      alert(`${friendData.displayName} wurde zu deinen Freunden hinzugefügt!`);
    } catch (error) {
      console.error("Error adding friend from leaderboard:", error);
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
          <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl text-slate-900 dark:text-white">#</div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">UTTT<span className="text-purple-500">ELITE</span></span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <ThemeToggle />
          {user ? (
            <>
              {currentUserData && (
                <div className="hidden md:flex flex-col items-end">
                  <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest">Globales Rating</span>
                  <span className="text-lg font-mono font-bold text-purple-400">{(currentUserData.utictactoe_rating || 1000)} ELO</span>
                </div>
              )}
              <div className="hidden md:block h-10 w-px bg-slate-100 dark:bg-slate-800"></div>
              <button 
                onClick={() => navigate("/profile")}
                className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800 py-1 pl-3 pr-1 rounded-full border border-slate-300 dark:border-slate-700 transition-colors"
                title="Profil öffnen"
              >
                <span className="text-sm font-medium truncate max-w-[80px] sm:max-w-[150px]">{user.displayName || user.email}</span>
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-500 border border-slate-400 dark:border-slate-600 flex items-center justify-center text-xs font-bold shrink-0 uppercase text-slate-900 dark:text-white shadow-inner">
                  {(user.displayName || user.email)?.substring(0, 2)}
                </div>
              </button>
              <button 
                onClick={() => signOut(auth)}
                className="p-2 hover:bg-slate-100 dark:bg-slate-800 rounded-full transition-colors text-slate-500 dark:text-slate-400 hover:text-purple-400"
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </>
          ) : (
            <button 
              onClick={() => setShowAuthModal(true)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-white font-bold rounded-xl transition-colors shadow-lg shadow-purple-900/20 text-sm"
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
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-purple-500"
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
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-purple-500"
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
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-purple-500"
                  placeholder="••••••••"
                />
              </div>

              <button 
                type="submit"
                disabled={isAuthLoading}
                className="mt-2 w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-purple-900/20"
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
                className="text-sm text-slate-500 dark:text-slate-400 hover:text-purple-400"
              >
                {authMode === "login" 
                  ? "Noch keinen Account? Registrieren" 
                  : "Bereits einen Account? Einloggen"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden bg-slate-50 dark:bg-slate-950">
        {/* Left Sidebar: Spiel Modus & Meine Spiele */}
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
                    const myTurnSymbol = game.player1Id === user.uid ? "X" : "O";
                    const isMyTurn = isPlaying && game.turn === myTurnSymbol;
                    const opponentUid = game.player1Id === user.uid ? game.player2Id : game.player1Id;
                    const opponentName = opponentUid ? (userNames[opponentUid] || "Gegner") : "Gegner";

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
                              onClick={() => navigate(`/utictactoe/game/${game.id}`)}
                              className="p-2 text-purple-400 hover:bg-purple-500/10 rounded-full transition-colors flex items-center gap-1 text-xs font-bold"
                              title="Beitreten"
                            >
                              <Play className="w-4 h-4 animate-pulse" />
                            </button>
                          )}
                          {isWaiting && game.player1Id !== user.uid && (
                            <button
                              onClick={() => navigate(`/utictactoe/game/${game.id}`)}
                              className="p-2 text-purple-400 hover:bg-purple-500/10 rounded-full transition-colors flex items-center gap-1 text-xs font-bold"
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
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-purple-500/5 via-transparent to-transparent pointer-events-none"></div>
          
          {activeMatchmakingId ? (
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-3xl shadow-xl flex flex-col items-center gap-6 relative z-10 animate-in zoom-in-95 duration-200">
              <div className="relative w-24 h-24 flex items-center justify-center">
                <div className="absolute inset-0 border-4 border-purple-500/20 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-t-purple-500 rounded-full animate-spin"></div>
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
                <div className="text-purple-400 text-sm font-semibold mb-1 uppercase tracking-widest">Ultimate TicTacToe</div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white leading-tight">Willkommen im UTTT Elite</h2>
                <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium max-w-sm mx-auto">
                  Tritt in der Arena der 81 Felder an. Setze weise, kontrolliere das Macro-Board.
                </p>
              </div>

              <div className="w-56 h-56 opacity-20 border-[4px] border-slate-200 dark:border-slate-800 grid grid-cols-3 grid-rows-3 gap-2 p-2 rounded-2xl pointer-events-none transition-all duration-500 hover:scale-105">
                 {[...Array(9)].map((_, i) => (
                   <div key={i} className="border border-slate-300 dark:border-slate-700 grid grid-cols-3 grid-rows-3 gap-0.5 p-0.5 rounded-md">
                     {[...Array(9)].map((_, j) => <div key={j} className="bg-slate-200 dark:bg-slate-800 rounded-[1px]"></div>)}
                   </div>
                 ))}
              </div>

              <button
                onClick={findMatch}
                disabled={isFindingMatch}
                className="group flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-lg py-4 px-10 rounded-2xl shadow-xl shadow-purple-900/20 active:scale-95 transition-all duration-200 w-full max-w-xs disabled:opacity-50"
              >
                <Play className="w-5 h-5 fill-current" />
                Spiel suchen
              </button>
            </div>
          )}
        </section>

        {/* Right Sidebar: Leaderboard */}
        <aside className="lg:col-span-3 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/30 flex flex-col h-auto lg:h-full lg:overflow-hidden shrink-0">
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
                    <span className={cn("w-6 text-center font-mono font-bold text-sm", style.num)}>{i + 1}</span>
                    <div className="relative shrink-0">
                      <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold uppercase", style.avatar)}>
                        {u.displayName.substring(0, 2)}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className={cn("text-sm font-bold truncate", isMe ? "text-purple-400" : "text-slate-900 dark:text-white")}>
                          {u.displayName}
                        </p>
                        {isFriend && (
                          <span className="bg-purple-500/20 text-purple-400 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full uppercase shrink-0">
                            Freund
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest font-mono font-semibold mt-0.5">
                        {u.utictactoe_rating || 1000} ELO
                      </p>
                    </div>
                    {user && !isMe && !isFriend && !u.uid.startsWith("bot_") && (
                      <button 
                        onClick={() => addFriend(u.uid)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        title="Als Freund hinzufügen"
                      >
                        <UserPlus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
