import QuickChat from "../components/QuickChat";
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, onSnapshot, getDoc, updateDoc, serverTimestamp, runTransaction, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { ThemeToggle } from "../components/ThemeToggle";
import { cn } from "../lib/utils";
import { ArrowLeft } from "lucide-react";

interface GameData {
  player1Id: string;
  player2Id: string | null;
  board: string[];
  turn: "blue" | "red";
  status: "waiting" | "playing" | "finished";
  winner: "blue" | "red" | "draw" | null;
  lastChat?: {
    senderId: string;
    text: string;
    sentAt: number;
  };
}

interface UserData {
  uid: string;
  displayName: string;
  dots_rating?: number;
}

const calculateEloDelta = (myRating: number, oppRating: number, outcome: 1 | 0.5 | 0) => {
  const expected = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(32 * (outcome - expected));
};
function getBestMoveDots(board: string[], botSymbol: string): number {
  const allLines = [];
  for (let i = 0; i < 40; i++) {
    if (board[i] === "") {
      allLines.push(i);
    }
  }

  if (allLines.length === 0) return -1;

  // 1. Check for immediate box completion (box has exactly 3 lines filled)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const boxIndex = 40 + r * 4 + c;
      if (board[boxIndex] !== "") continue;

      const lines = [
        r * 4 + c,
        (r + 1) * 4 + c,
        20 + r * 5 + c,
        20 + r * 5 + c + 1
      ];

      const emptyLines = lines.filter(idx => board[idx] === "");
      if (emptyLines.length === 1) {
        return emptyLines[0];
      }
    }
  }

  // Helper to simulate greedy chain claiming by the opponent
  const countChainReclaimableBoxes = (boardState: string[], nextPlayerSymbol: string): number => {
    let tempBoard = [...boardState];
    let claimedCount = 0;
    let keepGoing = true;

    while (keepGoing) {
      keepGoing = false;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const boxIdx = 40 + r * 4 + c;
          if (tempBoard[boxIdx] !== "") continue;

          const lines = [
            r * 4 + c,
            (r + 1) * 4 + c,
            20 + r * 5 + c,
            20 + r * 5 + c + 1
          ];

          const emptyLines = lines.filter(idx => tempBoard[idx] === "");
          if (emptyLines.length === 1) {
            tempBoard[boxIdx] = nextPlayerSymbol;
            tempBoard[emptyLines[0]] = nextPlayerSymbol;
            claimedCount++;
            keepGoing = true;
            break;
          }
        }
        if (keepGoing) break;
      }
    }
    return claimedCount;
  };

  // 2. Classify lines as safe or unsafe
  const safeLines = [];
  const unsafeLines = [];

  const playerSymbol = botSymbol === "blue" ? "red" : "blue";

  for (const lineIdx of allLines) {
    const tempBoard = [...board];
    tempBoard[lineIdx] = botSymbol;

    let createsThreeFilledBox = false;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const boxIndex = 40 + r * 4 + c;
        if (tempBoard[boxIndex] !== "") continue;

        const lines = [
          r * 4 + c,
          (r + 1) * 4 + c,
          20 + r * 5 + c,
          20 + r * 5 + c + 1
        ];

        const emptyCount = lines.filter(idx => tempBoard[idx] === "").length;
        if (emptyCount === 1) {
          createsThreeFilledBox = true;
          break;
        }
      }
      if (createsThreeFilledBox) break;
    }

    if (createsThreeFilledBox) {
      // Unsafe line: calculate how many boxes this opens up for the opponent in a chain
      const penalty = countChainReclaimableBoxes(tempBoard, playerSymbol);
      unsafeLines.push({ lineIdx, penalty });
    } else {
      safeLines.push(lineIdx);
    }
  }

  // 3. Selection based on safety & minimum penalty
  if (safeLines.length > 0) {
    return safeLines[Math.floor(Math.random() * safeLines.length)];
  }

  // No safe lines left: select the unsafe line with the absolute MINIMUM penalty (least boxes given away)
  let minPenalty = Infinity;
  let bestUnsafeLines = [];

  for (const item of unsafeLines) {
    if (item.penalty < minPenalty) {
      minPenalty = item.penalty;
      bestUnsafeLines = [item.lineIdx];
    } else if (item.penalty === minPenalty) {
      bestUnsafeLines.push(item.lineIdx);
    }
  }

  if (bestUnsafeLines.length > 0) {
    return bestUnsafeLines[Math.floor(Math.random() * bestUnsafeLines.length)];
  }

  return allLines[Math.floor(Math.random() * allLines.length)];
}


export default function DotsGame() {
  const { gameId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [game, setGame] = useState<GameData | null>(null);
  const [opponent, setOpponent] = useState<UserData | null>(null);
  const [player1Data, setPlayer1Data] = useState<UserData | null>(null);
  const [statsUpdated, setStatsUpdated] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!gameId) return;

    const gameRef = doc(db, "games_dots", gameId);
    const unsubscribe = onSnapshot(gameRef, async (snapshot) => {
      if (snapshot.exists()) {
        const gameData = snapshot.data() as GameData;
        setGame(gameData);
        
        // Fetch Player 1 (Creator) data
        const p1Id = gameData.player1Id;
        const p1Ref = doc(db, "users", p1Id);
        getDoc(p1Ref).then(p1Snap => {
          if (p1Snap.exists()) {
            setPlayer1Data(p1Snap.data() as UserData);
          }
        });

        if (gameData.player2Id && user) {
          const oppId = gameData.player1Id === user.uid ? gameData.player2Id : gameData.player1Id;
          if (oppId.startsWith("bot_dots")) {
            const oppRef = doc(db, "users", oppId);
            getDoc(oppRef).then(oppSnap => {
              if (oppSnap.exists()) {
                setOpponent(oppSnap.data() as UserData);
              } else {
                let defaultName = "🤖 Robo-Bot (Schwer)";
                let defaultRating = 1200;
                if (oppId === "bot_dots_easy") {
                  defaultName = "🤖 Easy-Bot (Einfach)";
                  defaultRating = 800;
                } else if (oppId === "bot_dots_medium") {
                  defaultName = "🤖 Medi-Bot (Mittel)";
                  defaultRating = 1000;
                }
                setOpponent({
                  uid: oppId,
                  displayName: defaultName,
                  dots_rating: defaultRating
                });
              }
            });
          } else {
            const oppRef = doc(db, "users", oppId);
            getDoc(oppRef).then(oppSnap => {
              if (oppSnap.exists()) {
                setOpponent(oppSnap.data() as UserData);
              }
            });
          }
        }
      } else {
        navigate("/dots");
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, "games_dots"));

    return () => unsubscribe();
  }, [gameId, user, navigate]);

  // Perfectly playing Dots bot loop
  useEffect(() => {
    if (game && game.status === "playing" && game.player2Id && game.player2Id.startsWith("bot_dots") && game.turn === "red") {
      const timer = setTimeout(async () => {
        let bestMove = -1;
        const randomChance = Math.random();
        let shouldPlayRandom = false;
        
        if (game.player2Id === "bot_dots_easy") {
          shouldPlayRandom = randomChance < 0.70;
        } else if (game.player2Id === "bot_dots_medium") {
          shouldPlayRandom = randomChance < 0.35;
        }
        
        if (shouldPlayRandom) {
          const validLines = [];
          for (let i = 0; i < 40; i++) {
            if (game.board[i] === "") {
              validLines.push(i);
            }
          }
          if (validLines.length > 0) {
            bestMove = validLines[Math.floor(Math.random() * validLines.length)];
          }
        } else {
          bestMove = getBestMoveDots(game.board, "red");
        }
        
        if (bestMove !== -1) {
          const newBoard = [...game.board];
          newBoard[bestMove] = "red";
          
          let completedABox = false;
          
          for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
              const boxIndex = 40 + r * 4 + c;
              if (newBoard[boxIndex] === "") {
                const top = r * 4 + c;
                const bottom = (r + 1) * 4 + c;
                const left = 20 + r * 5 + c;
                const right = 20 + r * 5 + c + 1;
                
                if (newBoard[top] !== "" && newBoard[bottom] !== "" && newBoard[left] !== "" && newBoard[right] !== "") {
                  newBoard[boxIndex] = "red";
                  completedABox = true;
                }
              }
            }
          }
          
          const updateData = {
            board: newBoard,
            updatedAt: serverTimestamp(),
            turn: completedABox ? "red" : "blue",
            status: "playing",
            winner: null
          };
          
          let boxesBlue = 0;
          let boxesRed = 0;
          let emptyBoxes = 0;
          for (let i = 40; i < 56; i++) {
            if (newBoard[i] === "blue") boxesBlue++;
            else if (newBoard[i] === "red") boxesRed++;
            else emptyBoxes++;
          }
          
          if (emptyBoxes === 0) {
            updateData.status = "finished";
            if (boxesBlue > boxesRed) updateData.winner = "blue";
            else if (boxesRed > boxesBlue) updateData.winner = "red";
            else updateData.winner = "draw";
          }
          
          try {
            await updateDoc(doc(db, "games_dots", gameId!), updateData);
          } catch (error) {
            console.error("Error committing bot move:", error);
          }
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [game?.turn, game?.status, game?.board, game?.player2Id, gameId]);


  useEffect(() => {
    if (game?.status === "finished" && !statsUpdated && user && opponent) {
      setStatsUpdated(true);
      
      if (sessionStorage.getItem(`dots_processed_${gameId}`)) {
        return;
      }
      sessionStorage.setItem(`dots_processed_${gameId}`, "true");

      const updateStats = async () => {
        try {
          const mySymbol = game.player1Id === user.uid ? "blue" : "red";
          let outcome: 1 | 0.5 | 0 = 0.5;
          if (game.winner === mySymbol) outcome = 1;
          else if (game.winner && game.winner !== "draw") outcome = 0;

          const userRef = doc(db, "users", user.uid);
          
          if (opponent.uid.startsWith("bot_dots")) {
            const botRef = doc(db, "users", opponent.uid);
            await runTransaction(db, async (t) => {
              const userSnap = await t.get(userRef);
              const botSnap = await t.get(botRef);
              if (!userSnap.exists()) return;
              
              const userData = userSnap.data();
              const botData = botSnap.exists() ? botSnap.data() : {
                uid: opponent.uid,
                displayName: opponent.displayName || "🤖 Robo-Bot",
                rating: 1000,
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                dots_rating: opponent.dots_rating || 1000,
                dots_gamesPlayed: 0,
                dots_wins: 0,
                dots_losses: 0,
                dots_draws: 0
              };
              
              const myEloDelta = calculateEloDelta(userData.dots_rating || 1000, botData.dots_rating || 1000, outcome);
              const botEloDelta = calculateEloDelta(botData.dots_rating || 1000, userData.dots_rating || 1000, (1 - outcome) as 0 | 1 | 0.5);
              
              t.update(userRef, {
                dots_rating: (userData.dots_rating || 1000) + myEloDelta,
                dots_gamesPlayed: (userData.dots_gamesPlayed || 0) + 1,
                dots_wins: (userData.dots_wins || 0) + (outcome === 1 ? 1 : 0),
                dots_losses: (userData.dots_losses || 0) + (outcome === 0 ? 1 : 0),
                dots_draws: (userData.dots_draws || 0) + (outcome === 0.5 ? 1 : 0)
              });
              
              t.set(botRef, {
                uid: opponent.uid,
                displayName: botData.displayName || opponent.displayName || "🤖 Robo-Bot",
                dots_rating: (botData.dots_rating || 1000) + botEloDelta,
                dots_gamesPlayed: (botData.dots_gamesPlayed || 0) + 1,
                dots_wins: (botData.dots_wins || 0) + ((1 - outcome) === 1 ? 1 : 0),
                dots_losses: (botData.dots_losses || 0) + ((1 - outcome) === 0 ? 1 : 0),
                dots_draws: (botData.dots_draws || 0) + ((1 - outcome) === 0.5 ? 1 : 0)
              }, { merge: true });
            });
          } else {
            await runTransaction(db, async (t) => {
              const userSnap = await t.get(userRef);
              if (!userSnap.exists()) return;
              const userData = userSnap.data();
              const eloDelta = calculateEloDelta(userData.dots_rating || 1000, opponent.dots_rating || 1000, outcome);
              
              t.update(userRef, {
                dots_rating: (userData.dots_rating || 1000) + eloDelta,
                dots_gamesPlayed: (userData.dots_gamesPlayed || 0) + 1,
                dots_wins: (userData.dots_wins || 0) + (outcome === 1 ? 1 : 0),
                dots_losses: (userData.dots_losses || 0) + (outcome === 0 ? 1 : 0),
                dots_draws: (userData.dots_draws || 0) + (outcome === 0.5 ? 1 : 0)
              });
            });
          }
        } catch (error) {
          console.error("Error updating stats", error);
        }
      };
      
      setTimeout(() => updateStats(), 500);
    }
  }, [game?.status, game?.winner, statsUpdated, user, opponent, game?.player1Id, gameId]);

  if (!game || !user) {
    return <div className="h-full flex items-center justify-center">Loading...</div>;
  }

  const mySymbol = game.player1Id === user.uid ? "blue" : "red";
  const isMyTurn = game.turn === mySymbol;

  const handleCellClick = async (lineIndex: number) => {
    if (game.status !== "playing" || !isMyTurn) return;
    if (game.board[lineIndex] !== "") return;

    try {
      const newBoard = [...game.board];
      newBoard[lineIndex] = mySymbol;
      
      let completedABox = false;
      
      // Check for completed boxes
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const boxIndex = 40 + r * 4 + c;
          if (newBoard[boxIndex] === "") {
            const top = r * 4 + c;
            const bottom = (r + 1) * 4 + c;
            const left = 20 + r * 5 + c;
            const right = 20 + r * 5 + c + 1;
            
            if (newBoard[top] !== "" && newBoard[bottom] !== "" && newBoard[left] !== "" && newBoard[right] !== "") {
              newBoard[boxIndex] = mySymbol;
              completedABox = true;
            }
          }
        }
      }

      const updateData: Partial<GameData> & { updatedAt: any } = {
        board: newBoard,
        updatedAt: serverTimestamp()
      };

      // If a box was completed, player gets another turn. Otherwise, switch turns.
      if (!completedABox) {
        updateData.turn = mySymbol === "blue" ? "red" : "blue";
      } else {
        updateData.turn = mySymbol; // Explicit, though not strictly needed
      }

      // Check if game is finished (all 16 boxes filled)
      let boxesBlue = 0;
      let boxesRed = 0;
      let emptyBoxes = 0;
      for (let i = 40; i < 56; i++) {
        if (newBoard[i] === "blue") boxesBlue++;
        else if (newBoard[i] === "red") boxesRed++;
        else emptyBoxes++;
      }

      if (emptyBoxes === 0) {
        updateData.status = "finished";
        if (boxesBlue > boxesRed) updateData.winner = "blue";
        else if (boxesRed > boxesBlue) updateData.winner = "red";
        else updateData.winner = "draw";
      }

      await updateDoc(doc(db, "games_dots", gameId!), updateData);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "games_dots");
    }
  };

  // Render variables
  const dotsGridSize = 5;
  const cellSize = windowWidth < 400 ? 50 : 60; // px
  const containerSize = (dotsGridSize - 1) * cellSize;
  const dotRadius = 8;
  const lineThickness = 16;

  // Calculate scores from board
  let myScore = 0;
  let oppScore = 0;
  let p1Score = 0;
  let p2Score = 0;
  for (let i = 40; i < 56; i++) {
    if (game.board[i] === mySymbol) myScore++;
    else if (game.board[i] !== "") oppScore++;

    if (game.board[i] === "blue") p1Score++;
    else if (game.board[i] === "red") p2Score++;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <nav className="shrink-0 h-16 border-b border-slate-200 dark:border-slate-800 px-4 md:px-8 flex items-center justify-between bg-white/80 dark:bg-slate-900/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate("/")}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 hover:text-slate-950 dark:hover:text-white transition-colors"
            title="Zum Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-xl text-slate-900 dark:text-white">#</div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white cursor-pointer" onClick={() => navigate("/")}>
            DOTS<span className="text-indigo-500">ELITE</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800/50 py-1 pl-3 pr-1 rounded-full border border-slate-300 dark:border-slate-700">
            <span className="text-sm font-medium truncate max-w-[80px] sm:max-w-[150px]">{user.displayName}</span>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 border border-slate-400 dark:border-slate-600 flex items-center justify-center text-xs font-bold uppercase shrink-0 text-slate-900 dark:text-white">
              {user.displayName?.substring(0, 2) || "U"}
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-0 overflow-y-auto">
        <section className="col-span-1 md:col-span-12 lg:col-span-8 lg:col-start-3 bg-slate-50 dark:bg-slate-950 flex flex-col items-center p-4 sm:p-8 min-h-min">
          {game.status === "waiting" ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div className="w-12 h-12 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-indigo-500 animate-spin mb-6"></div>
              <h2 className="text-2xl font-bold mb-2">Suche Gegner...</h2>
              <p className="text-slate-500 dark:text-slate-400 mb-8">Warte auf einen weiteren Spieler.</p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={() => navigate("/dots")}
                  className="px-6 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white rounded-xl font-bold transition-colors"
                >
                  Zurück zur Lobby
                </button>
                {game.player1Id === user.uid && (
                  <button
                    disabled={isDeleting}
                    onClick={async () => {
                      if (isDeleting) return;
                      setIsDeleting(true);
                      try {
                        if(gameId) {
                          await deleteDoc(doc(db, "games_dots", gameId));
                        }
                        navigate("/dots");
                      } catch (error: any) {
                        if (error.code !== 'permission-denied' && error.code !== 'not-found') {
                           handleFirestoreError(error, OperationType.DELETE, "games_dots");
                        }
                      } finally {
                        setIsDeleting(false);
                      }
                    }}
                    className="px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold transition-colors shadow-lg shadow-rose-900/20 disabled:opacity-50"
                  >
                    Suche abbrechen
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="w-full flex flex-col items-center pb-8">
              {/* Die Spieler ELO Bar */}
              <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-lg mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden shrink-0">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/[0.02] via-transparent to-rose-500/[0.02] pointer-events-none"></div>
                
                {/* Player 1 (Creator - Blau) */}
                <div className={cn(
                  "flex items-center gap-3 p-2.5 rounded-2xl border transition-all duration-200 w-full sm:w-auto sm:flex-1",
                  game.turn === "blue" && game.status === "playing"
                    ? "bg-blue-500/5 border-blue-500/40 shadow-md shadow-blue-500/5 scale-[1.02]"
                    : "bg-slate-50/50 dark:bg-slate-800/30 border-transparent"
                )}>
                  <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center font-bold text-white shrink-0 text-sm shadow-md shadow-blue-500/20">
                    🔵
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                      {player1Data?.displayName || "Suche..."}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold font-mono uppercase tracking-widest mt-0.5">
                      {player1Data?.dots_rating || 1000} ELO
                    </p>
                  </div>
                  {game.status !== "waiting" && (
                    <div className="text-lg font-black text-blue-500 font-mono px-2">
                      {p1Score}
                    </div>
                  )}
                </div>

                {/* VS Badge */}
                <div className="text-xs font-black uppercase text-slate-400 tracking-wider shrink-0 px-2">
                  vs
                </div>

                {/* Player 2 (Opponent - Rot) */}
                <div className={cn(
                  "flex items-center gap-3 p-2.5 rounded-2xl border transition-all duration-200 w-full sm:w-auto sm:flex-1",
                  game.turn === "red" && game.status === "playing"
                    ? "bg-rose-500/5 border-rose-500/40 shadow-md shadow-rose-500/5 scale-[1.02]"
                    : "bg-slate-50/50 dark:bg-slate-800/30 border-transparent"
                )}>
                  {game.status !== "waiting" && (
                    <div className="text-lg font-black text-rose-500 font-mono px-2">
                      {p2Score}
                    </div>
                  )}
                  <div className="w-9 h-9 rounded-full bg-rose-500 flex items-center justify-center font-bold text-white shrink-0 text-sm shadow-md shadow-rose-500/20">
                    🔴
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                      {opponent?.displayName || "Suche..."}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold font-mono uppercase tracking-widest mt-0.5">
                      {opponent?.dots_rating || 1000} ELO
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Game Board */}
              <div className="bg-white dark:bg-slate-900 p-4 sm:p-12 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 mb-8 overflow-visible flex items-center justify-center">
                <div 
                  className={cn("relative transition-opacity duration-300 mx-auto", game.status === "finished" ? "opacity-75" : "")}
                  style={{ width: containerSize, height: containerSize }}
                >
                  {/* Boxes */}
                  {[...Array(16)].map((_, i) => {
                    const r = Math.floor(i / 4);
                    const c = i % 4;
                    const owner = game.board[40 + i];
                    return (
                      <div
                        key={`box-${i}`}
                        className={cn(
                          "absolute transition-all duration-300 ease-out transform",
                          owner === "blue" ? "bg-blue-500/20 dark:bg-blue-500/30 scale-100" : 
                          owner === "red" ? "bg-rose-500/20 dark:bg-rose-500/30 scale-100" : "scale-0 opacity-0"
                        )}
                        style={{
                          top: r * cellSize,
                          left: c * cellSize,
                          width: cellSize,
                          height: cellSize,
                        }}
                      >
                         {/* Optional icon or color fill inside box */}
                         {owner === "blue" && <div className="absolute inset-0 m-auto w-1/2 h-1/2 bg-blue-500 rounded-sm shadow-lg rotate-45 opacity-50"></div>}
                         {owner === "red" && <div className="absolute inset-0 m-auto w-1/2 h-1/2 bg-rose-500 rounded-full shadow-lg opacity-50"></div>}
                      </div>
                    );
                  })}

                  {/* Horizontal Lines */}
                  {[...Array(20)].map((_, i) => {
                    const r = Math.floor(i / 4);
                    const c = i % 4;
                    const val = game.board[i];
                    return (
                      <div
                        key={`hline-${i}`}
                        onClick={() => handleCellClick(i)}
                        className={cn(
                          "absolute rounded-full transition-all duration-200 z-10 cursor-pointer",
                          val === "" && isMyTurn && game.status === "playing" ? "hover:bg-slate-300 dark:hover:bg-slate-700 hover:scale-110 shadow-sm" : "",
                          val === "" && (!isMyTurn || game.status !== "playing") ? "bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800" : "",
                          val === "blue" ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] cursor-default" : "",
                          val === "red" ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)] cursor-default" : ""
                        )}
                        style={{
                          top: r * cellSize - lineThickness / 2,
                          left: c * cellSize + dotRadius,
                          width: cellSize - dotRadius * 2,
                          height: lineThickness,
                        }}
                      />
                    );
                  })}

                  {/* Vertical Lines */}
                  {[...Array(20)].map((_, i) => {
                    const r = Math.floor(i / 5);
                    const c = i % 5;
                    const idx = i + 20;
                    const val = game.board[idx];
                    return (
                      <div
                        key={`vline-${i}`}
                        onClick={() => handleCellClick(idx)}
                        className={cn(
                          "absolute rounded-full transition-all duration-200 z-10 cursor-pointer",
                          val === "" && isMyTurn && game.status === "playing" ? "hover:bg-slate-300 dark:hover:bg-slate-700 hover:scale-110 shadow-sm" : "",
                          val === "" && (!isMyTurn || game.status !== "playing") ? "bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800" : "",
                          val === "blue" ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] cursor-default" : "",
                          val === "red" ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)] cursor-default" : ""
                        )}
                        style={{
                          top: r * cellSize + dotRadius,
                          left: c * cellSize - lineThickness / 2,
                          width: lineThickness,
                          height: cellSize - dotRadius * 2,
                        }}
                      />
                    );
                  })}

                  {/* Dots (Rendered last so they are on top) */}
                  {[...Array(25)].map((_, i) => {
                    const r = Math.floor(i / 5);
                    const c = i % 5;
                    return (
                      <div
                        key={`dot-${i}`}
                        className="absolute bg-slate-400 dark:bg-slate-500 rounded-full z-20 shadow-md"
                        style={{
                          top: r * cellSize - dotRadius,
                          left: c * cellSize - dotRadius,
                          width: dotRadius * 2,
                          height: dotRadius * 2,
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-center relative min-h-[100px] w-full">
                {game.status === "playing" ? (
                  <div className="flex flex-col items-center">
                    <span className="text-xs uppercase text-slate-500 font-bold mb-3">Aktueller Zug</span>
                    {isMyTurn ? (
                      <>
                        <div className={cn("w-4 h-4 rounded-full animate-pulse mb-2 shadow-[0_0_15px_rgba(255,255,255,0.4)]", mySymbol === 'blue' ? "bg-blue-500" : "bg-rose-500")}></div>
                        <span className="text-sm font-bold text-slate-900 dark:text-white">Du bist dran</span>
                      </>
                    ) : (
                      <>
                        <div className="w-3 h-3 rounded-full bg-slate-200 dark:bg-slate-800 mb-2"></div>
                        <span className="text-sm font-bold text-slate-500">Gegner ist dran</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center animate-in zoom-in-95 duration-500">
                    <div className="text-3xl font-bold text-slate-900 dark:text-white mb-6 text-center">
                      {game.winner === "draw" ? (
                        <span className="text-slate-600 dark:text-slate-300">Unentschieden!</span>
                      ) : game.winner === mySymbol ? (
                        <span className="text-green-500 drop-shadow-[0_0_10px_rgba(34,197,94,0.4)]">Du hast gewonnen!</span>
                      ) : (
                        <span className="text-rose-500 drop-shadow-[0_0_10px_rgba(244,63,94,0.4)]">Du hast verloren!</span>
                      )}
                    </div>
                    <button
                      onClick={() => navigate("/dots")}
                      className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-slate-900 dark:text-white rounded-xl font-bold transition-colors shadow-lg shadow-indigo-900/40"
                    >
                      Zurück zur Lobby
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>

            {game.status === "playing" && (
        <QuickChat
          gameId={gameId!}
          collectionName="games_dots"
          currentUserId={user.uid}
          player1Id={game.player1Id}
          player1Name={user.uid === game.player1Id ? (user.displayName || "Du") : (opponent?.displayName || "Gegner")}
          player2Name={user.uid === game.player1Id ? (opponent?.displayName || "Gegner") : (user.displayName || "Du")}
          lastChat={game.lastChat}
        />
      )}


      <footer className="shrink-0 h-8 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-6 sm:flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500 font-bold hidden">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Online</span>
          <span>Server: EU-West</span>
        </div>
        <div>© {new Date().getFullYear()} DOTS ELITE SYSTEM</div>
      </footer>
    </div>
  );
}
