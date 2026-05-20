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
  turn: "X" | "O";
  status: "waiting" | "playing" | "finished";
  winner: "X" | "O" | "draw" | null;
  lastChat?: {
    senderId: string;
    text: string;
    sentAt: number;
  };
}

interface UserData {
  uid: string;
  displayName: string;
  rating: number;
}

const checkWinner = (board: string[]): "X" | "O" | "draw" | null => {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
    [0, 4, 8], [2, 4, 6]             // Diagonals
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as "X" | "O";
    }
  }
  if (!board.includes("")) {
    return "draw";
  }
  return null;
};
function getBestMove(board: string[], botSymbol: string): number {
  const playerSymbol = botSymbol === "X" ? "O" : "X";
  
  function minimax(tempBoard: string[], depth: number, isMax: boolean): number {
    const outcome = checkWinner(tempBoard);
    if (outcome === botSymbol) return 10 - depth;
    if (outcome === playerSymbol) return depth - 10;
    if (outcome === "draw") return 0;
    
    if (isMax) {
      let best = -Infinity;
      for (let i = 0; i < 9; i++) {
        if (tempBoard[i] === "") {
          tempBoard[i] = botSymbol;
          best = Math.max(best, minimax(tempBoard, depth + 1, false));
          tempBoard[i] = "";
        }
      }
      return best;
    } else {
      let best = Infinity;
      for (let i = 0; i < 9; i++) {
        if (tempBoard[i] === "") {
          tempBoard[i] = playerSymbol;
          best = Math.min(best, minimax(tempBoard, depth + 1, true));
          tempBoard[i] = "";
        }
      }
      return best;
    }
  }
  
  let bestVal = -Infinity;
  let bestMove = -1;
  const tempBoard = [...board];
  
  for (let i = 0; i < 9; i++) {
    if (tempBoard[i] === "") {
      tempBoard[i] = botSymbol;
      const moveVal = minimax(tempBoard, 0, false);
      tempBoard[i] = "";
      
      if (moveVal > bestVal) {
        bestVal = moveVal;
        bestMove = i;
      }
    }
  }
  return bestMove;
}


const calculateEloDelta = (myRating: number, oppRating: number, outcome: 1 | 0.5 | 0) => {
  const expected = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(32 * (outcome - expected));
};

export default function Game() {
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

    const gameRef = doc(db, "games", gameId);
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
          if (oppId.startsWith("bot_tictactoe")) {
            const oppRef = doc(db, "users", oppId);
            getDoc(oppRef).then(oppSnap => {
              if (oppSnap.exists()) {
                setOpponent(oppSnap.data() as UserData);
              } else {
                let defaultName = "🤖 Robo-Bot (Schwer)";
                let defaultRating = 1200;
                if (oppId === "bot_tictactoe_easy") {
                  defaultName = "🤖 Easy-Bot (Einfach)";
                  defaultRating = 800;
                } else if (oppId === "bot_tictactoe_medium") {
                  defaultName = "🤖 Medi-Bot (Mittel)";
                  defaultRating = 1000;
                }
                setOpponent({
                  uid: oppId,
                  displayName: defaultName,
                  rating: defaultRating
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
        navigate("/tictactoe");
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, "games"));

    return () => unsubscribe();
  }, [gameId, user, navigate]);

  useEffect(() => {
    if (game && game.status === "playing" && game.player2Id && game.player2Id.startsWith("bot_tictactoe") && game.turn === "O") {
      const timer = setTimeout(async () => {
        let bestMove = -1;
        const randomChance = Math.random();
        let shouldPlayRandom = false;
        
        if (game.player2Id === "bot_tictactoe_easy") {
          shouldPlayRandom = randomChance < 0.70;
        } else if (game.player2Id === "bot_tictactoe_medium") {
          shouldPlayRandom = randomChance < 0.35;
        }
        
        if (shouldPlayRandom) {
          const availableIndices: number[] = [];
          game.board.forEach((cell, idx) => {
            if (cell === "") availableIndices.push(idx);
          });
          if (availableIndices.length > 0) {
            bestMove = availableIndices[Math.floor(Math.random() * availableIndices.length)];
          }
        } else {
          bestMove = getBestMove(game.board, "O");
        }
        
        if (bestMove !== -1) {
          const newBoard = [...game.board];
          newBoard[bestMove] = "O";
          
          let newStatus = "playing";
          let newWinner = null;
          
          const outcome = checkWinner(newBoard);
          if (outcome === "O") {
            newStatus = "finished";
            newWinner = "O";
          } else if (outcome === "draw") {
            newStatus = "finished";
            newWinner = "draw";
          }
          
          try {
            await updateDoc(doc(db, "games", gameId!), {
              board: newBoard,
              turn: "X",
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
      
      if (sessionStorage.getItem(`processed_${gameId}`)) {
        return;
      }
      sessionStorage.setItem(`processed_${gameId}`, "true");

      const updateStats = async () => {
        try {
          const mySymbol = game.player1Id === user.uid ? "X" : "O";
          let outcome: 1 | 0.5 | 0 = 0.5;
          if (game.winner === mySymbol) outcome = 1;
          else if (game.winner && game.winner !== "draw") outcome = 0;

          const userRef = doc(db, "users", user.uid);
          
          if (opponent.uid.startsWith("bot_tictactoe")) {
            const botRef = doc(db, "users", opponent.uid);
            await runTransaction(db, async (t) => {
              const userSnap = await t.get(userRef);
              const botSnap = await t.get(botRef);
              if (!userSnap.exists()) return;
              
              const userData = userSnap.data();
              const botData = botSnap.exists() ? botSnap.data() : {
                uid: opponent.uid,
                displayName: opponent.displayName || "🤖 Robo-Bot",
                rating: opponent.rating || 1000,
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                draws: 0
              };
              
              const myEloDelta = calculateEloDelta(userData.rating, botData.rating, outcome);
              const botEloDelta = calculateEloDelta(botData.rating, userData.rating, (1 - outcome) as 0 | 1 | 0.5);
              
              t.update(userRef, {
                rating: userData.rating + myEloDelta,
                gamesPlayed: userData.gamesPlayed + 1,
                wins: userData.wins + (outcome === 1 ? 1 : 0),
                losses: userData.losses + (outcome === 0 ? 1 : 0),
                draws: userData.draws + (outcome === 0.5 ? 1 : 0)
              });
              
              t.set(botRef, {
                uid: opponent.uid,
                displayName: botData.displayName || opponent.displayName || "🤖 Robo-Bot",
                rating: botData.rating + botEloDelta,
                gamesPlayed: (botData.gamesPlayed || 0) + 1,
                wins: (botData.wins || 0) + ((1 - outcome) === 1 ? 1 : 0),
                losses: (botData.losses || 0) + ((1 - outcome) === 0 ? 1 : 0),
                draws: (botData.draws || 0) + ((1 - outcome) === 0.5 ? 1 : 0)
              }, { merge: true });
            });
          } else {
            await runTransaction(db, async (t) => {
              const userSnap = await t.get(userRef);
              if (!userSnap.exists()) return;
              const userData = userSnap.data();
              const eloDelta = calculateEloDelta(userData.rating, opponent.rating, outcome);
              
              t.update(userRef, {
                rating: userData.rating + eloDelta,
                gamesPlayed: userData.gamesPlayed + 1,
                wins: userData.wins + (outcome === 1 ? 1 : 0),
                losses: userData.losses + (outcome === 0 ? 1 : 0),
                draws: userData.draws + (outcome === 0.5 ? 1 : 0)
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

  const mySymbol = game.player1Id === user.uid ? "X" : "O";
  const isMyTurn = game.turn === mySymbol;

  const handleCellClick = async (index: number) => {
    if (game.status !== "playing" || !isMyTurn || game.board[index] !== "") return;

    try {
      const newBoard = [...game.board];
      newBoard[index] = mySymbol;
      const winner = checkWinner(newBoard);
      
      const updateData: Partial<GameData> & { updatedAt: any } = {
        board: newBoard,
        turn: mySymbol === "X" ? "O" : "X",
        updatedAt: serverTimestamp()
      };

      if (winner) {
        updateData.status = "finished";
        updateData.winner = winner;
      }

      await updateDoc(doc(db, "games", gameId!), updateData);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "games");
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
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-xl text-slate-900 dark:text-white">#</div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white cursor-pointer" onClick={() => navigate("/")}>
            TTT<span className="text-indigo-500">ELITE</span>
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
                  onClick={() => navigate("/tictactoe")}
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
                          await deleteDoc(doc(db, "games", gameId));
                        }
                        navigate("/tictactoe");
                      } catch (error: any) {
                        if (error.code !== 'permission-denied' && error.code !== 'not-found') {
                           handleFirestoreError(error, OperationType.DELETE, "games");
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
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/[0.02] via-transparent to-rose-500/[0.02] pointer-events-none"></div>
                
                {/* Player 1 (Creator - X) */}
                <div className={cn(
                  "flex items-center gap-3 p-2.5 rounded-2xl border transition-all duration-200 w-full sm:w-auto sm:flex-1",
                  game.turn === "X" && game.status === "playing"
                    ? "bg-indigo-500/5 border-indigo-500/40 shadow-md shadow-indigo-500/5 scale-[1.02]"
                    : "bg-slate-50/50 dark:bg-slate-800/30 border-transparent"
                )}>
                  <div className="w-9 h-9 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center font-bold text-indigo-400 shrink-0 text-sm">
                    X
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                      {player1Data?.displayName || "Suche..."}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold font-mono uppercase tracking-widest mt-0.5">
                      {player1Data?.rating || 1000} ELO
                    </p>
                  </div>
                </div>

                {/* VS Badge */}
                <div className="text-xs font-black uppercase text-slate-400 tracking-wider shrink-0 px-2">
                  vs
                </div>

                {/* Player 2 (Opponent - O) */}
                <div className={cn(
                  "flex items-center gap-3 p-2.5 rounded-2xl border transition-all duration-200 w-full sm:w-auto sm:flex-1",
                  game.turn === "O" && game.status === "playing"
                    ? "bg-rose-500/5 border-rose-500/40 shadow-md shadow-rose-500/5 scale-[1.02]"
                    : "bg-slate-50/50 dark:bg-slate-800/30 border-transparent"
                )}>
                  <div className="w-9 h-9 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center font-bold text-rose-400 shrink-0 text-sm">
                    O
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                      {opponent?.displayName || "Suche..."}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold font-mono uppercase tracking-widest mt-0.5">
                      {opponent?.rating || 1000} ELO
                    </p>
                  </div>
                </div>
              </div>
              
              <div className={cn(
                "grid grid-cols-3 grid-rows-3 gap-2 sm:gap-4 w-full max-w-[360px] aspect-square transition-opacity duration-300",
                game.status === "finished" ? "opacity-75" : ""
              )}>
                {game.board.map((cell, idx) => {
                  return (
                    <div
                      key={idx}
                      onClick={() => handleCellClick(idx)}
                      className={cn(
                        "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-center text-5xl sm:text-6xl font-black shadow-inner overflow-hidden select-none transition-colors",
                        cell === "" && isMyTurn && game.status === "playing" ? "hover:ring-2 hover:ring-indigo-500 hover:ring-offset-4 hover:ring-offset-slate-950 cursor-pointer" : "",
                        cell !== "" && "cursor-default",
                        cell === "X" && "text-indigo-500",
                        cell === "O" && "text-rose-500",
                      )}
                    >
                      {cell}
                    </div>
                  );
                })}
              </div>

              <div className="mt-12 flex items-center justify-center relative min-h-[100px] w-full">
                {game.status === "playing" ? (
                  <div className="flex flex-col items-center">
                    <span className="text-xs uppercase text-slate-500 font-bold mb-3">Dein Zug</span>
                    {isMyTurn ? (
                      <>
                        <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_10px_rgba(99,102,241,0.6)] mb-2"></div>
                        <span className="text-sm font-bold text-slate-900 dark:text-white">Du bist dran</span>
                      </>
                    ) : (
                      <>
                        <div className="w-3 h-3 rounded-full bg-slate-100 dark:bg-slate-800 mb-2"></div>
                        <span className="text-sm font-bold text-slate-500">Gegner ist dran</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center animate-in zoom-in-95 duration-500">
                    <div className="text-3xl font-bold text-slate-900 dark:text-white mb-6">
                      {game.winner === "draw" ? (
                        <span className="text-slate-600 dark:text-slate-300">Unentschieden!</span>
                      ) : game.winner === mySymbol ? (
                        <span className="text-green-500 drop-shadow-[0_0_10px_rgba(34,197,94,0.4)]">Du hast gewonnen!</span>
                      ) : (
                        <span className="text-rose-500 drop-shadow-[0_0_10px_rgba(244,63,94,0.4)]">Du hast verloren!</span>
                      )}
                    </div>
                    <button
                      onClick={() => navigate("/tictactoe")}
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
          collectionName="games"
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
        <div>© {new Date().getFullYear()} TTT ELITE SYSTEM</div>
      </footer>
    </div>
  );
}
