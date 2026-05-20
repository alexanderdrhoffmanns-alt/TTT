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
  turn: "red" | "yellow";
  status: "waiting" | "playing" | "finished";
  winner: "red" | "yellow" | "draw" | null;
  lastChat?: {
    senderId: string;
    text: string;
    sentAt: number;
  };
}

interface UserData {
  uid: string;
  displayName: string;
  connect4_rating?: number;
}

const checkWinnerConnect4 = (board: string[]): "red" | "yellow" | "draw" | null => {
  const ROWS = 6;
  const COLS = 7;
  
  const get = (r: number, c: number) => board[r * COLS + c];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = get(r, c);
      if (!p) continue;

      // Horizontal
      if (c + 3 < COLS && p === get(r, c+1) && p === get(r, c+2) && p === get(r, c+3)) return p as any;
      // Vertical
      if (r + 3 < ROWS && p === get(r+1, c) && p === get(r+2, c) && p === get(r+3, c)) return p as any;
      // Diagonal Right
      if (r + 3 < ROWS && c + 3 < COLS && p === get(r+1, c+1) && p === get(r+2, c+2) && p === get(r+3, c+3)) return p as any;
      // Diagonal Left
      if (r + 3 < ROWS && c - 3 >= 0 && p === get(r+1, c-1) && p === get(r+2, c-2) && p === get(r+3, c-3)) return p as any;
    }
  }

  if (!board.includes("")) return "draw";
  return null;
};
function getBestMoveConnect4(board: string[], botSymbol: string): number {
  const playerSymbol = botSymbol === "red" ? "yellow" : "red";
  const ROWS = 6;
  const COLS = 7;

  function getValidMoves(tempBoard: string[]): number[] {
    const moves: number[] = [];
    for (let c = 0; c < COLS; c++) {
      if (tempBoard[c] === "") {
        moves.push(c);
      }
    }
    return moves;
  }

  function makeMove(tempBoard: string[], col: number, symbol: string): number {
    for (let r = ROWS - 1; r >= 0; r--) {
      const idx = r * COLS + col;
      if (tempBoard[idx] === "") {
        tempBoard[idx] = symbol;
        return idx;
      }
    }
    return -1;
  }

  function evaluateWindow(window: string[]): number {
    let score = 0;
    const botCount = window.filter(x => x === botSymbol).length;
    const playerCount = window.filter(x => x === playerSymbol).length;
    const emptyCount = window.filter(x => x === "").length;

    if (botCount === 4) {
      score += 1000;
    } else if (botCount === 3 && emptyCount === 1) {
      score += 50;
    } else if (botCount === 2 && emptyCount === 2) {
      score += 10;
    }

    if (playerCount === 3 && emptyCount === 1) {
      score -= 80;
    } else if (playerCount === 2 && emptyCount === 2) {
      score -= 15;
    }

    return score;
  }

  function scoreBoard(tempBoard: string[]): number {
    let score = 0;
    const centerCol = 3;
    for (let r = 0; r < ROWS; r++) {
      if (tempBoard[r * COLS + centerCol] === botSymbol) score += 4;
      else if (tempBoard[r * COLS + centerCol] === playerSymbol) score -= 4;
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS - 3; c++) {
        const window = [
          tempBoard[r * COLS + c],
          tempBoard[r * COLS + c + 1],
          tempBoard[r * COLS + c + 2],
          tempBoard[r * COLS + c + 3]
        ];
        score += evaluateWindow(window);
      }
    }

    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS - 3; r++) {
        const window = [
          tempBoard[r * COLS + c],
          tempBoard[(r + 1) * COLS + c],
          tempBoard[(r + 2) * COLS + c],
          tempBoard[(r + 3) * COLS + c]
        ];
        score += evaluateWindow(window);
      }
    }

    for (let r = 0; r < ROWS - 3; r++) {
      for (let c = 0; c < COLS - 3; c++) {
        const window = [
          tempBoard[r * COLS + c],
          tempBoard[(r + 1) * COLS + c + 1],
          tempBoard[(r + 2) * COLS + c + 2],
          tempBoard[(r + 3) * COLS + c + 3]
        ];
        score += evaluateWindow(window);
      }
    }

    for (let r = 0; r < ROWS - 3; r++) {
      for (let c = 3; c < COLS; c++) {
        const window = [
          tempBoard[r * COLS + c],
          tempBoard[(r + 1) * COLS + c - 1],
          tempBoard[(r + 2) * COLS + c - 2],
          tempBoard[(r + 3) * COLS + c - 3]
        ];
        score += evaluateWindow(window);
      }
    }

    return score;
  }

  function minimax(tempBoard: string[], depth: number, alpha: number, beta: number, isMax: boolean): number {
    const outcome = checkWinnerConnect4(tempBoard);
    if (outcome === botSymbol) return 100000 - depth;
    if (outcome === playerSymbol) return -100000 + depth;
    if (outcome === "draw") return 0;
    if (depth >= 5) {
      return scoreBoard(tempBoard);
    }

    const validMoves = getValidMoves(tempBoard);
    if (isMax) {
      let maxVal = -Infinity;
      for (const col of validMoves) {
        const boardCopy = [...tempBoard];
        makeMove(boardCopy, col, botSymbol);
        const val = minimax(boardCopy, depth + 1, alpha, beta, false);
        maxVal = Math.max(maxVal, val);
        alpha = Math.max(alpha, val);
        if (beta <= alpha) break;
      }
      return maxVal;
    } else {
      let minVal = Infinity;
      for (const col of validMoves) {
        const boardCopy = [...tempBoard];
        makeMove(boardCopy, col, playerSymbol);
        const val = minimax(boardCopy, depth + 1, alpha, beta, true);
        minVal = Math.min(minVal, val);
        beta = Math.min(beta, val);
        if (beta <= alpha) break;
      }
      return minVal;
    }
  }

  const validMoves = getValidMoves(board);
  let bestScore = -Infinity;
  let bestCol = validMoves[0] !== undefined ? validMoves[0] : 3;

  for (const col of validMoves) {
    const boardCopy = [...board];
    makeMove(boardCopy, col, botSymbol);
    const score = minimax(boardCopy, 0, -Infinity, Infinity, false);
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }

  for (let r = ROWS - 1; r >= 0; r--) {
    const idx = r * COLS + bestCol;
    if (board[idx] === "") {
      return idx;
    }
  }
  return -1;
}


const calculateEloDelta = (myRating: number, oppRating: number, outcome: 1 | 0.5 | 0) => {
  const expected = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(32 * (outcome - expected));
};

export default function Connect4Game() {
  const { gameId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameData | null>(null);
  const [opponent, setOpponent] = useState<UserData | null>(null);
  const [player1Data, setPlayer1Data] = useState<UserData | null>(null);
  const [statsUpdated, setStatsUpdated] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!gameId) return;

    const gameRef = doc(db, "games_connect4", gameId);
    const unsubscribe = onSnapshot(gameRef, async (snapshot) => {
      if (snapshot.exists()) {
        const gameData = snapshot.data() as GameData;
        const normalizedBoard = gameData.board.map(cell => (cell === null || cell === undefined) ? "" : cell);
        setGame({ ...gameData, board: normalizedBoard });
        
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
          if (oppId.startsWith("bot_connect4")) {
            const oppRef = doc(db, "users", oppId);
            getDoc(oppRef).then(oppSnap => {
              if (oppSnap.exists()) {
                setOpponent(oppSnap.data() as UserData);
              } else {
                let defaultName = "🤖 Robo-Bot (Schwer)";
                let defaultRating = 1200;
                if (oppId === "bot_connect4_easy") {
                  defaultName = "🤖 Easy-Bot (Einfach)";
                  defaultRating = 800;
                } else if (oppId === "bot_connect4_medium") {
                  defaultName = "🤖 Medi-Bot (Mittel)";
                  defaultRating = 1000;
                }
                setOpponent({
                  uid: oppId,
                  displayName: defaultName,
                  connect4_rating: defaultRating
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
        navigate("/connect4");
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, "games_connect4"));

    return () => unsubscribe();
  }, [gameId, user, navigate]);

  // Perfectly playing Connect4 bot loop
  useEffect(() => {
    if (game && game.status === "playing" && game.player2Id && game.player2Id.startsWith("bot_connect4") && game.turn === "yellow") {
      const timer = setTimeout(async () => {
        let bestMove = -1;
        const randomChance = Math.random();
        let shouldPlayRandom = false;
        
        if (game.player2Id === "bot_connect4_easy") {
          shouldPlayRandom = randomChance < 0.70;
        } else if (game.player2Id === "bot_connect4_medium") {
          shouldPlayRandom = randomChance < 0.35;
        }
        
        if (shouldPlayRandom) {
          const validCols = [];
          for (let c = 0; c < 7; c++) {
            if (game.board[c] === "") {
              validCols.push(c);
            }
          }
          if (validCols.length > 0) {
            const chosenCol = validCols[Math.floor(Math.random() * validCols.length)];
            for (let r = 5; r >= 0; r--) {
              const idx = r * 7 + chosenCol;
              if (game.board[idx] === "") {
                bestMove = idx;
                break;
              }
            }
          }
        } else {
          bestMove = getBestMoveConnect4(game.board, "yellow");
        }
        
        if (bestMove !== -1) {
          const newBoard = [...game.board];
          newBoard[bestMove] = "yellow";
          
          let newStatus = "playing";
          let newWinner = null;
          
          const outcome = checkWinnerConnect4(newBoard);
          if (outcome === "yellow") {
            newStatus = "finished";
            newWinner = "yellow";
          } else if (outcome === "draw") {
            newStatus = "finished";
            newWinner = "draw";
          }
          
          try {
            await updateDoc(doc(db, "games_connect4", gameId!), {
              board: newBoard,
              turn: "red",
              status: newStatus,
              winner: newWinner,
              updatedAt: serverTimestamp()
            });
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
      
      if (sessionStorage.getItem(`c4_processed_${gameId}`)) {
        return;
      }
      sessionStorage.setItem(`c4_processed_${gameId}`, "true");

      const updateStats = async () => {
        try {
          const mySymbol = game.player1Id === user.uid ? "red" : "yellow";
          let outcome: 1 | 0.5 | 0 = 0.5;
          if (game.winner === mySymbol) outcome = 1;
          else if (game.winner && game.winner !== "draw") outcome = 0;

          const userRef = doc(db, "users", user.uid);
          
          if (opponent.uid.startsWith("bot_connect4")) {
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
                connect4_rating: opponent.connect4_rating || 1000,
                connect4_gamesPlayed: 0,
                connect4_wins: 0,
                connect4_losses: 0,
                connect4_draws: 0
              };
              
              const myEloDelta = calculateEloDelta(userData.connect4_rating || 1000, botData.connect4_rating || 1000, outcome);
              const botEloDelta = calculateEloDelta(botData.connect4_rating || 1000, userData.connect4_rating || 1000, (1 - outcome) as 0 | 1 | 0.5);
              
              t.update(userRef, {
                connect4_rating: (userData.connect4_rating || 1000) + myEloDelta,
                connect4_gamesPlayed: (userData.connect4_gamesPlayed || 0) + 1,
                connect4_wins: (userData.connect4_wins || 0) + (outcome === 1 ? 1 : 0),
                connect4_losses: (userData.connect4_losses || 0) + (outcome === 0 ? 1 : 0),
                connect4_draws: (userData.connect4_draws || 0) + (outcome === 0.5 ? 1 : 0)
              });
              
              t.set(botRef, {
                uid: opponent.uid,
                displayName: botData.displayName || opponent.displayName || "🤖 Robo-Bot",
                connect4_rating: (botData.connect4_rating || 1000) + botEloDelta,
                connect4_gamesPlayed: (botData.connect4_gamesPlayed || 0) + 1,
                connect4_wins: (botData.connect4_wins || 0) + ((1 - outcome) === 1 ? 1 : 0),
                connect4_losses: (botData.connect4_losses || 0) + ((1 - outcome) === 0 ? 1 : 0),
                connect4_draws: (botData.connect4_draws || 0) + ((1 - outcome) === 0.5 ? 1 : 0)
              }, { merge: true });
            });
          } else {
            await runTransaction(db, async (t) => {
              const userSnap = await t.get(userRef);
              if (!userSnap.exists()) return;
              const userData = userSnap.data();
              const eloDelta = calculateEloDelta(userData.connect4_rating || 1000, opponent.connect4_rating || 1000, outcome);
              
              t.update(userRef, {
                connect4_rating: (userData.connect4_rating || 1000) + eloDelta,
                connect4_gamesPlayed: (userData.connect4_gamesPlayed || 0) + 1,
                connect4_wins: (userData.connect4_wins || 0) + (outcome === 1 ? 1 : 0),
                connect4_losses: (userData.connect4_losses || 0) + (outcome === 0 ? 1 : 0),
                connect4_draws: (userData.connect4_draws || 0) + (outcome === 0.5 ? 1 : 0)
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

  const mySymbol = game.player1Id === user.uid ? "red" : "yellow";
  const isMyTurn = game.turn === mySymbol;

  const handleCellClick = async (index: number) => {
    if (game.status !== "playing" || !isMyTurn) return;
    
    // Find lowest empty cell in column
    const c = index % 7;
    let targetIdx = -1;
    for (let r = 5; r >= 0; r--) {
      if (game.board[r * 7 + c] === "") {
        targetIdx = r * 7 + c;
        break;
      }
    }
    if (targetIdx === -1) return; // Column full

    try {
      const newBoard = [...game.board];
      newBoard[targetIdx] = mySymbol;
      const winner = checkWinnerConnect4(newBoard);
      
      const updateData: Partial<GameData> & { updatedAt: any } = {
        board: newBoard,
        turn: mySymbol === "red" ? "yellow" : "red",
        updatedAt: serverTimestamp()
      };

      if (winner) {
        updateData.status = "finished";
        updateData.winner = winner;
      }

      await updateDoc(doc(db, "games_connect4", gameId!), updateData);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "games_connect4");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <nav className="shrink-0 h-16 border-b border-slate-200 dark:border-slate-800 px-4 md:px-8 flex items-center justify-between bg-white/80 dark:bg-slate-900/50 backdrop-blur-md">
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
            C4<span className="text-indigo-500">ELITE</span>
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

      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-0 overflow-hidden">
        <section className="col-span-1 md:col-span-12 lg:col-span-8 lg:col-start-3 bg-slate-50 dark:bg-slate-950 flex flex-col items-center p-4 sm:p-8 overflow-y-auto">
          {game.status === "waiting" ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-indigo-500 animate-spin mb-6"></div>
              <h2 className="text-2xl font-bold mb-2">Suche Gegner...</h2>
              <p className="text-slate-500 dark:text-slate-400 mb-8">Warte auf einen weiteren Spieler.</p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={() => navigate("/connect4")}
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
                          await deleteDoc(doc(db, "games_connect4", gameId));
                        }
                        navigate("/connect4");
                      } catch (error: any) {
                        if (error.code !== 'permission-denied' && error.code !== 'not-found') {
                           handleFirestoreError(error, OperationType.DELETE, "games_connect4");
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
                <div className="absolute inset-0 bg-gradient-to-r from-rose-500/[0.02] via-transparent to-amber-500/[0.02] pointer-events-none"></div>
                
                {/* Player 1 (Creator - Rot) */}
                <div className={cn(
                  "flex items-center gap-3 p-2.5 rounded-2xl border transition-all duration-200 w-full sm:w-auto sm:flex-1",
                  game.turn === "red" && game.status === "playing"
                    ? "bg-rose-500/5 border-rose-500/40 shadow-md shadow-rose-500/5 scale-[1.02]"
                    : "bg-slate-50/50 dark:bg-slate-800/30 border-transparent"
                )}>
                  <div className="w-9 h-9 rounded-full bg-rose-500 flex items-center justify-center font-bold text-white shrink-0 text-sm shadow-md shadow-rose-500/20">
                    🔴
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                      {player1Data?.displayName || "Suche..."}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold font-mono uppercase tracking-widest mt-0.5">
                      {player1Data?.connect4_rating || 1000} ELO
                    </p>
                  </div>
                </div>

                {/* VS Badge */}
                <div className="text-xs font-black uppercase text-slate-400 tracking-wider shrink-0 px-2">
                  vs
                </div>

                {/* Player 2 (Opponent - Gelb) */}
                <div className={cn(
                  "flex items-center gap-3 p-2.5 rounded-2xl border transition-all duration-200 w-full sm:w-auto sm:flex-1",
                  game.turn === "yellow" && game.status === "playing"
                    ? "bg-amber-500/5 border-amber-500/40 shadow-md shadow-amber-500/5 scale-[1.02]"
                    : "bg-slate-50/50 dark:bg-slate-800/30 border-transparent"
                )}>
                  <div className="w-9 h-9 rounded-full bg-amber-400 flex items-center justify-center font-bold text-white shrink-0 text-sm shadow-md shadow-amber-500/20">
                    🟡
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                      {opponent?.displayName || "Suche..."}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold font-mono uppercase tracking-widest mt-0.5">
                      {opponent?.connect4_rating || 1000} ELO
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-indigo-600 dark:bg-indigo-900 p-1.5 sm:p-4 rounded-2xl sm:rounded-3xl w-full max-w-[320px] sm:max-w-none flex justify-center shadow-[0_10px_30px_rgba(79,70,229,0.3)]">
                <div className={cn(
                  "grid grid-cols-7 grid-rows-6 gap-1 sm:gap-2 w-full max-w-[300px] sm:max-w-none sm:w-[420px] lg:w-[500px] transition-opacity duration-300",
                  game.status === "finished" ? "opacity-75" : ""
                )}>
                  {game.board.map((cell, idx) => {
                    return (
                      <div
                        key={idx}
                        onClick={() => handleCellClick(idx)}
                        className={cn(
                          "aspect-square rounded-full flex items-center justify-center shadow-inner overflow-hidden select-none transition-all duration-300 transform",
                          cell === "" ? "bg-slate-100 dark:bg-slate-950" : "",
                          isMyTurn && game.status === "playing" && cell === "" ? "cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-900" : "",
                          cell !== "" ? "cursor-default scale-95" : "",
                          cell === "red" ? "bg-rose-500 shadow-[inset_0_-4px_8px_rgba(0,0,0,0.3)]" : "",
                          cell === "yellow" ? "bg-amber-400 shadow-[inset_0_-4px_8px_rgba(0,0,0,0.3)]" : ""
                        )}
                      >
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-12 flex items-center justify-center relative min-h-[100px] w-full">
                {game.status === "playing" ? (
                  <div className="flex flex-col items-center">
                    <span className="text-xs uppercase text-slate-500 font-bold mb-3">Dein Zug</span>
                    {isMyTurn ? (
                      <>
                        <div className="w-4 h-4 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_15px_rgba(99,102,241,0.6)] mb-2"></div>
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
                      onClick={() => navigate("/connect4")}
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
          collectionName="games_connect4"
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
        <div>© {new Date().getFullYear()} C4 ELITE SYSTEM</div>
      </footer>
    </div>
  );
}
