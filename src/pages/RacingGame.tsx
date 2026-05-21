import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, onSnapshot, updateDoc, serverTimestamp, collection, query, where, getDocs, setDoc, getDoc, deleteDoc, increment } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { ThemeToggle } from "../components/ThemeToggle";
import { cn } from "../lib/utils";
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Play, RefreshCw, Trophy, Volume2, VolumeX, Timer, Award, ShieldAlert, Maximize, Minimize } from "lucide-react";

interface TelemetryPoint {
  x: number;
  y: number;
  angle: number;
  time: number;
}

interface RacingGameDoc {
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  status: "waiting" | "playing" | "finished";
  trackId: "neon-gp" | "drift-canyon";
  player1Time: number | null;
  player2Time: number | null;
  player1BestLap?: number;
  player2BestLap?: number;
  player1Ghost?: string; // serialized JSON array
  player2Ghost?: string;
  winnerId: string | null;
  winnerName: string | null;
  createdAt: any;
  updatedAt: any;
}

// Waypoints definition for tracks
const TRACKS = {
  "neon-gp": {
    name: "Neon Grand Prix",
    waypoints: [
      { x: 150, y: 150 },
      { x: 350, y: 120 },
      { x: 550, y: 160 },
      { x: 750, y: 200 },
      { x: 720, y: 420 },
      { x: 500, y: 350 }, // S-curve center
      { x: 300, y: 480 },
      { x: 120, y: 350 }
    ],
    checkpoints: [0, 3, 6], // Waypoint indices for checkpoints
    width: 80
  },
  "drift-canyon": {
    name: "Drift Canyon",
    waypoints: [
      { x: 120, y: 150 },
      { x: 450, y: 130 },
      { x: 550, y: 260 },
      { x: 350, y: 320 }, // tight hairpin
      { x: 280, y: 480 },
      { x: 620, y: 500 },
      { x: 780, y: 380 },
      { x: 750, y: 180 },
      { x: 620, y: 120 },
      { x: 800, y: 540 },
      { x: 120, y: 520 }
    ],
    checkpoints: [0, 4, 8],
    width: 76
  }
};

function getDistanceToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(x - ax, y - ay);
  let t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function getClosestPointOnSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay };
  let t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * dx, y: ay + t * dy };
}

export default function RacingGame() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState<string>("");
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});

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

  const [gameDoc, setGameDoc] = useState<RacingGameDoc | null>(null);
  
  // Solo statistics states
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [personalBestLap, setPersonalBestLap] = useState<number | null>(null);
  const [trackRecord, setTrackRecord] = useState<{ playerId?: string; name: string; time: number } | null>(null);
  const [trackRecordLap, setTrackRecordLap] = useState<{ playerId?: string; name: string; time: number } | null>(null);
  const [ghostRacer, setGhostRacer] = useState<{ playerId?: string; name: string; time: number; ghostPath: TelemetryPoint[] | null } | null>(null);

  // Gameplay state
  const [gameState, setGameState] = useState<"idle" | "countdown" | "racing" | "finished">("idle");
  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const [finalRaceTime, setFinalRaceTime] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [lapTimes, setLapTimes] = useState<number[]>([]);
  const bestLapTime = lapTimes.length > 0 ? Math.min(...lapTimes) : null;
  const [lapCount, setLapCount] = useState(1);
  const [currentCheckpoint, setCurrentCheckpoint] = useState(1); // Next checkpoint to hit (1 or 2, then 0 for start/finish line)
  const [isOffRoad, setIsOffRoad] = useState(false);
  const [speedKmh, setSpeedKmh] = useState(0);

  // Mobile virtual joystick (Steuerknüppel) state
  const [joystickOffset, setJoystickOffset] = useState({ x: 0, y: 0 });
  const joystickOffsetRef = useRef({ x: 0, y: 0 });

  // Fullscreen support state & handlers
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Audio Engine State
  const [isMuted, setIsMuted] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // Canvas Refs & Telemetry buffers
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const joystickRef = useRef<HTMLDivElement | null>(null);
  const myGhostBuffer = useRef<TelemetryPoint[]>([]);
  
  // Keyboard keys state
  const keysRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false
  });

  // Track config
  const trackId = gameDoc?.trackId || "neon-gp";
  const track = TRACKS[trackId];

  // Fetch Game document
  useEffect(() => {
    if (!gameId) return;

    const unsubscribe = onSnapshot(doc(db, "games_racing", gameId), (snapshot) => {
      if (!snapshot.exists()) {
        if (gameStateRef.current === "finished") {
          return;
        }
        alert("Rennen existiert nicht mehr.");
        navigate("/racing");
        return;
      }
      const data = snapshot.data() as RacingGameDoc;
      setGameDoc(data);
    }, (error) => handleFirestoreError(error, OperationType.GET, "games_racing"));

    return () => unsubscribe();
  }, [gameId, navigate]);

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

  // Fetch Personal Best and Track Records/Ghost on load
  useEffect(() => {
    if (!trackId || !user) return;

    const fetchTimesAndGhost = async () => {
      try {
        const q = query(
          collection(db, "games_racing"),
          where("status", "==", "finished"),
          where("player2Id", "==", null) // solo runs only
        );
        const snap = await getDocs(q);
        const runs = snap.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            player1Id: data.player1Id,
            player1Name: data.player1Name,
            trackId: data.trackId,
            player1Time: data.player1Time,
            player1BestLap: data.player1BestLap,
            player1Ghost: data.player1Ghost,
            createdAt: data.createdAt
          };
        });

        // 1. Personal Best for this user on this track
        const myRunsOnTrack = runs.filter(r => r.player1Id === user.uid && r.trackId === trackId);
        if (myRunsOnTrack.length > 0) {
          const pb = Math.min(...myRunsOnTrack.map(r => r.player1Time));
          setPersonalBest(pb);

          const pbLaps = myRunsOnTrack.map(r => r.player1BestLap).filter((lap): lap is number => typeof lap === "number" && lap > 0);
          if (pbLaps.length > 0) {
            setPersonalBestLap(Math.min(...pbLaps));
          } else {
            setPersonalBestLap(null);
          }
        } else {
          setPersonalBest(null);
          setPersonalBestLap(null);
        }

        // 2. Track Record for this track
        const trackRuns = runs.filter(r => r.trackId === trackId);
        if (trackRuns.length > 0) {
          let fastestRun = trackRuns[0];
          for (const run of trackRuns) {
            if (run.player1Time < fastestRun.player1Time) {
              fastestRun = run;
            }
          }
          setTrackRecord({ playerId: fastestRun.player1Id, name: fastestRun.player1Name, time: fastestRun.player1Time });

          const allLaps = trackRuns.map(r => ({ playerId: r.player1Id, name: r.player1Name, lap: r.player1BestLap })).filter((r): r is { playerId: string; name: string; lap: number } => typeof r.lap === "number" && r.lap > 0);
          if (allLaps.length > 0) {
            let fastestLap = allLaps[0];
            for (const r of allLaps) {
              if (r.lap < fastestLap.lap) {
                fastestLap = r;
              }
            }
            setTrackRecordLap({ playerId: fastestLap.playerId, name: fastestLap.name, time: fastestLap.lap });
          } else {
            setTrackRecordLap(null);
          }

          // Try to load the fastest run with a ghost recording
          const runsWithGhost = trackRuns.filter(r => r.player1Ghost && r.player1Ghost !== "");
          if (runsWithGhost.length > 0) {
            runsWithGhost.sort((a, b) => a.player1Time - b.player1Time);
            const recordGhostRun = runsWithGhost[0];
            try {
              const parsedPath = JSON.parse(recordGhostRun.player1Ghost!);
              setGhostRacer({
                playerId: recordGhostRun.player1Id,
                name: `Rekord: ${recordGhostRun.player1Name}`,
                time: recordGhostRun.player1Time,
                ghostPath: parsedPath
              });
              return;
            } catch (e) {
              console.error("Error parsing ghost telemetry:", e);
            }
          }
        } else {
          setTrackRecord(null);
          setTrackRecordLap(null);
        }

        // 3. Fallback: Pro-Bot centerline playback
        setGhostRacer({
          name: "🤖 Pro-Bot",
          time: trackId === "neon-gp" ? 42000 : 48000,
          ghostPath: null
        });

      } catch (error) {
        console.error("Error loading solo racing telemetry / times:", error);
      }
    };

    fetchTimesAndGhost();
  }, [trackId, user, gameState]); // refetch stats when gameState changes to get fresh PBs

  // Touch controls for mobile virtual joystick/pedals
  const handleTouchStart = (key: "forward" | "backward" | "left" | "right") => {
    // Initialize or resume audio context
    if (!audioCtxRef.current) {
      initAudio();
    } else if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    keysRef.current[key] = true;
  };

  const handleTouchEnd = (key: "forward" | "backward" | "left" | "right") => {
    keysRef.current[key] = false;
  };

  const handleJoystickTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!joystickRef.current) return;

    // Initialize or resume audio context
    if (!audioCtxRef.current) {
      initAudio();
    } else if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }

    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const touch = e.touches[0];
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;

    // Constrain to maximum radius (40px)
    const maxRadius = 40;
    const distance = Math.hypot(dx, dy);
    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }

    joystickOffsetRef.current = { x: dx, y: dy };
    setJoystickOffset({ x: dx, y: dy });
  };

  const handleJoystickRelease = () => {
    joystickOffsetRef.current = { x: 0, y: 0 };
    setJoystickOffset({ x: 0, y: 0 });
  };

  // Keyboard control listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Initialize Audio on first key interaction
      if (!audioCtxRef.current) {
        initAudio();
      }

      if (["ArrowUp", "KeyW"].includes(e.code)) keysRef.current.forward = true;
      if (["ArrowDown", "KeyS"].includes(e.code)) keysRef.current.backward = true;
      if (["ArrowLeft", "KeyA"].includes(e.code)) keysRef.current.left = true;
      if (["ArrowRight", "KeyD"].includes(e.code)) keysRef.current.right = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (["ArrowUp", "KeyW"].includes(e.code)) keysRef.current.forward = false;
      if (["ArrowDown", "KeyS"].includes(e.code)) keysRef.current.backward = false;
      if (["ArrowLeft", "KeyA"].includes(e.code)) keysRef.current.left = false;
      if (["ArrowRight", "KeyD"].includes(e.code)) keysRef.current.right = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Web Audio Synth engine hum
  const initAudio = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(45, ctx.currentTime);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(150, ctx.currentTime);

      gain.gain.setValueAtTime(isMuted ? 0 : 0.08, ctx.currentTime);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start();

      oscRef.current = osc;
      filterRef.current = filter;
      gainRef.current = gain;
    } catch (e) {
      console.warn("Audio Context could not start:", e);
    }
  };

  const updateAudioPitch = (speed: number, isDrifting: boolean) => {
    if (!oscRef.current || !filterRef.current || !audioCtxRef.current) return;
    const baseFreq = 42;
    const pitchMultiplier = 1.0 + (speed / 7.5) * 4.5;
    const targetFreq = baseFreq * pitchMultiplier;

    oscRef.current.frequency.setTargetAtTime(targetFreq, audioCtxRef.current.currentTime, 0.1);
    
    // Lowpass filter frequency opens up on speed, squeals slightly on drift
    const baseFilterFreq = 180;
    const driftModifier = isDrifting ? 150 : 0;
    const targetFilterFreq = baseFilterFreq + (speed / 7.5) * 600 + driftModifier;
    filterRef.current.frequency.setTargetAtTime(targetFilterFreq, audioCtxRef.current.currentTime, 0.15);
  };

  // Toggle Mute Audio
  const toggleMute = () => {
    setIsMuted(prev => {
      const next = !prev;
      if (gainRef.current && audioCtxRef.current) {
        gainRef.current.gain.setValueAtTime(next ? 0 : 0.08, audioCtxRef.current.currentTime);
      }
      return next;
    });
  };

  // End turn cleanup
  useEffect(() => {
    return () => {
      if (oscRef.current) {
        try {
          oscRef.current.stop();
        } catch (_) {}
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch (_) {}
      }
    };
  }, []);

  // Main Canvas & Gameplay Loop
  useEffect(() => {
    if ((gameState !== "racing" && gameState !== "countdown") || !canvasRef.current || !gameDoc) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;
    let startTime = Date.now();
    let lastTime = startTime;
    let lastGhostSaveTime = 0;

    // Car Physics states
    const waypoints = track.waypoints;
    const startPoint = waypoints[0];
    const startNext = waypoints[1];
    const initialAngle = Math.atan2(startNext.y - startPoint.y, startNext.x - startPoint.x);

    let car = {
      x: startPoint.x,
      y: startPoint.y,
      vx: 0,
      vy: 0,
      angle: initialAngle,
      speed: 0
    };

    // Bot path pre-calculation for real-time bot ghost playback
    const botPathDistances: number[] = [];
    let cumulativeBotDist = 0;
    for (let i = 0; i < waypoints.length; i++) {
      const p1 = waypoints[i];
      const p2 = waypoints[(i + 1) % waypoints.length];
      botPathDistances.push(cumulativeBotDist);
      cumulativeBotDist += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }
    const totalBotTrackLength = cumulativeBotDist;

    // Determine target bot completion time (3 laps)
    let botTargetTotalTime = ghostRacer?.time || (trackId === "neon-gp" ? 42000 : 48000);

    // Permanent lists for drawing
    let skidmarks: { x1: number; y1: number; x2: number; y2: number; life: number }[] = [];
    let particles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number; color: string }[] = [];

    // Local checkpoint track vars
    let localLap = 1;
    let localCheckpoint = 1;
    let lapStartTime = startTime;
    let localLapTimes: number[] = [];

    // Local telemetry recorder
    myGhostBuffer.current = [];

    const updatePhysics = (dt: number, now: number) => {
      const ownFinished = gameDoc.player1Time !== null;
      if (ownFinished) {
        setGameState("finished");
        return;
      }

      // Mobile joystick direction control & auto-acceleration
      const joyX = joystickOffsetRef.current.x;
      const joyY = joystickOffsetRef.current.y;
      const joyDist = Math.hypot(joyX, joyY);
      const deadzone = 12;

      const accel = 0.16;
      const drag = 0.985;
      const maxSpeed = 6.8;

      if (joyDist > deadzone) {
        // Calculate the target angle from the joystick coordinates
        const targetAngle = Math.atan2(joyY, joyX);

        // Find the shortest rotation angle difference
        let angleDiff = targetAngle - car.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        // Steer the car towards the target angle
        const joySteerSpeed = 0.075; // Snappy responsiveness for mobile joystick
        if (Math.abs(angleDiff) > 0.02) {
          car.angle += Math.min(Math.abs(angleDiff), joySteerSpeed) * Math.sign(angleDiff);
        }

        // Auto-accelerate!
        car.vx += Math.cos(car.angle) * accel;
        car.vy += Math.sin(car.angle) * accel;
      } else {
        // Fallback to keyboard steering (always high-performance, responsive steering!)
        const steerSpeed = 0.048;
        if (keysRef.current.left) car.angle -= steerSpeed;
        if (keysRef.current.right) car.angle += steerSpeed;

        // Fallback to keyboard acceleration
        if (keysRef.current.forward) {
          car.vx += Math.cos(car.angle) * accel;
          car.vy += Math.sin(car.angle) * accel;
        } else if (keysRef.current.backward) {
          car.vx -= Math.cos(car.angle) * (accel * 0.5);
          car.vy -= Math.sin(car.angle) * (accel * 0.5);
        }
      }

      if (gameState === "countdown") {
        car.vx = 0;
        car.vy = 0;
        car.speed = 0;
        setSpeedKmh(0);
        updateAudioPitch(0, false);
        return;
      }

      // Slide and drift vector calculations
      car.vx *= drag;
      car.vy *= drag;

      const currentSpeed = Math.hypot(car.vx, car.vy);
      if (currentSpeed > maxSpeed) {
        car.vx = (car.vx / currentSpeed) * maxSpeed;
        car.vy = (car.vy / currentSpeed) * maxSpeed;
      }

      car.speed = currentSpeed;
      setSpeedKmh(Math.round(currentSpeed * 32));

      // Apply positional drift slip
      const velocityAngle = Math.atan2(car.vy, car.vx);
      let angleDiff = velocityAngle - car.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      const isDrifting = currentSpeed > 2.8 && Math.abs(angleDiff) > 0.38;

      // Update Web Audio engine sound
      updateAudioPitch(currentSpeed, isDrifting);

      // Spawn Skidmarks and sparks particles on drift
      if (isDrifting) {
        const backLeft = {
          x: car.x - Math.cos(car.angle) * 12 + Math.sin(car.angle) * 6,
          y: car.y - Math.sin(car.angle) * 12 - Math.cos(car.angle) * 6
        };
        const backRight = {
          x: car.x - Math.cos(car.angle) * 12 - Math.sin(car.angle) * 6,
          y: car.y - Math.sin(car.angle) * 12 + Math.cos(car.angle) * 6
        };

        if (skidmarks.length > 0) {
          skidmarks.push({ x1: backLeft.x, y1: backLeft.y, x2: backRight.x, y2: backRight.y, life: 100 });
        } else {
          skidmarks.push({ x1: backLeft.x, y1: backLeft.y, x2: backLeft.x, y2: backLeft.y, life: 100 });
        }

        // Emit green sparks!
        if (Math.random() < 0.6) {
          particles.push({
            x: (backLeft.x + backRight.x) / 2,
            y: (backLeft.y + backRight.y) / 2,
            vx: -Math.cos(car.angle) * 1.5 + (Math.random() - 0.5) * 1.2,
            vy: -Math.sin(car.angle) * 1.5 + (Math.random() - 0.5) * 1.2,
            size: Math.random() * 3.5 + 1.5,
            alpha: 1.0,
            color: "rgba(52,211,153,0.8)" // beautiful emerald green drift sparks
          });
        }
      }

      // Move car coordinates
      car.x += car.vx;
      car.y += car.vy;

      // Solid barrier collision checking (Bande)
      let minDist = 99999;
      let closestPt = { x: 0, y: 0 };
      for (let i = 0; i < waypoints.length; i++) {
        const w1 = waypoints[i];
        const w2 = waypoints[(i + 1) % waypoints.length];
        const pt = getClosestPointOnSegment(car.x, car.y, w1.x, w1.y, w2.x, w2.y);
        const dist = Math.hypot(car.x - pt.x, car.y - pt.y);
        if (dist < minDist) {
          minDist = dist;
          closestPt = pt;
        }
      }

      const roadHalfWidth = track.width / 2;
      const isCurrentlyColliding = minDist > roadHalfWidth;
      setIsOffRoad(isCurrentlyColliding); // Set status so that visual scrap indicators or shadows work temporarily

      if (isCurrentlyColliding) {
        const dx = car.x - closestPt.x;
        const dy = car.y - closestPt.y;
        const nx = dx / minDist;
        const ny = dy / minDist;

        // Correct position: push car back onto the track boundary
        car.x = closestPt.x + nx * roadHalfWidth;
        car.y = closestPt.y + ny * roadHalfWidth;

        // Velocity reflection (bounce & scrape friction loss)
        const dot = car.vx * nx + car.vy * ny;
        if (dot > 0) {
          const bounceFactor = 0.22; // satisfying reactive bounce
          car.vx = (car.vx - (1 + bounceFactor) * dot * nx) * 0.82; // scrape friction
          car.vy = (car.vy - (1 + bounceFactor) * dot * ny) * 0.82;
        }

        // Spawn beautiful bright neon orange sparks on wall impact
        for (let j = 0; j < 3; j++) {
          particles.push({
            x: car.x - nx * 4,
            y: car.y - ny * 4,
            vx: -nx * 1.5 + (Math.random() - 0.5) * 2.0,
            vy: -ny * 1.5 + (Math.random() - 0.5) * 2.0,
            size: Math.random() * 3.0 + 1.5,
            alpha: 1.0,
            color: "rgba(251, 146, 60, 0.9)" // high intensity bright orange wall spark
          });
        }
      }

      // Update particle physics
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.02;
        p.size *= 0.98;
      });
      particles = particles.filter(p => p.alpha > 0);

      // Decaying skidmark alpha
      skidmarks.forEach(s => {
        s.life -= 0.1;
      });
      skidmarks = skidmarks.filter(s => s.life > 0);

      // Verify Checkpoint collisions
      const checkpointWpIdx = track.checkpoints[localCheckpoint];
      const checkpointWp = waypoints[checkpointWpIdx];
      const distToCheckpoint = Math.hypot(car.x - checkpointWp.x, car.y - checkpointWp.y);

      if (distToCheckpoint < track.width * 0.9) {
        // Advanced checkpoints
        if (localCheckpoint === track.checkpoints.length - 1) {
          // Cross intermediate checkpoint, now look for finish line (checkpoint index 0)
          localCheckpoint = 0;
          setCurrentCheckpoint(0);
        } else if (localCheckpoint === 0) {
          // Completed lap!
          const lapTime = now - lapStartTime;
          localLapTimes.push(lapTime);
          setLapTimes([...localLapTimes]);

          lapStartTime = now;
          localCheckpoint = 1;
          setCurrentCheckpoint(1);

          if (localLap >= 3) {
            // Race finished!
            const finalTotalTime = now - startTime;
            setFinalRaceTime(finalTotalTime);
            setGameState("finished");
            const sessionBestLap = Math.min(...localLapTimes);
            handleFinish(finalTotalTime, sessionBestLap);
          } else {
            localLap++;
            setLapCount(localLap);
          }
        } else {
          localCheckpoint++;
          setCurrentCheckpoint(localCheckpoint);
        }
      }

      // Record telemetry every 100ms
      if (now - lastGhostSaveTime >= 100) {
        myGhostBuffer.current.push({
          x: car.x,
          y: car.y,
          angle: car.angle,
          time: now - startTime
        });
        lastGhostSaveTime = now;
      }
    };

    const drawGame = (now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const elapsed = gameState === "countdown" ? 0 : now - startTime;

      // Draw background cyber grid
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "rgba(16,185,129,0.03)";
      ctx.lineWidth = 1.0;
      const gridSize = 40;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw red/white border curbs
      ctx.setLineDash([16, 16]);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = track.width + 12;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      waypoints.forEach((w, i) => {
        if (i === 0) ctx.moveTo(w.x, w.y);
        else ctx.lineTo(w.x, w.y);
      });
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = "#ffffff";
      ctx.lineDashOffset = 16;
      ctx.stroke();

      // Draw primary asphalt tarmac road
      ctx.setLineDash([]);
      ctx.strokeStyle = "#0b0f19";
      ctx.lineWidth = track.width;
      ctx.beginPath();
      waypoints.forEach((w, i) => {
        if (i === 0) ctx.moveTo(w.x, w.y);
        else ctx.lineTo(w.x, w.y);
      });
      ctx.closePath();
      ctx.stroke();

      // Draw dotted white center guide line
      ctx.setLineDash([10, 15]);
      ctx.strokeStyle = "rgba(52,211,153,0.3)";
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      waypoints.forEach((w, i) => {
        if (i === 0) ctx.moveTo(w.x, w.y);
        else ctx.lineTo(w.x, w.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw skidmarks
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 10;
      skidmarks.forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      });

      // Draw check-points visual gates
      track.checkpoints.forEach((wpIdx, index) => {
        const wp = waypoints[wpIdx];
        const nextWp = waypoints[(wpIdx + 1) % waypoints.length];
        const heading = Math.atan2(nextWp.y - wp.y, nextWp.x - wp.x);
        
        ctx.save();
        ctx.translate(wp.x, wp.y);
        ctx.rotate(heading + Math.PI / 2);

        // Highlight next target gate in glowing amber, others in green
        const isNextTarget = localCheckpoint === index;
        ctx.fillStyle = isNextTarget ? "rgba(245,158,11,0.2)" : "rgba(16,185,129,0.06)";
        ctx.fillRect(-track.width / 2, -4, track.width, 8);

        ctx.strokeStyle = isNextTarget ? "#f59e0b" : "rgba(16,185,129,0.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-track.width / 2, 0);
        ctx.lineTo(track.width / 2, 0);
        ctx.stroke();

        ctx.restore();
      });

      // Draw Start/Finish checker flag line
      const finishWp = waypoints[0];
      const finishNext = waypoints[1];
      const finishHeading = Math.atan2(finishNext.y - finishWp.y, finishNext.x - finishWp.x);
      
      ctx.save();
      ctx.translate(finishWp.x, finishWp.y);
      ctx.rotate(finishHeading + Math.PI / 2);
      
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-track.width / 2, -3, track.width, 6);
      ctx.fillStyle = "#000000";
      // Checker blocks
      const blockWidth = 8;
      for (let offset = -track.width / 2; offset < track.width / 2; offset += blockWidth * 2) {
        ctx.fillRect(offset, -3, blockWidth, 3);
        ctx.fillRect(offset + blockWidth, 0, blockWidth, 3);
      }
      ctx.restore();

      // Draw particles
      particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Target Ghost Car (Track Record or Bot centerline)
      let oppX = 0, oppY = 0, oppAngle = 0;
      let hasOppPath = false;

      if (ghostRacer) {
        if (ghostRacer.ghostPath === null) {
          // Calculate smooth continuous bot location along centerline based on elapsed time
          const botProgressDistance = (elapsed / botTargetTotalTime) * totalBotTrackLength * 3;
          const wrappedBotDist = botProgressDistance % totalBotTrackLength;
          
          let segmentIdx = 0;
          for (let i = 0; i < waypoints.length; i++) {
            if (botPathDistances[i] <= wrappedBotDist) {
              segmentIdx = i;
            }
          }
          const nextSegmentIdx = (segmentIdx + 1) % waypoints.length;
          const segDistStart = botPathDistances[segmentIdx];
          const segDistEnd = nextSegmentIdx === 0 ? totalBotTrackLength : botPathDistances[nextSegmentIdx];
          
          const ratio = (wrappedBotDist - segDistStart) / (segDistEnd - segDistStart);
          const pA = waypoints[segmentIdx];
          const pB = waypoints[nextSegmentIdx];
          
          oppX = pA.x + ratio * (pB.x - pA.x);
          oppY = pA.y + ratio * (pB.y - pA.y);
          oppAngle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
          hasOppPath = elapsed < botTargetTotalTime * 3;
        } else if (ghostRacer.ghostPath.length > 0) {
          // Human ghost replay - interpolate coordinates
          const frames = ghostRacer.ghostPath;
          if (elapsed < frames[frames.length - 1].time) {
            let idx1 = 0;
            for (let i = 0; i < frames.length; i++) {
              if (frames[i].time <= elapsed) idx1 = i;
            }
            const idx2 = Math.min(idx1 + 1, frames.length - 1);
            const f1 = frames[idx1];
            const f2 = frames[idx2];
            
            let tRatio = 0;
            if (f2.time !== f1.time) {
              tRatio = (elapsed - f1.time) / (f2.time - f1.time);
            }
            
            oppX = f1.x + tRatio * (f2.x - f1.x);
            oppY = f1.y + tRatio * (f2.y - f1.y);
            oppAngle = f1.angle + tRatio * (f2.angle - f1.angle);
            hasOppPath = true;
          }
        }
      }

      if (hasOppPath) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.translate(oppX, oppY);
        ctx.rotate(oppAngle);

        // Drawing a semi-transparent blue ghost racer
        ctx.fillStyle = "#3b82f6";
        ctx.fillRect(-12, -7, 24, 14);
        
        ctx.fillStyle = "#60a5fa";
        ctx.fillRect(4, -5, 6, 10);
        ctx.fillRect(-10, -5, 3, 10);

        // Tires
        ctx.fillStyle = "#000";
        ctx.fillRect(4, -9, 5, 2);
        ctx.fillRect(4, 7, 5, 2);
        ctx.fillRect(-9, -9, 5, 2);
        ctx.fillRect(-9, 7, 5, 2);

        ctx.restore();
      }

      // Draw local User Car
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      // Body chassis shadow
      ctx.shadowColor = isOffRoad ? "rgba(180,140,50,0.4)" : "rgba(16,185,129,0.3)";
      ctx.shadowBlur = 8;

      // Draw glowing emerald race car chassis
      ctx.fillStyle = isOffRoad ? "#b45309" : "#10b981";
      ctx.fillRect(-12, -7, 24, 14);

      // Windshield & carbon details
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#0b1329";
      ctx.fillRect(4, -5, 6, 10);
      ctx.fillRect(-10, -5, 3, 10);

      // Tires
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(4, -9, 5, 2);
      ctx.fillRect(4, 7, 5, 2);
      ctx.fillRect(-9, -9, 5, 2);
      ctx.fillRect(-9, 7, 5, 2);

      // Spoiler wing
      ctx.fillStyle = "#34d399";
      ctx.fillRect(-13, -8, 2, 16);

      ctx.restore();
    };

    const tick = () => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (gameState === "racing") {
        setElapsedTime(now - startTime);
      } else {
        setElapsedTime(0);
      }

      updatePhysics(dt, now);
      drawGame(now);

      if (gameState === "racing" || gameState === "countdown") {
        animFrameId = requestAnimationFrame(tick);
      }
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [gameState, gameDoc, ghostRacer]);

  // Start countdown sequence
  const startRace = () => {
    // Resume Audio Context on interaction
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    setFinalRaceTime(null);
    setGameState("countdown");
    setCountdown(3);

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setGameState("racing");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Upload final score & ghost telemetry
  const handleFinish = async (finalTime: number, bestLap: number) => {
    if (!gameId || !user || !gameDoc) return;

    try {
      // 1. Increment racing_gamesPlayed for the user in the users collection
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          racing_gamesPlayed: increment(1)
        });
      } catch (err) {
        console.error("Error incrementing racing_gamesPlayed:", err);
      }

      const ghostString = JSON.stringify(myGhostBuffer.current);

      // Safeguard: Make sure bestLap is a valid number, otherwise fallback to finalTime / 3
      const safeBestLap = typeof bestLap === "number" && !isNaN(bestLap) && isFinite(bestLap) && bestLap > 0
        ? bestLap
        : Math.round(finalTime / 3);

      // Query all existing finished runs for this track by this user to check for PB
      const q = query(
        collection(db, "games_racing"),
        where("player1Id", "==", user.uid),
        where("trackId", "==", trackId),
        where("status", "==", "finished"),
        where("player2Id", "==", null)
      );
      const snap = await getDocs(q);
      const finishedRuns = snap.docs.map(d => ({ id: d.id, time: d.data().player1Time }));

      // Find the fastest existing run
      let existingBestTime = Infinity;
      const existingBestDocIds: string[] = [];

      for (const run of finishedRuns) {
        if (typeof run.time === "number") {
          if (run.time < existingBestTime) {
            existingBestTime = run.time;
          }
          existingBestDocIds.push(run.id);
        }
      }

      if (finalTime < existingBestTime) {
        // This is a new Personal Best! We save this run with full ghost telemetry
        const updates: any = {
          player1Time: finalTime,
          player1BestLap: safeBestLap,
          player1Ghost: ghostString,
          status: "finished",
          updatedAt: serverTimestamp()
        };

        const gameRef = doc(db, "games_racing", gameId);
        await updateDoc(gameRef, updates);

        // Clear ghost telemetry for all older finished runs to save storage space
        for (const oldId of existingBestDocIds) {
          try {
            await updateDoc(doc(db, "games_racing", oldId), {
              player1Ghost: "",
              updatedAt: serverTimestamp()
            });
          } catch (err) {
            console.error("Error clearing ghost of old run:", oldId, err);
          }
        }
      } else {
        // Did not beat PB! We save this current game session as finished but with empty ghost telemetry to save space
        const updates: any = {
          player1Time: finalTime,
          player1BestLap: safeBestLap,
          player1Ghost: "",
          status: "finished",
          updatedAt: serverTimestamp()
        };

        const gameRef = doc(db, "games_racing", gameId);
        await updateDoc(gameRef, updates);
      }
    } catch (e) {
      console.error("Error submitting race results:", e);
    }
  };

  const handleRetry = async () => {
    if (!user || !trackId) return;
    try {
      // Clean up the current unfinished game document if we are retrying before completing it
      if (gameId && gameDoc && gameDoc.status === "playing") {
        try {
          await deleteDoc(doc(db, "games_racing", gameId));
        } catch (err) {
          console.error("Error cleaning up unfinished run on retry:", err);
        }
      }

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
        trackId: trackId,
        player1Time: null,
        player2Time: null,
        winnerId: null,
        winnerName: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      // Navigate to the new game ID
      navigate(`/racing/game/${newGameRef.id}`);
      
      // Force page states to reset
      setGameState("idle");
      setFinalRaceTime(null);
      setElapsedTime(0);
      setLapTimes([]);
      setLapCount(1);
      setCurrentCheckpoint(1);
      setIsOffRoad(false);
      setSpeedKmh(0);
    } catch (error) {
      console.error("Error retrying solo run:", error);
    }
  };

  if (!gameDoc || !user) {
    return <div className="h-full flex items-center justify-center bg-slate-950 text-emerald-400 font-mono">Loading telemetry...</div>;
  }

  const ownTime = gameDoc.player1Time;
  const displayTotalTime = ownTime || finalRaceTime;

  const formatMs = (ms: number | null) => {
    if (ms === null || ms === undefined) return "--:--";
    const totalSec = ms / 1000;
    const sec = Math.floor(totalSec);
    const fract = Math.floor((totalSec - sec) * 100);
    return `${sec}.${fract.toString().padStart(2, "0")}s`;
  };

  const isNewPB = displayTotalTime !== null && (personalBest === null || displayTotalTime < personalBest);
  const isNewTR = displayTotalTime !== null && (trackRecord === null || displayTotalTime < trackRecord.time);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 font-sans select-none overflow-hidden touch-none">
      {/* Navbar bar */}
      <nav className="shrink-0 h-16 border-b border-slate-900 px-4 md:px-8 flex items-center justify-between bg-slate-950/80 backdrop-blur-md z-20">
        <button
          onClick={async () => {
            // Clean up the current unfinished game document if leaving before completing
            if (gameId && gameDoc && gameDoc.status === "playing") {
              try {
                await deleteDoc(doc(db, "games_racing", gameId));
              } catch (err) {
                console.error("Error cleaning up unfinished run on leave:", err);
              }
            }
            navigate("/racing");
          }}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Lobby</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Time Trial Arena</span>
          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-black rounded-full uppercase tracking-wider">
            {track.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-xl transition-all"
            title={isFullscreen ? "Vollbild beenden" : "Vollbildmodus"}
          >
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
          <button
            onClick={toggleMute}
            className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-xl transition-all"
            title={isMuted ? "Sound einschalten" : "Sound stummschalten"}
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {/* Main Game panel */}
      <main className="flex-1 grid grid-cols-12 overflow-hidden p-4 md:p-6 gap-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.04),transparent_50%)] pointer-events-none"></div>

        {/* Left Side: Stats and HUD Card */}
        <section className="col-span-12 lg:col-span-3 hidden lg:flex flex-col gap-4 shrink-0 justify-between">
          <div className="bg-slate-900/50 border border-slate-900 backdrop-blur-md p-6 rounded-3xl flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs uppercase font-bold text-slate-500 tracking-widest">Solo-Rennen</h3>
              {gameState === "racing" && (
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {/* Me */}
              <div className="flex items-center gap-3 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center font-bold text-emerald-400">
                  Du
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-white truncate">
                    {displayName || user.displayName || "Du"}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500 font-mono uppercase tracking-widest mt-0.5">
                    PB: {personalBest ? formatMs(personalBest) : "--:--"}
                  </p>
                  {personalBestLap && (
                    <p className="text-[9px] font-bold text-emerald-400/80 font-mono uppercase tracking-wider mt-0.5">
                      ⚡ Beste Rnd: {formatMs(personalBestLap)}
                    </p>
                  )}
                </div>
              </div>

              {/* Ghost Target */}
              <div className="flex items-center gap-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center font-bold text-blue-400">
                  👻
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-white truncate">
                    {ghostRacer ? (
                      ghostRacer.playerId ? (
                        `Rekord: ${usersMap[ghostRacer.playerId] || ghostRacer.name.replace("Rekord: ", "")}`
                      ) : (
                        ghostRacer.name
                      )
                    ) : "Pro-Bot Ghost"}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500 font-mono uppercase tracking-widest mt-0.5">
                    Ziel: {ghostRacer ? formatMs(ghostRacer.time) : "--:--"}
                  </p>
                  {trackRecordLap && (
                    <p className="text-[9px] font-bold text-blue-400/80 font-mono uppercase tracking-wider mt-0.5 truncate">
                      ⚡ Beste Rnd: {formatMs(trackRecordLap.time)} ({trackRecordLap.playerId ? (usersMap[trackRecordLap.playerId] || trackRecordLap.name) : trackRecordLap.name})
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="w-full h-px bg-slate-900 my-1"></div>

            {/* Timings and Laps section */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-950/50 border border-slate-900 rounded-2xl p-3">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Runde</span>
                  <span className="text-2xl font-black text-white font-mono">{gameState === "racing" ? `${lapCount}/3` : "--"}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-900 rounded-2xl p-3">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Gate</span>
                  <span className={cn(
                    "text-lg font-black font-mono block",
                    currentCheckpoint === 0 ? "text-emerald-400" : "text-amber-400"
                  )}>
                    {gameState === "racing" ? (currentCheckpoint === 0 ? "START/ZIEL" : `C${currentCheckpoint}`) : "--"}
                  </span>
                </div>
              </div>

              <div className="bg-slate-950/50 border border-slate-900 rounded-2xl p-3 flex flex-col items-center">
                <span className="text-[10px] font-bold text-slate-500 uppercase mb-1">Gesamtzeit</span>
                <span className="text-3xl font-black text-white font-mono tracking-wider">
                  {gameState === "racing" ? formatMs(elapsedTime) : formatMs(displayTotalTime)}
                </span>
              </div>

              {bestLapTime !== null && (
                <div className="bg-slate-950/50 border border-slate-900 rounded-2xl p-3 flex flex-col items-center border-emerald-500/20">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase mb-1">⚡ Beste Runde</span>
                  <span className="text-2xl font-black text-emerald-400 font-mono tracking-wider">
                    {formatMs(bestLapTime)}
                  </span>
                </div>
              )}

              {/* Laps List */}
              {lapTimes.length > 0 && (
                <div className="bg-slate-950/50 border border-slate-900 rounded-2xl p-3 space-y-1.5 font-mono text-xs">
                  {lapTimes.map((lt, idx) => (
                    <div key={idx} className="flex justify-between text-slate-400">
                      <span>Runde {idx + 1}:</span>
                      <span className="text-emerald-400 font-bold">{formatMs(lt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Off-Road Warn indicator */}
          {isOffRoad && gameState === "racing" && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-3 flex items-center justify-center gap-2 text-rose-400 text-xs font-bold animate-pulse">
              <ShieldAlert className="w-4 h-4" /> KOLLISION: BANDE BERÜHRT
            </div>
          )}

          {/* Speedometer Card */}
          <div className="bg-slate-900/50 border border-slate-900 backdrop-blur-md p-4 rounded-3xl flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Tachometer</span>
              <span className="text-3xl font-black text-white font-mono">{speedKmh} <span className="text-xs text-slate-500 font-sans">km/h</span></span>
            </div>
            {/* Minimal neon circular SVG needle indicator */}
            <svg className="w-16 h-16" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" stroke="#1e293b" strokeWidth="6" fill="none" />
              <circle
                cx="50"
                cy="50"
                r="40"
                stroke="#10b981"
                strokeWidth="6"
                fill="none"
                strokeDasharray="250"
                strokeDashoffset={250 - (250 * Math.min(speedKmh, 220)) / 280}
                className="transition-all duration-100"
              />
            </svg>
          </div>
        </section>

        {/* Center: The Canvas Race Arena */}
        <section className="col-span-12 lg:col-span-9 flex flex-col items-center justify-center relative min-h-0 bg-slate-900/20 border border-slate-900 rounded-[32px] p-4 overflow-hidden">
          
          {/* Compact Mobile Top HUD */}
          <div className="flex lg:hidden w-full max-w-[900px] bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-2xl p-3 items-center justify-between text-xs font-mono select-none mb-3 shrink-0">
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-slate-500 uppercase">Runde</span>
                <span className="text-sm font-black text-white">{gameState === "racing" ? `${lapCount}/3` : "--"}</span>
              </div>
              <div className="w-px h-6 bg-slate-800" />
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-slate-500 uppercase">Gate</span>
                <span className={cn(
                  "text-sm font-black",
                  currentCheckpoint === 0 ? "text-emerald-400" : "text-amber-400"
                )}>
                  {gameState === "racing" ? (currentCheckpoint === 0 ? "START" : `C${currentCheckpoint}`) : "--"}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <span className="text-[9px] font-bold text-slate-500 uppercase">Zeit</span>
              <span className="text-base font-black text-emerald-400 tracking-wider">
                {gameState === "racing" ? formatMs(elapsedTime) : formatMs(displayTotalTime)}
              </span>
              {bestLapTime !== null && (
                <span className="text-[8px] font-bold text-emerald-500 font-mono mt-0.5 animate-pulse">
                  ⚡ BEST: {formatMs(bestLapTime)}
                </span>
              )}
            </div>

            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-slate-500 uppercase">Speed</span>
              <span className="text-sm font-black text-white">{speedKmh} <span className="text-[9px] text-slate-500">km/h</span></span>
            </div>
          </div>

          <canvas
            ref={canvasRef}
            width={900}
            height={600}
            className="w-full max-w-[900px] aspect-[3/2] bg-slate-950 rounded-2xl shadow-2xl border border-slate-800/40 relative z-10"
          />

          {/* Virtual Gamepad Touch Controls Overlay */}
          {(gameState === "racing" || gameState === "countdown") && (
            <>
              {/* Left steering joystick container */}
              <div className="absolute bottom-8 left-8 z-20 lg:hidden select-none flex items-center justify-center">
                <div
                  ref={joystickRef}
                  onTouchStart={handleJoystickTouch}
                  onTouchMove={handleJoystickTouch}
                  onTouchEnd={handleJoystickRelease}
                  onTouchCancel={handleJoystickRelease}
                  className="w-28 h-28 rounded-full bg-slate-950/60 backdrop-blur-md border-2 border-slate-800/80 flex items-center justify-center relative shadow-2xl animate-pulse"
                  style={{ animationDuration: '3s' }}
                >
                  {/* Subtle directional markers */}
                  <div className="absolute inset-2 rounded-full border border-slate-900/10 pointer-events-none" />
                  <div className="absolute top-2 w-1 h-1 rounded-full bg-slate-800/80" />
                  <div className="absolute bottom-2 w-1 h-1 rounded-full bg-slate-800/80" />
                  <div className="absolute left-2 w-1 h-1 rounded-full bg-slate-800/80" />
                  <div className="absolute right-2 w-1 h-1 rounded-full bg-slate-800/80" />

                  {/* Active glowing joystick knob */}
                  <div
                    style={{
                      transform: `translate(${joystickOffset.x}px, ${joystickOffset.y}px)`,
                      transition: "transform 0.05s ease-out"
                    }}
                    className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 border border-emerald-300/40 shadow-lg shadow-emerald-500/20 flex items-center justify-center cursor-pointer pointer-events-none"
                  >
                    {/* Retro inner details */}
                    <div className="w-6 h-6 rounded-full bg-slate-950/30 border border-white/20" />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* HUD Screens Overlay */}
          {gameState === "idle" && (
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-6 text-center p-6">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-3xl">
                🏎️
              </div>
              <div>
                <h2 className="text-2xl font-black text-white mb-2">Bist du bereit fürs Rennen?</h2>
                <p className="text-sm text-slate-400 max-w-sm">
                  Steuerung mit <strong>WASD</strong> oder <strong>Pfeiltasten</strong>. Drifte in Kurven für maximale Traktion, bleibe auf dem Asphalt!
                </p>
              </div>

              <div className="flex flex-col items-center gap-4 w-full max-w-xs">
                <button
                  onClick={startRace}
                  className="w-full px-8 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black rounded-2xl shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Play className="w-5 h-5 fill-slate-950" /> BEREIT MACHEN
                </button>
              </div>
            </div>
          )}

          {gameState === "countdown" && (
            <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
              <div className="text-[120px] font-black text-emerald-400 animate-pulse tracking-widest font-mono select-none drop-shadow-[0_0_20px_rgba(16,185,129,0.65)]">
                {countdown > 0 ? countdown : "GO!"}
              </div>
            </div>
          )}

          {gameState === "finished" && (
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-20 flex flex-col items-center justify-center gap-6 text-center p-6">
              <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400">
                <Trophy className="w-7 h-7" />
              </div>

              <div>
                <h2 className="text-3xl font-black text-white mb-1">Ziel erreicht!</h2>
                <p className="text-xs uppercase font-bold text-slate-500 tracking-wider">Ergebnis deiner Zeitjagd</p>
              </div>

              <div className="grid grid-cols-2 gap-4 max-w-sm w-full bg-slate-900/50 border border-slate-800 rounded-3xl p-6 relative">
                <div className="text-center col-span-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Deine Zeit:</span>
                  <span className="text-xl font-mono font-black text-emerald-400">{formatMs(displayTotalTime)}</span>
                  {bestLapTime !== null && (
                    <span className="text-[10px] font-bold text-emerald-500 font-mono block mt-1">
                      Beste Rnd: {formatMs(bestLapTime)}
                    </span>
                  )}
                </div>
                <div className="text-center border-l border-slate-800 flex flex-col justify-center items-center col-span-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Geist-Ziel:</span>
                  <span className="text-xl font-mono font-black text-blue-400">
                    {ghostRacer ? formatMs(ghostRacer.time) : "--:--"}
                  </span>
                </div>

                {isNewTR && (
                  <div className="col-span-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 font-black text-xs rounded-xl uppercase tracking-widest animate-bounce">
                    🏆 NEUER STRECKENREKORD!
                  </div>
                )}
                {!isNewTR && isNewPB && (
                  <div className="col-span-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-black text-xs rounded-xl uppercase tracking-widest animate-pulse">
                    ⚡ NEUE PERSÖNLICHE BESTZEIT!
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <button
                  onClick={handleRetry}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/10"
                >
                  <RefreshCw className="w-4 h-4" /> Nochmal versuchen
                </button>
                <button
                  onClick={() => navigate("/racing")}
                  className="px-6 py-3 bg-slate-900 border border-slate-850 hover:border-slate-700 text-white font-bold rounded-2xl hover:bg-slate-850 transition-all"
                >
                  Zurück zur Lobby
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
