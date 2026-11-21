import { defineConfig, devices } from "@playwright/test";

/**
 * Specs whose result can differ between viewports.
 *
 * The mobile projects run only these. Room lifecycle, reconnect grace, and
 * winner agreement are decided by the server and are the same at every
 * viewport, so running those specs three times bought three identical results
 * for three times the wall clock. The desktop project still runs everything.
 */
const VIEWPORT_SENSITIVE =
  /(?:art-acceptance|dawn-refraction|mobile-controls|aquarian-beauty|aquarian-evidence|overhaul-2-evidence|connect-screen|shell-flow|character-select|select-flow|stage-ascent-evidence|survival-lava-evidence|stage-seed|select-seed-evidence|race-flow|replay-layout|replay-video-evidence|unlocks)\.spec\.ts/;

/**
 * A Chromium device running in new headless mode, which keeps the GPU. See the
 * `headless` note below. Applied per project rather than in the shared `use`,
 * because WebKit has no such channel and an `undefined` override does not
 * clear one set there.
 */
const gpuChromium = (device: string) => ({ ...devices[device], channel: "chromium", ...linuxGpu });

/**
 * On Linux, new-headless Chromium falls back to SwiftShader unless ANGLE is
 * told to use Vulkan. Measured on a Runpod RTX A4000 (driver 595.91.07,
 * 2026-11-17): no flags gave SwiftShader; these gave
 * "ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA NVIDIA RTX A4000))". Mac and Windows
 * need none (ANGLE on Metal and Direct3D 11 by default).
 */
// FLOOR_FIFTY_NO_GPU: a gate CPU pod, where Chromium draws in software and the Vulkan flags have nothing to use.
const linuxGpu =
  process.platform === "linux" && !process.env["FLOOR_FIFTY_NO_GPU"]
    ? { launchOptions: { args: ["--mute-audio", "--use-angle=vulkan", "--enable-features=Vulkan"] } }
    : {};

/**
 * The e2e server's and client's ports.
 *
 * In GitHub Actions the default pair is 4100 and 4173, unless the overrides
 * below set another (a gate pod sharing its GPU between pieces). On the Mac several
 * worktrees can run Playwright at once (with or without `CI=1`), and with
 * fixed ports the second run either failed on a busy port or, reusing the
 * first one's server, silently tested the other worktree's build. So each
 * checkout takes a pair derived from its own path, and reuses a running
 * server only when asked to (`FLOOR_FIFTY_E2E_REUSE=1`, for a server you
 * started yourself on those ports). `FLOOR_FIFTY_E2E_SERVER_PORT` and
 * `FLOOR_FIFTY_E2E_CLIENT_PORT` override the pair.
 */
const e2ePorts = (): { server: number; client: number } => {
  const env = process.env;
  // A gate pod runs up to three pieces at once, and its start script gives each
  // runner its own pair through the two overrides, so they win here too.
  if (env["GITHUB_ACTIONS"]) {
    return {
      server: Number(env["FLOOR_FIFTY_E2E_SERVER_PORT"] ?? 4100),
      client: Number(env["FLOOR_FIFTY_E2E_CLIENT_PORT"] ?? 4173),
    };
  }
  let hash = 0;
  for (const char of import.meta.dirname) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const slot = hash % 100;
  return {
    server: Number(env["FLOOR_FIFTY_E2E_SERVER_PORT"] ?? 4400 + slot),
    client: Number(env["FLOOR_FIFTY_E2E_CLIENT_PORT"] ?? 4500 + slot),
  };
};
const PORTS = e2ePorts();
const REUSE = !process.env["CI"] && process.env["FLOOR_FIFTY_E2E_REUSE"] === "1";
// Read by the npm scripts the web servers start, and by the specs'
// server-fixture.ts. The config is evaluated again in every worker, so they
// see the same values.
process.env["E2E_SERVER_PORT"] = String(PORTS.server);
process.env["E2E_CLIENT_PORT"] = String(PORTS.client);
process.env["FLOOR_FIFTY_SERVER_URL"] ??= `http://127.0.0.1:${PORTS.server}`;

// One desktop project plus the two mobile orientations the spec requires
// evidence for. Every project drives the same built client against a real
// server; none of them stub the transport.
export default defineConfig({
  testDir: "tests/e2e",
  // Tests are isolated by the room code the server issues, so two specs never
  // touch the same room. The one shared resource is the server process, and the
  // only thing that occupies it for any length of time is the test driver,
  // which finishes a race in well under a tenth of a second.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Each test drives up to four WebGL clients at once, so the ceiling is memory
  // and GPU contention rather than cores.
  workers: process.env.CI ? 2 : 4,
  // Raised from the 30s default because running four-wide roughly doubles how
  // long any one test takes: the work is the same, but it now shares a machine
  // with three other races. The heaviest specs open four clients and measured
  // 84s against `test.slow()`'s old 90s ceiling, which is a flake waiting to
  // happen rather than a budget.
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORTS.client}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Headless, but Chromium's new headless mode (`gpuChromium` below), not
    // Playwright's default headless shell. Every spec here drives a WebGL
    // client, and the headless shell has no GPU: it rasterises through
    // SwiftShader and did not reach the splash within 60s. New headless runs
    // the full browser without a window and keeps the GPU (ANGLE on Metal on
    // a Mac), so the suite no longer takes over the screen. Measured on an M1,
    // time for a client to reach the title:
    //
    //            headless shell    headed (GPU)    new headless (GPU)
    //   1 client     > 60s             3.5s              2.0s
    //   4 clients      --           5.3s - 6.0s       4.0s - 4.5s
    //
    // Never fall back to the headless shell: the suite cannot pass a 20s
    // screen wait on SwiftShader, and raising the timeout would only make it
    // slow rather than correct. Two further reasons it has to be the GPU and
    // not a longer clock: the art-acceptance
    // screenshots are the evidence this project's art direction is judged on,
    // and a software rasteriser is not obliged to produce what a GPU produces
    // from the same shader; and the frame-budget probe is meaningless without
    // one, which is why it measured ~480ms a frame for a chain that runs at
    // 16.6ms.
    //
    // A runner therefore needs a GPU, though no longer a display. Without a
    // GPU the frame-budget spec fails its median guard, which is the correct
    // outcome rather than a flake to tune away.
    //
    // CI runs the GPU specs on Runpod GPU pods (`tools/ci/plan.ts`), where
    // Chromium needs the Vulkan flags in `linuxGpu` above, and
    // `gpu-guard.spec.ts` fails first and by name if a runner ever falls back
    // to software.
    headless: true,
    // Every client reports a preference for reduced motion, which makes the
    // art baselines deterministic.
    //
    // The chrome rises in on a GSAP tween, and a screenshot taken while one is
    // running catches a panel at part opacity: the first run under this config
    // stamped a ready room you could see the city through. Waiting a fixed
    // time for the tween instead would trade a wrong screenshot for a flaky
    // one.
    //
    // `ui/motion.ts` honours the preference by placing the element at its final
    // state with no tween, so this captures exactly what the animation settles
    // to. The animated path itself is covered in `tests/client/features/kit/motion.test.ts`,
    // where it can be asserted rather than photographed.
    reducedMotion: "reduce",
    // A headless browser still plays the race's song through the machine's
    // speakers. Chromium's flag silences the output only: the Web Audio graph
    // still runs, so audio state and leak checks see what a player's would.
    launchOptions: { args: ["--mute-audio"] },
  },
  // A real client against a real server. The only thing the tests reach past
  // the interface for is the room driver, which feeds valid inputs into the
  // same simulation a keypress reaches.
  webServer: [
    {
      command: "pnpm e2e:server",
      url: `http://127.0.0.1:${PORTS.server}/health`,
      reuseExistingServer: REUSE,
      timeout: 60_000,
    },
    {
      command: "pnpm e2e:client",
      url: `http://127.0.0.1:${PORTS.client}`,
      reuseExistingServer: REUSE,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: "desktop",
      use: { ...gpuChromium("Desktop Chrome"), viewport: { width: 1280, height: 720 } },
      // The frame budget is measured by its own project, alone. See below. The
      // responsive sweep and its evidence build a context per viewport, so they
      // run once, in `responsive`, rather than at this project's size.
      testIgnore: /(?:frame-budget|perf-probe|perf-profile|shader-bench|responsive-layout|screen-catalogue|story-evidence|languages|visual-audit|screens-walk(?:-check)?)\.spec\.ts/,
    },
    /**
     * The controller journeys again in WebKit, because players with a pad on
     * a Mac use Safari. Playwright's WebKit is not Safari -- it cannot show
     * what macOS does with a controller -- but it runs the same engine's
     * focus, fullscreen and Gamepad API paths. Chromium's mute flag does not
     * exist here, so the launch args are cleared.
     */
    {
      name: "webkit-gamepad",
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 720 }, launchOptions: { args: [] } },
      testMatch: /gamepad\.spec\.ts/,
    },
    /**
     * The replay's re-simulation in a second engine (race-options spec §7.4):
     * the race must reproduce in WebKit's JavaScript as it does in V8's, and
     * the replay spec's "no drift notice" is that check.
     */
    {
      name: "webkit-replay",
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 720 }, launchOptions: { args: [] } },
      testMatch: /replay\.spec\.ts/,
    },
    /**
     * The frame budget, measured with the machine to itself.
     *
     * Run by `pnpm test:e2e:budget` rather than by the default suite, and with
     * one worker. Under the four-wide default it measured a p95 of 46.1ms
     * against a 33.4ms budget; run alone on the same machine and the same
     * build, 17.9ms. The first number is three other WebGL clients competing
     * for the GPU, not the filter chain, and a budget that reports contention
     * is not a budget.
     *
     * The owner relaxed regression ceilings to 50ms for gameplay/menu and
     * 66.7ms for the brief wipe (2026-10-12). Isolation still matters: these
     * limits allow runner cadence variance, not competition from other tests.
     */
    {
      name: "frame-budget",
      use: { ...gpuChromium("Desktop Chrome"), viewport: { width: 1280, height: 720 } },
      testMatch: /frame-budget\.spec\.ts/,
    },
    /**
     * The same measurement at the two mobile viewports.
     *
     * The spec asks for the budget at 390x844 and 844x390 as well as on the
     * desktop, because the scenery now runs through a bounded target whose
     * fitted size depends on the viewport's shape -- a tall phone rasterises a
     * different number of pixels from the same chain, and a pass that fits the
     * desktop budget is not evidence about a phone. Separate projects rather
     * than three runs of one, so a failure names the orientation it failed at.
     */
    {
      name: "frame-budget-portrait",
      use: {
        ...gpuChromium("Pixel 7"),
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
      testMatch: /frame-budget\.spec\.ts/,
    },
    {
      name: "frame-budget-landscape",
      use: {
        ...gpuChromium("Pixel 7"),
        viewport: { width: 844, height: 390 },
        hasTouch: true,
        isMobile: true,
      },
      testMatch: /frame-budget\.spec\.ts/,
    },
    {
      name: "mobile-portrait",
      use: {
        ...gpuChromium("Pixel 7"),
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
      // The smoke set's phone (`smoke.spec.ts`); the desktop project runs it too.
      testMatch: [VIEWPORT_SENSITIVE, /smoke\.spec\.ts/],
    },
    {
      name: "mobile-landscape",
      use: {
        ...gpuChromium("Pixel 7"),
        viewport: { width: 844, height: 390 },
        hasTouch: true,
        isMobile: true,
      },
      testMatch: VIEWPORT_SENSITIVE,
    },
    /**
     * The layout sweep (responsive parity spec §9.1). One project, because the
     * spec builds a context per reference viewport itself: its whole point is
     * the viewport, so a project per size would be fourteen projects.
     */
    {
      name: "responsive",
      use: { ...gpuChromium("Desktop Chrome") },
      testMatch: /(?:responsive-layout|screen-catalogue|story-evidence|languages|visual-audit)\.spec\.ts/,
    },
    /**
     * What a frame costs (`perf-probe.spec.ts`): CPU, GPU, draw calls,
     * passes and heap, per scenario. A measurement rather than a gate, run on
     * request with one worker and never in a suite.
     */
    {
      name: "perf-probe",
      use: {
        ...gpuChromium("Desktop Chrome"),
        viewport: { width: 1280, height: 720 },
        launchOptions: { args: ["--mute-audio", "--enable-precise-memory-info"] },
      },
      testMatch: /(?:perf-probe|perf-profile|shader-bench)\.spec\.ts/,
    },
    /**
     * The screens walk (`screens-walk.spec.ts`): every screen on every view,
     * photographed for the visual audit's board. A capture, not a check, and
     * never a part of any suite: the gate's `screens` job runs it for a draft
     * that commits `tests/e2e/look.json` (`pnpm screens:look`). It builds a
     * context per view itself, so the project's own viewport is not used.
     *
     * One attempt: a retry would repeat a view's whole walk, and its notes
     * already say what failed. The check that follows it (`teardown`) fails
     * the run if any screen a view needs is missing.
     */
    {
      name: "screens-walk",
      use: { ...gpuChromium("Desktop Chrome"), trace: "off", screenshot: "off" },
      testMatch: /screens-walk\.spec\.ts/,
      retries: 0,
      teardown: "screens-walk-check",
    },
    {
      name: "screens-walk-check",
      testMatch: /screens-walk-check\.spec\.ts/,
    },
    {
      name: "tablet-portrait",
      use: {
        ...gpuChromium("Pixel 7"),
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: true,
      },
      testMatch: VIEWPORT_SENSITIVE,
    },
    {
      name: "frame-budget-tablet",
      use: {
        ...gpuChromium("Pixel 7"),
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: true,
      },
      testMatch: /frame-budget\.spec\.ts/,
    },
  ],
});
