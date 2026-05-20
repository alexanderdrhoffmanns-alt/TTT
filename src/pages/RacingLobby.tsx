import React, { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  query,
  where,
  serverTimestamp,
  onSnapshot
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Car, Trophy, Play, Timer, Award, Calendar, ChevronRight } from "lucide-react";
import { ThemeToggle } from "../components/ThemeToggle";

interface CompletedRun {
  id: string;
  player1Id: string;
  player1Name: string;
  trackId: "neon-gp" | "drift-canyon";
  player1Time: number; // in milliseconds
  player1BestLap?: number; // in milliseconds
  createdAt: any;
}

interface LeaderboardEntry {
  player1Id: string;
  player1Name: string;
  time: number;
  date: any;
}

function getRankStyle(index: number) {
  if (index === 0) return { root: "bg-amber-500/10 border border-amber-500/30 shadow-lg shadow-amber-500/5", num: "text-amber-500 font-black", avatar: "bg-amber-500 text-slate-950 font-extrabold shadow-md shadow-amber-500/20" };
  if (index === 1) return { root: "bg-slate-300/10 border border-slate-300/20", num: "text-slate-400 font-bold", avatar: "bg-slate-400 text-slate-950 font-bold" };
  if (index === 2) return { root: "bg-amber-700/10 border border-amber-700/20", num: "text-amber-600 font-bold", avatar: "bg-amber-700 text-white font-bold" };
  return { root: "border border-transparent hover:bg-slate-800/10 dark:hover:bg-slate-800/30", num: "text-slate-500 dark:text-slate-550", avatar: "bg-slate-200 dark:bg-slate-850 text-slate-700 dark:text-slate-400" };
}

export default function RacingLobby() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [allFinishedRuns, setAllFinishedRuns] = useState<CompletedRun[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<"neon-gp" | "drift-canyon">("neon-gp");
  const [leaderboardMode, setLeaderboardMode] = useState<"total" | "lap">("total");
  const [displayName, setDisplayName] = useState<string>("");
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});

  // Fetch all completed solo runs globally
  useEffect(() => {
    const q = query(
      collection(db, "games_racing"),
      where("player2Id", "==", null),
      where("status", "==", "finished")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const runs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          player1Id: data.player1Id,
          player1Name: data.player1Name,
          trackId: data.trackId,
          player1Time: data.player1Time,
          player1BestLap: data.player1BestLap,
          createdAt: data.createdAt
        } as CompletedRun;
      });
      setAllFinishedRuns(runs);
    }, (error) => {
      console.error("Error fetching racing runs:", error);
    });

    return () => unsubscribe();
  }, []);

  // Fetch user profile from Firestore to keep displayName synced in real-time
  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data && data.displayName) {
          setDisplayName(data.displayName);
        }
      }
    }, (error) => {
      console.error("Error listening to user profile:", error);
    });
    return () => unsubscribe();
  }, [user]);

  // Fetch all users to map IDs to their latest display names in real-time
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
      const mapping: Record<string, string> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.displayName) {
          mapping[doc.id] = data.displayName;
        }
      });
      setUsersMap(mapping);
    }, (error) => {
      console.error("Error fetching users mapping:", error);
    });
    return () => unsubscribe();
  }, []);

  const formatMs = (ms: number | null) => {
    if (ms === null || ms === undefined) return "--:--";
    const totalSec = ms / 1000;
    const sec = Math.floor(totalSec);
    const fract = Math.floor((totalSec - sec) * 100);
    return `${sec}.${fract.toString().padStart(2, "0")}s`;
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  // Compute Personal Bests
  const getPersonalBest = (trackId: "neon-gp" | "drift-canyon") => {
    if (!user) return null;
    const myRuns = allFinishedRuns.filter(r => r.player1Id === user.uid && r.trackId === trackId);
    if (myRuns.length === 0) return null;
    return Math.min(...myRuns.map(r => r.player1Time));
  };

  const getPersonalBestLap = (trackId: "neon-gp" | "drift-canyon") => {
    if (!user) return null;
    const myRuns = allFinishedRuns.filter(r => r.player1Id === user.uid && r.trackId === trackId);
    const laps = myRuns.map(r => r.player1BestLap).filter((lap): lap is number => typeof lap === "number" && lap > 0);
    if (laps.length === 0) return null;
    return Math.min(...laps);
  };

  // Compute Track Records
  const getTrackRecord = (trackId: "neon-gp" | "drift-canyon") => {
    const trackRuns = allFinishedRuns.filter(r => r.trackId === trackId);
    if (trackRuns.length === 0) return null;
    
    let fastestRun = trackRuns[0];
    for (const run of trackRuns) {
      if (run.player1Time < fastestRun.player1Time) {
        fastestRun = run;
      }
    }
    return fastestRun;
  };

  // Filter Leaderboard for the selected track
  // Showing only the single best run for each unique user
  const getLeaderboard = (trackId: "neon-gp" | "drift-canyon"): LeaderboardEntry[] => {
    const trackRuns = allFinishedRuns.filter(r => r.trackId === trackId);
    
    // Group by user and find their minimum time
    const userBestTimes: Record<string, { player1Name: string; time: number; date: any }> = {};
    for (const run of trackRuns) {
      const val = leaderboardMode === "total" ? run.player1Time : run.player1BestLap;
      if (typeof val === "number" && val > 0) {
        const existing = userBestTimes[run.player1Id];
        if (!existing || val < existing.time) {
          userBestTimes[run.player1Id] = {
            player1Name: usersMap[run.player1Id] || run.player1Name || "Spieler",
            time: val,
            date: run.createdAt
          };
        }
      }
    }

    // Convert to array and sort by time ascending
    return Object.entries(userBestTimes)
      .map(([player1Id, data]) => ({
        player1Id,
        player1Name: data.player1Name,
        time: data.time,
        date: data.date
      }))
      .sort((a, b) => a.time - b.time)
      .slice(0, 50);
  };

  // User's own completed runs history
  const getMyHistory = () => {
    if (!user) return [];
    return allFinishedRuns
      .filter(r => r.player1Id === user.uid)
      .sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      })
      .slice(0, 8);
  };

  // Start Solo Run
  const startSoloRun = async (track: "neon-gp" | "drift-canyon") => {
    if (!user) return;
    try {
      let activeName = displayName;
      if (!activeName) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          activeName = userDoc.data().displayName || "";
        }
      }
      const finalPlayerName = activeName || user.displayName || "Spieler";

      const newGameRef = doc(collection(db, "games_racing"));
      await setDoc(newGameRef, {
        player1Id: user.uid,
        player1Name: finalPlayerName,
        player2Id: null,
        player2Name: null,
        status: "playing",
        trackId: track,
        player1Time: null,
        player2Time: null,
        winnerId: null,
        winnerName: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      navigate(`/racing/game/${newGameRef.id}`);
    } catch (error) {
      console.error("Error starting solo run:", error);
    }
  };

  const pbNeon = getPersonalBest("neon-gp");
  const pbNeonLap = getPersonalBestLap("neon-gp");
  const pbCanyon = getPersonalBest("drift-canyon");
  const pbCanyonLap = getPersonalBestLap("drift-canyon");
  const trNeon = getTrackRecord("neon-gp");
  const trCanyon = getTrackRecord("drift-canyon");

  const currentLeaderboard = getLeaderboard(selectedTrack);
  const myHistory = getMyHistory();

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Header bar */}
      <nav className="shrink-0 h-16 border-b border-slate-900 px-4 md:px-8 flex items-center justify-between bg-slate-950/80 backdrop-blur-md z-10 relative">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-slate-900 rounded-full transition-colors text-slate-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center font-bold text-xl text-slate-950">
            🏎️
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            RETRO<span className="text-emerald-500">RACER</span> ELITE
          </span>
          <span className="hidden sm:inline-block px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/25 rounded-md text-[10px] uppercase font-black tracking-widest text-emerald-400">
            Solo Time Trial
          </span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          {user && (
            <button
              onClick={() => navigate("/profile")}
              className="flex items-center gap-3 bg-slate-900/50 hover:bg-slate-900 py-1 pl-3 pr-3 rounded-full border border-slate-800 hover:border-emerald-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer group"
              title="Profil öffnen"
            >
              <span className="text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">
                {displayName || user.displayName || "Spieler"}
              </span>
            </button>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-6 p-4 md:p-8 max-w-7xl mx-auto w-full relative">
        {/* Decorative Neon BG glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.08),transparent_50%)] pointer-events-none"></div>

        {/* Left column - Track Selection cards (7 cols) */}
        <div className="lg:col-span-7 flex flex-col min-h-0 gap-6">
          <div className="shrink-0">
            <h2 className="text-2xl font-black text-white mb-2 flex items-center gap-2">
              <Timer className="w-6 h-6 text-emerald-400" /> Wähle eine Strecke
            </h2>
            <p className="text-sm text-slate-400">
              Drifte durch anspruchsvolle Kurven, optimiere deine Ideallinie und schlage die Bestzeiten auf der Rangliste!
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
            {/* Track 1: Neon GP */}
            <div className="bg-slate-900/40 border border-slate-850 hover:border-emerald-500/30 backdrop-blur-md rounded-3xl p-5 flex flex-col justify-between transition-all group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 transform group-hover:scale-110 group-hover:rotate-12 transition-transform duration-500">
                <Car className="w-24 h-24 text-emerald-500" />
              </div>
              <div className="relative z-10">
                <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-black uppercase text-emerald-400 rounded-md">Track 01</span>
                <h3 className="text-xl font-black text-white mt-2 mb-1">Neon Grand Prix</h3>
                <p className="text-xs text-slate-400 mb-4">8 Waypoints • Green Spark Drifts • 3 Laps</p>
                
                <div className="space-y-2 mb-6 font-mono text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-slate-850/60">
                    <span className="text-slate-500">Beste Gesamtzeit:</span>
                    <span className="text-emerald-400 font-bold">{pbNeon ? formatMs(pbNeon) : "--:--"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-slate-850/60">
                    <span className="text-slate-500">Beste Rundenzeit:</span>
                    <span className="text-emerald-400 font-bold">{pbNeonLap ? formatMs(pbNeonLap) : "--:--"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-slate-500">Streckenrekord:</span>
                    <span className="text-slate-300 font-bold truncate max-w-[120px]">
                      {trNeon ? `${formatMs(trNeon.player1Time)} (${usersMap[trNeon.player1Id] || trNeon.player1Name || "Racer"})` : "--:--"}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => startSoloRun("neon-gp")}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black rounded-2xl shadow-lg shadow-emerald-500/10 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                RENNEN STARTEN
              </button>
            </div>

            {/* Track 2: Drift Canyon */}
            <div className="bg-slate-900/40 border border-slate-850 hover:border-emerald-500/30 backdrop-blur-md rounded-3xl p-5 flex flex-col justify-between transition-all group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 transform group-hover:scale-110 group-hover:rotate-12 transition-transform duration-500">
                <Car className="w-24 h-24 text-emerald-500" />
              </div>
              <div className="relative z-10">
                <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-black uppercase text-emerald-400 rounded-md">Track 02</span>
                <h3 className="text-xl font-black text-white mt-2 mb-1">Drift Canyon</h3>
                <p className="text-xs text-slate-400 mb-4">11 Waypoints • Hairpin Curves • 3 Laps</p>
                
                <div className="space-y-2 mb-6 font-mono text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-slate-850/60">
                    <span className="text-slate-500">Beste Gesamtzeit:</span>
                    <span className="text-emerald-400 font-bold">{pbCanyon ? formatMs(pbCanyon) : "--:--"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-slate-850/60">
                    <span className="text-slate-500">Beste Rundenzeit:</span>
                    <span className="text-emerald-400 font-bold">{pbCanyonLap ? formatMs(pbCanyonLap) : "--:--"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-slate-500">Streckenrekord:</span>
                    <span className="text-slate-300 font-bold truncate max-w-[120px]">
                      {trCanyon ? `${formatMs(trCanyon.player1Time)} (${usersMap[trCanyon.player1Id] || trCanyon.player1Name || "Racer"})` : "--:--"}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => startSoloRun("drift-canyon")}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black rounded-2xl shadow-lg shadow-emerald-500/10 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                RENNEN STARTEN
              </button>
            </div>
          </div>

          {/* User Run History (in Left Column) */}
          <div className="bg-slate-900/40 border border-slate-900 backdrop-blur-md rounded-3xl p-5 flex flex-col min-h-0 flex-1">
            <h3 className="text-md font-bold text-white mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" /> Deine letzten Läufe
            </h3>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-800">
              {myHistory.length === 0 ? (
                <div className="h-full min-h-[140px] flex flex-col items-center justify-center border border-dashed border-slate-850 rounded-2xl text-slate-500 p-4">
                  <Car className="w-6 h-6 mb-2 opacity-30 text-emerald-400" />
                  <p className="text-xs font-semibold">Bisher keine Rundenzeiten aufgezeichnet.</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">Wähle eine Strecke und starte deinen ersten Lauf!</p>
                </div>
              ) : (
                myHistory.map(run => (
                  <div
                    key={run.id}
                    className="border border-slate-950/40 bg-slate-950/20 hover:border-slate-800/80 p-3 rounded-xl flex items-center justify-between transition-all"
                  >
                    <div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 uppercase font-black tracking-wider">
                        {run.trackId === "neon-gp" ? "Neon GP" : "Drift Canyon"}
                      </span>
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <Timer className="w-3 h-3 text-slate-600" /> {formatDate(run.createdAt)}
                      </div>
                    </div>
                    <div className="text-right font-mono text-sm font-black text-emerald-400">
                      {formatMs(run.player1Time)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right column - Global Leaderboard (5 cols) */}
        <div className="lg:col-span-5 flex flex-col min-h-0 bg-slate-900/40 border border-slate-900 backdrop-blur-md rounded-3xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-md font-bold text-white flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500 animate-pulse" /> Rangliste
            </h3>
            
            {/* Track Toggle for Leaderboard */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-850">
              <button
                onClick={() => setSelectedTrack("neon-gp")}
                className={`px-3 py-1 text-[10px] font-black uppercase rounded-lg transition-all ${selectedTrack === "neon-gp" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
              >
                Neon GP
              </button>
              <button
                onClick={() => setSelectedTrack("drift-canyon")}
                className={`px-3 py-1 text-[10px] font-black uppercase rounded-lg transition-all ${selectedTrack === "drift-canyon" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
              >
                Canyon
              </button>
            </div>
          </div>

          {/* Leaderboard Mode Toggle (Gesamtzeit vs. Beste Rundenzeit) */}
          <div className="grid grid-cols-2 bg-slate-950 p-1 rounded-xl border border-slate-850 mb-4 shrink-0 font-sans">
            <button
              onClick={() => setLeaderboardMode("total")}
              className={`py-2 text-[10px] md:text-[11px] font-black uppercase rounded-lg transition-all flex items-center justify-center gap-1.5 ${leaderboardMode === "total" ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400" : "text-slate-400 hover:text-white border border-transparent"}`}
            >
              🏁 Gesamtzeit (3 Rnd)
            </button>
            <button
              onClick={() => setLeaderboardMode("lap")}
              className={`py-2 text-[10px] md:text-[11px] font-black uppercase rounded-lg transition-all flex items-center justify-center gap-1.5 ${leaderboardMode === "lap" ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400" : "text-slate-400 hover:text-white border border-transparent"}`}
            >
              ⚡ Beste Rundenzeit
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-800">
            {currentLeaderboard.length === 0 ? (
              <div className="h-full min-h-[250px] flex flex-col items-center justify-center text-slate-600 text-xs">
                <Trophy className="w-8 h-8 mb-2 opacity-15" />
                Keine Zeiten für diese Strecke geladen.
              </div>
            ) : (
              currentLeaderboard.map((entry, index) => {
                const style = getRankStyle(index);
                const isMe = entry.player1Id === user?.uid;

                return (
                  <div
                    key={entry.player1Id}
                    className={`flex items-center justify-between p-3 rounded-xl transition-all ${style.root} ${isMe ? "bg-emerald-500/5 border-emerald-500/30" : ""}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-5 text-center text-xs ${style.num}`}>
                        #{index + 1}
                      </span>
                      
                      <div className={`w-7 h-7 rounded-lg ${style.avatar} flex items-center justify-center font-black text-[10px] uppercase shrink-0`}>
                        {entry.player1Name.substring(0, 2)}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-bold truncate ${isMe ? "text-emerald-400" : "text-white"}`}>
                            {entry.player1Name}
                          </span>
                          {isMe && (
                            <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1 py-0.5 rounded font-black uppercase">
                              Ich
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] text-slate-600 font-medium">
                          Am {formatDate(entry.date)}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono text-xs font-extrabold text-white">
                      {formatMs(entry.time)}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* User's own Rank card at the bottom */}
          {user && (
            (() => {
              const myRankIndex = currentLeaderboard.findIndex(e => e.player1Id === user.uid);
              const myPB = leaderboardMode === "total"
                ? getPersonalBest(selectedTrack)
                : getPersonalBestLap(selectedTrack);

              return (
                <div className="mt-4 pt-4 border-t border-slate-900/60 flex items-center justify-between bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Dein Rang:</span>
                    <span className="text-md font-black text-white">
                      {myRankIndex !== -1 ? `#${myRankIndex + 1}` : "--"}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] text-slate-500 block">
                      {leaderboardMode === "total" ? "Deine Bestzeit (3 Rnd):" : "Deine beste Rundenzeit:"}
                    </span>
                    <span className="text-xs font-mono font-black text-emerald-400">
                      {myPB ? formatMs(myPB) : "--:--"}
                    </span>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </main>
    </div>
  );
}
