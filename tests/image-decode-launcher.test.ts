import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChildLaunch, buildChildEnv, CHILD_DATA_LIMIT_MB } from "@/lib/imageDecodeBridge";

// How the decode child is started. The launch plan is pure and tested everywhere; what the
// /bin/sh launcher does (memory limit, OOM priority, closed by default) is observed on Linux
// only, with a stand-in script (no sharp needed): CI is ubuntu, where /bin/sh is dash, and the
// production image is alpine, where it is busybox.

const workdir = mkdtempSync(join(tmpdir(), "launcher-"));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe("buildChildLaunch (pure)", () => {
  it("the data limit is 1,536 MB, about twice the peak of the heaviest legitimate file measured (710 MB)", () => {
    expect(CHILD_DATA_LIMIT_MB).toBe(1536);
  });

  it("Linux: /bin/sh, the limit in KB and the command as POSITIONAL arguments, never inside the shell text", () => {
    const hostile = "/app/scripts/x y';touch pwned;$(touch pwned2)`.mjs";
    const launch = buildChildLaunch("linux", "/usr/local/bin/node", hostile);
    expect(launch.command).toBe("/bin/sh");
    expect(launch.args.slice(0, 2)).toEqual(["-c", expect.any(String)]);
    expect(launch.args.slice(3)).toEqual([String(1536 * 1024), "/usr/local/bin/node", hostile]);
    const shellText = launch.args[1];
    expect(shellText).not.toContain("pwned");
    expect(shellText).not.toContain("/usr/local/bin/node");
    expect(shellText).toContain("ulimit -d");
    expect(shellText).toContain("ulimit -c 0");
    expect(shellText).toContain("oom_score_adj");
    expect(shellText).toContain('exec "$@"');
  });

  it("anywhere else (Windows, macOS: development) node runs directly, WITHOUT a memory bound", () => {
    for (const platform of ["win32", "darwin"] as const) {
      expect(buildChildLaunch(platform, "node", "child.mjs")).toEqual({ command: "node", args: ["child.mjs"] });
    }
  });

  it("the environment allowlist applies to both plans", () => {
    expect(Object.keys(buildChildEnv({ PATH: "/bin", AUTH_SECRET: "s" }, "linux")).sort()).toEqual(["NODE_ENV", "PATH"]);
  });
});

describe.runIf(process.platform === "linux")("[Linux] what the launcher does", () => {
  const report = join(workdir, "report.mjs");
  writeFileSync(
    report,
    `import { readFileSync } from "node:fs";
console.log(JSON.stringify({
  limits: readFileSync("/proc/self/limits", "utf8"),
  oom: readFileSync("/proc/self/oom_score_adj", "utf8").trim(),
}));`,
  );

  const run = (scriptPath: string, dataLimitMb?: number) => {
    const launch = buildChildLaunch("linux", process.execPath, scriptPath, dataLimitMb);
    return spawnSync(launch.command, launch.args, { encoding: "utf8", env: buildChildEnv(process.env, "linux") });
  };

  it("sets 'Max data size' to the limit (soft and hard) and the OOM score to 1000", () => {
    const result = run(report);
    expect(result.status).toBe(0);
    const out: { limits: string; oom: string } = JSON.parse(result.stdout);
    const line = out.limits.split("\n").find((l) => l.startsWith("Max data size"));
    const bytes = String(1536 * 1024 * 1024);
    expect(line?.split(/\s+/).slice(3, 5)).toEqual([bytes, bytes]);
    expect(out.oom).toBe("1000");
  });

  // A bomb stopped by the limit dies of SIGABRT, which writes a core file (apport on the host
  // of the VPS, ~1.5 GB each, on the disk Postgres shares) where the OOM killer wrote none.
  it("sets 'Max core file size' to 0 (soft and hard): no core file", () => {
    const result = run(report);
    const out: { limits: string } = JSON.parse(result.stdout);
    const line = out.limits.split("\n").find((l) => l.startsWith("Max core file size"));
    expect(line?.split(/\s+/).slice(4, 6)).toEqual(["0", "0"]);
  });

  it("is CLOSED by default: when ulimit fails there is no exec, the stand-in never runs, the exit code is 97 and a line is written", () => {
    const marker = join(workdir, "ran");
    const script = join(workdir, "marker.mjs");
    writeFileSync(script, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran");`);
    const result = run(script, Number.NaN);
    expect(result.status).toBe(97);
    expect(existsSync(marker)).toBe(false);
    expect(result.stderr).toContain("ulimit -d failed");
  });

  it("a path made of shell syntax is run as a path, never interpreted", () => {
    const dir = join(workdir, "a b'$(touch hacked)`;touch hacked2");
    mkdirSync(dir);
    const script = join(dir, "ok.mjs");
    writeFileSync(script, 'console.log("ran");');
    const result = run(script);
    expect(result.stdout.trim()).toBe("ran");
    expect(existsSync(join(process.cwd(), "hacked"))).toBe(false);
    expect(existsSync(join(process.cwd(), "hacked2"))).toBe(false);
    expect(existsSync(join(dir, "hacked"))).toBe(false);
  });

  it("an allocation past the limit does not succeed: the stand-in cannot go beyond it", () => {
    const hog = join(workdir, "hog.mjs");
    writeFileSync(
      hog,
      `const held = []; let total = 0;
try { for (;;) { const b = Buffer.allocUnsafeSlow(32 * 1024 * 1024); b.fill(1); held.push(b); total += b.length; } }
catch { console.log("REFUSED " + total); }`,
    );
    const result = run(hog, 256);
    // Either the allocation throws (and the script says how far it got) or the process dies: both are a bound.
    const reached = /REFUSED (\d+)/.exec(result.stdout);
    if (reached) expect(Number(reached[1])).toBeLessThan(256 * 1024 * 1024);
    else expect(result.status).not.toBe(0);
  });
});
