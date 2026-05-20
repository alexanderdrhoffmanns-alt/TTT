import React, { useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { collection, query, where, getDocs, doc, getDoc, orderBy, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Trophy, Flag, Handshake, Swords, Trash2, UserPlus, Loader2, Gamepad2, X, Car, Pencil, Check } from "lucide-react";
import { ThemeToggle } from "../components/ThemeToggle";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "../lib/utils";

interface GameHistory {
  id: string;
  opponentId: string;
  opponentName: string;
  mySymbol: "X" | "O";
  winner: string | null;
  status: string;
  updatedAt: Date;
  estimatedEloChange: number;
}

interface UserStats {
  displayName: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  percentile: number;
  connect4_rating: number;
  connect4_gamesPlayed: number;
  connect4_wins: number;
  connect4_losses: number;
  connect4_draws: number;
  connect4_percentile: number;
  dots_rating: number;
  dots_gamesPlayed: number;
  dots_wins: number;
  dots_losses: number;
  dots_draws: number;
  dots_percentile: number;
  utictactoe_rating: number;
  utictactoe_gamesPlayed: number;
  utictactoe_wins: number;
  utictactoe_losses: number;
  utictactoe_draws: number;
  utictactoe_percentile: number;
  racing_rating: number;
  racing_gamesPlayed: number;
  racing_wins: number;
  racing_losses: number;
  racing_draws: number;
  racing_percentile: number;
  createdAt: Date;
}

const calculateEloDelta = (myRating: number, oppRating: number, outcome: 1 | 0.5 | 0) => {
  const expected = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(32 * (outcome - expected));
};

const formatMs = (ms: number | null) => {
  if (ms === null || ms === undefined) return "--:--";
  const totalSec = ms / 1000;
  const sec = Math.floor(totalSec);
  const fract = Math.floor((totalSec - sec) * 100);
  return `${sec}.${fract.toString().padStart(2, "0")}s`;
};

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [history, setHistory] = useState<GameHistory[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [historyC4, setHistoryC4] = useState<GameHistory[]>([]);
  const [chartDataC4, setChartDataC4] = useState<any[]>([]);
  const [historyDots, setHistoryDots] = useState<GameHistory[]>([]);
  const [chartDataDots, setChartDataDots] = useState<any[]>([]);
  const [historyUtictactoe, setHistoryUtictactoe] = useState<GameHistory[]>([]);
  const [chartDataUtictactoe, setChartDataUtictactoe] = useState<any[]>([]);
  const [historyRacing, setHistoryRacing] = useState<any[]>([]);
  const [chartDataRacing, setChartDataRacing] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "tictactoe" | "connect4" | "dots" | "utictactoe" | "racing" | "friends">("overview");

  // Display Name Editor State
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  // Sync newName when stats load
  useEffect(() => {
    if (stats?.displayName) {
      setNewName(stats.displayName);
    }
  }, [stats]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setNameError("Name darf nicht leer sein.");
      return;
    }
    if (trimmedName.length > 50) {
      setNameError("Name darf maximal 50 Zeichen lang sein.");
      return;
    }
    setIsSavingName(true);
    setNameError("");
    try {
      await updateProfile(user, { displayName: trimmedName });
      await setDoc(doc(db, "users", user.uid), { displayName: trimmedName }, { merge: true });
      setStats(prev => prev ? { ...prev, displayName: trimmedName } : null);
      setIsEditingName(false);
    } catch (err: any) {
      console.error("Error saving display name:", err);
      setNameError(err.message || "Fehler beim Speichern.");
    } finally {
      setIsSavingName(false);
    }
  };

  // Friends system state
  const [friendsList, setFriendsList] = useState<{ uid: string; displayName: string; email: string }[]>([]);
  const [searchEmail, setSearchEmail] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searchSuccess, setSearchSuccess] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // Challenge flow states
  const [selectedFriend, setSelectedFriend] = useState<{ uid: string; displayName: string } | null>(null);
  const [showGameSelector, setShowGameSelector] = useState(false);
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<"pending" | "accepted" | "declined" | null>(null);

  // Load friends list
  useEffect(() => {
    if (!user) return;
    const friendsRef = collection(db, "users", user.uid, "friends");
    const unsubscribe = onSnapshot(friendsRef, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      } as { uid: string; displayName: string; email: string }));
      setFriendsList(list);
    }, (error) => {
      console.error("Error loading friends:", error);
    });
    return () => unsubscribe();
  }, [user]);

  // Listen to active challenge document
  useEffect(() => {
    if (!activeChallengeId) return;

    const unsubscribe = onSnapshot(doc(db, "challenges", activeChallengeId), (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      setChallengeStatus(data.status);

      if (data.status === "accepted" && data.gameId) {
        const gameId = data.gameId;
        setActiveChallengeId(null);
        setSelectedFriend(null);
        
        if (data.gameType === "tictactoe") {
          navigate(`/game/${gameId}`);
        } else if (data.gameType === "connect4") {
          navigate(`/connect4/game/${gameId}`);
        } else if (data.gameType === "dots") {
          navigate(`/dots/game/${gameId}`);
        } else if (data.gameType === "utictactoe") {
          navigate(`/utictactoe/game/${gameId}`);
        } else if (data.gameType === "racing") {
          navigate(`/racing/game/${gameId}`);
        }
      }
    });

    return () => unsubscribe();
  }, [activeChallengeId, navigate]);

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSearchError("");
    setSearchSuccess("");
    setIsSearching(true);

    try {
      const emailQuery = searchEmail.trim().toLowerCase();
      if (emailQuery === user.email?.toLowerCase()) {
        throw new Error("Du kannst dich nicht selbst als Freund hinzufügen!");
      }

      const q = query(collection(db, "users"), where("email", "==", emailQuery));
      const querySnap = await getDocs(q);

      if (querySnap.empty) {
        throw new Error("Kein Spieler mit dieser E-Mail-Adresse gefunden.");
      }

      const friendDoc = querySnap.docs[0];
      const friendData = friendDoc.data();
      const friendUid = friendDoc.id;

      if (friendsList.some(f => f.uid === friendUid)) {
        throw new Error("Dieser Spieler ist bereits in deiner Freundesliste.");
      }

      await setDoc(doc(db, "users", user.uid, "friends", friendUid), {
        displayName: friendData.displayName || "Spieler",
        email: friendData.email || emailQuery,
        addedAt: serverTimestamp()
      });

      setSearchSuccess(`${friendData.displayName || "Spieler"} wurde erfolgreich hinzugefügt!`);
      setSearchEmail("");
    } catch (err: any) {
      console.error("Add friend error:", err);
      setSearchError(err.message || "Fehler beim Hinzufügen des Freundes.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleRemoveFriend = async (friendUid: string) => {
    if (!user) return;
    setIsRemoving(true);
    try {
      await deleteDoc(doc(db, "users", user.uid, "friends", friendUid));
    } catch (err) {
      console.error("Remove friend error:", err);
    } finally {
      setIsRemoving(false);
    }
  };

  const handleStartChallenge = async (gameType: "tictactoe" | "connect4" | "dots" | "utictactoe" | "racing") => {
    if (!user || !selectedFriend) return;
    setShowGameSelector(false);
    setChallengeStatus("pending");

    try {
      const challengeRef = doc(collection(db, "challenges"));
      await setDoc(challengeRef, {
        senderId: user.uid,
        senderName: user.displayName || "Spieler",
        receiverId: selectedFriend.uid,
        gameType: gameType,
        status: "pending",
        gameId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setActiveChallengeId(challengeRef.id);
    } catch (err) {
      console.error("Challenge error:", err);
      setChallengeStatus(null);
      setSelectedFriend(null);
    }
  };

  const handleCancelChallenge = async () => {
    if (!activeChallengeId) return;
    try {
      await setDoc(doc(db, "challenges", activeChallengeId), {
        status: "declined",
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error("Cancel challenge error:", err);
    } finally {
      setActiveChallengeId(null);
      setSelectedFriend(null);
    }
  };

  useEffect(() => {
    if (!user) return;

    const fetchProfileData = async () => {
      try {
        // 1. Fetch user document
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;
        const userData = userSnap.data();
        const lowerEmail = (user.email || "").toLowerCase();
        if (userData && userData.email !== lowerEmail && lowerEmail) {
          await setDoc(userRef, { email: lowerEmail }, { merge: true });
        }

        // 2. Fetch all users to calculate percentile
        const allUsersSnap = await getDocs(collection(db, "users"));
        const allUsers = allUsersSnap.docs.map(d => d.data());
        const totalUsers = allUsers.length;
        const usersBelow = allUsers.filter(u => u.rating < userData.rating).length;
        const percentile = totalUsers > 1 ? Math.round((usersBelow / (totalUsers - 1)) * 100) : 100;

        setStats({
          displayName: userData.displayName || "Spieler",
          rating: userData.rating,
          gamesPlayed: userData.gamesPlayed,
          wins: userData.wins,
          losses: userData.losses,
          draws: userData.draws,
          percentile,
          connect4_rating: userData.connect4_rating || 1000,
          connect4_gamesPlayed: userData.connect4_gamesPlayed || 0,
          connect4_wins: userData.connect4_wins || 0,
          connect4_losses: userData.connect4_losses || 0,
          connect4_draws: userData.connect4_draws || 0,
          connect4_percentile: Math.round((allUsers.filter(u => (u.connect4_rating||1000) < (userData.connect4_rating||1000)).length / Math.max(1, totalUsers - 1)) * 100),
          dots_rating: userData.dots_rating || 1000,
          dots_gamesPlayed: userData.dots_gamesPlayed || 0,
          dots_wins: userData.dots_wins || 0,
          dots_losses: userData.dots_losses || 0,
          dots_draws: userData.dots_draws || 0,
          dots_percentile: Math.round((allUsers.filter(u => (u.dots_rating||1000) < (userData.dots_rating||1000)).length / Math.max(1, totalUsers - 1)) * 100),
          utictactoe_rating: userData.utictactoe_rating || 1000,
          utictactoe_gamesPlayed: userData.utictactoe_gamesPlayed || 0,
          utictactoe_wins: userData.utictactoe_wins || 0,
          utictactoe_losses: userData.utictactoe_losses || 0,
          utictactoe_draws: userData.utictactoe_draws || 0,
          utictactoe_percentile: Math.round((allUsers.filter(u => (u.utictactoe_rating||1000) < (userData.utictactoe_rating||1000)).length / Math.max(1, totalUsers - 1)) * 100),
          racing_rating: userData.racing_rating || 1000,
          racing_gamesPlayed: userData.racing_gamesPlayed || 0,
          racing_wins: userData.racing_wins || 0,
          racing_losses: userData.racing_losses || 0,
          racing_draws: userData.racing_draws || 0,
          racing_percentile: Math.round((allUsers.filter(u => (u.racing_rating||1000) < (userData.racing_rating||1000)).length / Math.max(1, totalUsers - 1)) * 100),
          createdAt: userData.createdAt?.toDate() || new Date()
        });

        // 3. Fetch finished games by fetching all and filtering (to avoid composite index requirements)
        const q1 = query(collection(db, "games"), where("player1Id", "==", user.uid));
        const q2 = query(collection(db, "games"), where("player2Id", "==", user.uid));
        
        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        const allFinishedGames = [...snap1.docs, ...snap2.docs]
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((g: any) => g.status === "finished");

        // Sort by updatedAt primarily to reconstruct timeline
        allFinishedGames.sort((a: any, b: any) => {
          const tA = a.updatedAt?.toMillis() || 0;
          const tB = b.updatedAt?.toMillis() || 0;
          return tA - tB; // Ascending
        });

        let currentSimulatedRating = 1000; // start at 1000
        const parsedHistory: GameHistory[] = [];
        const newChartData: any[] = [{ name: "Start", ELO: 1000 }];

        // Cache for opponents
        const opponentCache: Record<string, any> = {};

        for (let i = 0; i < allFinishedGames.length; i++) {
          const g: any = allFinishedGames[i];
          const isPlayer1 = g.player1Id === user.uid;
          const oppId = isPlayer1 ? g.player2Id : g.player1Id;
          const mySymbol = isPlayer1 ? "X" : "O";

          let oppData = opponentCache[oppId];
          if (!oppData && oppId) {
            const oppRef = doc(db, "users", oppId);
            const oppSnap = await getDoc(oppRef);
            if (oppSnap.exists()) {
              oppData = oppSnap.data();
              opponentCache[oppId] = oppData;
            }
          }

          let outcome: 1 | 0.5 | 0 = 0.5;
          if (g.winner === mySymbol) outcome = 1;
          else if (g.winner && g.winner !== "draw") outcome = 0;

          const oppRating = oppData ? oppData.rating : 1000;
          const eloDelta = calculateEloDelta(currentSimulatedRating, oppRating, outcome);
          currentSimulatedRating += eloDelta;

          parsedHistory.push({
            id: g.id,
            opponentId: oppId,
            opponentName: oppData ? oppData.displayName : "Unknown",
            mySymbol,
            winner: g.winner,
            status: g.status,
            updatedAt: g.updatedAt?.toDate() || new Date(),
            estimatedEloChange: eloDelta
          });

          newChartData.push({
            name: `Spiel ${i + 1}`,
            ELO: currentSimulatedRating,
            date: g.updatedAt?.toDate() || new Date()
          });
        }

        // If the simulated rating differs heavily from actual rating, we could adjust 
        // the latest chart node to match actual rating, but this is a rough estimation anyway.
        if (allFinishedGames.length > 0) {
            newChartData[newChartData.length - 1].ELO = userData.rating;
        }

        parsedHistory.reverse(); // Show newest first
        setHistory(parsedHistory);
        setChartData(newChartData);

        // 4. Fetch Connect 4 Games
        const qC41 = query(collection(db, "games_connect4"), where("player1Id", "==", user.uid));
        const qC42 = query(collection(db, "games_connect4"), where("player2Id", "==", user.uid));
        const [snapC41, snapC42] = await Promise.all([getDocs(qC41), getDocs(qC42)]);
        const allFinishedGamesC4 = [...snapC41.docs, ...snapC42.docs]
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((g: any) => g.status === "finished");

        allFinishedGamesC4.sort((a: any, b: any) => {
          const tA = a.updatedAt?.toMillis() || 0;
          const tB = b.updatedAt?.toMillis() || 0;
          return tA - tB;
        });

        let currentSimulatedRatingC4 = 1000;
        const parsedHistoryC4: GameHistory[] = [];
        const newChartDataC4: any[] = [{ name: "Start", ELO: 1000 }];

        for (let i = 0; i < allFinishedGamesC4.length; i++) {
          const g: any = allFinishedGamesC4[i];
          const isPlayer1 = g.player1Id === user.uid;
          const oppId = isPlayer1 ? g.player2Id : g.player1Id;
          const mySymbol = isPlayer1 ? "red" : "yellow";

          let oppData = opponentCache[oppId];
          if (!oppData && oppId) {
            const oppRef = doc(db, "users", oppId);
            const oppSnap = await getDoc(oppRef);
            if (oppSnap.exists()) {
              oppData = oppSnap.data();
              opponentCache[oppId] = oppData;
            }
          }

          let outcome: 1 | 0.5 | 0 = 0.5;
          if (g.winner === mySymbol) outcome = 1;
          else if (g.winner && g.winner !== "draw") outcome = 0;

          const oppRating = oppData ? (oppData.connect4_rating || 1000) : 1000;
          const eloDelta = calculateEloDelta(currentSimulatedRatingC4, oppRating, outcome);
          currentSimulatedRatingC4 += eloDelta;

          parsedHistoryC4.push({
            id: g.id,
            opponentId: oppId,
            opponentName: oppData ? oppData.displayName : "Unknown",
            mySymbol: mySymbol as any,
            winner: g.winner,
            status: g.status,
            updatedAt: g.updatedAt?.toDate() || new Date(),
            estimatedEloChange: eloDelta
          });

          newChartDataC4.push({
            name: `Spiel ${i + 1}`,
            ELO: currentSimulatedRatingC4,
            date: g.updatedAt?.toDate() || new Date()
          });
        }

        if (allFinishedGamesC4.length > 0) {
            newChartDataC4[newChartDataC4.length - 1].ELO = userData.connect4_rating || 1000;
        }

        parsedHistoryC4.reverse();
        setHistoryC4(parsedHistoryC4);
        setChartDataC4(newChartDataC4);

        // 5. Fetch Dots Games
        const qDots1 = query(collection(db, "games_dots"), where("player1Id", "==", user.uid));
        const qDots2 = query(collection(db, "games_dots"), where("player2Id", "==", user.uid));
        const [snapDots1, snapDots2] = await Promise.all([getDocs(qDots1), getDocs(qDots2)]);
        const allFinishedGamesDots = [...snapDots1.docs, ...snapDots2.docs]
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((g: any) => g.status === "finished");

        allFinishedGamesDots.sort((a: any, b: any) => {
          const tA = a.updatedAt?.toMillis() || 0;
          const tB = b.updatedAt?.toMillis() || 0;
          return tA - tB;
        });

        let currentSimulatedRatingDots = 1000;
        const parsedHistoryDots: GameHistory[] = [];
        const newChartDataDots: any[] = [{ name: "Start", ELO: 1000 }];

        for (let i = 0; i < allFinishedGamesDots.length; i++) {
          const g: any = allFinishedGamesDots[i];
          const isPlayer1 = g.player1Id === user.uid;
          const oppId = isPlayer1 ? g.player2Id : g.player1Id;
          const mySymbol = isPlayer1 ? "blue" : "red";

          let oppData = opponentCache[oppId];
          if (!oppData && oppId) {
            const oppRef = doc(db, "users", oppId);
            const oppSnap = await getDoc(oppRef);
            if (oppSnap.exists()) {
              oppData = oppSnap.data();
              opponentCache[oppId] = oppData;
            }
          }

          let outcome: 1 | 0.5 | 0 = 0.5;
          if (g.winner === mySymbol) outcome = 1;
          else if (g.winner && g.winner !== "draw") outcome = 0;

          const oppRating = oppData ? (oppData.dots_rating || 1000) : 1000;
          const eloDelta = calculateEloDelta(currentSimulatedRatingDots, oppRating, outcome);
          currentSimulatedRatingDots += eloDelta;

          parsedHistoryDots.push({
            id: g.id,
            opponentId: oppId,
            opponentName: oppData ? oppData.displayName : "Unknown",
            mySymbol: mySymbol as any,
            winner: g.winner,
            status: g.status,
            updatedAt: g.updatedAt?.toDate() || new Date(),
            estimatedEloChange: eloDelta
          });

          newChartDataDots.push({
            name: `Spiel ${i + 1}`,
            ELO: currentSimulatedRatingDots,
            date: g.updatedAt?.toDate() || new Date()
          });
        }

        if (allFinishedGamesDots.length > 0) {
            newChartDataDots[newChartDataDots.length - 1].ELO = userData.dots_rating || 1000;
        }

        parsedHistoryDots.reverse();
        setHistoryDots(parsedHistoryDots);
        setChartDataDots(newChartDataDots);

        // 6. Fetch Ultimate Tic Tac Toe Games
        const qUtictactoe1 = query(collection(db, "games_utictactoe"), where("player1Id", "==", user.uid));
        const qUtictactoe2 = query(collection(db, "games_utictactoe"), where("player2Id", "==", user.uid));
        const [snapUtictactoe1, snapUtictactoe2] = await Promise.all([getDocs(qUtictactoe1), getDocs(qUtictactoe2)]);
        const allFinishedGamesUtictactoe = [...snapUtictactoe1.docs, ...snapUtictactoe2.docs]
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((g: any) => g.status === "finished");

        allFinishedGamesUtictactoe.sort((a: any, b: any) => {
          const tA = a.updatedAt?.toMillis() || 0;
          const tB = b.updatedAt?.toMillis() || 0;
          return tA - tB;
        });

        let currentSimulatedRatingUtictactoe = 1000;
        const parsedHistoryUtictactoe: GameHistory[] = [];
        const newChartDataUtictactoe: any[] = [{ name: "Start", ELO: 1000 }];

        for (let i = 0; i < allFinishedGamesUtictactoe.length; i++) {
          const g: any = allFinishedGamesUtictactoe[i];
          const isPlayer1 = g.player1Id === user.uid;
          const oppId = isPlayer1 ? g.player2Id : g.player1Id;
          const mySymbol = isPlayer1 ? "X" : "O";

          let oppData = opponentCache[oppId];
          if (!oppData && oppId) {
            const oppRef = doc(db, "users", oppId);
            const oppSnap = await getDoc(oppRef);
            if (oppSnap.exists()) {
              oppData = oppSnap.data();
              opponentCache[oppId] = oppData;
            }
          }

          let outcome: 1 | 0.5 | 0 = 0.5;
          if (g.winner === mySymbol) outcome = 1;
          else if (g.winner && g.winner !== "draw") outcome = 0;

          const oppRating = oppData ? (oppData.utictactoe_rating || 1000) : 1000;
          const eloDelta = calculateEloDelta(currentSimulatedRatingUtictactoe, oppRating, outcome);
          currentSimulatedRatingUtictactoe += eloDelta;

          parsedHistoryUtictactoe.push({
            id: g.id,
            opponentId: oppId,
            opponentName: oppData ? oppData.displayName : "Unknown",
            mySymbol: mySymbol as any,
            winner: g.winner,
            status: g.status,
            updatedAt: g.updatedAt?.toDate() || new Date(),
            estimatedEloChange: eloDelta
          });

          newChartDataUtictactoe.push({
            name: `Spiel ${i + 1}`,
            ELO: currentSimulatedRatingUtictactoe,
            date: g.updatedAt?.toDate() || new Date()
          });
        }

        if (allFinishedGamesUtictactoe.length > 0) {
            newChartDataUtictactoe[newChartDataUtictactoe.length - 1].ELO = userData.utictactoe_rating || 1000;
        }

        parsedHistoryUtictactoe.reverse();
        setHistoryUtictactoe(parsedHistoryUtictactoe);
        setChartDataUtictactoe(newChartDataUtictactoe);

        // 7. Fetch Racing Games (Solo Time Trials)
        const qRacing = query(
          collection(db, "games_racing"), 
          where("player1Id", "==", user.uid),
          where("player2Id", "==", null),
          where("status", "==", "finished")
        );
        const snapRacing = await getDocs(qRacing);
        const allFinishedGamesRacing = snapRacing.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            trackId: data.trackId,
            player1Time: data.player1Time,
            createdAt: data.createdAt?.toDate() || new Date()
          };
        });

        // Sort by date descending (newest first)
        allFinishedGamesRacing.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        setHistoryRacing(allFinishedGamesRacing);
        setChartDataRacing([]);
        setIsLoading(false);

      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "users/games");
        setIsLoading(false);
      }
    };

    fetchProfileData();
  }, [user]);

  const getPersonalBest = (trackId: "neon-gp" | "drift-canyon") => {
    const runs = historyRacing.filter(r => r.trackId === trackId && r.player1Time != null);
    if (runs.length === 0) return null;
    return Math.min(...runs.map(r => r.player1Time));
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-indigo-500 animate-pulse font-bold text-xl">Lade Profil...</div>
      </div>
    );
  }

  if (!stats) return <div className="p-8 text-center text-rose-500">Profil nicht gefunden.</div>;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      <nav className="shrink-0 h-16 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center bg-white/80 dark:bg-slate-900/50 backdrop-blur-md">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 mr-4 hover:bg-slate-100 dark:bg-slate-800 rounded-full transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Mein <span className="text-indigo-500">Profil</span></span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-8">
          
          {/* Header & Tabs */}
          <div className="flex flex-col gap-4 sm:p-6">
            <div className="flex items-center gap-4 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl">
              <div className="w-20 h-20 shrink-0 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 border-2 border-white dark:border-slate-800 flex items-center justify-center text-3xl font-black text-white uppercase shadow-inner">
                 {(stats.displayName || user?.displayName || user?.email || "Sp")?.substring(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                {isEditingName ? (
                  <form onSubmit={handleSaveName} className="flex flex-col gap-2 max-w-md">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => {
                          setNewName(e.target.value);
                          setNameError("");
                        }}
                        className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 text-lg font-bold w-full"
                        placeholder="Spielername"
                        disabled={isSavingName}
                        autoFocus
                      />
                      <button
                        type="submit"
                        disabled={isSavingName}
                        className="p-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 rounded-xl transition-all shadow-md flex items-center justify-center shrink-0"
                        title="Speichern"
                      >
                        {isSavingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingName(false);
                          setNewName(stats.displayName);
                          setNameError("");
                        }}
                        disabled={isSavingName}
                        className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all shrink-0"
                        title="Abbrechen"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {nameError && (
                      <p className="text-xs text-rose-500 font-semibold">{nameError}</p>
                    )}
                  </form>
                ) : (
                  <div className="flex items-center gap-2 group/title">
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white truncate">
                      {stats.displayName || user?.displayName || "Spieler"}
                    </h1>
                    <button
                      onClick={() => setIsEditingName(true)}
                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-950 dark:hover:text-white rounded-lg transition-all opacity-0 group-hover/title:opacity-100 focus:opacity-100"
                      title="Name bearbeiten"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <p className="text-slate-500 dark:text-slate-400 font-medium">Elite Gamer</p>
              </div>
            </div>

            <div className="flex space-x-2 border-b border-slate-200 dark:border-slate-800 pb-px overflow-x-auto">
              <button
                onClick={() => setActiveTab("overview")}
                className={cn(
                  "px-6 py-3 font-bold text-sm transition-colors border-b-2 whitespace-nowrap",
                  activeTab === "overview" 
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                Übersicht
              </button>
              <button
                onClick={() => setActiveTab("tictactoe")}
                className={cn(
                  "px-6 py-3 font-bold text-sm transition-colors border-b-2 whitespace-nowrap",
                  activeTab === "tictactoe" 
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                TicTacToe Elite
              </button>

              <button
                onClick={() => setActiveTab("connect4")}
                className={cn(
                  "px-6 py-3 font-bold text-sm transition-colors border-b-2 whitespace-nowrap",
                  activeTab === "connect4" 
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                4 Gewinnt Elite
              </button>

              <button
                onClick={() => setActiveTab("dots")}
                className={cn(
                  "px-6 py-3 font-bold text-sm transition-colors border-b-2 whitespace-nowrap",
                  activeTab === "dots" 
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                Käsekästchen Elite
              </button>

              <button
                onClick={() => setActiveTab("utictactoe")}
                className={cn(
                  "px-6 py-3 font-bold text-sm transition-colors border-b-2 whitespace-nowrap",
                  activeTab === "utictactoe" 
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                Ultimate TicTacToe
              </button>

              <button
                onClick={() => setActiveTab("racing")}
                className={cn(
                  "px-6 py-3 font-bold text-sm transition-colors border-b-2 whitespace-nowrap",
                  activeTab === "racing" 
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                Retro Racer Elite
              </button>

              <button
                onClick={() => setActiveTab("friends")}
                className={cn(
                  "px-6 py-3 font-bold text-sm transition-colors border-b-2 whitespace-nowrap",
                  activeTab === "friends" 
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" 
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                Freunde ({friendsList.length})
              </button>
            </div>
          </div>

          {activeTab === "overview" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Account Info */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
                <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-6">Account Info</h3>
                <div className="space-y-6">
                  <div>
                    <span className="text-xs font-bold text-slate-500 uppercase">Mitglied seit</span>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                      {stats.createdAt.toLocaleDateString("de-DE", { day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-sm text-slate-500 font-medium mt-1">
                      (Seit {Math.max(0, Math.floor((new Date().getTime() - stats.createdAt.getTime()) / (1000 * 3600 * 24)))} Tagen dabei)
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-500 uppercase">Gespielte Spiele (Gesamt)</span>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{stats.gamesPlayed}</p>
                  </div>
                </div>
              </div>

              {/* Friends Summary */}
              <div 
                onClick={() => setActiveTab("friends")}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden cursor-pointer hover:border-indigo-500/50 dark:hover:border-indigo-500/50 transition-all duration-300"
              >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent pointer-events-none"></div>
                <div className="relative z-10 flex flex-col h-full justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-4">Freundesliste</h3>
                    <p className="text-3xl font-black text-slate-900 dark:text-white mb-2">{friendsList.length}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                      Hinzugefügte Freunde, die du direkt zu Ranglisten-Duellen herausfordern kannst.
                    </p>
                  </div>
                  <button className="mt-6 text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest text-left hover:translate-x-1 transition-transform">
                    Verwalten & Herausfordern →
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "tictactoe" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Top Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
              <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mb-2">Rating</span>
              <span className="text-2xl sm:text-4xl font-black text-indigo-400">{stats.rating}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">
                {stats.percentile >= 50 ? `Top ${100 - stats.percentile}% der Spieler` : `Untere ${stats.percentile}% der Spieler`}
              </span>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
                <Trophy className="w-5 h-5" />
              </div>
              <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.wins}</span>
              <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Siege</span>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mb-3">
                <Flag className="w-5 h-5" />
              </div>
              <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.losses}</span>
              <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Niederlagen</span>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-full bg-slate-500/10 text-slate-500 dark:text-slate-400 flex items-center justify-center mb-3">
                <Handshake className="w-5 h-5" />
              </div>
              <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.draws}</span>
              <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Unentschieden</span>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl h-80">
            <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-6">Wertungs-Verlauf</h3>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <Line type="monotone" dataKey="ELO" stroke="#818cf8" strokeWidth={3} dot={{ r: 4, fill: "#312e81", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                <CartesianGrid stroke="#1e293b" strokeDasharray="5 5" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} domain={['dataMin - 50', 'dataMax + 50']} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', color: '#f8fafc', fontWeight: 'bold' }}
                  itemStyle={{ color: '#818cf8' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* History */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">Spielverlauf</h3>
            </div>
            {history.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                Noch keine Spiele gespielt.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/50">
                {history.map(game => {
                  let resultClass = "text-slate-500 dark:text-slate-400";
                  let resultText = "Unentschieden";
                  
                  if (game.winner === game.mySymbol) {
                    resultClass = "text-emerald-500";
                    resultText = "Sieg";
                  } else if (game.winner && game.winner !== "draw") {
                    resultClass = "text-rose-500";
                    resultText = "Niederlage";
                  }

                  const eloColor = game.estimatedEloChange > 0 ? "text-emerald-400" : game.estimatedEloChange < 0 ? "text-rose-400" : "text-slate-500 dark:text-slate-400";
                  const eloPrefix = game.estimatedEloChange > 0 ? "+" : "";

                  return (
                    <div key={game.id} className="p-4 sm:p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 hover:bg-slate-100 dark:bg-slate-800/20 transition-colors">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className={cn("w-2 h-12 rounded-full", resultClass.replace("text-", "bg-"))}></div>
                        <div>
                          <p className="text-sm text-slate-500 dark:text-slate-400 font-bold uppercase mb-1">Gegner</p>
                          <p className="text-lg font-bold text-slate-900 dark:text-white">{game.opponentName}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:p-6 sm:gap-12 items-center">
                        <div>
                          <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Ergebnis</p>
                          <p className={cn("font-bold", resultClass)}>{resultText}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">ELO Änderung</p>
                          <p className={cn("font-bold font-mono", eloColor)}>{eloPrefix}{game.estimatedEloChange}</p>
                        </div>
                        <div className="col-span-2 sm:col-span-1 text-left sm:text-right">
                          <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Datum</p>
                          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            {game.updatedAt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
            </div>
          )}

          {activeTab === "connect4" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Top Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mb-2">Rating</span>
                  <span className="text-2xl sm:text-4xl font-black text-indigo-400">{stats.connect4_rating}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">
                    {stats.connect4_percentile >= 50 ? `Top ${100 - stats.connect4_percentile}% der Spieler` : `Untere ${stats.connect4_percentile}% der Spieler`}
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.connect4_wins}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Siege</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mb-3">
                    <Flag className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.connect4_losses}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Niederlagen</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-slate-500/10 text-slate-500 dark:text-slate-400 flex items-center justify-center mb-3">
                    <Handshake className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.connect4_draws}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Unentschieden</span>
                </div>
              </div>

              {/* Chart */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl h-80">
                <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-6">Wertungs-Verlauf</h3>
                {chartDataC4.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartDataC4} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <Line type="monotone" dataKey="ELO" stroke="#818cf8" strokeWidth={3} dot={{ r: 4, fill: "#312e81", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      <CartesianGrid stroke="#1e293b" strokeDasharray="5 5" vertical={false} />
                      <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} domain={['dataMin - 50', 'dataMax + 50']} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', color: '#f8fafc', fontWeight: 'bold' }}
                        itemStyle={{ color: '#818cf8' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                    <span className="text-sm font-bold">Noch nicht genug Daten für einen Graphen.</span>
                    <span className="text-xs">Spiele mindestens ein Match!</span>
                  </div>
                )}
              </div>

              {/* History */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800">
                  <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">Spielverlauf</h3>
                </div>
                {historyC4.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    Noch keine Spiele gespielt.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/50">
                    {historyC4.map(game => {
                      let resultClass = "text-slate-500 dark:text-slate-400";
                      let resultText = "Unentschieden";
                      
                      if (game.winner === game.mySymbol) {
                        resultClass = "text-emerald-500";
                        resultText = "Sieg";
                      } else if (game.winner && game.winner !== "draw") {
                        resultClass = "text-rose-500";
                        resultText = "Niederlage";
                      }

                      const eloColor = game.estimatedEloChange > 0 ? "text-emerald-400" : game.estimatedEloChange < 0 ? "text-rose-400" : "text-slate-500 dark:text-slate-400";
                      const eloPrefix = game.estimatedEloChange > 0 ? "+" : "";

                      return (
                        <div key={game.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 hover:bg-slate-100 dark:bg-slate-800/20 transition-colors">
                          <div className="flex items-center gap-3 sm:gap-4">
                            <div className={cn("w-2 h-12 rounded-full", resultClass.replace("text-", "bg-"))}></div>
                            <div>
                              <p className="text-sm text-slate-500 dark:text-slate-400 font-bold uppercase mb-1">Gegner</p>
                              <p className="text-lg font-bold text-slate-900 dark:text-white">{game.opponentName}</p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:p-6 sm:gap-12 items-center">
                            <div>
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Ergebnis</p>
                              <p className={cn("font-bold", resultClass)}>{resultText}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">ELO Änderung</p>
                              <p className={cn("font-bold font-mono", eloColor)}>{eloPrefix}{game.estimatedEloChange}</p>
                            </div>
                            <div className="col-span-2 sm:col-span-1 text-left sm:text-right">
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Datum</p>
                              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                                {game.updatedAt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "utictactoe" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Top Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mb-2">Rating</span>
                  <span className="text-2xl sm:text-4xl font-black text-indigo-400">{stats.utictactoe_rating}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">
                    {stats.utictactoe_percentile >= 50 ? `Top ${100 - stats.utictactoe_percentile}% der Spieler` : `Untere ${stats.utictactoe_percentile}% der Spieler`}
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.utictactoe_wins}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Siege</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mb-3">
                    <Flag className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.utictactoe_losses}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Niederlagen</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-slate-500/10 text-slate-500 dark:text-slate-400 flex items-center justify-center mb-3">
                    <Handshake className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.utictactoe_draws}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Unentschieden</span>
                </div>
              </div>

              {/* Chart */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl h-80">
                <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-6">Wertungs-Verlauf</h3>
                {chartDataUtictactoe.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartDataUtictactoe} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <Line type="monotone" dataKey="ELO" stroke="#a855f7" strokeWidth={3} dot={{ r: 4, fill: "#581c87", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      <CartesianGrid stroke="#1e293b" strokeDasharray="5 5" vertical={false} />
                      <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} domain={['dataMin - 50', 'dataMax + 50']} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', color: '#f8fafc', fontWeight: 'bold' }}
                        itemStyle={{ color: '#c084fc' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                    <span className="text-sm font-bold">Noch nicht genug Daten für einen Graphen.</span>
                    <span className="text-xs">Spiele mindestens ein Match!</span>
                  </div>
                )}
              </div>

              {/* History */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800">
                  <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">Spielverlauf</h3>
                </div>
                {historyUtictactoe.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    Noch keine Spiele gespielt.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/50">
                    {historyUtictactoe.map(game => {
                      let resultClass = "text-slate-500 dark:text-slate-400";
                      let resultText = "Unentschieden";
                      
                      if (game.winner === game.mySymbol) {
                        resultClass = "text-emerald-500";
                        resultText = "Sieg";
                      } else if (game.winner && game.winner !== "draw") {
                        resultClass = "text-rose-500";
                        resultText = "Niederlage";
                      }

                      const eloColor = game.estimatedEloChange > 0 ? "text-emerald-400" : game.estimatedEloChange < 0 ? "text-rose-400" : "text-slate-500 dark:text-slate-400";
                      const eloPrefix = game.estimatedEloChange > 0 ? "+" : "";

                      return (
                        <div key={game.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 hover:bg-slate-100 dark:bg-slate-800/20 transition-colors">
                          <div className="flex items-center gap-3 sm:gap-4">
                            <div className={cn("w-2 h-12 rounded-full", resultClass.replace("text-", "bg-"))}></div>
                            <div>
                              <p className="text-sm text-slate-500 dark:text-slate-400 font-bold uppercase mb-1">Gegner</p>
                              <p className="text-lg font-bold text-slate-900 dark:text-white">{game.opponentName}</p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:p-6 sm:gap-12 items-center">
                            <div>
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Ergebnis</p>
                              <p className={cn("font-bold", resultClass)}>{resultText}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">ELO Änderung</p>
                              <p className={cn("font-bold font-mono", eloColor)}>{eloPrefix}{game.estimatedEloChange}</p>
                            </div>
                            <div className="col-span-2 sm:col-span-1 text-left sm:text-right">
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Datum</p>
                              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                                {game.updatedAt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "dots" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Top Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mb-2">Rating</span>
                  <span className="text-2xl sm:text-4xl font-black text-indigo-400">{stats.dots_rating}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">
                    {stats.dots_percentile >= 50 ? `Top ${100 - stats.dots_percentile}% der Spieler` : `Untere ${stats.dots_percentile}% der Spieler`}
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.dots_wins}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Siege</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mb-3">
                    <Flag className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.dots_losses}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Niederlagen</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-slate-500/10 text-slate-500 dark:text-slate-400 flex items-center justify-center mb-3">
                    <Handshake className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.dots_draws}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Unentschieden</span>
                </div>
              </div>

              {/* Chart */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl h-80">
                <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-6">Wertungs-Verlauf</h3>
                {chartDataDots.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartDataDots} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <Line type="monotone" dataKey="ELO" stroke="#818cf8" strokeWidth={3} dot={{ r: 4, fill: "#312e81", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      <CartesianGrid stroke="#1e293b" strokeDasharray="5 5" vertical={false} />
                      <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} domain={['dataMin - 50', 'dataMax + 50']} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', color: '#f8fafc', fontWeight: 'bold' }}
                        itemStyle={{ color: '#818cf8' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                    <span className="text-sm font-bold">Noch nicht genug Daten für einen Graphen.</span>
                    <span className="text-xs">Spiele mindestens ein Match!</span>
                  </div>
                )}
              </div>

              {/* History */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800">
                  <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">Spielverlauf</h3>
                </div>
                {historyDots.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    Noch keine Spiele gespielt.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/50">
                    {historyDots.map(game => {
                      let resultClass = "text-slate-500 dark:text-slate-400";
                      let resultText = "Unentschieden";
                      
                      if (game.winner === game.mySymbol) {
                        resultClass = "text-emerald-500";
                        resultText = "Sieg";
                      } else if (game.winner && game.winner !== "draw") {
                        resultClass = "text-rose-500";
                        resultText = "Niederlage";
                      }

                      const eloColor = game.estimatedEloChange > 0 ? "text-emerald-400" : game.estimatedEloChange < 0 ? "text-rose-400" : "text-slate-500 dark:text-slate-400";
                      const eloPrefix = game.estimatedEloChange > 0 ? "+" : "";

                      return (
                        <div key={game.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 hover:bg-slate-100 dark:bg-slate-800/20 transition-colors">
                          <div className="flex items-center gap-3 sm:gap-4">
                            <div className={cn("w-2 h-12 rounded-full", resultClass.replace("text-", "bg-"))}></div>
                            <div>
                              <p className="text-sm text-slate-500 dark:text-slate-400 font-bold uppercase mb-1">Gegner</p>
                              <p className="text-lg font-bold text-slate-900 dark:text-white">{game.opponentName}</p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:p-6 sm:gap-12 items-center">
                            <div>
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Ergebnis</p>
                              <p className={cn("font-bold", resultClass)}>{resultText}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">ELO Änderung</p>
                              <p className={cn("font-bold font-mono", eloColor)}>{eloPrefix}{game.estimatedEloChange}</p>
                            </div>
                            <div className="col-span-2 sm:col-span-1 text-left sm:text-right">
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Datum</p>
                              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                                {game.updatedAt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "racing" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Top Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-3">
                    <Gamepad2 className="w-5 h-5" />
                  </div>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{historyRacing.length}</span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Gesamte Läufe</span>
                </div>
                
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <span className="text-2xl sm:text-3xl font-black text-emerald-500">
                    {formatMs(getPersonalBest("neon-gp"))}
                  </span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Bestzeit: Neon GP</span>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mb-3">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <span className="text-2xl sm:text-3xl font-black text-amber-500">
                    {formatMs(getPersonalBest("drift-canyon"))}
                  </span>
                  <span className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Bestzeit: Drift Canyon</span>
                </div>
              </div>

              {/* History */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800">
                  <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">Spielverlauf</h3>
                </div>
                {historyRacing.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    Noch keine Rennen gefahren.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                    {historyRacing.map(run => {
                      const isNeon = run.trackId === "neon-gp";
                      const trackName = isNeon ? "Neon Grand Prix" : "Drift Canyon";
                      const badgeColor = isNeon ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-amber-500/10 text-amber-500 border border-amber-500/20";
                      
                      return (
                        <div key={run.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 hover:bg-slate-100 dark:bg-slate-800/20 transition-colors">
                          <div className="flex items-center gap-3 sm:gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-150 dark:bg-slate-850 flex items-center justify-center">
                              <Car className="w-5 h-5 text-indigo-500 animate-pulse" />
                            </div>
                            <div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase mb-1">Strecke</p>
                              <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold", badgeColor)}>
                                {trackName}
                              </span>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-2 gap-4 sm:p-6 sm:gap-12 items-center">
                            <div>
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Gefahrene Zeit</p>
                              <p className="font-mono font-black text-lg text-slate-900 dark:text-white">
                                {formatMs(run.player1Time)}
                              </p>
                            </div>
                            <div className="text-left sm:text-right">
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Datum</p>
                              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                                {run.createdAt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "friends" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Add Friend Form */}
              <div className="md:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl h-fit">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-indigo-500" />
                  Freund hinzufügen
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 font-medium">
                  Gib die E-Mail-Adresse eines Spielers ein, um ihn zu deiner Freundesliste hinzuzufügen.
                </p>
                
                {searchError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-xl text-xs mb-4">
                    {searchError}
                  </div>
                )}
                {searchSuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-xs mb-4">
                    {searchSuccess}
                  </div>
                )}

                <form onSubmit={handleAddFriend} className="flex flex-col gap-3">
                  <input 
                    type="email"
                    value={searchEmail}
                    onChange={e => setSearchEmail(e.target.value)}
                    required
                    placeholder="spieler@email.de"
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button 
                    type="submit"
                    disabled={isSearching}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-2 rounded-xl transition-all shadow-lg shadow-indigo-900/15 text-sm"
                  >
                    {isSearching ? "Suche..." : "Hinzufügen"}
                  </button>
                </form>
              </div>

              {/* Friends List */}
              <div className="md:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl min-h-[300px]">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Meine Freunde ({friendsList.length})</h3>
                {friendsList.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-sm border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    Keine Freunde hinzugefügt. Suche oben nach einer E-Mail-Adresse!
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {friendsList.map(friend => (
                      <div key={friend.uid} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 hover:bg-slate-100/50 dark:hover:bg-slate-900/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center font-bold text-indigo-600 dark:text-indigo-400 uppercase text-sm">
                            {friend.displayName.substring(0, 2)}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white text-sm">{friend.displayName}</div>
                            <div className="text-xs text-slate-500">{friend.email}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setSelectedFriend(friend); setShowGameSelector(true); }}
                            className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
                            title="Herausfordern"
                          >
                            <Swords className="w-4 h-4" />
                            Duell
                          </button>
                          <button
                            disabled={isRemoving}
                            onClick={() => handleRemoveFriend(friend.uid)}
                            className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                            title="Entfernen"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Game Selector Modal */}
          {showGameSelector && selectedFriend && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl relative">
                <button 
                  onClick={() => { setShowGameSelector(false); setSelectedFriend(null); }}
                  className="absolute top-4 right-4 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
                <h3 className="text-xl font-bold mb-2 text-slate-900 dark:text-white">Spiel wählen</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                  Wähle ein Spiel für das Duell gegen <strong>{selectedFriend.displayName}</strong>.
                </p>
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => handleStartChallenge("tictactoe")}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-900/20"
                  >
                    TicTacToe Elite
                  </button>
                  <button 
                    onClick={() => handleStartChallenge("connect4")}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-900/20"
                  >
                    4 Gewinnt Elite
                  </button>
                  <button 
                    onClick={() => handleStartChallenge("dots")}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-900/20"
                  >
                    Käsekästchen Elite
                  </button>
                  <button 
                    onClick={() => handleStartChallenge("utictactoe")}
                    className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-purple-900/20"
                  >
                    Ultimate TTT Elite
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Outgoing Challenge Waiting Modal */}
          {activeChallengeId && selectedFriend && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl text-center">
                <div className="w-16 h-16 bg-indigo-600/10 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-500">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
                <h3 className="text-xl font-bold mb-2 text-slate-900 dark:text-white">Herausforderung gesendet</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                  Warte auf Antwort von <strong>{selectedFriend.displayName}</strong>...
                </p>
                {challengeStatus === "declined" ? (
                  <div>
                    <p className="text-rose-400 font-bold mb-4">Herausforderung wurde abgelehnt.</p>
                    <button 
                      onClick={() => { setActiveChallengeId(null); setSelectedFriend(null); }}
                      className="w-full bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold py-2 rounded-xl transition-colors"
                    >
                      Schließen
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={handleCancelChallenge}
                    className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 rounded-xl transition-colors"
                  >
                    Herausforderung abbrechen
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
