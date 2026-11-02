// ============================================================
// Navier-Stokes Fluid Simulation (Processing)
// Based on Jos Stam's "Real-Time Fluid Dynamics for Games"
// ============================================================

NavierStokesFluidSolver fluidSolver;
double fluidViscosity, fluidDiffusion, velocityScaleFactor, particleVelocityScale;
float maxMouseVelocity;
float previousMouseX = 1, previousMouseY = 1;
int numberOfParticles;
Particle[] particles;

// --- paint colors ---
// Each particle carries its own RGB color; nearby particles blend toward each other.
int[][] paintPalette = {
  {235, 40, 60},   // red
  {255, 200, 30},  // yellow
  {40, 110, 255},  // blue
  {230, 50, 190}   // magenta
};
final int MIX_COLS = 50;       // coarse grid used to find the average color nearby
final int MIX_ROWS = 70;
float mixAmount = 0.06;        // how fast neighbors' colors blend (0 = never, 1 = instantly)
float[] mixR = new float[MIX_COLS * MIX_ROWS];
float[] mixG = new float[MIX_COLS * MIX_ROWS];
float[] mixB = new float[MIX_COLS * MIX_ROWS];
int[] mixCount = new int[MIX_COLS * MIX_ROWS];

// --- interaction speed boost ---
float speedBoost = 0;          // 0 = calm, 1 = mouse moving at full speed
float boostStrength = 1.5;     // extra speed multiplier at full boost
float boostDecay = 0.96;       // how quickly it eases back to calm (closer to 1 = slower)

void setup() {
  // A3竖版比例 (宽:高 = 1:√2)
  size(800, 1131);
  background(0); // black background

  fluidSolver = new NavierStokesFluidSolver();
  numberOfParticles = (int)pow(2, 16); // 65536
  particles = new Particle[numberOfParticles];
  fluidViscosity = 0.00059;
  fluidDiffusion = 0.03;
  velocityScaleFactor = 10;
  maxMouseVelocity = 10;
  initializeParticles();
}

void initializeParticles() {
  for (int i = 0; i < numberOfParticles; i++) {
    particles[i] = new Particle();
    particles[i].x = random(width);
    particles[i].y = random(height);
    assignPaint(particles[i]);
  }
}

// Fresh paint: one of four colors depending on which quadrant the particle is in
void assignPaint(Particle p) {
  int quadrant = (p.x < width / 2 ? 0 : 1) + (p.y < height / 2 ? 0 : 2);
  p.r = paintPalette[quadrant][0];
  p.g = paintPalette[quadrant][1];
  p.b = paintPalette[quadrant][2];
}

void draw() {
  updateMouseInteraction();
  clearCanvas();
  double timeStep = 1.0 / frameRate;
  fluidSolver.updateSimulation(timeStep, fluidViscosity, fluidDiffusion);
  particleVelocityScale = velocityScaleFactor * 60.0 / frameRate * (1 + boostStrength * speedBoost);
  renderParticles();
  mixColors();
}

void clearCanvas() {
  noStroke();
  fill(0);
  rect(0, 0, width, height);
}

void renderParticles() {
  int gridSize = NavierStokesFluidSolver.GRID_SIZE;
  float cellHeight = height / gridSize;
  float cellWidth = width / gridSize;

  for (Particle particle : particles) {
    if (particle != null) {
      int cellX = floor(particle.x / cellWidth);
      int cellY = floor(particle.y / cellHeight);

      float velocityX = (float)fluidSolver.getVelocityX(cellX, cellY);
      float velocityY = (float)fluidSolver.getVelocityY(cellX, cellY);

      float localX = particle.x - cellX * cellWidth - cellWidth / 2;
      float localY = particle.y - cellY * cellHeight - cellHeight / 2;

      int neighborX, neighborY, xDirection, yDirection;
      if (localX > 0) {
        neighborX = Math.min(gridSize, cellX + 1);
        xDirection = 1;
      } else {
        neighborX = Math.max(0, cellX - 1);
        xDirection = -1;
      }
      if (localY > 0) {
        neighborY = Math.min(gridSize, cellY + 1);
        yDirection = 1;
      } else {
        neighborY = Math.max(0, cellY - 1);
        yDirection = -1;
      }

      float vxNx = (float)fluidSolver.getVelocityX(neighborX, cellY);
      float vxNy = (float)fluidSolver.getVelocityX(cellX, neighborY);
      float vxNxy = (float)fluidSolver.getVelocityX(neighborX, neighborY);
      float vyNx = (float)fluidSolver.getVelocityY(neighborX, cellY);
      float vyNy = (float)fluidSolver.getVelocityY(cellX, neighborY);
      float vyNxy = (float)fluidSolver.getVelocityY(neighborX, neighborY);

      velocityX = lerp(
        lerp(velocityX, vxNx, xDirection * localX / cellWidth),
        lerp(vxNy, vxNxy, xDirection * localX / cellWidth),
        yDirection * localY / cellHeight
      );
      velocityY = lerp(
        lerp(velocityY, vyNx, xDirection * localX / cellWidth),
        lerp(vyNy, vyNxy, xDirection * localX / cellWidth),
        yDirection * localY / cellHeight
      );

      particle.x += velocityX * particleVelocityScale;
      particle.y += velocityY * particleVelocityScale;

      if (particle.x < 0 || particle.x >= width) {
        particle.x = random(width);
        assignPaint(particle);
      }
      if (particle.y < 0 || particle.y >= height) {
        particle.y = random(height);
        assignPaint(particle);
      }

      set((int)particle.x, (int)particle.y, color(particle.r, particle.g, particle.b));
    }
  }
}

// Blend each particle's color toward the average color of the particles around it,
// so colors smear into each other as the flow carries them together.
void mixColors() {
  int cells = MIX_COLS * MIX_ROWS;
  for (int i = 0; i < cells; i++) {
    mixR[i] = 0;
    mixG[i] = 0;
    mixB[i] = 0;
    mixCount[i] = 0;
  }

  for (Particle p : particles) {
    int c = constrain((int)(p.x / width * MIX_COLS), 0, MIX_COLS - 1);
    int r = constrain((int)(p.y / height * MIX_ROWS), 0, MIX_ROWS - 1);
    int idx = r * MIX_COLS + c;
    mixR[idx] += p.r;
    mixG[idx] += p.g;
    mixB[idx] += p.b;
    mixCount[idx]++;
  }

  for (Particle p : particles) {
    int c = constrain((int)(p.x / width * MIX_COLS), 0, MIX_COLS - 1);
    int r = constrain((int)(p.y / height * MIX_ROWS), 0, MIX_ROWS - 1);
    int idx = r * MIX_COLS + c;
    int n = mixCount[idx];
    p.r = lerp(p.r, mixR[idx] / n, mixAmount);
    p.g = lerp(p.g, mixG[idx] / n, mixAmount);
    p.b = lerp(p.b, mixB[idx] / n, mixAmount);
  }
}

void updateMouseInteraction() {
  // 使用局部变量避免修改系统 mouseX/mouseY
  float mx = mouseX;
  float my = mouseY;
  mx = max(1, mx);
  my = max(1, my);

  int gridSize = NavierStokesFluidSolver.GRID_SIZE;
  float cellHeight = height / gridSize;
  float cellWidth = width / gridSize;

  float mouseVelocityX = mx - previousMouseX;
  float mouseVelocityY = my - previousMouseY;

  // 限制速度避免极端值
  float speed = sqrt(mouseVelocityX*mouseVelocityX + mouseVelocityY*mouseVelocityY);
  if (speed > maxMouseVelocity) {
    mouseVelocityX = (mouseVelocityX / speed) * maxMouseVelocity;
    mouseVelocityY = (mouseVelocityY / speed) * maxMouseVelocity;
  }

  // dots speed up while the mouse moves, then ease back to calm
  speedBoost = max(speedBoost * boostDecay, min(1, speed / maxMouseVelocity));

  int cellX = floor(mx / cellWidth);
  int cellY = floor(my / cellHeight);
  fluidSolver.applyForce(cellX, cellY, mouseVelocityX, mouseVelocityY);

  previousMouseX = mx;
  previousMouseY = my;
}

class Particle {
  float x, y;
  float r, g, b;
}

// ============================================================
// 流体求解器 (Grid Resolution: 16×16)
// ============================================================
class NavierStokesFluidSolver {
  static final int GRID_SIZE = 16;
  private static final int SIZE = GRID_SIZE + 2; // 包含边界
  private double[][] u = new double[SIZE][SIZE]; // x方向速度
  private double[][] v = new double[SIZE][SIZE]; // y方向速度
  private double[][] uPrev = new double[SIZE][SIZE];
  private double[][] vPrev = new double[SIZE][SIZE];
  private double[][] fu = new double[SIZE][SIZE]; // 外力累加
  private double[][] fv = new double[SIZE][SIZE];

  // 获取速度（边界检查）
  double getVelocityX(int i, int j) {
    i = constrainIndex(i);
    j = constrainIndex(j);
    return u[i][j];
  }
  double getVelocityY(int i, int j) {
    i = constrainIndex(i);
    j = constrainIndex(j);
    return v[i][j];
  }

  private int constrainIndex(int idx) {
    if (idx < 0) return 0;
    if (idx >= GRID_SIZE) return GRID_SIZE - 1;
    return idx;
  }

  // 施加外力（累加）
  void applyForce(int cellX, int cellY, double fx, double fy) {
    if (cellX < 0 || cellX >= GRID_SIZE || cellY < 0 || cellY >= GRID_SIZE) return;
    int i = cellX + 1; // 偏移到含边界数组
    int j = cellY + 1;
    fu[i][j] += fx;
    fv[i][j] += fy;
  }

  // 更新模拟
  void updateSimulation(double dt, double viscosity, double diffusion) {
    int N = GRID_SIZE;
    int iter = 10; // 迭代次数

    // 1. 应用外力并更新速度
    for (int i = 1; i <= N; i++) {
      for (int j = 1; j <= N; j++) {
        u[i][j] += dt * fu[i][j];
        v[i][j] += dt * fv[i][j];
        fu[i][j] = 0;
        fv[i][j] = 0;
      }
    }

    // 2. 交换数组（用于平流和扩散）
    swapUV();

    // 3. 扩散 (隐式)
    diffuse(1, u, uPrev, viscosity, dt, iter);
    diffuse(2, v, vPrev, viscosity, dt, iter);

    // 4. 平流 (半拉格朗日)
    advect(1, u, uPrev, u, v, dt);
    advect(2, v, vPrev, u, v, dt);

    // 5. 投影 (使速度场无散)
    project(u, v, uPrev, vPrev, iter);
  }

  private void swapUV() {
    double[][] tmp = uPrev; uPrev = u; u = tmp;
    tmp = vPrev; vPrev = v; v = tmp;
  }

  // ---- 扩散 ----
  private void diffuse(int b, double[][] x, double[][] x0, double diff, double dt, int iter) {
    int N = GRID_SIZE;
    double a = dt * diff * N * N;
    for (int k = 0; k < iter; k++) {
      for (int i = 1; i <= N; i++) {
        for (int j = 1; j <= N; j++) {
          x[i][j] = (x0[i][j] + a * (x[i-1][j] + x[i+1][j] + x[i][j-1] + x[i][j+1])) / (1 + 4*a);
        }
      }
      setBoundary(b, x);
    }
  }

  // ---- 平流 ----
  private void advect(int b, double[][] d, double[][] d0, double[][] u, double[][] v, double dt) {
    int N = GRID_SIZE;
    double dt0 = dt * N;
    for (int i = 1; i <= N; i++) {
      for (int j = 1; j <= N; j++) {
        double x = i - dt0 * u[i][j];
        double y = j - dt0 * v[i][j];
        if (x < 0.5) x = 0.5;
        if (x > N + 0.5) x = N + 0.5;
        if (y < 0.5) y = 0.5;
        if (y > N + 0.5) y = N + 0.5;
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

  // ---- 投影 ----
  private void project(double[][] u, double[][] v, double[][] p, double[][] div, int iter) {
    int N = GRID_SIZE;
    for (int i = 1; i <= N; i++) {
      for (int j = 1; j <= N; j++) {
        div[i][j] = -0.5 * ((u[i+1][j] - u[i-1][j]) + (v[i][j+1] - v[i][j-1])) / N;
        p[i][j] = 0;
      }
    }
    setBoundary(0, div);
    setBoundary(0, p);

    for (int k = 0; k < iter; k++) {
      for (int i = 1; i <= N; i++) {
        for (int j = 1; j <= N; j++) {
          p[i][j] = (div[i][j] + p[i-1][j] + p[i+1][j] + p[i][j-1] + p[i][j+1]) / 4;
        }
      }
      setBoundary(0, p);
    }

    for (int i = 1; i <= N; i++) {
      for (int j = 1; j <= N; j++) {
        u[i][j] -= 0.5 * N * (p[i+1][j] - p[i-1][j]);
        v[i][j] -= 0.5 * N * (p[i][j+1] - p[i][j-1]);
      }
    }
    setBoundary(1, u);
    setBoundary(2, v);
  }

  // ---- 边界条件 ----
  private void setBoundary(int b, double[][] x) {
    int N = GRID_SIZE;
    for (int i = 1; i <= N; i++) {
      x[0][i] = (b == 1) ? -x[1][i] : x[1][i];
      x[N+1][i] = (b == 1) ? -x[N][i] : x[N][i];
      x[i][0] = (b == 2) ? -x[i][1] : x[i][1];
      x[i][N+1] = (b == 2) ? -x[i][N] : x[i][N];
    }
    x[0][0] = 0.5 * (x[1][0] + x[0][1]);
    x[0][N+1] = 0.5 * (x[1][N+1] + x[0][N]);
    x[N+1][0] = 0.5 * (x[N][0] + x[N+1][1]);
    x[N+1][N+1] = 0.5 * (x[N][N+1] + x[N+1][N]);
  }
}
