// Zcode-Pro 桌面安装包：本地构建 + 推送 GitHub Release 一键脚本
//
// 用法：
//   pnpm release:desktop                # 构建安装包并创建 Draft Release
//   pnpm release:desktop -- --skip-build # 跳过构建，只上传 packages/desktop/dist 里现成的 exe
//   pnpm release:desktop -- --tag pro-v3.15.1-beta.1   # 自定义 tag（默认 pro-v<version>）
//
// 前置（一次性）：
//   winget install --id GitHub.cli      # 安装 GitHub 官方 CLI
//   gh auth login                       # 浏览器登录授权（Release 上传走 HTTP API，SSH key 不覆盖这步）
//
// 为什么用 Release 而不是把 exe 提交进 git 仓库：GitHub 硬性拒绝 >100MB 的普通文件，
// Electron 安装包必然超限；Release 附件不受此限制，且不膨胀 clone 体积。
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./spawn-command.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const tagOverrideIndex = args.indexOf("--tag");
const tagOverride = tagOverrideIndex >= 0 ? args[tagOverrideIndex + 1] : undefined;

async function main() {
  const { version } = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
  const tag = tagOverride ?? `pro-v${version}`;

  // gh 不可用时提前失败，避免白构建 20 分钟。
  try {
    runCommand("gh", ["--version"], { stdio: "ignore", shell: true });
  } catch {
    console.error(
      [
        "[release] 未找到 gh CLI。安装后重试：",
        "  winget install --id GitHub.cli",
        "  gh auth login",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  if (!skipBuild) {
    console.log(`[release] 构建安装包（version=${version}）…`);
    // ZCODE_ENV=production 不能省：缺省会落成 ZCode Preview 身份 + 测试后端配置。
    // bundle 一条命令自带 prepare:runtime-assets + 编译 + electron-builder 打包 + 三道质检，
    // 产物直接落 packages/desktop/dist/（build 只到编译层，不产安装器）。
    runCommand("pnpm", ["--dir", "packages/desktop", "bundle", "win", "x64"], {
      cwd: repoRoot,
      env: { ...process.env, ZCODE_ENV: "production" },
    });
  }

  const distDir = resolve(repoRoot, "packages", "desktop", "dist");
  // 文件名带 Zcode-Pro 前缀（electron-builder.config.js win.artifactName 覆写），
  // 与官方产物区分；安装身份不变。
  const expected = `Zcode-Pro-${version}-win-x64.exe`;
  const candidates = existsSync(distDir)
    ? readdirSync(distDir).filter((name) => name.endsWith(".exe"))
    : [];
  const exeName = candidates.includes(expected)
    ? expected
    : candidates.sort((a, b) => b.localeCompare(a))[0];
  if (!exeName) {
    console.error(`[release] ${distDir} 下没有安装包（先去掉 --skip-build 完整跑一次）。`);
    process.exitCode = 1;
    return;
  }
  const exePath = resolve(distDir, exeName);
  console.log(`[release] 安装包：${exeName}`);

  // tag 已存在就复用（gh release create 需要远端已有 tag，或用 --target；这里显式推）。
  runCommand("git", ["tag", "-f", tag], { cwd: repoRoot });
  runCommand("git", ["push", "-f", "origin", tag], { cwd: repoRoot });

  // -R 必须显式指定：本地存在 upstream 远程时 gh 会把仓库解析到 zai-org/ZCode，
  // Release 会建到官方仓库去（或因无权限失败）。
  console.log(`[release] 创建 Draft Release ${tag} 并上传安装包…`);
  runCommand(
    "gh",
    [
      "release",
      "create",
      "-R",
      "nickshui/zcode-pro",
      tag,
      exePath,
      "--draft",
      "--generate-notes",
      "-t",
      `Zcode-Pro ${tag}`,
    ],
    { cwd: repoRoot },
  );
  console.log(`[release] 完成：https://github.com/nickshui/zcode-pro/releases（Draft 待发布）`);
}

await main();
