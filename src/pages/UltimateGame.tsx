import QuickChat from "../components/QuickChat";
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, onSnapshot, getDoc, updateDoc, serverTimestamp, runTransaction } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { ThemeToggle } from "../components/ThemeToggle";
import { cn } from "../lib/utils";
import { ArrowLeft, RefreshCw, Trophy } from "lucide-react";

interface GameData {
  player1Id: string;
  player2Id: string | null;
  smallBoards: { [key: string]: string }[];
  macroBoard: string[];
  activeBoard: number | null;
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

const checkSmallBoardWin = (board: { [key: string]: string }): "X" | "O" | "draw" | null => {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as "X" | "O";
    }
  }
  const isFull = [0, 1, 2, 3, 4, 5, 6, 7, 8].every(i => board[i] && board[i] !== "");
  if (isFull) {
    return "draw";
  }
  return null;
};

const checkMacroBoardWin = (board: string[]): "X" | "O" | "draw" | null => {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] !== "draw" && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as "X" | "O";
    }
  }
  
  const activeCount = board.filter(cell => cell === "").length;
  if (activeCount === 0) {
    return "draw";
  }
  return null;
};

function getBotMove(
  smallBoards: { [key: string]: string }[],
  macroBoard: string[],
  activeBoard: number | null,
  botSymbol: "X" | "O",
  difficulty: "easy" | "medium" | "hard"
): { boardIdx: number; cellIdx: number } {
  const opponentSymbol = botSymbol === "X" ? "O" : "X";

  let legalBoards: number[] = [];
  if (activeBoard !== null && macroBoard[activeBoard] === "") {
    legalBoards = [activeBoard];
  } else {
    for (let i = 0; i < 9; i++) {
      if (macroBoard[i] === "") {
        legalBoards.push(i);
      }
    }
  }

  const legalMoves: { boardIdx: number; cellIdx: number }[] = [];
  for (const b of legalBoards) {
    for (let c = 0; c < 9; c++) {
      if (!smallBoards[b][c]) {
        legalMoves.push({ boardIdx: b, cellIdx: c });
      }
    }
  }

  if (legalMoves.length === 0) return { boardIdx: 0, cellIdx: 0 };

  const roll = Math.random();
  const shouldPlayTactically = 
    (difficulty === "easy" && roll < 0.3) ||
    (difficulty === "medium" && roll < 0.65) ||
    (difficulty === "hard");

  if (!shouldPlayTactically) {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  const findWinMove = (board: { [key: string]: string }, symbol: string): number => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];
    for (const [a, b, c] of lines) {
      if (board[a] === symbol && board[b] === symbol && (!board[c] || board[c] === "")) return c;
      if (board[a] === symbol && board[c] === symbol && (!board[b] || board[b] === "")) return b;
      if (board[b] === symbol && board[c] === symbol && (!board[a] || board[a] === "")) return a;
    }
    return -1;
  };

  for (const move of legalMoves) {
    const subWin = findWinMove(smallBoards[move.boardIdx], botSymbol);
    if (subWin !== -1 && subWin === move.cellIdx) {
      return move;
    }
  }

  for (const move of legalMoves) {
    const subBlock = findWinMove(smallBoards[move.boardIdx], opponentSymbol);
    if (subBlock !== -1 && subBlock === move.cellIdx) {
      return move;
    }
  }

  const safeMoves = legalMoves.filter(move => {
    const targetBoardIndex = move.cellIdx;
    const targetMacro = macroBoard[targetBoardIndex];
    return targetMacro === "";
  });

  const baseMoves = safeMoves.length > 0 ? safeMoves : legalMoves;

  const moveScores = baseMoves.map(move => {
    let score = 0;
    if (move.cellIdx === 4) score += 3;
    else if ([0, 2, 6, 8].includes(move.cellIdx)) score += 2;
    else score += 1;

    if (move.boardIdx === 4) score += 2;
    else if ([0, 2, 6, 8].includes(move.boardIdx)) score += 1;

    return { move, score };
  });

  moveScores.sort((a, b) => b.score - a.score);
  return moveScores[0].move;
}

const calculateEloDelta = (myRating: number, oppRating: number, outcome: 1 | 0.5 | 0) => {
  const expected = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(32 * (outcome - expected));
};

export default function UltimateGame() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [game, setGame] = useState<GameData | null>(null);
  const [opponent, setOpponent] = useState<UserData | null>(null);
  const [player1Data, setPlayer1Data] = useState<UserData | null>(null);
  const [statsUpdated, setStatsUpdated] = useState(false);
  const [myOldRating, setMyOldRating] = useState<number | null>(null);
  const [myNewRating, setMyNewRating] = useState<number | null>(null);

  useEffect(() => {
    if (!gameId) return;
    
    const unsubscribe = onSnapshot(doc(db, "games_utictactoe", gameId), async (snapshot) => {
      if (!snapshot.exists()) {
        alert("Spiel existiert nicht mehr.");
        navigate("/utictactoe");
        return;
      }
      const data = snapshot.data() as GameData;
      setGame(data);
      
      const p1Id = data.player1Id;
      const p2Id = data.player2Id;
      
      if (user) {
        const oppId = user.uid === p1Id ? p2Id : p1Id;
        if (oppId) {
          const oppRef = doc(db, "users", oppId);
          const oppSnap = await getDoc(oppRef);
          if (oppSnap.exists()) {
            const oppData = oppSnap.data();
            setOpponent({
              uid: oppId,
              displayName: oppData.displayName || "Unbekannt",
              rating: oppData.utictactoe_rating || 1000
            });
          } else if (oppId.startsWith("bot_")) {
            let botName = "🤖 Robo-Bot";
            let botRating = 1200;
            if (oppId.includes("easy")) {
              botName = "🤖 Easy-Bot";
              botRating = 800;
            } else if (oppId.includes("medium")) {
              botName = "🤖 Medi-Bot";
              botRating = 1000;
            }
            setOpponent({
              uid: oppId,
              displayName: botName,
              rating: botRating
            });
          }
        }
        
        const p1Ref = doc(db, "users", p1Id);
        const p1Snap = await getDoc(p1Ref);
        if (p1Snap.exists()) {
          setPlayer1Data({
            uid: p1Id,
            displayName: p1Snap.data().displayName || "Unbekannt",
            rating: p1Snap.data().utictactoe_rating || 1000
          });
        }
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, "games_utictactoe"));

    return () => unsubscribe();
  }, [gameId, user, navigate]);

  // Bot Trigger
  useEffect(() => {
    if (!game || game.status !== "playing" || !opponent || !opponent.uid.startsWith("bot_")) return;
    
    const botSymbol = game.player1Id === opponent.uid ? "X" : "O";
    
    if (game.turn === botSymbol) {
      let difficulty: "easy" | "medium" | "hard" = "medium";
      if (opponent.uid.includes("easy")) difficulty = "easy";
      else if (opponent.uid.includes("hard")) difficulty = "hard";

      const timer = setTimeout(async () => {
        const currentSnap = await getDoc(doc(db, "games_utictactoe", gameId!));
        if (!currentSnap.exists()) return;
        const currentData = currentSnap.data() as GameData;
        
        if (currentData.turn !== botSymbol || currentData.status !== "playing") return;

        const move = getBotMove(
          currentData.smallBoards,
          currentData.macroBoard,
          currentData.activeBoard,
          botSymbol,
          difficulty
        );

        const newSmallBoards = currentData.smallBoards.map((board, bIdx) => {
          if (bIdx === move.boardIdx) {
            return {
              ...board,
              [move.cellIdx]: botSymbol
            };
          }
          return board;
        });

        const newMacroBoard = [...currentData.macroBoard];
        const localWin = checkSmallBoardWin(newSmallBoards[move.boardIdx]);
        if (localWin) {
          newMacroBoard[move.boardIdx] = localWin;
        }

        let nextActiveBoard: number | null = move.cellIdx;
        if (newMacroBoard[nextActiveBoard] !== "") {
          nextActiveBoard = null;
        }

        let newStatus = currentData.status as GameData["status"];
        let newWinner = currentData.winner;

        const globalWin = checkMacroBoardWin(newMacroBoard);
        if (globalWin) {
          newStatus = "finished";
          newWinner = globalWin;
        }

        try {
          await updateDoc(doc(db, "games_utictactoe", gameId!), {
            smallBoards: newSmallBoards,
            macroBoard: newMacroBoard,
            activeBoard: nextActiveBoard,
            turn: botSymbol === "X" ? "O" : "X",
            status: newStatus,
            winner: newWinner,
            updatedAt: serverTimestamp()
          });
        } catch (error) {
          console.error("Error committing bot move:", error);
        }
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [game?.turn, game?.status, game?.smallBoards, opponent, gameId]);

  // ELO updates
  useEffect(() => {
    if (game?.status === "finished" && !statsUpdated && user && opponent) {
      setStatsUpdated(true);
      
      if (sessionStorage.getItem(`processed_utictactoe_${gameId}`)) {
        return;
      }
      sessionStorage.setItem(`processed_utictactoe_${gameId}`, "true");

      const updateStats = async () => {
        try {
          const mySymbol = game.player1Id === user.uid ? "X" : "O";
          let outcome: 1 | 0.5 | 0 = 0.5;
          if (game.winner === mySymbol) outcome = 1;
          else if (game.winner && game.winner !== "draw") outcome = 0;

          const userRef = doc(db, "users", user.uid);
          
          if (opponent.uid.startsWith("bot_")) {
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
                utictactoe_rating: opponent.rating || 1000,
                utictactoe_gamesPlayed: 0,
                utictactoe_wins: 0,
                utictactoe_losses: 0,
                utictactoe_draws: 0
              };
              
              const myCurrentElo = userData.utictactoe_rating || 1000;
              const botCurrentElo = botData.utictactoe_rating || 1000;
              
              const myEloDelta = calculateEloDelta(myCurrentElo, botCurrentElo, outcome);
              const botEloDelta = calculateEloDelta(botCurrentElo, myCurrentElo, (1 - outcome) as 0 | 1 | 0.5);
              
              setMyOldRating(myCurrentElo);
              setMyNewRating(myCurrentElo + myEloDelta);

              t.update(userRef, {
                utictactoe_rating: myCurrentElo + myEloDelta,
                utictactoe_gamesPlayed: (userData.utictactoe_gamesPlayed || 0) + 1,
                utictactoe_wins: (userData.utictactoe_wins || 0) + (outcome === 1 ? 1 : 0),
                utictactoe_losses: (userData.utictactoe_losses || 0) + (outcome === 0 ? 1 : 0),
                utictactoe_draws: (userData.utictactoe_draws || 0) + (outcome === 0.5 ? 1 : 0)
              });
              
              t.set(botRef, {
                uid: opponent.uid,
                displayName: botData.displayName || opponent.displayName,
                rating: botData.rating || 1000,
                gamesPlayed: botData.gamesPlayed || 0,
                wins: botData.wins || 0,
                losses: botData.losses || 0,
                draws: botData.draws || 0,
                utictactoe_rating: botCurrentElo + botEloDelta,
                utictactoe_gamesPlayed: (botData.utictactoe_gamesPlayed || 0) + 1,
                utictactoe_wins: (botData.utictactoe_wins || 0) + ((1 - outcome) === 1 ? 1 : 0),
                utictactoe_losses: (botData.utictactoe_losses || 0) + ((1 - outcome) === 0 ? 1 : 0),
                utictactoe_draws: (botData.utictactoe_draws || 0) + ((1 - outcome) === 0.5 ? 1 : 0)
              }, { merge: true });
            });
          } else {
            await runTransaction(db, async (t) => {
              const userSnap = await t.get(userRef);
              if (!userSnap.exists()) return;
              const userData = userSnap.data();
              
              const myCurrentElo = userData.utictactoe_rating || 1000;
              const eloDelta = calculateEloDelta(myCurrentElo, opponent.rating, outcome);
              
              setMyOldRating(myCurrentElo);
              setMyNewRating(myCurrentElo + eloDelta);

              t.update(userRef, {
                utictactoe_rating: myCurrentElo + eloDelta,
                utictactoe_gamesPlayed: (userData.utictactoe_gamesPlayed || 0) + 1,
                utictactoe_wins: (userData.utictactoe_wins || 0) + (outcome === 1 ? 1 : 0),
                utictactoe_losses: (userData.utictactoe_losses || 0) + (outcome === 0 ? 1 : 0),
                utictactoe_draws: (userData.utictactoe_draws || 0) + (outcome === 0.5 ? 1 : 0)
              });
            });
          }
        } catch (error) {
          console.error("Error updating stats", error);
        }
      };
      updateStats();
    }
  }, [game?.status, statsUpdated, user, opponent, gameId]);

  const handleCellClick = async (boardIdx: number, cellIdx: number) => {
    if (!game || game.status !== "playing" || !user) return;
    
    const mySymbol = game.player1Id === user.uid ? "X" : "O";
    if (game.turn !== mySymbol) return;

    if (game.activeBoard !== null && game.activeBoard !== boardIdx && game.macroBoard[game.activeBoard] === "") {
      return;
    }
    
    if (game.macroBoard[boardIdx] !== "") return;
    if (game.smallBoards[boardIdx][cellIdx] && game.smallBoards[boardIdx][cellIdx] !== "") return;

    const newSmallBoards = game.smallBoards.map((board, bIdx) => {
      if (bIdx === boardIdx) {
        return {
          ...board,
          [cellIdx]: mySymbol
        };
      }
      return board;
    });

    const newMacroBoard = [...game.macroBoard];
    const subWin = checkSmallBoardWin(newSmallBoards[boardIdx]);
    if (subWin) {
      newMacroBoard[boardIdx] = subWin;
    }

    let nextActiveBoard: number | null = cellIdx;
    if (newMacroBoard[nextActiveBoard] !== "") {
      nextActiveBoard = null;
    }

    let newStatus = game.status;
    let newWinner = game.winner;

    const globalWin = checkMacroBoardWin(newMacroBoard);
    if (globalWin) {
      newStatus = "finished";
      newWinner = globalWin;
    }

    try {
      await updateDoc(doc(db, "games_utictactoe", gameId!), {
        smallBoards: newSmallBoards,
        macroBoard: newMacroBoard,
        activeBoard: nextActiveBoard,
        turn: mySymbol === "X" ? "O" : "X",
        status: newStatus,
        winner: newWinner,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Error placing move", e);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!gameId || !user) return;
    try {
      await updateDoc(doc(db, "games_utictactoe", gameId), {
        lastChat: {
          senderId: user.uid,
          text,
          sentAt: Date.now()
        },
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Error sending chat", e);
    }
  };

  if (!game || !user) {
    return <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-slate-950">Lade Arena...</div>;
  }

  const mySymbol = game.player1Id === user.uid ? "X" : "O";
  const myTurn = game.turn === mySymbol && game.status === "playing";

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      <nav className="shrink-0 h-16 border-b border-slate-200 dark:border-slate-800 px-4 md:px-8 flex items-center justify-between bg-white/80 dark:bg-slate-900/50 backdrop-blur-md z-10">
        <button
          onClick={() => navigate("/utictactoe")}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Lobby verlassen</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm uppercase font-bold text-slate-400">Spielmodus</span>
          <span className="px-3 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs font-black rounded-full uppercase tracking-wider">Ultimate TTT</span>
        </div>
        <ThemeToggle />
      </nav>

      <main className="flex-1 grid grid-cols-12 overflow-hidden p-4 md:p-6 gap-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-purple-500/5 via-transparent to-transparent pointer-events-none"></div>

        {/* Players Card */}
        <section className="col-span-12 lg:col-span-4 lg:col-start-2 flex flex-col gap-4 shrink-0">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs uppercase font-bold text-slate-400 tracking-widest">Die Spieler</h3>
              {game.status === "playing" && (
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></span>
              )}
            </div>

            <div className="flex flex-col gap-4">
              {/* Player 1 (Creator) */}
              <div className={cn(
                "flex items-center gap-4 p-3 rounded-2xl border transition-all duration-200",
                game.turn === "X" && game.status === "playing" 
                  ? "bg-purple-500/5 border-purple-500/40 shadow-lg shadow-purple-500/5 scale-105" 
                  : "bg-slate-50/50 dark:bg-slate-800/30 border-transparent"
              )}>
                <div className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center font-bold text-purple-400 shrink-0">
                  X
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {player1Data?.displayName || "Suche..."}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold font-mono uppercase tracking-widest mt-0.5">
                    {player1Data?.rating || 1000} ELO
                  </p>
                </div>
              </div>

              {/* Versus divider */}
              <div className="flex items-center justify-center text-xs font-black uppercase text-slate-400 tracking-wider">
                vs
              </div>

              {/* Player 2 (Opponent) */}
              <div className={cn(
                "flex items-center gap-4 p-3 rounded-2xl border transition-all duration-200",
                game.turn === "O" && game.status === "playing" 
                  ? "bg-purple-500/5 border-purple-500/40 shadow-lg shadow-purple-500/5 scale-105" 
                  : "bg-slate-50/50 dark:bg-slate-800/30 border-transparent"
              )}>
                <div className="w-10 h-10 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center font-bold text-indigo-400 shrink-0">
                  O
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {opponent?.displayName || "Suche..."}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold font-mono uppercase tracking-widest mt-0.5">
                    {opponent?.rating || 1000} ELO
                  </p>
                </div>
              </div>
            </div>

            {/* Game state message */}
            <div className="w-full h-px bg-slate-100 dark:bg-slate-800 my-1"></div>

            <div className="text-center">
              {game.status === "waiting" && (
                <div className="flex flex-col items-center gap-3">
                  <RefreshCw className="w-5 h-5 text-purple-500 animate-spin" />
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Warte auf Herausforderer...</p>
                </div>
              )}
              {game.status === "playing" && (
                <div>
                  <p className="text-xs uppercase font-bold text-slate-400 mb-1">Aktueller Zug</p>
                  <p className="text-lg font-black text-slate-800 dark:text-slate-200">
                    {myTurn 
                      ? "Du bist am Zug! ✨" 
                      : `${opponent?.displayName || "Gegner"} ist am Zug...`}
                  </p>
                </div>
              )}
              {game.status === "finished" && (
                <div className="flex flex-col gap-2">
                  <div className="w-10 h-10 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mx-auto text-amber-500 mb-1">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <p className="text-sm uppercase font-bold text-slate-400">Spiel beendet</p>
                  <p className="text-2xl font-black text-slate-800 dark:text-slate-100">
                    {game.winner === "draw" 
                      ? "Unentschieden! 🤝" 
                      : (game.winner === mySymbol ? "Sieg! 🎉" : "Niederlage... 😢")}
                  </p>
                  
                  {myOldRating !== null && myNewRating !== null && (
                    <div className="mt-3 bg-purple-500/10 border border-purple-500/20 rounded-2xl p-3 inline-block animate-in zoom-in-95 duration-300">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">ELO-Änderung</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="font-mono text-sm text-slate-500">{myOldRating}</span>
                        <span className="text-xs text-slate-400">➔</span>
                        <span className="font-mono text-lg font-black text-purple-400">{myNewRating} ELO</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Board Arena */}
        <section className="col-span-12 lg:col-span-6 flex flex-col justify-center items-center overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 md:p-6 rounded-[32px] shadow-2xl relative">
            
            {/* The 3x3 Macro Board Grid */}
            <div className="grid grid-cols-3 grid-rows-3 gap-3 md:gap-4 p-2 bg-slate-100 dark:bg-slate-850 rounded-2xl w-[320px] h-[320px] sm:w-[420px] sm:h-[420px] md:w-[480px] md:h-[480px] relative">
              {game.smallBoards.map((smallBoard, boardIdx) => {
                const boardWinner = game.macroBoard[boardIdx];
                
                const isBoardActive = game.status === "playing" && (
                  game.activeBoard === null || game.activeBoard === boardIdx
                ) && game.macroBoard[boardIdx] === "";

                return (
                  <div
                    key={boardIdx}
                    className={cn(
                      "relative rounded-xl border p-1 md:p-1.5 transition-all duration-300 grid grid-cols-3 grid-rows-3 gap-0.5 sm:gap-1 bg-white dark:bg-slate-900 overflow-hidden",
                      boardWinner !== "" ? "border-slate-200 dark:border-slate-800 opacity-60" : "border-slate-200 dark:border-slate-800",
                      isBoardActive && myTurn 
                        ? "ring-4 ring-purple-500 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.3)] animate-pulse" 
                        : isBoardActive 
                          ? "ring-2 ring-purple-500/20 border-purple-500/40" 
                          : ""
                    )}
                  >
                    {/* Inner 3x3 Cell Buttons */}
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((cellIdx) => {
                      const cellValue = smallBoard[cellIdx] || "";
                      const isCellClickable = game.status === "playing" && 
                        myTurn && 
                        (game.activeBoard === null || game.activeBoard === boardIdx) && 
                        boardWinner === "" && 
                        cellValue === "";

                      return (
                        <button
                          key={cellIdx}
                          disabled={!isCellClickable}
                          onClick={() => handleCellClick(boardIdx, cellIdx)}
                          className={cn(
                            "rounded-md text-xs sm:text-sm md:text-base font-black flex items-center justify-center transition-all duration-150 relative select-none",
                            cellValue === "" 
                              ? isCellClickable 
                                ? "bg-purple-500/5 dark:bg-purple-500/10 hover:bg-purple-500/20 text-transparent cursor-pointer hover:scale-105 active:scale-95" 
                                : "bg-slate-50 dark:bg-slate-900/50 cursor-not-allowed" 
                              : cellValue === "X" 
                                ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 font-extrabold shadow-inner" 
                                : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-extrabold shadow-inner"
                          )}
                        >
                          {cellValue}
                        </button>
                      );
                    })}

                    {/* Macro Win/Draw Overlay */}
                    {boardWinner !== "" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-slate-950/80 backdrop-blur-[1px] animate-in zoom-in-75 duration-200 z-10">
                        {boardWinner === "X" && (
                          <span className="text-5xl sm:text-7xl font-black text-purple-500/80 drop-shadow-[0_4px_8px_rgba(168,85,247,0.3)] select-none">
                            X
                          </span>
                        )}
                        {boardWinner === "O" && (
                          <span className="text-5xl sm:text-7xl font-black text-indigo-500/80 drop-shadow-[0_4px_8px_rgba(99,102,241,0.3)] select-none">
                            O
                          </span>
                        )}
                        {boardWinner === "draw" && (
                          <span className="text-xs sm:text-sm font-bold uppercase tracking-widest text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-full select-none">
                            DRAW
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Guide overlay on free moves */}
            {game.status === "playing" && game.activeBoard === null && (
              <div className="mt-4 text-center animate-in slide-in-from-bottom-2 fade-in duration-300">
                <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">
                  Freier Zug: Wähle ein beliebiges Feld!
                </span>
              </div>
            )}
          </div>
        </section>
      </main>

      {game.status === "playing" && (
        <QuickChat
          gameId={gameId!}
          collectionName="games_utictactoe"
          currentUserId={user.uid}
          player1Id={game.player1Id}
          player1Name={user.uid === game.player1Id ? (user.displayName || "Du") : (opponent?.displayName || "Gegner")}
          player2Name={user.uid === game.player1Id ? (opponent?.displayName || "Gegner") : (user.displayName || "Du")}
          lastChat={game.lastChat}
        />
      )}
    </div>
  );
}
