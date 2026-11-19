import { BIOME_CONFIGS, ITEM_METADATA, ROBOT_PALETTES } from './constants';
import { getSortedRacers, isLaserActive } from './physics';
import type {
  ActiveTrap,
  BiomeId,
  GameEvent,
  ItemType,
  Projectile,
  RobotState,
  StageData,
} from './types';

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

const POOL_SIZE = 320;

export class GameRenderer {
  private particles: Particle[] = Array.from({ length: POOL_SIZE }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 3,
    color: '#F59E0B',
    gravity: 300,
  }));
  private poolCursor = 0;

  private camX = 120;
  private camY = -80;
  private smoothLeadX = 0;
  private anchorY = -80;
  private zoom = 1.35;
  private camInitialized = false;
  private trauma = 0;
  private seenEventIds = new Set<number>();

  setZoom(zoom: number): void {
    this.zoom = Math.max(0.55, Math.min(2.4, zoom));
  }

  getZoom(): number {
    return this.zoom;
  }

  getCameraPosition(): { x: number; y: number; zoom: number } {
    return { x: this.camX, y: this.camY, zoom: this.zoom };
  }

  setCameraDirectly(x: number, y: number, zoom?: number): void {
    this.camX = x;
    this.camY = y;
    this.anchorY = y;
    this.smoothLeadX = 0;
    this.camInitialized = true;
    if (zoom !== undefined) {
      this.setZoom(zoom);
    }
  }

  screenToWorld(
    screenX: number,
    screenY: number,
    viewW: number,
    viewH: number
  ): { x: number; y: number } {
    return {
      x: (screenX - viewW * 0.5) / this.zoom + this.camX,
      y: (screenY - viewH * 0.54) / this.zoom + this.camY,
    };
  }

  resetCamera(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
    this.smoothLeadX = 0;
    this.anchorY = y;
    this.camInitialized = true;
    this.trauma = 0;
    this.seenEventIds.clear();
    for (let i = 0; i < POOL_SIZE; i++) {
      this.particles[i].active = false;
    }
  }

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    life: number,
    color: string,
    gravity = 320
  ): void {
    const p = this.particles[this.poolCursor];
    this.poolCursor = (this.poolCursor + 1) % POOL_SIZE;
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.size = size;
    p.life = life;
    p.maxLife = life;
    p.color = color;
    p.gravity = gravity;
  }

  private spawnBurst(
    x: number,
    y: number,
    count: number,
    speed: number,
    color: string,
    size = 4,
    gravity = 260
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const spd = speed * (0.5 + Math.random() * 0.7);
      this.spawnParticle(
        x,
        y,
        Math.cos(angle) * spd,
        Math.sin(angle) * spd - 40,
        size * (0.7 + Math.random() * 0.6),
        0.35 + Math.random() * 0.35,
        color,
        gravity
      );
    }
  }

  ingestEvents(events: GameEvent[], _localPlayerId: string): GameEvent[] {
    const fresh: GameEvent[] = [];
    for (const ev of events) {
      if (this.seenEventIds.has(ev.id)) continue;
      this.seenEventIds.add(ev.id);
      if (this.seenEventIds.size > 400) {
        const first = this.seenEventIds.values().next().value;
        if (first !== undefined) this.seenEventIds.delete(first);
      }
      fresh.push(ev);

      const palette =
        ev.colorIndex !== undefined
          ? ROBOT_PALETTES[ev.colorIndex % ROBOT_PALETTES.length]
          : ROBOT_PALETTES[0];

      switch (ev.type) {
        case 'jump':
          this.spawnBurst(ev.x, ev.y, 5, 90, '#CBD5E1', 3, 180);
          break;
        case 'dash':
          this.spawnBurst(ev.x, ev.y, 10, 190, '#38BDF8', 3.5, 40);
          break;
        case 'spring':
          this.spawnBurst(ev.x, ev.y, 12, 180, '#FBBF24', 4, 220);
          break;
        case 'pickup':
          this.spawnBurst(ev.x, ev.y, 10, 150, '#38BDF8', 4, 40);
          break;
        case 'turbo':
          this.spawnBurst(ev.x, ev.y, 14, 200, '#F59E0B', 4.5, 60);
          break;
        case 'jetpack':
          this.spawnBurst(ev.x, ev.y, 20, 240, '#FB923C', 5, -90);
          this.spawnBurst(ev.x, ev.y, 12, 180, '#FACC15', 4, 120);
          break;
        case 'shield':
          this.spawnBurst(ev.x, ev.y, 12, 170, '#60A5FA', 4, 20);
          break;
        case 'emp':
          this.spawnBurst(ev.x, ev.y, 22, 290, '#22D3EE', 4.5, 0);
          break;
        case 'rocket_launch':
          this.spawnBurst(ev.x, ev.y, 8, 130, '#F97316', 4, 40);
          break;
        case 'rocket_hit':
          this.spawnBurst(ev.x, ev.y, 24, 280, '#EF4444', 5, 220);
          break;
        case 'frost_drop':
          this.spawnBurst(ev.x, ev.y, 8, 100, '#7DD3FC', 3.5, 80);
          break;
        case 'frost_hit':
          this.spawnBurst(ev.x, ev.y, 16, 170, '#BAE6FD', 4.5, 120);
          break;
        case 'barrier_drop':
          this.spawnBurst(ev.x, ev.y, 12, 140, '#F97316', 4, 60);
          break;
        case 'barrier_hit':
          this.spawnBurst(ev.x, ev.y, 20, 240, '#FB923C', 4.5, 180);
          break;
        case 'grease_drop':
          this.spawnBurst(ev.x, ev.y, 10, 110, '#84CC16', 4, 160);
          break;
        case 'grease_hit':
          this.spawnBurst(ev.x, ev.y, 14, 160, '#A3E635', 4, 180);
          break;
        case 'whirlwind_drop':
        case 'whirlwind_hit':
          this.spawnBurst(ev.x, ev.y, 22, 260, '#22D3EE', 4.5, -120);
          break;
        case 'magnet':
          this.spawnBurst(ev.x, ev.y, 16, 220, '#C084FC', 4, 0);
          break;
        case 'glitch':
          this.spawnBurst(ev.x, ev.y, 18, 220, '#EC4899', 4, 0);
          break;
        case 'warp':
          this.spawnBurst(ev.x, ev.y, 20, 250, '#10B981', 4.5, 20);
          break;
        case 'boost_ring':
          this.spawnBurst(ev.x, ev.y, 16, 240, '#38BDF8', 4.5, 30);
          this.spawnBurst(ev.x, ev.y, 10, 180, '#FACC15', 3.5, 30);
          break;
        case 'bumper':
          this.spawnBurst(ev.x, ev.y, 14, 210, '#F472B6', 4, 80);
          break;
        case 'crystal':
          this.spawnBurst(ev.x, ev.y, 8, 130, '#34D399', 3.5, 20);
          break;
        case 'checkpoint':
          this.spawnBurst(ev.x, ev.y, 18, 210, '#34D399', 4.5, 60);
          break;
        case 'fall_reset':
        case 'hurt':
          this.spawnBurst(ev.x, ev.y, 16, 210, palette.accent, 4.5, 320);
          break;
        case 'finish':
          this.spawnBurst(ev.x, ev.y, 28, 280, '#FACC15', 5.5, 180);
          this.spawnBurst(ev.x, ev.y, 18, 240, '#34D399', 4.5, 180);
          break;
      }
    }
    return fresh;
  }

  renderWorld(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dt: number,
    nowSec: number,
    stage: StageData,
    robots: RobotState[],
    projectiles: Projectile[],
    traps: ActiveTrap[],
    localPlayerId: string
  ): void {
    // 1. Update camera target (follow local robot, or leader if local robot finished)
    const localRobot = robots.find((r) => r.id === localPlayerId);
    const sortedRacers = getSortedRacers(robots);
    const leaderRobot = sortedRacers[0];
    const focusRobot =
      localRobot && !localRobot.finished ? localRobot : leaderRobot ?? localRobot;

    if (focusRobot && localPlayerId !== '__editor_free_cam__') {
      const robotCenterX = focusRobot.x + focusRobot.w * 0.5;
      const robotFocusY = focusRobot.y - 16;

        // Gentle low-pass velocity lead (no instant facing flip-flop!)
        const desiredLeadX =
          Math.abs(focusRobot.vx) > 65
            ? Math.max(-34, Math.min(34, focusRobot.vx * 0.08))
            : 0;

        if (!this.camInitialized) {
          this.smoothLeadX = desiredLeadX;
          this.anchorY = robotFocusY;
          this.camX = robotCenterX + this.smoothLeadX;
          this.camY = this.anchorY;
          this.camInitialized = true;
        } else {
          // Jump teleport / fall respawn snap check
          const distJump = Math.hypot(robotCenterX - this.camX, robotFocusY - this.camY);
          if (distJump > 750) {
            this.smoothLeadX = 0;
            this.anchorY = robotFocusY;
            this.camX = robotCenterX;
            this.camY = robotFocusY;
          } else {
            const leadSmooth = 1 - Math.exp(-2.4 * dt);
            this.smoothLeadX += (desiredLeadX - this.smoothLeadX) * leadSmooth;
            const targetX = robotCenterX + this.smoothLeadX;

            // Platform-stabilized vertical anchor with deadzone so regular jumps don't bob the camera
            if (focusRobot.onGround || (focusRobot.jetpackTimer ?? 0) > 0) {
              const groundSmooth = 1 - Math.exp(-7.5 * dt);
              this.anchorY += (robotFocusY - this.anchorY) * groundSmooth;
            } else {
              const topDeadzone = -54;
              const bottomDeadzone = 40;
              const dy = robotFocusY - this.anchorY;
              if (dy < topDeadzone) {
                this.anchorY += dy - topDeadzone;
              } else if (dy > bottomDeadzone) {
                this.anchorY += dy - bottomDeadzone;
              }
            }

          const smoothX = 1 - Math.exp(-7.2 * dt);
          const smoothY = 1 - Math.exp(-5.8 * dt);
          this.camX += (targetX - this.camX) * smoothX;
          this.camY += (this.anchorY - this.camY) * smoothY;
        }
      }
    }

    // Emit continuous jetpack plasma trail particles for active jetpack robots
    for (const r of robots) {
      if (!r.finished && (r.jetpackTimer ?? 0) > 0 && Math.random() < 0.75) {
        const backX = r.x + r.w * 0.5 - r.facing * 14;
        const backY = r.y + r.h - 10;
        this.spawnBurst(
          backX,
          backY,
          1,
          65,
          Math.random() < 0.5 ? '#FB923C' : '#FACC15',
          3.4,
          220
        );
      }
    }

    // Update particles (zero camera trauma shake so view stays crystal clear)
    this.trauma = 0;

    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // 2. Draw Atmospheric Parallax Backdrop
    this.drawBackdrop(ctx, width, height, this.camX, this.camY, stage.biome, nowSec);

    const zoom = this.zoom;
    const halfViewW = (width * 0.75) / zoom;
    const halfViewH = (height * 0.85) / zoom;
    const viewMinX = this.camX - halfViewW;
    const viewMaxX = this.camX + halfViewW;
    const viewMinY = this.camY - halfViewH;
    const viewMaxY = this.camY + halfViewH;

    ctx.save();
    // Sub-pixel floating-point camera transform with zoom (no Math.round staircase jitter!)
    ctx.translate(width * 0.5, height * 0.54);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.camX, -this.camY);

    // 2.5 Wind Updraft Columns (behind platforms)
    for (const wind of stage.windZones) {
      if (wind.x + wind.w < viewMinX || wind.x > viewMaxX) {
        continue;
      }
      this.drawWindZone(ctx, wind.x, wind.y, wind.w, wind.h, nowSec);
    }

    // 3. Moving platform rails (drawn behind platforms)
    for (const p of stage.platforms) {
      if (p.kind === 'moving' && p.moveRange) {
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        if (p.moveAxis === 'x') {
          ctx.moveTo(p.baseX - p.moveRange + p.w * 0.5, p.baseY + p.h * 0.5);
          ctx.lineTo(p.baseX + p.moveRange + p.w * 0.5, p.baseY + p.h * 0.5);
        } else {
          ctx.moveTo(p.baseX + p.w * 0.5, p.baseY - p.moveRange + p.h * 0.5);
          ctx.lineTo(p.baseX + p.w * 0.5, p.baseY + p.moveRange + p.h * 0.5);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // 3.5 Subtle holographic trajectory guide chevrons between main-path platforms
    for (let i = 0; i < stage.platforms.length - 1; i++) {
      const curr = stage.platforms[i];
      const next = stage.platforms[i + 1];
      const mx = (curr.x + curr.w * 0.5 + next.x + next.w * 0.5) * 0.5;
      const my = (curr.y + next.y) * 0.5 - 18;
      if (mx < viewMinX || mx > viewMaxX || my < viewMinY || my > viewMaxY) continue;
      if (Math.hypot(next.x - curr.x, next.y - curr.y) > 480) continue;

      const angle = Math.atan2(
        next.y - 10 - (curr.y - 10),
        next.x + next.w * 0.5 - (curr.x + curr.w * 0.5)
      );
      const pulse = 0.22 + 0.18 * Math.sin(nowSec * 5 - i * 0.7);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.strokeStyle =
        curr.nextDir === -1
          ? `rgba(56, 189, 248, ${pulse + 0.15})`
          : `rgba(251, 191, 36, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, -5);
      ctx.lineTo(0, 0);
      ctx.lineTo(-6, 5);
      ctx.moveTo(2, -5);
      ctx.lineTo(8, 0);
      ctx.lineTo(2, 5);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Platforms
    const localCheckpointY = localRobot?.checkpointY ?? 9999;
    const localCheckpointX = localRobot?.checkpointX ?? 0;
    for (const p of stage.platforms) {
      if (
        p.x + p.w < viewMinX ||
        p.x > viewMaxX ||
        p.y + p.h < viewMinY ||
        p.y > viewMaxY
      ) {
        continue;
      }
      const isActivatedCheckpoint =
        p.kind === 'checkpoint' &&
        (localCheckpointY <= p.baseY - 10 || localCheckpointX >= p.baseX - 10);
      this.drawPlatform(ctx, p, nowSec, isActivatedCheckpoint);
    }

    // 5. Bounce Pads
    for (const pad of stage.bouncePads) {
      if (pad.x + pad.w < viewMinX || pad.x > viewMaxX) continue;
      this.drawBouncePad(ctx, pad.x, pad.y, pad.w, pad.h, nowSec);
    }

    // 5.2 Boost Rings (Anéis Propulsores)
    for (const ring of stage.boostRings ?? []) {
      if (ring.x + ring.r < viewMinX || ring.x - ring.r > viewMaxX) continue;
      this.drawBoostRing(ctx, ring.x, ring.y, ring.r, nowSec, ring.boostVx < 0 ? -1 : 1);
    }

    // 5.4 Electromagnetic Bumpers (Rebatedores)
    for (const bumper of stage.bumpers ?? []) {
      if (bumper.x + bumper.r < viewMinX || bumper.x - bumper.r > viewMaxX) continue;
      this.drawBumper(ctx, bumper.x, bumper.y, bumper.r, nowSec);
    }

    // 5.6 Energy Crystals (Arcos de Cristais)
    for (const crystal of stage.crystals ?? []) {
      if (crystal.respawnAt > 0) continue;
      if (crystal.x + 14 < viewMinX || crystal.x - 14 > viewMaxX) continue;
      this.drawCrystal(ctx, crystal.x, crystal.y, nowSec);
    }

    // 6. Finish Portal
    this.drawFinishPortal(ctx, stage, nowSec);

    // 7. Hazards (Saws, Lasers, Hover Drones)
    for (const h of stage.hazards) {
      if (h.x + h.w < viewMinX || h.x > viewMaxX) continue;
      if (h.kind === 'saw') {
        this.drawSaw(ctx, h.x + h.radius, h.y + h.radius, h.radius, nowSec);
      } else if (h.kind === 'drone') {
        this.drawDrone(ctx, h.x, h.y, h.w, h.h, nowSec);
      } else {
        this.drawLaser(
          ctx,
          h.x,
          h.y,
          h.w,
          h.h,
          h.cyclePeriod ?? 2.6,
          h.cycleOffset ?? 0,
          nowSec
        );
      }
    }

    // 8. Item Boxes (displaying their contained item!)
    for (const box of stage.itemBoxes) {
      if (box.x + 30 < viewMinX || box.x > viewMaxX) continue;
      this.drawItemBox(ctx, box.x, box.y, box.itemType ?? 'turbo', box.respawnAt > 0, nowSec);
    }

    // 9. Active Traps (Frost Mines, Laser Barriers, Grease Slicks, Whirlwinds)
    for (const trap of traps) {
      this.drawActiveTrap(ctx, trap, nowSec);
    }

    // 10. Homing Rockets
    for (const proj of projectiles) {
      const angle = Math.atan2(proj.vy, proj.vx);
      ctx.save();
      ctx.translate(proj.x, proj.y);
      ctx.rotate(angle);
      // Flame
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.lineTo(-20 - Math.random() * 6, 0);
      ctx.lineTo(-10, 4);
      ctx.closePath();
      ctx.fill();
      // Missile body
      ctx.fillStyle = '#EF4444';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-10, -5, 20, 10, 4);
      ctx.fill();
      ctx.stroke();
      // Tip
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.arc(6, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 11. Robots (draw rivals first, local player last on top)
    const leaderId = sortedRacers[0]?.id;
    const ordered = [...robots].sort((a, b) =>
      a.id === localPlayerId ? 1 : b.id === localPlayerId ? -1 : 0
    );

    for (const robot of ordered) {
      this.drawRobot(
        ctx,
        robot,
        robot.id === localPlayerId,
        robot.id === leaderId && robot.progress > 3,
        nowSec
      );
    }

    // 12. Pooled Particles (with glowing core)
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      const alpha = Math.max(0, p.life / p.maxLife);
      const rad = p.size * (0.4 + 0.65 * alpha);
      ctx.globalAlpha = alpha * 0.35;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad * 1.65, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // 13. Screen-Space High-Speed Wind Streaks when local robot is boosting/flying fast
    if (
      focusRobot &&
      (Math.abs(focusRobot.vx) > 400 ||
        focusRobot.turboTimer > 0 ||
        (focusRobot.jetpackTimer ?? 0) > 0 ||
        focusRobot.dashTimer > 0)
    ) {
      ctx.save();
      const intensity = Math.min(
        0.42,
        Math.max(0.14, (Math.abs(focusRobot.vx) - 340) / 420)
      );
      ctx.strokeStyle =
        (focusRobot.jetpackTimer ?? 0) > 0
          ? `rgba(251, 146, 60, ${intensity})`
          : focusRobot.turboTimer > 0
          ? `rgba(250, 204, 21, ${intensity})`
          : `rgba(56, 189, 248, ${intensity})`;
      ctx.lineWidth = 2;
      for (let s = 0; s < 10; s++) {
        const sy = ((s * 83 + nowSec * 140) % (height - 80)) + 40;
        const sideLeft = s % 2 === 0;
        const len = 36 + ((s * 29) % 48);
        const sx = sideLeft
          ? ((nowSec * 900 + s * 110) % 140)
          : width - ((nowSec * 900 + s * 110) % 140);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sideLeft ? sx + len : sx - len, sy);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  renderTitleShowcase(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    nowSec: number
  ): void {
    const panX = nowSec * 36;
    const panY = -120 + Math.sin(nowSec * 0.4) * 28;
    this.drawBackdrop(ctx, width, height, panX, panY, 'foundry', nowSec);

    // Draw an idle animated assembly platform with 3 showcase robots in the right half
    ctx.save();
    const baseX = width * 0.68;
    const baseY = height * 0.62;

    // Lower Launch Platform
    this.drawPlatform(
      ctx,
      {
        id: 0,
        x: baseX - 180,
        y: baseY,
        baseX: baseX - 180,
        baseY,
        w: 280,
        h: 34,
        kind: 'start',
      },
      nowSec
    );

    // Bounce pad on lower platform + Boost Ring + elevated upper platform with item box
    this.drawBouncePad(ctx, baseX + 40, baseY - 14, 44, 14, nowSec);
    this.drawBoostRing(ctx, baseX - 10, baseY - 96, 20, nowSec, 1);
    this.drawCrystal(ctx, baseX - 65, baseY - 68, nowSec);
    this.drawCrystal(ctx, baseX + 55, baseY - 175, nowSec);
    this.drawPlatform(
      ctx,
      {
        id: 1,
        x: baseX + 20,
        y: baseY - 140,
        baseX: baseX + 20,
        baseY: baseY - 140,
        w: 210,
        h: 28,
        kind: 'finish',
      },
      nowSec
    );
    this.drawItemBox(ctx, baseX + 110, baseY - 186, 'jetpack', false, nowSec);
    this.drawItemBox(ctx, baseX - 95, baseY - 54, 'whirlwind', false, nowSec);

    // Three idle robots gently bobbing on the showcase platforms (showing heldItem indicator & class silhouettes!)
    const demoConfigs = [
      { cIdx: 0, cls: 'speedster' as const, rx: baseX - 125, py: baseY, facing: 1 as const, turbo: 1, jetpack: 1.5, shield: 0, held: 'jetpack' as const },
      { cIdx: 2, cls: 'jumper' as const, rx: baseX - 35, py: baseY, facing: 1 as const, turbo: 0, jetpack: 0, shield: 1, held: 'barrier' as const },
      { cIdx: 3, cls: 'balanced' as const, rx: baseX + 145, py: baseY - 140, facing: -1 as const, turbo: 0, jetpack: 0, shield: 0, held: 'whirlwind' as const },
    ];
    demoConfigs.forEach((cfg, idx) => {
      const jumpArc = Math.max(0, Math.sin(nowSec * 2.2 + idx * 1.4)) * 22;
      const demoRobot: RobotState = {
        id: `demo_${idx}`,
        name: '',
        colorIndex: cfg.cIdx,
        robotClass: cfg.cls,
        isBot: false,
        connected: true,
        x: cfg.rx,
        y: cfg.py - 34 - jumpArc,
        vx: idx === 0 ? 220 : 0,
        vy: 0,
        w: 28,
        h: 34,
        facing: cfg.facing,
        onGround: jumpArc < 2,
        coyoteTimer: 0,
        jumpBufferTimer: 0,
        prevJumpHeld: false,
        carryingPlatformId: null,
        dashTimer: 0,
        dashCooldown: 0,
        dashMaxCooldown: 2.2,
        checkpointX: cfg.rx,
        checkpointY: cfg.py - 34,
        lastSafeY: cfg.py - 34,
        stridePhase: nowSec * 3 + idx,
        scaleX: jumpArc > 10 ? 0.92 : 1,
        scaleY: jumpArc > 10 ? 1.08 : 1,
        heldItem: cfg.held,
        turboTimer: cfg.turbo,
        jetpackTimer: cfg.jetpack,
        shieldTimer: cfg.shield,
        empSlowTimer: 0,
        frostTimer: 0,
        greaseTimer: 0,
        glitchTimer: 0,
        stunTimer: 0,
        invulnTimer: 0,
        crystals: 0,
        progress: 0,
        finished: false,
        finishTime: null,
        finishRank: null,
        score: 0,
      };
      this.drawRobot(ctx, demoRobot, false, idx === 2, nowSec);
    });
    ctx.restore();
  }

  private drawBackdrop(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    camX: number,
    camY: number,
    biome: BiomeId,
    nowSec: number
  ): void {
    const cfg = BIOME_CONFIGS[biome] ?? BIOME_CONFIGS.foundry;
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, cfg.skyTop);
    grad.addColorStop(0.58, cfg.skyMid);
    grad.addColorStop(1, cfg.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Layer 1: Biome-specific distant atmospheric horizon / celestial elements (0.06x parallax)
    ctx.save();
    if (biome === 'orbital_core') {
      // Distant ringed planet + nebula glow in upper-right sky
      const px = width * 0.76 - ((camX * 0.04) % (width * 0.4));
      const py = height * 0.24;
      const nebGrad = ctx.createRadialGradient(px, py, 10, px, py, 170);
      nebGrad.addColorStop(0, 'rgba(139, 92, 246, 0.22)');
      nebGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.08)');
      nebGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = nebGrad;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Planetary ring
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.32)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(px, py, 82, 16, -0.22, 0, Math.PI * 2);
      ctx.stroke();
    } else if (biome === 'wind_tower') {
      // Distant spinning wind-turbine silhouettes (0.12x parallax)
      const turbSpacing = 440;
      const startTurb = Math.floor((camX * 0.12 - width * 0.5) / turbSpacing);
      const endTurb = Math.ceil((camX * 0.12 + width * 0.9) / turbSpacing);
      for (let i = startTurb; i <= endTurb; i++) {
        const tx = i * turbSpacing - camX * 0.12 + width * 0.4;
        const ty = height * 0.42 + ((i * 53) % 70);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx, height);
        ctx.stroke();

        // 3 rotating turbine blades
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(nowSec * 0.9 + i);
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.22)';
        ctx.lineWidth = 3;
        for (let b = 0; b < 3; b++) {
          ctx.rotate((Math.PI * 2) / 3);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -68);
          ctx.stroke();
        }
        ctx.restore();
      }
    } else {
      // Foundry: Warm blast-furnace horizon glow at bottom of viewport
      const furnaceGrad = ctx.createLinearGradient(0, height * 0.62, 0, height);
      furnaceGrad.addColorStop(0, 'rgba(249, 115, 22, 0)');
      furnaceGrad.addColorStop(1, 'rgba(249, 115, 22, 0.13)');
      ctx.fillStyle = furnaceGrad;
      ctx.fillRect(0, height * 0.62, width, height * 0.38);
    }
    ctx.restore();

    // Layer 2: Subtle blueprint grid
    ctx.strokeStyle = cfg.gridColor;
    ctx.lineWidth = 1;
    const grid = 64;
    const offX = ((-camX * 0.25) % grid + grid) % grid;
    const offY = ((-camY * 0.25) % grid + grid) % grid;
    ctx.beginPath();
    for (let x = offX; x < width; x += grid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = offY; y < height; y += grid) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Layer 3: Parallax vertical industrial steel truss towers with cross-bracing (0.35x speed)
    const towerSpacing = 320;
    const startTower = Math.floor((camX * 0.35 - width * 0.6) / towerSpacing);
    const endTower = Math.ceil((camX * 0.35 + width * 0.8) / towerSpacing);
    for (let t = startTower; t <= endTower; t++) {
      const sx = t * towerSpacing - camX * 0.35 + width * 0.5;
      ctx.fillStyle = cfg.towerColor;
      ctx.fillRect(sx, 0, 38, height);
      ctx.fillStyle = 'rgba(51, 65, 85, 0.22)';
      ctx.fillRect(sx + 5, 0, 7, height);
      ctx.fillRect(sx + 26, 0, 7, height);

      // Diagonal truss cross-braces & warning lights
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.16)';
      ctx.lineWidth = 1.5;
      const stepY = 96;
      const baseYOff = ((-camY * 0.35) % stepY + stepY) % stepY;
      ctx.beginPath();
      for (let y = baseYOff - stepY; y < height + stepY; y += stepY) {
        ctx.moveTo(sx + 5, y);
        ctx.lineTo(sx + 33, y + stepY * 0.5);
        ctx.lineTo(sx + 5, y + stepY);
      }
      ctx.stroke();

      // Blinking tower beacon light
      const beaconY = ((t * 173 - camY * 0.35) % height + height) % height;
      const blink = 0.35 + 0.35 * Math.sin(nowSec * 3.5 + t);
      ctx.fillStyle =
        biome === 'foundry'
          ? `rgba(251, 146, 60, ${blink})`
          : biome === 'wind_tower'
          ? `rgba(56, 189, 248, ${blink})`
          : `rgba(192, 132, 252, ${blink})`;
      ctx.beginPath();
      ctx.arc(sx + 19, beaconY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Layer 4: Drifting ambient motes / embers / stars
    for (let i = 0; i < 24; i++) {
      const mx = ((i * 197 - camX * 0.15 + nowSec * 14) % width + width) % width;
      const my = ((i * 131 - camY * 0.15 - nowSec * (biome === 'foundry' ? 18 : 4) + Math.sin(nowSec + i) * 14) % height + height) % height;
      const sz = i % 3 === 0 ? 2.6 : 1.8;
      ctx.fillStyle =
        biome === 'foundry'
          ? 'rgba(251, 191, 36, 0.24)'
          : biome === 'orbital_core'
          ? 'rgba(224, 231, 255, 0.32)'
          : 'rgba(186, 230, 253, 0.22)';
      ctx.fillRect(mx, my, sz, sz);
    }
  }

  private drawWindZone(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    nowSec: number
  ): void {
    ctx.save();
    const grad = ctx.createLinearGradient(x, y + h, x, y);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
    grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.09)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // Rising wind streaks
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.35)';
    ctx.lineWidth = 2;
    const cols = 3;
    for (let c = 0; c < cols; c++) {
      const lx = x + ((c + 0.5) * w) / cols;
      const offset = ((nowSec * 160 + c * 70) % h);
      const ly = y + h - offset;
      ctx.beginPath();
      ctx.moveTo(lx, Math.min(y + h, ly + 28));
      ctx.lineTo(lx, Math.max(y, ly));
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlatform(
    ctx: CanvasRenderingContext2D,
    p: StageData['platforms'][number],
    nowSec: number,
    isActivatedCheckpoint = false
  ): void {
    if (p.kind === 'crumbling' && p.crumbleState === 'fallen') {
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.28)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(p.x, p.y, p.w, p.h);
      ctx.restore();
      return;
    }

    ctx.save();
    const shakeX =
      p.kind === 'crumbling' && p.crumbleState === 'shaking'
        ? Math.sin(nowSec * 55) * 3
        : 0;
    const drawX = p.x + shakeX;

    let topColor = '#475569';
    let bodyColor = '#1E293B';
    let accentColor = '#64748B';

    if (p.kind === 'start') {
      topColor = '#10B981';
      bodyColor = '#064E3B';
      accentColor = '#34D399';
    } else if (p.kind === 'finish') {
      topColor = '#F59E0B';
      bodyColor = '#451A03';
      accentColor = '#FBBF24';
    } else if (p.kind === 'checkpoint') {
      topColor = '#3B82F6';
      bodyColor = '#1E3A8A';
      accentColor = '#60A5FA';
    } else if (p.kind === 'moving') {
      topColor = '#D97706';
      bodyColor = '#292524';
      accentColor = '#F59E0B';
    } else if (p.kind === 'conveyor') {
      topColor = '#0284C7';
      bodyColor = '#0C4A6E';
      accentColor = '#38BDF8';
    } else if (p.kind === 'crumbling') {
      topColor = p.crumbleState === 'shaking' ? '#EF4444' : '#EA580C';
      bodyColor = '#431407';
      accentColor = '#FB923C';
    }

    // Drop shadow & underside thruster brackets
    ctx.fillStyle = 'rgba(2, 6, 23, 0.52)';
    ctx.beginPath();
    ctx.roundRect(drawX + 2, p.y + 5, p.w, p.h, 6);
    ctx.fill();

    if (p.w >= 90) {
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(drawX + 14, p.y + p.h, 14, 4);
      ctx.fillRect(drawX + p.w - 28, p.y + p.h, 14, 4);
    }

    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = '#090D16';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(drawX, p.y, p.w, p.h, 6);
    ctx.fill();
    ctx.stroke();

    // Top beveled deck plate
    ctx.fillStyle = topColor;
    ctx.beginPath();
    ctx.roundRect(drawX + 1, p.y + 1, p.w - 2, 9, [5, 5, 2, 2]);
    ctx.fill();

    // Specular top edge highlight
    ctx.fillStyle = accentColor;
    ctx.fillRect(drawX + 6, p.y + 2, Math.max(4, p.w - 12), 2);

    // Metallic side bumper caps
    ctx.fillStyle = 'rgba(248, 250, 252, 0.18)';
    ctx.fillRect(drawX + 2, p.y + 4, 3, p.h - 8);
    ctx.fillRect(drawX + p.w - 5, p.y + 4, 3, p.h - 8);

    // Conveyor belt directional chevrons
    if (p.kind === 'conveyor' && p.conveyorSpeed) {
      const dir = p.conveyorSpeed > 0 ? 1 : -1;
      const scroll = ((nowSec * 60 * dir) % 24 + 24) % 24;
      ctx.strokeStyle = '#BAE6FD';
      ctx.lineWidth = 2;
      for (let cx = drawX + 10 + scroll; cx < drawX + p.w - 10; cx += 24) {
        ctx.beginPath();
        ctx.moveTo(cx - 4 * dir, p.y + 14);
        ctx.lineTo(cx + 2 * dir, p.y + 18);
        ctx.lineTo(cx - 4 * dir, p.y + 22);
        ctx.stroke();
      }
    } else if (p.kind === 'crumbling') {
      ctx.strokeStyle = 'rgba(255, 237, 213, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(drawX + p.w * 0.3, p.y + 8);
      ctx.lineTo(drawX + p.w * 0.35, p.y + 16);
      ctx.lineTo(drawX + p.w * 0.28, p.y + 22);
      ctx.moveTo(drawX + p.w * 0.7, p.y + 8);
      ctx.lineTo(drawX + p.w * 0.64, p.y + 18);
      ctx.stroke();
    } else if (p.nextDir === -1) {
      // Dynamic 'S' curve leftward switchback indicator chevrons on the platform deck
      ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.font = '800 10px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('◀ ◀ ROTA S', drawX + p.w * 0.5, p.y + p.h - 9);
    } else {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.25)';
      for (let rx = drawX + 14; rx < drawX + p.w - 10; rx += 32) {
        ctx.beginPath();
        ctx.arc(rx, p.y + p.h - 8, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (p.kind === 'checkpoint') {
      const bx = drawX + 26;
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(bx - 2, p.y - 46, 4, 46);
      const pulse = 0.65 + 0.35 * Math.sin(nowSec * 5);
      ctx.fillStyle = isActivatedCheckpoint
        ? `rgba(16, 185, 129, ${pulse})`
        : `rgba(56, 189, 248, ${pulse})`;
      ctx.beginPath();
      ctx.arc(bx, p.y - 48, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isActivatedCheckpoint ? '#A7F3D0' : '#E0F2FE';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '700 9px Outfit, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isActivatedCheckpoint ? '#6EE7B7' : '#BAE6FD';
      const dirHint = p.nextDir === -1 ? ' ◀ SUBA' : '';
      ctx.fillText(
        (isActivatedCheckpoint ? 'CHECKPOINT ✓' : 'CHECKPOINT') + dirHint,
        bx + 12,
        p.y - 46
      );
    }

    ctx.restore();
  }

  private drawBouncePad(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    nowSec: number
  ): void {
    ctx.save();
    const bob = Math.sin(nowSec * 7) * 1.5;
    // Spring coils
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + h);
    ctx.lineTo(x + w - 10, y + 6 + bob);
    ctx.moveTo(x + w - 10, y + h);
    ctx.lineTo(x + 10, y + 6 + bob);
    ctx.stroke();

    // Top bumper plate
    ctx.fillStyle = '#F59E0B';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y + bob, w, 7, 3);
    ctx.fill();
    ctx.stroke();

    // Upward boost chevron hint above spring
    const pulse = 0.45 + 0.35 * Math.sin(nowSec * 6);
    ctx.strokeStyle = `rgba(251, 191, 36, ${pulse})`;
    ctx.lineWidth = 2;
    const cx = x + w * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - 6, y - 6 + bob);
    ctx.lineTo(cx, y - 12 + bob);
    ctx.lineTo(cx + 6, y - 6 + bob);
    ctx.stroke();
    ctx.restore();
  }

  private drawFinishPortal(
    ctx: CanvasRenderingContext2D,
    stage: StageData,
    nowSec: number
  ): void {
    const { finishX: x, finishY: y, finishW: w, finishH: h } = stage;
    ctx.save();

    // Outer golden aura behind the finish arch
    const halo = ctx.createRadialGradient(
      x + w * 0.5,
      y + h * 0.5,
      8,
      x + w * 0.5,
      y + h * 0.5,
      w * 0.9
    );
    halo.addColorStop(0, 'rgba(250, 204, 21, 0.36)');
    halo.addColorStop(1, 'rgba(16, 185, 129, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + h * 0.5, w * 0.9, 0, Math.PI * 2);
    ctx.fill();

    // Portal glow field
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(250, 204, 21, 0.62)');
    grad.addColorStop(1, 'rgba(16, 185, 129, 0.42)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 6, w - 12, h - 6, [12, 12, 0, 0]);
    ctx.fill();

    // Animated horizontal energy scanlines
    ctx.fillStyle = 'rgba(254, 249, 195, 0.68)';
    for (let i = 0; i < 4; i++) {
      const sy = y + 12 + (((nowSec * 45 + i * 22) % (h - 16)));
      ctx.fillRect(x + 10, sy, w - 20, 2);
    }

    // Arch frame
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, w - 6, h - 3, [14, 14, 0, 0]);
    ctx.stroke();

    // Top banner label with racing checkered trim
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 12, y - 26, w + 24, 23, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FEF08A';
    ctx.font = '800 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CHEGADA', x + w * 0.5, y - 14.5);

    ctx.restore();
  }

  private drawSaw(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    nowSec: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(nowSec * 9);

    ctx.fillStyle = '#E2E8F0';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const teeth = 10;
    for (let i = 0; i < teeth * 2; i++) {
      const angle = (Math.PI * i) / teeth;
      const rad = i % 2 === 0 ? r + 3 : r - 4;
      const px = Math.cos(angle) * rad;
      const py = Math.sin(angle) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Center crimson hub
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawLaser(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    period: number,
    offset: number,
    nowSec: number
  ): void {
    const active = isLaserActive(period, offset, nowSec);
    const phase = ((nowSec + offset) % period + period) % period;
    const telegraph = !active && phase > period - 0.35;

    ctx.save();
    // Top & bottom emitter caps
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.fillRect(x - 2, y, w + 4, 8);
    ctx.strokeRect(x - 2, y, w + 4, 8);
    ctx.fillRect(x - 2, y + h - 8, w + 4, 8);
    ctx.strokeRect(x - 2, y + h - 8, w + 4, 8);

    const cx = x + w * 0.5;
    if (active) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.38)';
      ctx.fillRect(cx - 7, y + 8, 14, h - 16);
      ctx.fillStyle = '#FCA5A5';
      ctx.fillRect(cx - 2.5, y + 8, 5, h - 16);
    } else if (telegraph) {
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, y + 8);
      ctx.lineTo(cx, y + h - 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draws a crisp vector icon for any ItemType centered at (0, 0) in the current canvas transform.
   */
  private drawCanvasItemIcon(
    ctx: CanvasRenderingContext2D,
    itemType: ItemType,
    scale = 1
  ): void {
    ctx.save();
    ctx.scale(scale, scale);

    switch (itemType) {
      case 'turbo': {
        ctx.fillStyle = '#F59E0B';
        ctx.strokeStyle = '#FEF08A';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(2, -9);
        ctx.lineTo(-6, 1);
        ctx.lineTo(0, 1);
        ctx.lineTo(-2, 9);
        ctx.lineTo(6, -1);
        ctx.lineTo(0, -1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'shield': {
        ctx.fillStyle = '#3B82F6';
        ctx.strokeStyle = '#BAE6FD';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(-7, -5);
        ctx.lineTo(-7, 1);
        ctx.quadraticCurveTo(-6, 7, 0, 9);
        ctx.quadraticCurveTo(6, 7, 7, 1);
        ctx.lineTo(7, -5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'emp': {
        ctx.strokeStyle = '#22D3EE';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ECFEFF';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'rocket': {
        ctx.fillStyle = '#EF4444';
        ctx.strokeStyle = '#FECACA';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(-7, -4, 13, 8, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FACC15';
        ctx.beginPath();
        ctx.arc(4, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'frost': {
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(0, 8);
        ctx.moveTo(-7, -4);
        ctx.lineTo(7, 4);
        ctx.moveTo(7, -4);
        ctx.lineTo(-7, 4);
        ctx.stroke();
        ctx.fillStyle = '#E0F2FE';
        ctx.beginPath();
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'magnet': {
        ctx.strokeStyle = '#C084FC';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 1, 5.5, 0, Math.PI);
        ctx.moveTo(-5.5, 1);
        ctx.lineTo(-5.5, -6);
        ctx.moveTo(5.5, 1);
        ctx.lineTo(5.5, -6);
        ctx.stroke();
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(-7, -7, 3, 2.5);
        ctx.fillRect(4, -7, 3, 2.5);
        break;
      }
      case 'glitch': {
        ctx.fillStyle = '#EC4899';
        ctx.beginPath();
        ctx.roundRect(-7, -6, 14, 12, 3);
        ctx.fill();
        ctx.strokeStyle = '#FDF2F8';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-4, -2);
        ctx.lineTo(-1, 1);
        ctx.moveTo(-1, -2);
        ctx.lineTo(-4, 1);
        ctx.moveTo(1, -2);
        ctx.lineTo(4, 1);
        ctx.moveTo(4, -2);
        ctx.lineTo(1, 1);
        ctx.stroke();
        break;
      }
      case 'warp': {
        ctx.strokeStyle = '#34D399';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.moveTo(-3, 0);
        ctx.lineTo(4, 0);
        ctx.moveTo(1, -4);
        ctx.lineTo(5, 0);
        ctx.lineTo(1, 4);
        ctx.stroke();
        break;
      }
      case 'barrier': {
        // Vertical emitter posts + 3 glowing orange laser bars
        ctx.fillStyle = '#94A3B8';
        ctx.fillRect(-7.5, -7, 3, 14);
        ctx.fillRect(4.5, -7, 3, 14);
        ctx.strokeStyle = '#F97316';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-4.5, -4);
        ctx.lineTo(4.5, -4);
        ctx.moveTo(-4.5, 0);
        ctx.lineTo(4.5, 0);
        ctx.moveTo(-4.5, 4);
        ctx.lineTo(4.5, 4);
        ctx.stroke();
        break;
      }
      case 'grease': {
        // Dripping lime-green oil drop + puddle
        ctx.fillStyle = '#84CC16';
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.quadraticCurveTo(6, -1, 5, 3);
        ctx.arc(0, 3, 5, 0, Math.PI);
        ctx.quadraticCurveTo(-6, -1, 0, -8);
        ctx.fill();
        ctx.fillStyle = '#BEF264';
        ctx.beginPath();
        ctx.ellipse(0, 7.5, 7, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'whirlwind': {
        // Cyclone tornado rings + upward arrow
        ctx.strokeStyle = '#22D3EE';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-7, -5);
        ctx.lineTo(7, -5);
        ctx.moveTo(-5.5, -0.5);
        ctx.lineTo(5.5, -0.5);
        ctx.moveTo(-4, 4);
        ctx.lineTo(4, 4);
        ctx.moveTo(-2, 7.5);
        ctx.lineTo(2, 7.5);
        ctx.stroke();
        ctx.fillStyle = '#BAE6FD';
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(3.5, -5);
        ctx.lineTo(-3.5, -5);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'jetpack': {
        // Dual thruster cylinders + central harness + plasma exhaust flames
        ctx.fillStyle = '#FB923C';
        ctx.beginPath();
        ctx.roundRect(-6.5, -6.5, 4.5, 10, 2);
        ctx.roundRect(2, -6.5, 4.5, 10, 2);
        ctx.fill();
        ctx.fillStyle = '#FFF7ED';
        ctx.fillRect(-3.5, -3.5, 7, 3);
        ctx.fillStyle = '#FACC15';
        ctx.beginPath();
        ctx.moveTo(-6, 3.5);
        ctx.lineTo(-4.2, 9);
        ctx.lineTo(-2.5, 3.5);
        ctx.moveTo(2.5, 3.5);
        ctx.lineTo(4.2, 9);
        ctx.lineTo(6, 3.5);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }

    ctx.restore();
  }

  private drawItemBox(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    itemType: ItemType,
    respawning: boolean,
    nowSec: number
  ): void {
    ctx.save();
    const bob = Math.sin(nowSec * 3.5 + x * 0.05) * 4;
    ctx.translate(x + 15, y + 15 + bob);

    const meta = ITEM_METADATA[itemType] ?? ITEM_METADATA.turbo;

    if (respawning) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.38)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(-13, -13, 26, 26);
      ctx.globalAlpha = 0.35;
      this.drawCanvasItemIcon(ctx, itemType, 0.72);
      ctx.restore();
      return;
    }

    // Outer rotating holographic halo ring
    ctx.save();
    ctx.rotate(nowSec * 1.8 + x * 0.01);
    ctx.strokeStyle = meta.color;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Outer item-colored crate frame
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.roundRect(-15, -15, 30, 30, 7);
    ctx.fill();
    ctx.stroke();

    // Subtle inner radial glow tinted with the item's signature color
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = meta.color;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Inner corner brackets
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-11, -11, 22, 22);

    // Draw the exact item icon inside the box!
    this.drawCanvasItemIcon(ctx, itemType, 0.94);

    ctx.restore();
  }

  private drawActiveTrap(
    ctx: CanvasRenderingContext2D,
    trap: ActiveTrap,
    nowSec: number
  ): void {
    if (trap.kind === 'barrier') {
      const bw = trap.w ?? 22;
      const bh = trap.h ?? 72;
      ctx.save();
      // Vertical metallic emitter posts on left & right edges of barrier
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2;
      ctx.fillRect(trap.x, trap.y, 6, bh);
      ctx.strokeRect(trap.x, trap.y, 6, bh);
      ctx.fillRect(trap.x + bw - 6, trap.y, 6, bh);
      ctx.strokeRect(trap.x + bw - 6, trap.y, 6, bh);

      // Glowing orange laser barrier field
      const pulse = 0.65 + 0.35 * Math.sin(nowSec * 12);
      ctx.fillStyle = `rgba(249, 115, 22, ${0.28 + pulse * 0.2})`;
      ctx.fillRect(trap.x + 4, trap.y + 4, bw - 8, bh - 8);

      ctx.strokeStyle = '#FDBA74';
      ctx.lineWidth = 3;
      for (let ry = trap.y + 12; ry < trap.y + bh - 8; ry += 16) {
        ctx.beginPath();
        ctx.moveTo(trap.x + 4, ry);
        ctx.lineTo(trap.x + bw - 4, ry);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (trap.kind === 'grease_slick') {
      const gw = trap.w ?? 84;
      const gh = trap.h ?? 12;
      ctx.save();
      // Slippery dark-olive / lime industrial grease puddle on floor
      ctx.fillStyle = '#365314';
      ctx.strokeStyle = '#84CC16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(trap.x + gw * 0.5, trap.y + gh * 0.5, gw * 0.5, gh * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Glossy oil sheen & bubbles
      ctx.fillStyle = '#A3E635';
      for (let b = 0; b < 3; b++) {
        const bx = trap.x + gw * (0.25 + b * 0.25) + Math.sin(nowSec * 4 + b) * 4;
        const by = trap.y + gh * 0.4;
        ctx.beginPath();
        ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (trap.kind === 'whirlwind') {
      const ww = trap.w ?? 48;
      const wh = trap.h ?? 82;
      const cx = trap.x + ww * 0.5;
      ctx.save();
      // Spinning cyan tornado funnel rising from the ground
      for (let ring = 0; ring < 6; ring++) {
        const t = ring / 5;
        const ry = trap.y + wh - ring * (wh / 5.5);
        const rx = 10 + t * (ww * 0.48);
        const sway = Math.sin(nowSec * 14 + ring * 1.1) * 5;
        ctx.strokeStyle = ring % 2 === 0 ? '#22D3EE' : '#BAE6FD';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.ellipse(cx + sway, ry, rx, 5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // Default: 'frost_mine'
    ctx.save();
    ctx.translate(trap.x + 14, trap.y + 8);
    ctx.fillStyle = '#0EA5E9';
    ctx.strokeStyle = '#E0F2FE';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 11, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const pulse = 0.5 + 0.5 * Math.sin(nowSec * 8);
    ctx.strokeStyle = `rgba(125, 211, 252, ${0.3 + pulse * 0.45})`;
    ctx.beginPath();
    ctx.arc(0, -2, 16 + pulse * 4, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  }

  private drawBoostRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    nowSec: number,
    dir: 1 | -1 = 1
  ): void {
    ctx.save();
    ctx.translate(x, y);

    // Outer rotating dashed ring
    ctx.save();
    ctx.rotate(nowSec * 3.2 * dir);
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 3.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Inner amber core ring
    ctx.strokeStyle = '#FACC15';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r - 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Forward-upward boost chevron arrows inside the portal
    ctx.scale(dir, 1);
    const pulse = Math.sin(nowSec * 8) * 2;
    ctx.strokeStyle = '#FEF08A';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-5 + pulse, 4);
    ctx.lineTo(2 + pulse, -3);
    ctx.lineTo(-5 + pulse, -10);
    ctx.moveTo(2 + pulse, 4);
    ctx.lineTo(9 + pulse, -3);
    ctx.lineTo(2 + pulse, -10);
    ctx.stroke();

    ctx.restore();
  }

  private drawBumper(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    nowSec: number
  ): void {
    ctx.save();
    const scale = 1 + Math.sin(nowSec * 6 + x * 0.02) * 0.06;
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Outer electromagnetic aura
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
    ctx.stroke();

    // Bumper body
    ctx.fillStyle = '#831843';
    ctx.strokeStyle = '#F472B6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner star/core
    ctx.fillStyle = '#FDE047';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawCrystal(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    nowSec: number
  ): void {
    ctx.save();
    const bob = Math.sin(nowSec * 5 + x * 0.04) * 3;
    ctx.translate(x, y + bob);

    // Diamond crystal shard
    ctx.fillStyle = '#10B981';
    ctx.strokeStyle = '#A7F3D0';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(8, 0);
    ctx.lineTo(0, 10);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner highlight facet
    ctx.fillStyle = '#ECFDF5';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.5, 0);
    ctx.lineTo(0, 5);
    ctx.lineTo(-3.5, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawDrone(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    nowSec: number
  ): void {
    ctx.save();
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    ctx.translate(cx, cy);

    // Bottom electric hazard prongs
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, h * 0.5 - 2);
    ctx.lineTo(-5, h * 0.5 + 4);
    ctx.moveTo(8, h * 0.5 - 2);
    ctx.lineTo(5, h * 0.5 + 4);
    ctx.stroke();

    // Drone chassis
    ctx.fillStyle = '#1E293B';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-w * 0.5, -h * 0.3, w, h * 0.75, 6);
    ctx.fill();
    ctx.stroke();

    // Top spring-bounceable cyan dome (visual cue that jumping on top bounces!)
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(0, -h * 0.25, w * 0.36, Math.PI, 0);
    ctx.fill();

    // Scanning red eye
    const eyeX = Math.sin(nowSec * 5) * 5;
    ctx.fillStyle = '#F87171';
    ctx.beginPath();
    ctx.arc(eyeX, 1, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawRobot(
    ctx: CanvasRenderingContext2D,
    robot: RobotState,
    isLocal: boolean,
    isLeader: boolean,
    nowSec: number
  ): void {
    const palette = ROBOT_PALETTES[robot.colorIndex % ROBOT_PALETTES.length];
    const cx = robot.x + robot.w * 0.5;
    const bottomY = robot.y + robot.h;

    // Ground contact shadow when standing on or near a deck
    if (robot.onGround) {
      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
      ctx.beginPath();
      ctx.ellipse(cx, bottomY + 1, 13, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Motion afterimage ghost trail when dashing, turbo-boosting, or flying with Jetpack
    if (
      robot.dashTimer > 0 ||
      robot.turboTimer > 0 ||
      (robot.jetpackTimer ?? 0) > 0
    ) {
      const ghostColor =
        (robot.jetpackTimer ?? 0) > 0
          ? 'rgba(251, 146, 60, 0.24)'
          : robot.dashTimer > 0
          ? 'rgba(56, 189, 248, 0.28)'
          : 'rgba(245, 158, 11, 0.22)';
      for (let g = 1; g <= 2; g++) {
        ctx.save();
        const gx = cx - robot.vx * 0.022 * g - robot.facing * 5 * g;
        const gy = bottomY - robot.vy * 0.018 * g;
        ctx.translate(gx, gy);
        ctx.scale(robot.scaleX * (1 - g * 0.05), robot.scaleY * (1 - g * 0.05));
        ctx.fillStyle = ghostColor;
        ctx.beginPath();
        ctx.roundRect(-13, -32, 26, 25, 7);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.save();
    ctx.translate(cx, bottomY);
    const leanAngle = Math.max(-0.13, Math.min(0.13, robot.vx * 0.00026));
    ctx.rotate(leanAngle);
    ctx.scale(robot.scaleX, robot.scaleY);

    // Invulnerability blink
    if (robot.invulnTimer > 0 && Math.floor(nowSec * 16) % 2 === 0) {
      ctx.globalAlpha = 0.55;
    }

    // Dash speed streak
    if (robot.dashTimer > 0) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.beginPath();
      ctx.roundRect(-robot.facing * 26 - 10, -30, 24, 22, 6);
      ctx.fill();
    }

    // Turbo exhaust flame
    if (robot.turboTimer > 0) {
      ctx.fillStyle = '#F97316';
      ctx.beginPath();
      ctx.moveTo(-robot.facing * 12, -12);
      ctx.lineTo(-robot.facing * (26 + Math.random() * 10), -16);
      ctx.lineTo(-robot.facing * 12, -20);
      ctx.closePath();
      ctx.fill();
    }

    // Mounted Twin-Cylinder Jetpack + Plasma Thruster Flames when active
    if ((robot.jetpackTimer ?? 0) > 0) {
      const packX = -robot.facing * 13;
      ctx.fillStyle = '#EA580C';
      ctx.strokeStyle = '#090D16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(packX - 4, -27, 8, 16, 3);
      ctx.fill();
      ctx.stroke();

      // Fuel gauge core on the backpack
      ctx.fillStyle = '#FDE047';
      ctx.fillRect(packX - 1.5, -24, 3, 9);

      // Animated plasma flames shooting downward from the thruster nozzle
      const flameLen = 14 + Math.sin(nowSec * 38) * 5;
      ctx.fillStyle = '#FB923C';
      ctx.beginPath();
      ctx.moveTo(packX - 4, -11);
      ctx.lineTo(packX, -11 + flameLen);
      ctx.lineTo(packX + 4, -11);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#FEF08A';
      ctx.beginPath();
      ctx.moveTo(packX - 2, -11);
      ctx.lineTo(packX, -11 + flameLen * 0.62);
      ctx.lineTo(packX + 2, -11);
      ctx.closePath();
      ctx.fill();
    }

    // Grease slick drips under robot wheels
    if ((robot.greaseTimer ?? 0) > 0) {
      ctx.fillStyle = '#84CC16';
      ctx.beginPath();
      ctx.ellipse(0, -1, 14, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Legs / wheels animated by stridePhase (with coil springs for 'jumper' class)
    const legOffset = robot.onGround ? Math.sin(robot.stridePhase) * 4 : 2;
    if (robot.robotClass === 'jumper') {
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6 + legOffset, -11);
      ctx.lineTo(-6 + legOffset, -6);
      ctx.moveTo(6 - legOffset, -11);
      ctx.lineTo(6 - legOffset, -6);
      ctx.stroke();
    }
    ctx.fillStyle = '#1E293B';
    ctx.strokeStyle = '#090D16';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-10 + legOffset, -8, 8, 8, 3);
    ctx.roundRect(2 - legOffset, -8, 8, 8, 3);
    ctx.fill();
    ctx.stroke();

    // Wheel hubcaps
    ctx.fillStyle = '#94A3B8';
    ctx.fillRect(-7 + legOffset, -5, 2, 2);
    ctx.fillRect(5 - legOffset, -5, 2, 2);

    // Class-specific aerodynamic wing fins for 'speedster'
    if (robot.robotClass === 'speedster') {
      ctx.fillStyle = palette.accent;
      ctx.strokeStyle = '#090D16';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-robot.facing * 11, -28);
      ctx.lineTo(-robot.facing * 20, -33);
      ctx.lineTo(-robot.facing * 16, -21);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Antenna
    const antennaSway = -robot.vx * 0.012;
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -32);
    ctx.lineTo(antennaSway, -41);
    ctx.stroke();
    ctx.fillStyle = isLocal ? '#FACC15' : palette.accent;
    ctx.beginPath();
    ctx.arc(antennaSway, -42, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Torso & Head chassis
    ctx.fillStyle =
      robot.frostTimer > 0
        ? '#7DD3FC'
        : (robot.greaseTimer ?? 0) > 0
        ? '#65A30D'
        : palette.body;
    ctx.strokeStyle = '#090D16';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(-13, -32, 26, 25, 7);
    ctx.fill();
    ctx.stroke();

    // Top metallic specular highlight bar on head
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.roundRect(-9, -30, 18, 2.5, 1.5);
    ctx.fill();

    // Lower chassis shadow strip & chest power core
    ctx.fillStyle = palette.shade;
    ctx.beginPath();
    ctx.roundRect(-11, -14, 22, 6, [0, 0, 5, 5]);
    ctx.fill();

    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.roundRect(-3.5, -13, 7, 3.5, 1.5);
    ctx.fill();

    // Visor screen
    const visorX = robot.facing > 0 ? -4 : -10;
    ctx.fillStyle = '#090D16';
    ctx.beginPath();
    ctx.roundRect(visorX, -27, 15, 10, 4);
    ctx.fill();

    // Visor diagonal glass reflection
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.roundRect(visorX + 1.5, -26, 6, 2.2, 1);
    ctx.fill();

    // Expressive glowing eyes
    const eyeColor =
      robot.stunTimer > 0
        ? '#FCA5A5'
        : robot.glitchTimer > 0
        ? '#F472B6'
        : (robot.jetpackTimer ?? 0) > 0
        ? '#FDE047'
        : palette.visor;
    ctx.fillStyle = eyeColor;
    const eyeShift = robot.facing * 2;
    const ex1 = visorX + 3 + eyeShift * 0.4;
    const ex2 = visorX + 9 + eyeShift * 0.4;
    if (robot.stunTimer > 0) {
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ex1, -24.5);
      ctx.lineTo(ex1 + 3, -20.5);
      ctx.moveTo(ex1 + 3, -24.5);
      ctx.lineTo(ex1, -20.5);
      ctx.moveTo(ex2, -24.5);
      ctx.lineTo(ex2 + 3, -20.5);
      ctx.moveTo(ex2 + 3, -24.5);
      ctx.lineTo(ex2, -20.5);
      ctx.stroke();
    } else {
      const eyeH =
        robot.dashTimer > 0 || robot.turboTimer > 0 ? 2.8 : 4;
      const eyeY =
        robot.dashTimer > 0 || robot.turboTimer > 0 ? -23.2 : -24;
      ctx.fillRect(ex1, eyeY, 3.2, eyeH);
      ctx.fillRect(ex2, eyeY, 3.2, eyeH);
    }

    // Shield bubble
    if (robot.shieldTimer > 0) {
      ctx.strokeStyle = '#38BDF8';
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -18, 23, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // EMP slow ring
    if (robot.empSlowTimer > 0) {
      ctx.strokeStyle = '#22D3EE';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, -18, 21, nowSec * 6, nowSec * 6 + Math.PI * 1.4);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Glitch inverted-control aura
    if (robot.glitchTimer > 0) {
      ctx.strokeStyle = '#EC4899';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -18, 24, -nowSec * 7, -nowSec * 7 + Math.PI * 1.2);
      ctx.stroke();
    }

    ctx.restore();

    // HELD-ITEM HOLOGRAPHIC INDICATOR ON THE ROBOT (drawn unscaled so icon is always crisp!)
    if (robot.heldItem) {
      const itemMeta = ITEM_METADATA[robot.heldItem] ?? ITEM_METADATA.turbo;
      const badgeBob = Math.sin(nowSec * 6 + robot.colorIndex) * 2.5;
      const badgeX = cx - robot.facing * 22;
      const badgeY = robot.y - 4 + badgeBob;

      ctx.save();
      // Connector beam from robot shoulder to floating item badge
      ctx.strokeStyle = itemMeta.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - robot.facing * 10, robot.y + 10);
      ctx.lineTo(badgeX, badgeY);
      ctx.stroke();

      ctx.translate(badgeX, badgeY);
      // Badge background & glowing item-colored frame
      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.strokeStyle = itemMeta.color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Render crisp item icon inside the robot's floating badge
      this.drawCanvasItemIcon(ctx, robot.heldItem, 0.78);
      ctx.restore();
    }

    // Floating name tag & leader crown (unscaled so text stays sharp)
    if (robot.name) {
      ctx.save();
      const tagY = robot.y - 16;
      if (isLeader) {
        // Mini crown above leader
        ctx.fillStyle = '#FACC15';
        ctx.beginPath();
        ctx.moveTo(cx - 7, tagY - 10);
        ctx.lineTo(cx - 7, tagY - 17);
        ctx.lineTo(cx - 3, tagY - 13);
        ctx.lineTo(cx, tagY - 19);
        ctx.lineTo(cx + 3, tagY - 13);
        ctx.lineTo(cx + 7, tagY - 17);
        ctx.lineTo(cx + 7, tagY - 10);
        ctx.closePath();
        ctx.fill();
      }

      ctx.font = isLocal ? '700 11px Plus Jakarta Sans, sans-serif' : '600 10px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeText(robot.name, cx, tagY);
      ctx.fillStyle = isLocal ? '#FDE047' : '#E2E8F0';
      ctx.fillText(robot.name, cx, tagY);
      ctx.restore();
    }
  }
}
