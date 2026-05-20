import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { Swords, Check, X, Loader2 } from "lucide-react";

interface Challenge {
  id: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  gameType: "tictactoe" | "connect4" | "dots" | "utictactoe" | "racing";
  status: "pending" | "accepted" | "declined";
  gameId: string | null;
}

export default function ChallengeManager() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [incomingChallenge, setIncomingChallenge] = useState<Challenge | null>(null);
  const [isResponding, setIsResponding] = useState(false);

  useEffect(() => {
    if (!user) {
      setIncomingChallenge(null);
      return;
    }

    // Query pending challenges where the current user is the receiver
    const q = query(
      collection(db, "challenges"),
      where("receiverId", "==", user.uid),
      where("status", "==", "pending")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        setIncomingChallenge(null);
        return;
      }
      
      // Get the most recent pending challenge
      const doc = snapshot.docs[0];
      setIncomingChallenge({
        id: doc.id,
        ...doc.data()
      } as Challenge);
    }, (error) => {
      console.error("Error listening to incoming challenges:", error);
    });

    return () => unsubscribe();
  }, [user]);

  if (!user || !incomingChallenge) return null;

  const handleAccept = async () => {
    setIsResponding(true);
    try {
      let newGameRef;
      let gameData: any = {
        player1Id: incomingChallenge.senderId,
        player1Name: incomingChallenge.senderName,
        player2Id: user.uid,
        player2Name: user.displayName || "Spieler",
        status: "playing",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      // Create the appropriate game instance
      if (incomingChallenge.gameType === "tictactoe") {
        newGameRef = doc(collection(db, "games"));
        gameData = {
          ...gameData,
          board: Array(9).fill(""),
          turn: "X",
          winner: null
        };
      } else if (incomingChallenge.gameType === "connect4") {
        newGameRef = doc(collection(db, "games_connect4"));
        gameData = {
          ...gameData,
          board: Array(42).fill(""),
          turn: "red",
          winner: null
        };
      } else if (incomingChallenge.gameType === "dots") {
        newGameRef = doc(collection(db, "games_dots"));
        gameData = {
          ...gameData,
          board: Array(56).fill(""),
          turn: "blue",
          winner: null
        };
      } else if (incomingChallenge.gameType === "utictactoe") {
        newGameRef = doc(collection(db, "games_utictactoe"));
        const initialSmallBoards = Array(9).fill(null).map(() => ({"0": "", "1": "", "2": "", "3": "", "4": "", "5": "", "6": "", "7": "", "8": ""}));
        const initialMacroBoard = Array(9).fill("");
        gameData = {
          ...gameData,
          smallBoards: initialSmallBoards,
          macroBoard: initialMacroBoard,
          activeBoard: null,
          turn: "X",
          winner: null
        };
      } else {
        newGameRef = doc(collection(db, "games_racing"));
        gameData = {
          ...gameData,
          trackId: Math.random() < 0.5 ? "neon-gp" : "drift-canyon",
          player1Time: null,
          player2Time: null,
          winnerId: null,
          winnerName: null
        };
      }

      // Write game document
      await setDoc(newGameRef, gameData);

      // Update challenge document
      await setDoc(doc(db, "challenges", incomingChallenge.id), {
        status: "accepted",
        gameId: newGameRef.id,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Navigate to game board
      if (incomingChallenge.gameType === "tictactoe") {
        navigate(`/game/${newGameRef.id}`);
      } else if (incomingChallenge.gameType === "connect4") {
        navigate(`/connect4/game/${newGameRef.id}`);
      } else if (incomingChallenge.gameType === "dots") {
        navigate(`/dots/game/${newGameRef.id}`);
      } else if (incomingChallenge.gameType === "utictactoe") {
        navigate(`/utictactoe/game/${newGameRef.id}`);
      } else {
        navigate(`/racing/game/${newGameRef.id}`);
      }
    } catch (err) {
      console.error("Error accepting challenge:", err);
    } finally {
      setIsResponding(false);
      setIncomingChallenge(null);
    }
  };

  const handleDecline = async () => {
    setIsResponding(true);
    try {
      await setDoc(doc(db, "challenges", incomingChallenge.id), {
        status: "declined",
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error("Error declining challenge:", err);
    } finally {
      setIsResponding(false);
      setIncomingChallenge(null);
    }
  };

  const getGameName = (type: "tictactoe" | "connect4" | "dots" | "utictactoe" | "racing") => {
    switch (type) {
      case "tictactoe": return "TicTacToe Elite";
      case "connect4": return "4 Gewinnt Elite";
      case "dots": return "Käsekästchen Elite";
      case "utictactoe": return "Ultimate TTT Elite";
      case "racing": return "Retro Racer Elite";
      default: return "Spiel";
    }
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-2rem)] max-w-md bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border border-indigo-500/30 rounded-2xl p-4 shadow-2xl flex items-center justify-between gap-4 animate-in slide-in-from-top-10 fade-in duration-300">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
          <Swords className="w-5 h-5 animate-pulse" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-indigo-500">Duell-Herausforderung</div>
          <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
            <strong>{incomingChallenge.senderName}</strong> fordert dich zu <strong>{getGameName(incomingChallenge.gameType)}</strong> heraus!
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-2 shrink-0">
        {isResponding ? (
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        ) : (
          <>
            <button
              onClick={handleAccept}
              className="w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-colors shadow-md shadow-indigo-900/10"
              title="Akzeptieren"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={handleDecline}
              className="w-8 h-8 rounded-lg bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-colors shadow-md shadow-rose-900/10"
              title="Ablehnen"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
