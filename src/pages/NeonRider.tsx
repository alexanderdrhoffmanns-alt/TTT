import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  onSnapshot
} from "firebase/firestore";
import {
  ArrowLeft,
  Trophy,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  Zap,
  Clock,
  Sparkles,
  Milestone,
  Award,
  CircleDot
} from "lucide-react";
import { cn } from "../lib/utils";

interface CompletedRiderRun {
  id: string;
  playerId: string;
  playerName: string;
  trackId: "neon-loop" | "gravity-drop" | "endless-grid";
  score: number;
  time: number | null;
  status: "finished";
  createdAt: any;
}

interface TelemetryPoint2D {
  x: number;
  y: number;
}

// 2D particle definition for explosions and landings
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
}

interface Gem {
  x: number;
  y: number;
  collected: boolean;
}

export default function NeonRider() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState<string>("");
  
  // Audio state
  const [isMuted, setIsMuted] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const engineOscRef = useRef<OscillatorNode | null>(null);
  const engineGainRef = useRef<GainNode | null>(null);

  // Lobby states
  const [activeTab, setActiveTab] = useState<"neon-loop" | "gravity-drop" | "endless-grid">("neon-loop");
  const [allRuns, setAllRuns] = useState<CompletedRiderRun[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  
  // Game states
  const [gameState, setGameState] = useState<"lobby" | "countdown" | "playing" | "gameover" | "complete">("lobby");
  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const [currentScore, setCurrentScore] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [slowmoMsg, setSlowmoMsg] = useState<string | null>(null);
  const [speedKmh, setSpeedKmh] = useState(0);

  // References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const touchActiveRef = useRef(false);

  // Sync user display name
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (snap.exists()) {
        setDisplayName(snap.data().displayName || "");
      }
    });
    return () => unsubscribe();
  }, [user]);

  // Fetch all Rider games from Firestore
  useEffect(() => {
    const q = query(collection(db, "games_rider"), where("status", "==", "finished"));
    const unsubscribe = onSnapshot(q, (snap) => {
      const runs = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as CompletedRiderRun[];
      setAllRuns(runs);
    });
    return () => unsubscribe();
  }, []);

  // Fetch all user mappings
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
    });
    return () => unsubscribe();
  }, []);

  // Audio Engine Synthesizer
  const initAudio = () => {
    try {
      if (audioCtxRef.current) return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(55, ctx.currentTime);
      gain.gain.setValueAtTime(isMuted ? 0 : 0.05, ctx.currentTime);

      // Add a lowpass filter to make it sound beefier and cyber-like
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(140, ctx.currentTime);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      engineOscRef.current = osc;
      engineGainRef.current = gain;
    } catch (e) {
      console.warn("Unable to start web audio synthesizer:", e);
    }
  };

  const playSynthSound = (type: "jump" | "flip" | "landing" | "gem" | "crash" | "win") => {
    if (!audioCtxRef.current || isMuted) return;
    const ctx = audioCtxRef.current;
    
    if (type === "jump") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(380, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } else if (type === "flip") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(280, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "landing") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(80, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(45, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
      
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(120, ctx.currentTime);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "gem") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.setValueAtTime(780, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else if (type === "crash") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(90, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(20, ctx.currentTime + 0.8);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
      
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(80, ctx.currentTime);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    } else if (type === "win") {
      // Futuristic synth arpeggio
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
        gain.gain.setValueAtTime(0.06, ctx.currentTime + idx * 0.08);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + idx * 0.08 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.35);
      });
    }
  };

  const toggleMute = () => {
    setIsMuted(prev => {
      const next = !prev;
      if (engineGainRef.current && audioCtxRef.current) {
        engineGainRef.current.gain.setValueAtTime(next ? 0 : 0.05, audioCtxRef.current.currentTime);
      }
      return next;
    });
  };

  // Keyboard Event Handlers
  const isHoldingKeyRef = useRef(false);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "KeyW"].includes(e.code)) {
        e.preventDefault();
        if (!audioCtxRef.current) {
          initAudio();
        } else if (audioCtxRef.current.state === "suspended") {
          audioCtxRef.current.resume();
        }
        isHoldingKeyRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "KeyW"].includes(e.code)) {
        isHoldingKeyRef.current = false;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Track generator formulas
  // Generates 2D coordinates for our tracks
  const generateTrack = (trackId: "neon-loop" | "gravity-drop" | "endless-grid") => {
    const points: TelemetryPoint2D[] = [];
    const gems: Gem[] = [];
    
    if (trackId === "neon-loop") {
      // Predefined Neon Loop Track: curves, jumps, loops, and a finish line
      let cx = 0;
      let cy = 400;
      points.push({ x: cx, y: cy });

      // 1. Initial flat start
      for (let i = 0; i < 20; i++) {
        cx += 30;
        points.push({ x: cx, y: cy });
      }

      // 2. A nice ramp jump
      for (let i = 0; i < 10; i++) {
        cx += 25;
        cy -= 10;
        points.push({ x: cx, y: cy });
      }
      
      // The gap (let's insert a gap in terrain)
      cx += 120; // landing gap
      cy += 60;  // landing is slightly lower
      
      // Landing ramp
      for (let i = 0; i < 15; i++) {
        cx += 25;
        cy += (i < 5 ? 5 : 0); // smooth landing curve
        points.push({ x: cx, y: cy });
      }

      // 3. A loop-de-loop!
      const loopCenterX = cx + 220;
      const loopCenterY = cy - 140;
      const loopRadius = 140;
      
      // Enter the loop (smooth entrance)
      for (let angle = Math.PI / 2; angle <= Math.PI * 2.5; angle += 0.15) {
        const lx = loopCenterX + loopRadius * Math.cos(angle);
        const ly = loopCenterY + loopRadius * Math.sin(angle);
        // Twist slightly in 2.5D coordinates to avoid overlapping path collision issues
        points.push({ x: lx, y: ly });
      }

      // Track resumes after the loop
      cx = loopCenterX + loopRadius * Math.cos(Math.PI * 2.5) + 30;
      cy = loopCenterY + loopRadius * Math.sin(Math.PI * 2.5);

      // 4. Rollercoaster hills
      for (let i = 0; i < 30; i++) {
        cx += 25;
        cy += Math.sin(i / 5) * 18;
        points.push({ x: cx, y: cy });
      }

      // 5. Final stretch and finish line
      for (let i = 0; i < 15; i++) {
        cx += 35;
        points.push({ x: cx, y: cy });
      }

      // Add gems along the way
      gems.push({ x: 300, y: 380, collected: false });
      gems.push({ x: 580, y: 300, collected: false });
      gems.push({ x: 1200, y: 220, collected: false });
      gems.push({ x: 1750, y: 340, collected: false });

    } else if (trackId === "gravity-drop") {
      // High vertical drop with steep ramps
      let cx = 0;
      let cy = 180;
      points.push({ x: cx, y: cy });

      // Start area
      for (let i = 0; i < 12; i++) {
        cx += 30;
        points.push({ x: cx, y: cy });
      }

      // Massive Gravity Drop ramp
      for (let i = 0; i < 20; i++) {
        cx += 30;
        cy += i * 3.5;
        points.push({ x: cx, y: cy });
      }

      // Huge launch kicker
      for (let i = 0; i < 8; i++) {
        cx += 28;
        cy -= 15;
        points.push({ x: cx, y: cy });
      }

      // The Giant Chasm gap
      cx += 350;
      cy += 200; // drops down severely

      // Landing pad
      for (let i = 0; i < 25; i++) {
        cx += 30;
        cy += (i < 8 ? 6 : -1); // curve upward and flat
        points.push({ x: cx, y: cy });
      }

      // Final run to the goal
      for (let i = 0; i < 20; i++) {
        cx += 35;
        points.push({ x: cx, y: cy });
      }

      // Gems in the sky
      gems.push({ x: 450, y: 220, collected: false });
      gems.push({ x: 1050, y: 340, collected: false });
      gems.push({ x: 1180, y: 360, collected: false });
      gems.push({ x: 1550, y: 480, collected: false });

    } else {
      // Endless Grid dynamic procedural starter
      let cx = 0;
      let cy = 400;
      for (let i = 0; i < 50; i++) {
        cx += 30;
        points.push({ x: cx, y: cy });
      }
    }

    return { points, gems };
  };

  // Main gameplay loop Effect
  useEffect(() => {
    if (gameState !== "playing" || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;
    let startTime = Date.now();
    let lastTime = startTime;

    // Bullet-time slow-motion logic
    let slowmoEndTime = 0;
    let slowmoFactor = 1.0;

    // Load initial track assets
    const trackData = generateTrack(activeTab);
    let trackPoints = [...trackData.points];
    const gemsList = [...trackData.gems];

    // Vehicle state variables
    let rider = {
      x: 100,
      y: 350,
      vx: 0,
      vy: 0,
      angle: 0,
      angularVelocity: 0,
      onGround: false,
      flipsCompleted: 0,
      lastAirborneAngle: 0,
      accumulatedAirTimeRotation: 0,
      speedBonusTimer: 0
    };

    const backWheelOffset = -18;
    const frontWheelOffset = 18;
    const bikeRadius = 14;

    // Visual buffers
    let particles: Particle[] = [];
    let trailBuffer: TelemetryPoint2D[] = [];

    // Local timing counters
    let localScore = 0;
    let localTime = 0;

    const getTerrainHeight = (px: number, py: number): { y: number; slopeAngle: number } | null => {
      let closestSegment: { y: number; slopeAngle: number } | null = null;
      let minDistanceY = Infinity;

      // Find closest segment that horizontally spans px
      for (let i = 0; i < trackPoints.length - 1; i++) {
        const p1 = trackPoints[i];
        const p2 = trackPoints[i + 1];

        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);

        if (px >= minX && px <= maxX) {
          const dx = p2.x - p1.x;
          if (dx === 0) continue; // vertical wall skip

          const ratio = (px - p1.x) / dx;
          const y = p1.y + ratio * (p2.y - p1.y);
          const distanceY = Math.abs(py - y);

          if (distanceY < minDistanceY) {
            minDistanceY = distanceY;
            const slopeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            closestSegment = { y, slopeAngle };
          }
        }
      }
      return closestSegment;
    };

    // Procedural generation helper for Endless Grid
    const extendEndlessTrackIfNeeded = (riderX: number) => {
      if (activeTab !== "endless-grid") return;

      const lastPoint = trackPoints[trackPoints.length - 1];
      // Generate dynamically ahead of rider position
      if (lastPoint.x - riderX < 1200) {
        let cx = lastPoint.x;
        let cy = lastPoint.y;
        
        // Pick a random track segment template
        const type = Math.random();
        if (type < 0.3) {
          // Flat cruise
          for (let i = 0; i < 15; i++) {
            cx += 30;
            trackPoints.push({ x: cx, y: cy });
            if (Math.random() < 0.12) {
              gemsList.push({ x: cx, y: cy - 40, collected: false });
            }
          }
        } else if (type < 0.6) {
          // Jump ramp
          for (let i = 0; i < 8; i++) {
            cx += 26;
            cy -= 9;
            trackPoints.push({ x: cx, y: cy });
          }
          // The chasm gap (no points added for a gap!)
          cx += 130 + Math.random() * 80;
          cy += 40 + Math.random() * 50;
          
          // Landing pad
          for (let i = 0; i < 12; i++) {
            cx += 28;
            cy += (i < 4 ? 4 : 0);
            trackPoints.push({ x: cx, y: cy });
          }
          gemsList.push({ x: cx - 120, y: cy - 90, collected: false });
        } else if (type < 0.85) {
          // Big looping roller-coaster hill
          for (let i = 0; i < 20; i++) {
            cx += 28;
            cy += Math.sin(i / 3) * 22;
            trackPoints.push({ x: cx, y: cy });
            if (i === 10) {
              gemsList.push({ x: cx, y: cy - 50, collected: false });
            }
          }
        } else {
          // A full looping in endless!
          const loopCenterX = cx + 180;
          const loopCenterY = cy - 110;
          const loopRadius = 110;
          for (let angle = Math.PI / 2; angle <= Math.PI * 2.5; angle += 0.18) {
            const lx = loopCenterX + loopRadius * Math.cos(angle);
            const ly = loopCenterY + loopRadius * Math.sin(angle);
            trackPoints.push({ x: lx, y: ly });
          }
          cx = loopCenterX + loopRadius * Math.cos(Math.PI * 2.5) + 30;
          cy = loopCenterY + loopRadius * Math.sin(Math.PI * 2.5);
          for (let i = 0; i < 10; i++) {
            cx += 30;
            trackPoints.push({ x: cx, y: cy });
          }
        }
      }
    };

    const updatePhysics = (dt: number, now: number) => {
      // 1. Endless track procedural expansion
      extendEndlessTrackIfNeeded(rider.x);

      // Handle bullet-time timing
      if (now < slowmoEndTime) {
        slowmoFactor = 0.22; // super cool Matrix bullet-time speed
      } else {
        slowmoFactor = 1.0;
        setSlowmoMsg(null);
      }

      // Scaled time step for bullet time slow motion
      const step = dt * slowmoFactor;

      // 2. Physics values
      const gravity = 0.44;
      const rotationSpeed = 0.082;
      const acceleration = 0.38;
      const maxGroundSpeed = 16.5;

      // Calculate wheel centers (including vertical offset of 6px in chassis space)
      const cosA = Math.cos(rider.angle);
      const sinA = Math.sin(rider.angle);
      
      const backWheelX = rider.x + backWheelOffset * cosA - 6 * sinA;
      const backWheelY = rider.y + backWheelOffset * sinA + 6 * cosA;
      const frontWheelX = rider.x + frontWheelOffset * cosA - 6 * sinA;
      const frontWheelY = rider.y + frontWheelOffset * sinA + 6 * cosA;

      const terrainBack = getTerrainHeight(backWheelX, backWheelY);
      const terrainFront = getTerrainHeight(frontWheelX, frontWheelY);
      const terrainCenter = getTerrainHeight(rider.x, rider.y);

      // Wheel bottoms (6px radius below wheel center)
      const backWheelBottomY = backWheelY + 6;
      const frontWheelBottomY = frontWheelY + 6;

      // Determine if on ground (with buffer to prevent jittering/snapping bugs)
      const backTouching = terrainBack ? (backWheelBottomY >= terrainBack.y - 6) : false;
      const frontTouching = terrainFront ? (frontWheelBottomY >= terrainFront.y - 6) : false;
      const isCurrentlyOnGround = terrainCenter
        ? (backTouching || frontTouching || (rider.y >= terrainCenter.y - 16))
        : false;

      // Input check: User holding Spacebar/click/touch
      const isHoldingControls = isHoldingKeyRef.current || touchActiveRef.current;

      if (isCurrentlyOnGround && terrainCenter) {
        if (!rider.onGround) {
          // Just touched down! Evaluate landing stunt quality
          rider.onGround = true;
          playSynthSound("landing");

          // Evaluate angle alignment
          const angleDiff = Math.abs(rider.angle - terrainCenter.slopeAngle);
          const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));

          if (Math.abs(normalizedDiff) > 1.25) {
            // CRASHED! Boom!
            triggerCrash(now);
            return;
          }

          // Evaluate Flip completion bonuses
          if (rider.flipsCompleted > 0) {
            const isPerfect = Math.abs(normalizedDiff) < 0.28;
            let scoreGained = rider.flipsCompleted * 250;
            if (isPerfect) {
              scoreGained *= 2; // Perfect Landing Double score!
              rider.speedBonusTimer = 45; // Super Speed burst!
              setSlowmoMsg(`⚡ PERFECT LANDING x${rider.flipsCompleted}!`);
            } else {
              setSlowmoMsg(`🔥 NICE FLIP x${rider.flipsCompleted}!`);
            }

            localScore += scoreGained;
            setCurrentScore(localScore);

            // Spawn celebration particles
            for (let i = 0; i < 15; i++) {
              particles.push({
                x: rider.x,
                y: rider.y,
                vx: (Math.random() - 0.5) * 8,
                vy: -Math.random() * 6 - 2,
                size: Math.random() * 4.5 + 2,
                color: isPerfect ? "#10b981" : "#f43f5e",
                alpha: 1.0,
                decay: 0.025
              });
            }
          }

          rider.flipsCompleted = 0;
          rider.accumulatedAirTimeRotation = 0;
        }

        // Apply ground movement
        rider.vy = 0;
        rider.angularVelocity = 0;

        // Snap to ground slope safely
        const targetAngle = terrainCenter.slopeAngle;
        let angleDiff = targetAngle - rider.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        rider.angle += angleDiff * 0.32; // smooth alignment

        // Snap to ground height
        rider.y = terrainCenter.y - 12; // ride offset

        // Apply driving force
        if (isHoldingControls) {
          const driveForce = acceleration + (rider.speedBonusTimer > 0 ? 0.35 : 0);
          rider.vx += Math.cos(rider.angle) * driveForce;
        }

        // Apply standard ground friction
        rider.vx *= 0.985;
        if (rider.vx > maxGroundSpeed) {
          rider.vx = maxGroundSpeed;
        }
      } else {
        // Airborne state physics
        if (rider.onGround) {
          rider.onGround = false;
          playSynthSound("jump");
          rider.lastAirborneAngle = rider.angle;
          rider.accumulatedAirTimeRotation = 0;
        }

        // Apply gravity
        rider.vy += gravity;
        rider.y += rider.vy * step;

        // Rotational dynamics: Flipping in the air
        if (isHoldingControls) {
          rider.angularVelocity += rotationSpeed * 0.18;
          if (rider.angularVelocity > 0.16) {
            rider.angularVelocity = 0.16;
          }
        } else {
          rider.angularVelocity *= 0.94; // natural spin drag
        }

        rider.angle += rider.angularVelocity * step;
        rider.accumulatedAirTimeRotation += rider.angularVelocity * step;

        // Detect full backflips (360 degrees rotation)
        if (Math.abs(rider.accumulatedAirTimeRotation) >= Math.PI * 2 * (rider.flipsCompleted + 1)) {
          rider.flipsCompleted++;
          playSynthSound("flip");
          setSlowmoMsg(`+ ${rider.flipsCompleted} FLIP!`);
          
          // Trigger matrix-style slow-motion effect on flip milestone
          slowmoEndTime = now + 420; // slow-motion lasts 420ms
          
          // Spawn neon ring particles
          for (let a = 0; a < Math.PI * 2; a += 0.4) {
            particles.push({
              x: rider.x,
              y: rider.y,
              vx: Math.cos(a) * 3,
              vy: Math.sin(a) * 3,
              size: 3,
              color: "#3b82f6",
              alpha: 1.0,
              decay: 0.04
            });
          }
        }

        // Horizontal air resistance drag
        rider.vx *= 0.995;
      }

      // Horizontal update
      rider.x += rider.vx * step;

      // Handle endless distance scoring
      if (activeTab === "endless-grid") {
        const distScore = Math.floor(rider.x / 10);
        if (distScore > localScore) {
          localScore = distScore;
          setCurrentScore(localScore);
        }
      }

      // Handle Speed Bonus Timer decaying
      if (rider.speedBonusTimer > 0) {
        rider.speedBonusTimer--;
      }

      // Synth Pitch modulation based on current speed
      setSpeedKmh(Math.round(Math.abs(rider.vx) * 14));
      if (engineOscRef.current && audioCtxRef.current) {
        const baseFreq = 50;
        const currentSpeedRatio = Math.abs(rider.vx) / maxGroundSpeed;
        const targetFreq = baseFreq + currentSpeedRatio * 90 + (rider.angularVelocity > 0 ? 120 : 0);
        engineOscRef.current.frequency.setTargetAtTime(targetFreq, audioCtxRef.current.currentTime, 0.08);
      }

      // 3. Collision checking for leuchtende Diamanten (Gems)
      gemsList.forEach(gem => {
        if (!gem.collected) {
          const dist = Math.hypot(rider.x - gem.x, rider.y - gem.y);
          if (dist < 32) {
            gem.collected = true;
            localScore += 500;
            setCurrentScore(localScore);
            playSynthSound("gem");

            // Gem sparkle particles
            for (let i = 0; i < 8; i++) {
              particles.push({
                x: gem.x,
                y: gem.y,
                vx: (Math.random() - 0.5) * 6,
                vy: (Math.random() - 0.5) * 6,
                size: Math.random() * 3 + 1.5,
                color: "#e11d48", // Hot Pink diamond sparkles
                alpha: 1.0,
                decay: 0.04
              });
            }
          }
        }
      });

      // 4. Trail buffer
      trailBuffer.push({ x: rider.x, y: rider.y });
      if (trailBuffer.length > 25) {
        trailBuffer.shift();
      }

      // 5. Particles ticking
      particles.forEach(p => {
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.alpha -= p.decay;
      });
      particles = particles.filter(p => p.alpha > 0);

      // Check Time-Trial finish line
      if (activeTab !== "endless-grid") {
        const finalPoint = trackPoints[trackPoints.length - 1];
        if (rider.x >= finalPoint.x - 30) {
          // Finished track! Clean victory!
          setGameState("complete");
          playSynthSound("win");
          handleFinishGame(localScore, localTime);
        }
      }
    };

    const triggerCrash = (now: number) => {
      setGameState("gameover");
      playSynthSound("crash");

      // Spawn massive explosion!
      for (let i = 0; i < 45; i++) {
        particles.push({
          x: rider.x,
          y: rider.y,
          vx: (Math.random() - 0.5) * 14,
          vy: (Math.random() - 0.5) * 14 - 3,
          size: Math.random() * 6 + 2.5,
          color: i % 2 === 0 ? "#f43f5e" : "#f59e0b", // Neon Pink and Gold blast
          alpha: 1.0,
          decay: 0.015
        });
      }

      // Stop engine sound hum
      if (engineGainRef.current && audioCtxRef.current) {
        engineGainRef.current.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
      }

      handleFinishGame(localScore, localTime);
    };

    const drawGame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Camera follow: Offset to center the vehicle
      const cameraX = rider.x - 220;
      const cameraY = rider.y - 280;

      // Draw futuristic cyberpunk background grid
      ctx.save();
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "rgba(244,63,94,0.035)";
      ctx.lineWidth = 1.0;
      const gridSize = 45;
      // Parallax scroll the grid
      const offsetX = -(cameraX * 0.15) % gridSize;
      const offsetY = -(cameraY * 0.15) % gridSize;

      for (let x = offsetX; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = offsetY; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      ctx.restore();

      // Start drawing active game components offset by camera
      ctx.save();
      ctx.translate(-cameraX, -cameraY);

      // Draw the glowing Neon Track
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      
      // Bottom thick ambient glow
      ctx.strokeStyle = activeTab === "endless-grid" ? "rgba(16,185,129,0.18)" : "rgba(244,63,94,0.18)";
      ctx.lineWidth = 16;
      ctx.beginPath();
      trackPoints.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Middle bright stroke
      ctx.strokeStyle = activeTab === "endless-grid" ? "#10b981" : "#f43f5e";
      ctx.lineWidth = 6;
      ctx.beginPath();
      trackPoints.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Inner white core
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      trackPoints.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Draw Finish Line (Flag) for Time Trials
      if (activeTab !== "endless-grid" && trackPoints.length > 0) {
        const finalPoint = trackPoints[trackPoints.length - 1];
        ctx.save();
        ctx.translate(finalPoint.x, finalPoint.y - 45);

        // Checkerboard flag
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-2, 0, 4, 45); // flagpole
        
        ctx.fillStyle = activeTab === "neon-loop" ? "#f43f5e" : "#3b82f6";
        ctx.fillRect(2, 0, 24, 15);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(8, 3, 6, 6);
        ctx.fillRect(16, 6, 6, 6);

        ctx.restore();
      }

      // Draw Gems
      gemsList.forEach(gem => {
        if (!gem.collected) {
          ctx.save();
          ctx.translate(gem.x, gem.y);
          
          // Draw diamond gem
          ctx.shadowColor = "#e11d48";
          ctx.shadowBlur = 8;
          ctx.fillStyle = "#f43f5e";
          ctx.beginPath();
          ctx.moveTo(0, -9);
          ctx.lineTo(7, 0);
          ctx.lineTo(0, 9);
          ctx.lineTo(-7, 0);
          ctx.closePath();
          ctx.fill();

          ctx.restore();
        }
      });

      // Draw vehicle tail trail
      if (trailBuffer.length > 1) {
        ctx.strokeStyle = "rgba(59,130,246,0.35)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        trailBuffer.forEach((p, idx) => {
          if (idx === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }

      // Draw particles
      particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Draw Rider Vehicle (Motorcycle chassis)
      if (gameStateRef.current === "playing") {
        ctx.save();
        ctx.translate(rider.x, rider.y);
        ctx.rotate(rider.angle);

        // Ambient cyber shadow
        ctx.shadowColor = "#3b82f6";
        ctx.shadowBlur = 10;

        // Front Wheel
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.arc(frontWheelOffset, 6, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Inner detail
        ctx.fillStyle = "#3b82f6";
        ctx.beginPath();
        ctx.arc(frontWheelOffset, 6, 2, 0, Math.PI * 2);
        ctx.fill();

        // Back Wheel
        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.arc(backWheelOffset, 6, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Inner detail
        ctx.beginPath();
        ctx.arc(backWheelOffset, 6, 2, 0, Math.PI * 2);
        ctx.fill();

        // Main Bike Chassis vector path
        ctx.shadowBlur = 0; // reset
        ctx.strokeStyle = "#3b82f6"; // neon blue bike chassis
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(backWheelOffset, 6);
        ctx.lineTo(-4, -6);
        ctx.lineTo(8, -6);
        ctx.lineTo(frontWheelOffset, 6);
        ctx.stroke();

        // Glowing Engine core block
        ctx.fillStyle = rider.speedBonusTimer > 0 ? "#10b981" : "#60a5fa";
        ctx.fillRect(-6, -4, 12, 6);

        // Cyber Rider Head / Helmet (stylized)
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, -14, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(1, -16, 4, 3); // visor

        ctx.restore();
      }

      ctx.restore(); // camera restore
    };

    const tick = () => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (gameStateRef.current === "playing") {
        localTime += dt * 1000;
        setCurrentTime(localTime);
        updatePhysics(dt, now);
        drawGame();
        animFrameId = requestAnimationFrame(tick);
      }
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [gameState]);

  // Starts the countdown sequence
  const startGame = () => {
    initAudio();
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    setGameState("countdown");
    setCountdown(3);
    setCurrentScore(0);
    setCurrentTime(0);

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setGameState("playing");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Upload Finished game scores to Firestore
  const handleFinishGame = async (score: number, timeMs: number) => {
    if (!user) return;
    
    try {
      const finalTimeVal = activeTab === "endless-grid" ? null : Math.round(timeMs);
      const newGameRef = doc(collection(db, "games_rider"));
      
      await setDoc(newGameRef, {
        playerId: user.uid,
        playerName: displayName || user.displayName || "Spieler",
        trackId: activeTab,
        score: score,
        time: finalTimeVal,
        status: "finished",
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Error submitting Neon Rider score:", e);
    }
  };

  const formatMs = (ms: number | null) => {
    if (ms === null || ms === undefined) return "--:--";
    const totalSec = ms / 1000;
    const sec = Math.floor(totalSec);
    const fract = Math.floor((totalSec - sec) * 100);
    return `${sec}.${fract.toString().padStart(2, "0")}s`;
  };

  // Helper to extract Leaderboard for the active tab
  const getActiveLeaderboard = () => {
    const trackRuns = allRuns.filter(r => r.trackId === activeTab);
    
    if (activeTab === "endless-grid") {
      // Group by user and find maximum score
      const userBest: Record<string, CompletedRiderRun> = {};
      for (const run of trackRuns) {
        const existing = userBest[run.playerId];
        if (!existing || run.score > existing.score) {
          userBest[run.playerId] = run;
        }
      }
      return Object.values(userBest)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else {
      // Group by user and find minimum time
      const userBest: Record<string, CompletedRiderRun> = {};
      for (const run of trackRuns) {
        if (run.time && run.time > 0) {
          const existing = userBest[run.playerId];
          if (!existing || run.time < existing.time!) {
            userBest[run.playerId] = run;
          }
        }
      }
      return Object.values(userBest)
        .sort((a, b) => a.time! - b.time!)
        .slice(0, 10);
    }
  };

  const getPersonalBest = () => {
    if (!user) return null;
    const trackRuns = allRuns.filter(r => r.trackId === activeTab && r.playerId === user.uid);
    if (trackRuns.length === 0) return null;
    
    if (activeTab === "endless-grid") {
      return Math.max(...trackRuns.map(r => r.score));
    } else {
      const times = trackRuns.map(r => r.time).filter((t): t is number => typeof t === "number" && t > 0);
      if (times.length === 0) return null;
      return Math.min(...times);
    }
  };

  const pbValue = getPersonalBest();
  const leaderBoardList = getActiveLeaderboard();

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 font-sans select-none overflow-hidden touch-none relative">
      
      {/* Top Navbar */}
      <nav className="shrink-0 h-16 border-b border-slate-900 px-4 md:px-8 flex items-center justify-between bg-slate-950/80 backdrop-blur-md z-20">
        <button
          onClick={() => {
            // Stop engine sound hum on leave
            if (engineGainRef.current && audioCtxRef.current) {
              engineGainRef.current.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
            }
            navigate("/");
          }}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Dashboard</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Arcade Zone</span>
          <span className="px-3 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-black rounded-full uppercase tracking-widest">
            Neon Rider
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleMute}
            className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-xl transition-all"
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <ThemeToggle />
        </div>
      </nav>

      {/* Main Container */}
      <main className="flex-1 grid grid-cols-12 overflow-hidden p-4 md:p-6 gap-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(244,63,94,0.035),transparent_50%)] pointer-events-none"></div>

        {/* LOBBY / PRE-GAME OVERLAY OR LEADERBOARD SIDEBAR */}
        <section className="col-span-12 lg:col-span-4 flex flex-col gap-6 h-full min-h-0 relative z-10 shrink-0">
          
          {/* Track Selection Card */}
          <div className="bg-slate-900/50 border border-slate-900 backdrop-blur-md p-6 rounded-3xl shrink-0">
            <h3 className="text-xs uppercase font-black text-slate-500 tracking-widest mb-4">Streckenauswahl</h3>
            <div className="flex flex-col gap-3">
              {[
                { id: "neon-loop", name: "Looping Valley", type: "Zeitrennen", desc: "Absolviere Rampen und Loopings.", icon: CircleDot },
                { id: "gravity-drop", name: "Gravity Leap", type: "Zeitrennen", desc: "Ein extremer Abhang mit Riesensprung.", icon: Milestone },
                { id: "endless-grid", name: "Endless Neon Grid", type: "Highscore-Jagd", desc: "Überlebe auf einer dynamischen Bahn.", icon: Sparkles }
              ].map(t => {
                const IconComponent = t.icon;
                const isSelected = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    disabled={gameState === "playing" || gameState === "countdown"}
                    onClick={() => setActiveTab(t.id as any)}
                    className={cn(
                      "w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all",
                      isSelected
                        ? "bg-rose-500/10 border-rose-500/40 shadow-lg shadow-rose-500/5"
                        : "bg-slate-950/40 border-slate-900 hover:border-slate-800 disabled:opacity-50"
                    )}
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <IconComponent className={cn("w-4 h-4", isSelected ? "text-rose-400" : "text-slate-400")} />
                        <span className="font-extrabold text-sm text-white">{t.name}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">{t.desc}</p>
                    </div>
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0",
                      isSelected ? "bg-rose-500/20 text-rose-300" : "bg-slate-900 text-slate-500"
                    )}>
                      {t.type}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Leaderboard Card */}
          <div className="bg-slate-900/50 border border-slate-900 backdrop-blur-md p-6 rounded-3xl flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-xs uppercase font-black text-slate-500 tracking-widest flex items-center gap-1.5">
                <Trophy className="w-4 h-4 text-rose-400" /> Bestenliste
              </h3>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">
                {activeTab === "endless-grid" ? "Punkte" : "Zeiten"}
              </span>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar min-h-0">
              {leaderBoardList.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs py-8">
                  Keine Rekorde vorhanden.
                </div>
              ) : (
                leaderBoardList.map((entry, index) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-2xl border text-xs",
                      entry.playerId === user?.uid
                        ? "bg-rose-500/5 border-rose-500/20"
                        : "bg-slate-950/20 border-slate-900"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-3">
                      <span className={cn(
                        "w-5 h-5 font-black flex items-center justify-center rounded-lg",
                        index === 0 ? "bg-amber-500/20 text-amber-400" :
                        index === 1 ? "bg-slate-400/20 text-slate-400" :
                        index === 2 ? "bg-amber-700/20 text-amber-600" : "text-slate-500"
                      )}>
                        {index + 1}
                      </span>
                      <span className="font-extrabold text-white truncate">
                        {usersMap[entry.playerId] || entry.playerName}
                      </span>
                    </div>
                    <span className="font-black font-mono text-rose-400">
                      {activeTab === "endless-grid" ? `${entry.score} pts` : formatMs(entry.time)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Personal Best bar */}
            {pbValue !== null && (
              <div className="mt-4 pt-4 border-t border-slate-900 flex items-center justify-between text-xs shrink-0">
                <span className="font-bold text-slate-400 uppercase tracking-wider">Deine Bestleistung:</span>
                <span className="font-black text-rose-400 font-mono">
                  {activeTab === "endless-grid" ? `${pbValue} pts` : formatMs(pbValue as any)}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* GAME CANVAS ARENA */}
        <section className="col-span-12 lg:col-span-8 flex flex-col items-center justify-center bg-slate-900/10 border border-slate-900 rounded-[32px] p-4 overflow-hidden relative min-h-0">
          
          {/* Game HUD Bar when playing */}
          {gameState === "playing" && (
            <div className="w-full max-w-[800px] flex items-center justify-between mb-4 bg-slate-900/60 backdrop-blur-md border border-slate-900 rounded-3xl p-4 text-xs font-mono select-none z-20 shrink-0">
              <div className="flex items-center gap-4">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-500 uppercase">Geschwindigkeit</span>
                  <span className="text-sm font-black text-white">{speedKmh} <span className="text-[9px] text-slate-500">km/h</span></span>
                </div>
                <div className="w-px h-6 bg-slate-800" />
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-500 uppercase">
                    {activeTab === "endless-grid" ? "Punkte" : "Timer"}
                  </span>
                  <span className="text-sm font-black text-rose-400">
                    {activeTab === "endless-grid" ? `${currentScore} pts` : formatMs(currentTime)}
                  </span>
                </div>
              </div>

              {/* Stunts Indicator */}
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-bold text-slate-500 uppercase">Art</span>
                <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-black rounded-md uppercase tracking-wider">
                  {activeTab === "endless-grid" ? "SURVIVAL" : "TIME TRIAL"}
                </span>
              </div>
            </div>
          )}

          {/* Interactive Screen Game Area */}
          <div className="w-full max-w-[800px] aspect-[16/10] bg-slate-950 rounded-3xl border border-slate-900 shadow-2xl relative overflow-hidden flex items-center justify-center shrink-0">
            
            <canvas
              ref={canvasRef}
              width={800}
              height={500}
              className="w-full h-full relative z-10"
              onTouchStart={() => {
                if (!audioCtxRef.current) initAudio();
                touchActiveRef.current = true;
              }}
              onTouchEnd={() => {
                touchActiveRef.current = false;
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!audioCtxRef.current) initAudio();
                touchActiveRef.current = true;
              }}
              onMouseUp={() => {
                touchActiveRef.current = false;
              }}
              onMouseLeave={() => {
                touchActiveRef.current = false;
              }}
            />

            {/* Slowmo or Stunt Notifications Overlay */}
            {slowmoMsg && (
              <div className="absolute top-8 left-1/2 transform -translate-x-1/2 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-black text-xs px-4 py-1.5 rounded-full tracking-wider z-20 uppercase animate-bounce shadow-lg shadow-rose-950/20 select-none">
                {slowmoMsg}
              </div>
            )}

            {/* Screen 1: Idle Lobby Screen */}
            {gameState === "lobby" && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-6 text-center p-6 select-none">
                <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center text-3xl shadow-inner animate-pulse">
                  🏍️
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white mb-2">Bereit für Neon Rider?</h2>
                  <p className="text-xs text-slate-400 max-w-sm font-medium">
                    Drücke und halte die <strong>Leertaste</strong>, die <strong>Pfeiltaste Oben</strong> oder klicke/berühre den Bildschirm zum Beschleunigen. Halte sie in der Luft gedrückt, um waghalsige Saltos zu schlagen!
                  </p>
                </div>

                <button
                  onClick={startGame}
                  className="px-8 py-3.5 bg-gradient-to-r from-rose-500 to-pink-500 text-slate-950 font-black rounded-2xl shadow-lg shadow-rose-500/25 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                  <Play className="w-5 h-5 fill-slate-950" /> RENNEN STARTEN
                </button>
              </div>
            )}

            {/* Screen 2: Countdown Screen */}
            {gameState === "countdown" && (
              <div className="absolute inset-0 bg-slate-950/40 z-20 flex items-center justify-center pointer-events-none select-none">
                <div className="text-[100px] font-black text-rose-400 animate-pulse tracking-widest font-mono drop-shadow-[0_0_20px_rgba(244,63,94,0.6)]">
                  {countdown > 0 ? countdown : "GO!"}
                </div>
              </div>
            )}

            {/* Screen 3: Game Over Screen */}
            {gameState === "gameover" && (
              <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-20 flex flex-col items-center justify-center gap-6 text-center p-6 select-none">
                <div className="w-14 h-14 bg-rose-500/10 border border-rose-500/30 rounded-full flex items-center justify-center text-rose-400">
                  <RotateCcw className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-3xl font-black text-white mb-1">Crashed! 💥</h2>
                  <p className="text-xs uppercase font-bold text-slate-500 tracking-wider">Du bist unglücklich gelandet</p>
                </div>

                <div className="max-w-xs w-full bg-slate-900/50 border border-slate-900 rounded-3xl p-5 text-center">
                  <span className="text-[10px] font-black text-slate-500 uppercase block mb-1">Erreichte Leistung</span>
                  <span className="text-xl font-mono font-black text-rose-400 block">
                    {activeTab === "endless-grid" ? `${currentScore} Punkte` : `DNF (Gestürzt)`}
                  </span>
                  {activeTab !== "endless-grid" && (
                    <span className="text-[10px] text-slate-400 font-medium block mt-1">
                      Strecke zu 55% absolviert.
                    </span>
                  )}
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={startGame}
                    className="px-6 py-3 bg-gradient-to-r from-rose-500 to-pink-500 text-slate-950 font-black rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2 shadow-lg shadow-rose-500/15"
                  >
                    Noch einmal versuchen
                  </button>
                  <button
                    onClick={() => setGameState("lobby")}
                    className="px-6 py-3 bg-slate-900 border border-slate-800 hover:border-slate-700 text-white font-bold rounded-2xl transition-all"
                  >
                    Zurück zur Übersicht
                  </button>
                </div>
              </div>
            )}

            {/* Screen 4: Level Complete (Time Trial Win) */}
            {gameState === "complete" && (
              <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-20 flex flex-col items-center justify-center gap-6 text-center p-6 select-none animate-in zoom-in-95 duration-300">
                <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center text-emerald-400 shadow-lg">
                  <Award className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-3xl font-black text-white mb-1">Ziel erreicht! 🏆</h2>
                  <p className="text-xs uppercase font-bold text-slate-500 tracking-wider">Ergebnis des Zeitlaufs</p>
                </div>

                <div className="max-w-xs w-full bg-slate-900/50 border border-slate-900 rounded-3xl p-5 text-center">
                  <span className="text-[10px] font-black text-slate-500 uppercase block mb-1">Deine Endzeit</span>
                  <span className="text-2xl font-mono font-black text-emerald-400 block">
                    {formatMs(currentTime)}
                  </span>
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={startGame}
                    className="px-6 py-3 bg-gradient-to-r from-rose-500 to-pink-500 text-slate-950 font-black rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2 shadow-lg shadow-rose-500/15"
                  >
                    Noch einmal versuchen
                  </button>
                  <button
                    onClick={() => setGameState("lobby")}
                    className="px-6 py-3 bg-slate-900 border border-slate-800 hover:border-slate-700 text-white font-bold rounded-2xl transition-all"
                  >
                    Zurück zur Übersicht
                  </button>
                </div>
              </div>
            )}

          </div>

          {/* Compact Instructions footer in playing */}
          {gameState === "playing" && (
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-4 animate-pulse">
              Halte LEERTASTE / BILDSCHIRM gedrückt zum Beschleunigen & Flippen
            </div>
          )}

        </section>

      </main>
    </div>
  );
}
