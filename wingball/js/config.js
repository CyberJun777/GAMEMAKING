// 모든 게임 수치는 여기 한 곳에서 관리한다 (design/plan.md 기준).
export const CFG = {
  dt: 1 / 30,                       // 고정 타임스텝 30Hz

  arena: { rx: 80, rz: 45, ceil: 45, floor: 1 },  // 타원형 160×90, 높이 45
  rings: {
    x: 72,                          // 양 끝 링 평면 x = ±72
    zs: [-7, 0, 7],
    ys: [9, 14, 19],
    radius: 2.5,                    // 지름 5u
    crease: 16,                     // 상대 링 평면에서 이 거리 안으로 볼을 들고 들어가면 반칙 → 상대 가디언 볼
  },

  roles: {
    runner:   { count: 3, maxSpeed: 22, accel: 18 },
    keeper:   { count: 1, maxSpeed: 18, accel: 20, leash: 14 },
    breaker:  { count: 2, maxSpeed: 20, accel: 16 },
    hunter:   { count: 1, maxSpeed: 26, accel: 22 },
  },

  player: {
    radius: 0.8,
    boostMul: 1.5,
    holdMul: 0.9,                   // 볼 소유 시 속도
    stunTime: 1.2,
    stunFall: 3,                    // 기절 중 하강 속도
    staminaMax: 100,
    staminaDrain: 25,
    staminaRegen: 12,
    staminaDelay: 0.8,
    exhaustRecover: 25,             // 스태미나 0(탈진) 후 이 값까지 회복해야 다시 부스트 가능
    tackleRange: 3,
    tackleCd: 2,
    tackleFront: 0.55,
    tackleBack: 0.75,
    switchCd: 3,
  },

  comet: {
    pickup: 2,
    shotMin: 35, shotMax: 55,
    errMax: 6, errMin: 2,           // 슛 각도 오차(도)
    passSpeed: 30,
    gravity: 6,
    drag: 0.25,
    flySpeed: 12,                   // 이 속도 이상이면 중력 없음(직선 비행)
    noPickupSelf: 0.4,
    keeperReach: 3.2,               // 가디언은 팔이 길다(블록 반경)
    goal: 10,
  },

  stone: { count: 2, speed: 24, accel: 12, hitRange: 1.6, retarget: 3, hitCd: 1,
           batRange: 2.5, batSpeed: 40, batCd: 1.5, ownerTime: 1.5 },

  orb: { appear: 90, speed: 30, turnMin: 0.6, turnMax: 1.2, catchRange: 1.5, catchHold: 0.3,
         points: 100, hoverChance: 0.22, hoverMul: 0.25, fleeRange: 18, fleeWeight: 0.6,
         slowStart: 360, slowPerMin: 0.15, minMul: 0.2 },

  match: { hardLimit: 540 },

  ai: {
    think:   { easy: 0.4, normal: 0.25, hard: 0.15 },
    speed:   { easy: 0.85, normal: 1.0, hard: 1.1 },
    shootDist: 30,
    aimErr:  { easy: 10, normal: 7.5, hard: 6 },   // AI 슛 추가 각도 오차(도)
    clearAhead: 8,
    keeperFront: 6,
    keeperReact: 0.2,
  },
};

export const TEAM = { TEAL: 0, AMBER: 1 };
// 팀 t 가 공격하는 링 쪽 x 부호: 청록(0)은 +x, 주황(1)은 -x
export const attackSign = (t) => (t === 0 ? 1 : -1);
