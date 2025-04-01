let video, detector, canvas, ctx;
let pushups = 0;
let pushupState = "up";         // "up" or "down" for counting reps
let isWorkoutActive = false;

// Position can be "notSet" or "set"
let positionState = "notSet";

/** We'll confirm the user is in "start up" position for X frames */
const INIT_UP_FRAMES = 5;
let initUpCounter = 0;

/** Once set, we remain set unless wrists move up for X frames. */
const LOSS_FRAMES = 10;
let lossCounter = 0;

/** 
 * For counting reps: we require arms remain "down" or "up" for X frames 
 * to confirm that transition.
 */
const FRAMES_TO_CONFIRM = 5;
let downFrameCount = 0;
let upFrameCount = 0;

/** Elbow angle thresholds */
const ANGLE_DOWN_THRESHOLD = 100;
const ANGLE_UP_THRESHOLD = 140;

/** 
 * Return "Lower", "Up", or "Hold" 
 * based on avg elbow angle.
 */
function getMotionLabel(angle) {
  if (angle < ANGLE_DOWN_THRESHOLD) return "Lower";
  if (angle > ANGLE_UP_THRESHOLD) return "Up";
  return "Hold";
}

/** 
 * Calc angle at B, given A,B,C in 2D space 
 */
function getAngle(A, B, C) {
  const BAx = A.x - B.x;
  const BAy = A.y - B.y;
  const BCx = C.x - B.x;
  const BCy = C.y - B.y;
  const dot = BAx * BCx + BAy * BCy;
  const magBA = Math.sqrt(BAx**2 + BAy**2);
  const magBC = Math.sqrt(BCx**2 + BCy**2);
  if (!magBA || !magBC) return 0;
  const angleRad = Math.acos(dot / (magBA * magBC));
  return (angleRad * 180) / Math.PI;
}

/**
 * Check if wrists are below shoulders by at least 50 px 
 * and there's enough confidence in keypoints.
 */
function wristsBelowShoulders(keypoints, margin=50) {
  const ls = keypoints[5]; // left shoulder
  const rs = keypoints[6]; // right shoulder
  const lw = keypoints[9]; // left wrist
  const rw = keypoints[10]; // right wrist

  if (ls.score<0.5 || rs.score<0.5 || lw.score<0.5 || rw.score<0.5) {
    return false;
  }
  const avgShoulderY = (ls.y + rs.y)/2;
  const avgWristY = (lw.y + rw.y)/2;
  return (avgWristY > avgShoulderY + margin);
}

/**
 * Check if user is in the "up" angle at start (elbow > 140°).
 */
function armsInUpAngle(keypoints) {
  const ls = keypoints[5];
  const rs = keypoints[6];
  const le = keypoints[7];
  const re = keypoints[8];
  const lw = keypoints[9];
  const rw = keypoints[10];

  // Confidence check
  if (
    ls.score<0.5 || rs.score<0.5 ||
    le.score<0.5 || re.score<0.5 ||
    lw.score<0.5 || rw.score<0.5
  ) {
    return false;
  }
  const leftAngle = getAngle(ls, le, lw);
  const rightAngle = getAngle(rs, re, rw);
  const avgAngle = (leftAngle + rightAngle)/2;
  return (avgAngle > ANGLE_UP_THRESHOLD);
}

/**
 * We'll confirm "set" if:
 * 1) Wrists below shoulders
 * 2) Elbows in Up angle
 * 3) This stays true for INIT_UP_FRAMES frames in a row
 */
function checkSetInitialization(keypoints) {
  if (wristsBelowShoulders(keypoints) && armsInUpAngle(keypoints)) {
    initUpCounter++;
    if (initUpCounter >= INIT_UP_FRAMES) {
      positionState = "set";
      document.getElementById("position-status").innerText = "Set";
      document.getElementById("position-status").className = "green";
    }
  } else {
    initUpCounter = 0;
  }
}

/**
 * If we're "set", we only break that if wrists are above shoulders
 * for LOSS_FRAMES in a row. (User left the floor.)
 */
function checkLossOfSet(keypoints) {
  if (!wristsBelowShoulders(keypoints, 30)) {
    // wrists are not 30 px below shoulders
    lossCounter++;
    if (lossCounter >= LOSS_FRAMES) {
      // revert to "notSet"
      positionState = "notSet";
      document.getElementById("position-status").innerText = "Not set";
      document.getElementById("position-status").className = "red";
      initUpCounter = 0;  // allow re-init
    }
  } else {
    lossCounter = 0;
  }
}

// Initialize pose detection
async function initPoseDetection() {
  try {
    const model = poseDetection.SupportedModels.MoveNet;
    detector = await poseDetection.createDetector(model);
    console.log("✅ Pose Detector Initialized Successfully");
    requestAnimationFrame(detectPose);
  } catch (error) {
    console.error("❌ MediaPipe Initialization Failed:", error);
    alert("Error initializing MediaPipe. Check console for details.");
  }
}

// Start workout session
document.getElementById("start-btn").addEventListener("click", async () => {
  document.getElementById("start-screen").style.display = "none";
  document.getElementById("workout-screen").style.display = "block";

  video = document.getElementById("video");
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      isWorkoutActive = true;
      initPoseDetection();
    };
  } catch (error) {
    console.error("❌ Webcam Access Denied:", error);
    alert("Please allow webcam access and reload the page.");
  }
});

/**
 * Detect Pose / Count Push-ups
 */
async function detectPose() {
  if (!isWorkoutActive || !video.videoWidth) {
    requestAnimationFrame(detectPose);
    return;
  }

  try {
    const poses = await detector.estimatePoses(video);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (poses.length > 0) {
      const keypoints = poses[0].keypoints;
      drawKeypoints(keypoints);

      // If we are not set, see if we can initialize
      if (positionState === "notSet") {
        checkSetInitialization(keypoints);
      } 
      else {
        // If we are "set," check if we lose that state
        checkLossOfSet(keypoints);
      }

      // --- MOTION STATUS (Lower, Hold, Up) ---
      const motionObj = getMotionAngleInfo(keypoints);
      document.getElementById("motion-status").innerText = motionObj.label;
      document.getElementById("motion-status").className = motionObj.color;

      // If set, do rep counting
      if (positionState === "set") {
        if (motionObj.avgAngle < ANGLE_DOWN_THRESHOLD && pushupState === "up") {
          downFrameCount++;
          if (downFrameCount >= FRAMES_TO_CONFIRM) {
            pushupState = "down";
            downFrameCount = 0;
          }
        } else {
          downFrameCount = 0;
        }

        if (motionObj.avgAngle > ANGLE_UP_THRESHOLD && pushupState === "down") {
          upFrameCount++;
          if (upFrameCount >= FRAMES_TO_CONFIRM) {
            pushups++;
            document.getElementById("pushup-count").innerText = pushups;
            pushupState = "up";
            upFrameCount = 0;
          }
        } else {
          upFrameCount = 0;
        }
      }
    }
  } catch (error) {
    console.error("Error detecting pose:", error);
  }

  requestAnimationFrame(detectPose);
}

/**
 * Evaluate average elbow angle and return label + color
 */
function getMotionAngleInfo(keypoints) {
  // default to "Hold" if we can't compute angles
  let label = "Hold";
  let color = "red";

  const ls = keypoints[5];
  const rs = keypoints[6];
  const le = keypoints[7];
  const re = keypoints[8];
  const lw = keypoints[9];
  const rw = keypoints[10];

  if (
    ls.score>0.5 && rs.score>0.5 && 
    le.score>0.5 && re.score>0.5 && 
    lw.score>0.5 && rw.score>0.5
  ) {
    const leftAngle = getAngle(ls, le, lw);
    const rightAngle = getAngle(rs, re, rw);
    const avgAngle = (leftAngle + rightAngle)/2;
    label = getMotionLabel(avgAngle);
    color = (label === "Up") ? "green" 
           : (label === "Lower") ? "red" 
           : "red";
    return { label, color, avgAngle };
  }
  
  return { label, color, avgAngle: 999 };
}

/**
 * Draw keypoints on the video feed, with each index labeled.
 */
function drawKeypoints(keypoints) {
  ctx.fillStyle = "red";
  ctx.font = "14px Arial";
  ctx.textAlign = "left";

  keypoints.forEach((kp, index) => {
    if (kp.score > 0.5) {
      const x = (kp.x / video.videoWidth) * canvas.width;
      const y = (kp.y / video.videoHeight) * canvas.height;
      // Draw a small circle
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fill();

      // Label with the keypoint index
      ctx.fillStyle = "#ffffff";
      ctx.fillText(index.toString(), x + 6, y - 6);
      ctx.fillStyle = "red";
    }
  });
}

// End workout
document.getElementById("end-btn").addEventListener("click", () => {
  isWorkoutActive = false;
  document.getElementById("workout-screen").style.display = "none";
  document.getElementById("end-screen").style.display = "block";
  document.getElementById("final-pushups").innerText = pushups;
});

// Restart workout
document.getElementById("restart-btn").addEventListener("click", () => {
  location.reload();
});
