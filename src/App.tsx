import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { AuthProvider, useAuth } from "./components/AuthProvider";
import { ThemeProvider } from "./components/ThemeProvider";
import Dashboard from "./pages/Dashboard";
import TicTacToeLobby from "./pages/TicTacToeLobby";
import Connect4Lobby from "./pages/Connect4Lobby";
import Connect4Game from "./pages/Connect4Game";
import DotsLobby from "./pages/DotsLobby";
import DotsGame from "./pages/DotsGame";
import UltimateLobby from "./pages/UltimateLobby";
import UltimateGame from "./pages/UltimateGame";
import RacingLobby from "./pages/RacingLobby";
import RacingGame from "./pages/RacingGame";
import Game from "./pages/Game";
import Profile from "./pages/Profile";
import ChallengeManager from "./components/ChallengeManager";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return <div className="h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">Loading...</div>;
  }
  
  if (!user) {
    return <Navigate to="/" replace />;
  }
  
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <HashRouter>
          <div className="h-screen w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans flex flex-col overflow-hidden transition-colors duration-200">
            <ChallengeManager />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tictactoe" element={<TicTacToeLobby />} />
              <Route 
                path="/game/:gameId" 
                element={
                  <ProtectedRoute>
                    <Game />
                  </ProtectedRoute>
                } 
              />
              <Route path="/connect4" element={<Connect4Lobby />} />
              <Route 
                path="/connect4/game/:gameId" 
                element={
                  <ProtectedRoute>
                    <Connect4Game />
                  </ProtectedRoute>
                } 
              />
              <Route path="/dots" element={<DotsLobby />} />
              <Route 
                path="/dots/game/:gameId" 
                element={
                  <ProtectedRoute>
                    <DotsGame />
                  </ProtectedRoute>
                } 
              />
              <Route path="/utictactoe" element={<UltimateLobby />} />
              <Route 
                path="/utictactoe/game/:gameId" 
                element={
                  <ProtectedRoute>
                    <UltimateGame />
                  </ProtectedRoute>
                } 
              />
              <Route path="/racing" element={<RacingLobby />} />
              <Route 
                path="/racing/game/:gameId" 
                element={
                  <ProtectedRoute>
                    <RacingGame />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/profile" 
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                } 
              />
            </Routes>
          </div>
        </HashRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
