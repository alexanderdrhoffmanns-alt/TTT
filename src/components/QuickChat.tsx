import { useState, useEffect, useRef } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { MessageSquare, X } from "lucide-react";
import { cn } from "../lib/utils";

interface QuickChatProps {
  gameId: string;
  collectionName: "games" | "games_connect4" | "games_dots" | "games_utictactoe" | "games_racing";
  currentUserId: string;
  player1Id: string;
  player1Name: string;
  player2Name: string;
  lastChat?: {
    senderId: string;
    text: string;
    sentAt: number;
  };
}

const QUICK_MESSAGES = [
  "Hallo! 👋",
  "Guter Zug! 🧠",
  "Ups... 😅",
  "Knappe Kiste! ⚡",
  "Viel Glück! 🍀",
  "Danke! 😊",
  "Gutes Spiel! 🤝",
  "Nein! 😱"
];

const QUICK_EMOJIS = [
  "🔥", "👑", "🎉", "🤔", "😂", "🤯", "👍", "😎"
];

export default function QuickChat({
  gameId,
  collectionName,
  currentUserId,
  player1Id,
  player1Name,
  player2Name,
  lastChat
}: QuickChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeBubble, setActiveBubble] = useState<{ senderName: string; text: string; isMe: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close chat popover on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Listen to new incoming chat messages
  useEffect(() => {
    if (lastChat && lastChat.sentAt) {
      // Only display messages sent in the last 6 seconds (to avoid showing old messages on load)
      if (Date.now() - lastChat.sentAt < 6000) {
        const isMe = lastChat.senderId === currentUserId;
        const senderName = lastChat.senderId === player1Id ? player1Name : player2Name;

        setActiveBubble({
          senderName,
          text: lastChat.text,
          isMe
        });

        const timer = setTimeout(() => {
          setActiveBubble(null);
        }, 3500);

        return () => clearTimeout(timer);
      }
    }
  }, [lastChat?.sentAt, lastChat?.senderId, lastChat?.text, currentUserId, player1Id, player1Name, player2Name]);

  const sendQuickMessage = async (text: string) => {
    setIsOpen(false);
    try {
      const gameRef = doc(db, collectionName, gameId);
      await updateDoc(gameRef, {
        lastChat: {
          senderId: currentUserId,
          text,
          sentAt: Date.now()
        },
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error sending quick chat", error);
    }
  };

  const isEmoji = activeBubble && QUICK_EMOJIS.includes(activeBubble.text);

  return (
    <>
      {/* Floating Entry Alert / Bubble */}
      {activeBubble && (
        <div className="fixed inset-x-0 top-20 flex justify-center z-50 pointer-events-none">
          {isEmoji ? (
            <div className="flex flex-col items-center gap-1.5 animate-in zoom-in-50 duration-300">
              <span className="text-6xl sm:text-7xl animate-bounce filter drop-shadow-[0_10px_15px_rgba(0,0,0,0.3)]">{activeBubble.text}</span>
              <span className="text-[10px] font-black uppercase tracking-widest bg-slate-900/90 text-slate-200 border border-slate-700/50 backdrop-blur-md px-2.5 py-0.5 rounded-full shadow-lg">
                {activeBubble.isMe ? "Du" : activeBubble.senderName}
              </span>
            </div>
          ) : (
            <div className={cn(
              "flex items-center gap-3 bg-slate-900/95 dark:bg-slate-950/95 border backdrop-blur-md px-5 py-3 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 max-w-[90vw] md:max-w-md",
              activeBubble.isMe ? "border-emerald-500/30 text-emerald-400" : "border-indigo-500/30 text-indigo-400"
            )}>
              <div className="w-1.5 h-8 rounded-full shrink-0 bg-indigo-500" />
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] uppercase font-black tracking-widest text-slate-400 truncate">
                  {activeBubble.isMe ? "Du" : activeBubble.senderName}
                </span>
                <span className="text-sm font-bold text-white mt-0.5 break-words">{activeBubble.text}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating Chat Button */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end" ref={menuRef}>
        {/* Chat Menu Popover */}
        {isOpen && (
          <div className="mb-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xl w-72 max-w-[90vw] animate-in slide-in-from-bottom-2 fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">
              <span className="text-xs font-black uppercase tracking-wider text-slate-400">Quick Chat</span>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Emojis Grid */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => sendQuickMessage(emoji)}
                  className="text-2xl p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all duration-200 active:scale-95 text-center"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Messages Grid */}
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {QUICK_MESSAGES.map((msg) => (
                <button
                  key={msg}
                  onClick={() => sendQuickMessage(msg)}
                  className="text-left text-xs font-bold px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 hover:bg-indigo-500/10 hover:border-indigo-500/30 rounded-xl transition-all duration-200 active:scale-95 text-slate-700 dark:text-slate-300 hover:text-indigo-400"
                >
                  {msg}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Floating Action Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "p-4 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-slate-900 dark:text-white rounded-2xl shadow-xl shadow-indigo-500/10 hover:shadow-indigo-500/20 transition-all duration-200 flex items-center justify-center border border-indigo-500/30",
            isOpen && "bg-rose-600 hover:bg-rose-500 shadow-rose-500/10 hover:shadow-rose-500/20 border-rose-500/30"
          )}
          title="Quick Chat öffnen"
        >
          {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        </button>
      </div>
    </>
  );
}
