// ============================================================
// Ink in Water (Processing)
// Fluid solver based on Jos Stam's "Real-Time Fluid Dynamics for Games",
// plus vorticity confinement (for curling tendrils) and subtractive
// "ink" rendering (overlapping colour gets darker, like dye in water).
//
// Controls:
//   click + hold  drop ink (each click uses the next colour)
//   move mouse    stir the water
//   1-6 pick a specific ink colour
//   R             clear the water
// ============================================================

// ---- tuning values (edit these!) ---------------------------
final int PAPER = 252;            // background brightness (255 = pure white)
final float INK_STRENGTH = 1.20;  // how much light one particle absorbs (higher = darker, denser ink)
final float SWIRL = 6.0;          // vorticity confinement: higher = more curls and tendrils
final float DAMPING = 0.993;      // water slows down each frame (1 = never)
final float SINK = 0.05;          // pixels per frame that ink slowly sinks
final float JITTER = 0.50;        // random wobble in pixels (softens edges)
final float MIX_AMOUNT = 0.006;   // how fast neighbouring ink colours blend (0 = never)
final int DROP_PER_FRAME = 220;   // particles added each frame while the mouse is held
final float DROP_RADIUS = 14;     // pixel size of the drop

// Ink colours (R, G, B). Mixing averages them, then overlaps darken them further.
int[][] inkPalette = {
  {226, 30, 105},   // magenta-pink
  {25, 40, 190},    // ultramarine
  {20, 160, 215},   // cyan
  {120, 20, 150},   // violet
  {250, 110, 10},   // orange
  {10, 150, 90}     // green
};

// ---- fluid grid (cells are roughly square) -----------------
final int NX = 56;
final int NY = 79;
final float CELL = 800.0 / NX;    // pixels per grid cell

// ---- particles ---------------------------------------------
final int MAX_PARTICLES = 120000;
Particle[] particles = new Particle[MAX_PARTICLES];
int nextSlot = 0;                 // ring buffer: oldest ink is recycled when full

// coarse grid used to blend colours between nearby particles
final int MIX_COLS = 80;
final int MIX_ROWS = 113;
float[] mixR = new float[MIX_COLS * MIX_ROWS];
float[] mixG = new float[MIX_COLS * MIX_ROWS];
float[] mixB = new float[MIX_COLS * MIX_ROWS];
int[] mixCount = new int[MIX_COLS * MIX_ROWS];

NavierStokesFluidSolver fluidSolver;
float previousMouseX = 1, previousMouseY = 1;
boolean dropping = false;
int inkIndex = -1;

void setup() {
  // A3 portrait ratio (width : height = 1 : sqrt(2))
  size(800, 1131);
  frameRate(60);
  fluidSolver = new NavierStokesFluidSolver();
  for (int i = 0; i < MAX_PARTICLES; i++) {
    particles[i] = new Particle();
  }
  seedDrops();
}

// Two starting drops that drift toward each other and meet in the middle
void seedDrops() {
  spawnInk(width * 0.28, height * 0.32, 6000, 45, 0);   // pink
  spawnInk(width * 0.72, height * 0.38, 6000, 45, 1);   // blue
  spawnInk(width * 0.30, height * 0.68, 6000, 45, 4);   // orange
  spawnInk(width * 0.70, height * 0.72, 6000, 45, 2);   // cyan
  spawnInk(width * 0.50, height * 0.52, 5000, 40, 5);   // green
  for (int k = 0; k < 6; k++) {
    fluidSolver.addVelocity((int)(NX * 0.28), (int)(NY * 0.32), 12, 6, 6);
    fluidSolver.addVelocity((int)(NX * 0.72), (int)(NY * 0.38), -12, 6, 6);
    fluidSolver.addVelocity((int)(NX * 0.30), (int)(NY * 0.68), 12, -6, 6);
    fluidSolver.addVelocity((int)(NX * 0.70), (int)(NY * 0.72), -12, -6, 6);
  }
}

void spawnInk(float cx, float cy, int count, float radius, int colorIndex) {
  for (int k = 0; k < count; k++) {
    Particle p = particles[nextSlot];
    nextSlot = (nextSlot + 1) % MAX_PARTICLES;
    float angle = random(TWO_PI);
    float dist = radius * sqrt(random(1));
    p.x = constrain(cx + cos(angle) * dist, 1, width - 2);
    p.y = constrain(cy + sin(angle) * dist, 1, height - 2);
    p.r = inkPalette[colorIndex][0];
    p.g = inkPalette[colorIndex][1];
    p.b = inkPalette[colorIndex][2];
    p.active = true;
  }
}

void draw() {
  stirWater();
  if (dropping) {
    spawnInk(mouseX, mouseY, DROP_PER_FRAME, DROP_RADIUS, inkIndex);
  }
  fluidSolver.updateSimulation(1.0 / 60.0);
  moveParticles();
  mixColors();
  renderInk();
}

// ---- moving the ink with the fluid -------------------------
void moveParticles() {
  for (int i = 0; i < MAX_PARTICLES; i++) {
    Particle p = particles[i];
    if (!p.active) continue;

    float vx = fluidSolver.sampleU(p.x, p.y);
    float vy = fluidSolver.sampleV(p.x, p.y);

    // velocity is in cells per second; the step is 1/60 of a second
    p.x += vx * CELL / 60.0 + random(-JITTER, JITTER);
    p.y += vy * CELL / 60.0 + SINK + random(-JITTER, JITTER);

    // keep ink inside the "tank"
    p.x = constrain(p.x, 1, width - 2);
    p.y = constrain(p.y, 1, height - 2);
  }
}

// Blend each particle's colour a little toward the average colour around it
void mixColors() {
  int cells = MIX_COLS * MIX_ROWS;
  for (int i = 0; i < cells; i++) {
    mixR[i] = 0;
    mixG[i] = 0;
    mixB[i] = 0;
    mixCount[i] = 0;
  }
  for (int i = 0; i < MAX_PARTICLES; i++) {
    Particle p = particles[i];
    if (!p.active) continue;
    int idx = mixIndex(p);
    mixR[idx] += p.r;
    mixG[idx] += p.g;
    mixB[idx] += p.b;
    mixCount[idx]++;
  }
  for (int i = 0; i < MAX_PARTICLES; i++) {
    Particle p = particles[i];
    if (!p.active) continue;
    int idx = mixIndex(p);
    int n = mixCount[idx];
    p.r = lerp(p.r, mixR[idx] / n, MIX_AMOUNT);
    p.g = lerp(p.g, mixG[idx] / n, MIX_AMOUNT);
    p.b = lerp(p.b, mixB[idx] / n, MIX_AMOUNT);
  }
}

int mixIndex(Particle p) {
  int c = constrain((int)(p.x / width * MIX_COLS), 0, MIX_COLS - 1);
  int r = constrain((int)(p.y / height * MIX_ROWS), 0, MIX_ROWS - 1);
  return r * MIX_COLS + c;
}

// ---- drawing: subtractive ink on white paper ---------------
// Every particle multiplies the pixels under it by its colour, so ink
// thickens and darkens where particles overlap, like dye in water.
void renderInk() {
  background(PAPER);
  loadPixels();
  for (int i = 0; i < MAX_PARTICLES; i++) {
    Particle p = particles[i];
    if (!p.active) continue;

    // each particle is a soft 3x3 blob, so fewer particles cover more canvas
    int ix = (int)p.x;
    int iy = (int)p.y;
    inkPixel(ix,     iy,     0.60, p);
    inkPixel(ix - 1, iy,     0.35, p);
    inkPixel(ix + 1, iy,     0.35, p);
    inkPixel(ix,     iy - 1, 0.35, p);
    inkPixel(ix,     iy + 1, 0.35, p);
    inkPixel(ix - 1, iy - 1, 0.20, p);
    inkPixel(ix + 1, iy - 1, 0.20, p);
    inkPixel(ix - 1, iy + 1, 0.20, p);
    inkPixel(ix + 1, iy + 1, 0.20, p);
  }
  updatePixels();
}

void inkPixel(int px, int py, float weight, Particle p) {
  if (px < 0 || px >= width || py < 0 || py >= height) return;
  int idx = py * width + px;
  int c = pixels[idx];
  float k = weight * INK_STRENGTH;
  int nr = (int)(((c >> 16) & 255) * (1 - k * (1 - p.r / 255.0)));
  int ng = (int)(((c >> 8) & 255) * (1 - k * (1 - p.g / 255.0)));
  int nb = (int)((c & 255) * (1 - k * (1 - p.b / 255.0)));
  pixels[idx] = (255 << 24) | (nr << 16) | (ng << 8) | nb;
}

// ---- mouse and keys ----------------------------------------
void stirWater() {
  float mx = max(1, mouseX);
  float my = max(1, mouseY);
  float dx = mx - previousMouseX;
  float dy = my - previousMouseY;

  float speed = sqrt(dx * dx + dy * dy);
  float maxSpeed = 25;
  if (speed > maxSpeed) {
    dx = dx / speed * maxSpeed;
    dy = dy / speed * maxSpeed;
  }

  // pixels per frame -> cells per second, then push a fraction of it into the water
  float pushX = dx * 60.0 / CELL * 0.35;
  float pushY = dy * 60.0 / CELL * 0.35;
  fluidSolver.addVelocity((int)(mx / CELL), (int)(my / CELL), pushX, pushY, 4);

  previousMouseX = mx;
  previousMouseY = my;
}

void mousePressed() {
  inkIndex = (inkIndex + 1) % inkPalette.length;
  dropping = true;
}

void mouseReleased() {
  dropping = false;
}

void keyPressed() {
  if (key == '1') inkIndex = 0;
  if (key == '2') inkIndex = 1;
  if (key == '3') inkIndex = 2;
  if (key == '4') inkIndex = 3;
  if (key == '5') inkIndex = 4;
  if (key == '6') inkIndex = 5;
  if (key == 'r' || key == 'R') {
    for (int i = 0; i < MAX_PARTICLES; i++) particles[i].active = false;
  }
}

class Particle {
  float x, y;
  float r, g, b;
  boolean active = false;
}

// ============================================================
// Fluid solver (NX x NY grid, velocities in cells per second)
// ============================================================
class NavierStokesFluidSolver {
  double[][] u = new double[NX + 2][NY + 2];     // x velocity
  double[][] v = new double[NX + 2][NY + 2];     // y velocity
  double[][] uPrev = new double[NX + 2][NY + 2];
  double[][] vPrev = new double[NX + 2][NY + 2];
  double[][] curl = new double[NX + 2][NY + 2];  // spin of the water
  double viscosity = 0.05;
  double maxSpeed = 45;                          // safety limit (cells per second)
  int iterations = 20;

  // push the water around a cell; strength fades to 0 at the radius
  void addVelocity(int cellX, int cellY, double dvx, double dvy, int radius) {
    for (int i = cellX - radius; i <= cellX + radius; i++) {
      for (int j = cellY - radius; j <= cellY + radius; j++) {
        if (i < 0 || i >= NX || j < 0 || j >= NY) continue;
        double d = Math.sqrt((i - cellX) * (i - cellX) + (j - cellY) * (j - cellY));
        if (d > radius) continue;
        double falloff = 1 - d / radius;
        u[i + 1][j + 1] += dvx * falloff;
        v[i + 1][j + 1] += dvy * falloff;
      }
    }
  }

  // velocity at a pixel position (smoothly interpolated between cells)
  float sampleU(float px, float py) { return (float)sample(u, px, py); }
  float sampleV(float px, float py) { return (float)sample(v, px, py); }

  double sample(double[][] f, float px, float py) {
    double x = px / CELL + 0.5;
    double y = py / CELL + 0.5;
    if (x < 1) x = 1;
    if (x > NX) x = NX;
    if (y < 1) y = 1;
    if (y > NY) y = NY;
    int i0 = (int)x;
    int j0 = (int)y;
    int i1 = Math.min(i0 + 1, NX);
    int j1 = Math.min(j0 + 1, NY);
    double s = x - i0;
    double t = y - j0;
    return (1 - s) * ((1 - t) * f[i0][j0] + t * f[i0][j1]) +
           s * ((1 - t) * f[i1][j0] + t * f[i1][j1]);
  }

  void updateSimulation(double dt) {
    addSwirl(dt);

    // viscosity
    copyField(u, uPrev);
    copyField(v, vPrev);
    diffuse(1, u, uPrev, viscosity, dt);
    diffuse(2, v, vPrev, viscosity, dt);
    project(u, v, uPrev, vPrev);

    // carry the velocity along itself
    copyField(u, uPrev);
    copyField(v, vPrev);
    advect(1, u, uPrev, uPrev, vPrev, dt);
    advect(2, v, vPrev, uPrev, vPrev, dt);
    project(u, v, uPrev, vPrev);

    // water slowly loses energy, and never goes crazy-fast
    for (int i = 1; i <= NX; i++) {
      for (int j = 1; j <= NY; j++) {
        u[i][j] *= DAMPING;
        v[i][j] *= DAMPING;
        u[i][j] = Math.max(-maxSpeed, Math.min(maxSpeed, u[i][j]));
        v[i][j] = Math.max(-maxSpeed, Math.min(maxSpeed, v[i][j]));
      }
    }
  }

  // Vorticity confinement: finds where the water is spinning and pushes it to spin
  // a bit more, which keeps small curls alive instead of smoothing them away.
  void addSwirl(double dt) {
    for (int i = 1; i <= NX; i++) {
      for (int j = 1; j <= NY; j++) {
        curl[i][j] = 0.5 * ((v[i + 1][j] - v[i - 1][j]) - (u[i][j + 1] - u[i][j - 1]));
      }
    }
    for (int i = 2; i < NX; i++) {
      for (int j = 2; j < NY; j++) {
        double dx = 0.5 * (Math.abs(curl[i + 1][j]) - Math.abs(curl[i - 1][j]));
        double dy = 0.5 * (Math.abs(curl[i][j + 1]) - Math.abs(curl[i][j - 1]));
        double len = Math.sqrt(dx * dx + dy * dy) + 0.00001;
        u[i][j] += dt * SWIRL * (dy / len) * curl[i][j];
        v[i][j] -= dt * SWIRL * (dx / len) * curl[i][j];
      }
    }
  }

  void copyField(double[][] from, double[][] to) {
    for (int i = 0; i < NX + 2; i++) {
      for (int j = 0; j < NY + 2; j++) {
        to[i][j] = from[i][j];
      }
    }
  }

  void diffuse(int b, double[][] x, double[][] x0, double diff, double dt) {
    double a = dt * diff;
    for (int k = 0; k < iterations; k++) {
      for (int i = 1; i <= NX; i++) {
        for (int j = 1; j <= NY; j++) {
          x[i][j] = (x0[i][j] + a * (x[i - 1][j] + x[i + 1][j] + x[i][j - 1] + x[i][j + 1])) / (1 + 4 * a);
        }
      }
      setBoundary(b, x);
    }
  }

  void advect(int b, double[][] d, double[][] d0, double[][] uu, double[][] vv, double dt) {
    for (int i = 1; i <= NX; i++) {
      for (int j = 1; j <= NY; j++) {
        double x = i - dt * uu[i][j];
        double y = j - dt * vv[i][j];
        if (x < 0.5) x = 0.5;
        if (x > NX + 0.5) x = NX + 0.5;
        if (y < 0.5) y = 0.5;
        if (y > NY + 0.5) y = NY + 0.5;
        int i0 = (int)x;
        int i1 = i0 + 1;
        int j0 = (int)y;
        int j1 = j0 + 1;
        double s1 = x - i0;
        double s0 = 1 - s1;
        double t1 = y - j0;
        double t0 = 1 - t1;
        d[i][j] = s0 * (t0 * d0[i0][j0] + t1 * d0[i0][j1]) +
                  s1 * (t0 * d0[i1][j0] + t1 * d0[i1][j1]);
      }
    }
    setBoundary(b, d);
  }

  // make the flow incompressible (water can't be squeezed)
  void project(double[][] uu, double[][] vv, double[][] p, double[][] div) {
    for (int i = 1; i <= NX; i++) {
      for (int j = 1; j <= NY; j++) {
        div[i][j] = -0.5 * ((uu[i + 1][j] - uu[i - 1][j]) + (vv[i][j + 1] - vv[i][j - 1]));
        p[i][j] = 0;
      }
    }
    setBoundary(0, div);
    setBoundary(0, p);

    for (int k = 0; k < iterations; k++) {
      for (int i = 1; i <= NX; i++) {
        for (int j = 1; j <= NY; j++) {
          p[i][j] = (div[i][j] + p[i - 1][j] + p[i + 1][j] + p[i][j - 1] + p[i][j + 1]) / 4;
        }
      }
      setBoundary(0, p);
    }

    for (int i = 1; i <= NX; i++) {
      for (int j = 1; j <= NY; j++) {
        uu[i][j] -= 0.5 * (p[i + 1][j] - p[i - 1][j]);
        vv[i][j] -= 0.5 * (p[i][j + 1] - p[i][j - 1]);
      }
    }
    setBoundary(1, uu);
    setBoundary(2, vv);
  }

  // walls: water bounces back off the edges of the canvas
  void setBoundary(int b, double[][] x) {
    for (int j = 1; j <= NY; j++) {
      x[0][j] = (b == 1) ? -x[1][j] : x[1][j];
      x[NX + 1][j] = (b == 1) ? -x[NX][j] : x[NX][j];
    }
    for (int i = 1; i <= NX; i++) {
      x[i][0] = (b == 2) ? -x[i][1] : x[i][1];
      x[i][NY + 1] = (b == 2) ? -x[i][NY] : x[i][NY];
    }
    x[0][0] = 0.5 * (x[1][0] + x[0][1]);
    x[0][NY + 1] = 0.5 * (x[1][NY + 1] + x[0][NY]);
    x[NX + 1][0] = 0.5 * (x[NX][0] + x[NX + 1][1]);
    x[NX + 1][NY + 1] = 0.5 * (x[NX][NY + 1] + x[NX + 1][NY]);
  }
}
