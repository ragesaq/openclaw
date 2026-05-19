#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const PACKAGE_DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];
const WORKSPACE_DEPENDENCY_SECTIONS = ["overrides"];
const EXACT_SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const EXACT_NPM_ALIAS_PATTERN =
  /^npm:(?:@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const PINNED_GIT_PATTERN = /(?:#|\/commit\/)[0-9a-f]{40}$/iu;
const LOCKFILE_PATHS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
const BLOCKED_DEPENDENCY_RULES = [
  { pattern: /^@antv\//u, reason: "Mini Shai-Hulud AntV/atool wave, 2026-05-19" },
  { pattern: /^@lint-md\//u, reason: "Mini Shai-Hulud atool wave, 2026-05-19" },
  { pattern: /^@openclaw-cn\//u, reason: "Mini Shai-Hulud atool wave, 2026-05-19" },
  { pattern: /^@starmind\//u, reason: "Mini Shai-Hulud atool wave, 2026-05-19" },
  { pattern: /^echarts-for-react$/u, reason: "Mini Shai-Hulud atool wave, 2026-05-19" },
  { pattern: /^timeago\.js$/u, reason: "Mini Shai-Hulud atool wave, 2026-05-19" },
  { pattern: /^size-sensor$/u, reason: "Mini Shai-Hulud atool wave, 2026-05-19" },
  { pattern: /^canvas-nest\.js$/u, reason: "Mini Shai-Hulud atool wave, 2026-05-19" },
  { pattern: /^jest-canvas-mock$/u, reason: "Mini Shai-Hulud atool wave, 2026-05-19" },
  { pattern: /^jest-date-mock$/u, reason: "Mini Shai-Hulud atool wave, 2026-05-19" },
];
const BLOCKED_PACKAGE_VERSIONS = new Map([
  ["@mistralai/mistralai", new Set(["2.2.2", "2.2.3"])],
  ["@mistralai/mistralai-azure", new Set(["1.7.1", "1.7.2", "1.7.3"])],
  ["@mistralai/mistralai-gcp", new Set(["1.7.1", "1.7.2", "1.7.3"])],
  ["@opensearch-project/opensearch", new Set(["3.5.3", "3.6.2", "3.7.0", "3.8.0"])],
  ["intercom-client", new Set(["7.0.4", "7.0.5"])],
  ["mbt", new Set(["1.2.48"])],
  ["@cap-js/db-service", new Set(["2.10.1"])],
  ["@cap-js/postgres", new Set(["2.2.2"])],
  ["@cap-js/sqlite", new Set(["2.2.2"])],
]);

function listTrackedPackageJsonFiles(cwd) {
  return execFileSync("git", ["ls-files", "-z", "--", "*package.json"], {
    cwd,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .toSorted((left, right) => left.localeCompare(right));
}

function listTrackedFiles(cwd, patterns) {
  return execFileSync("git", ["ls-files", "-z", "--", ...patterns], {
    cwd,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .toSorted((left, right) => left.localeCompare(right));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTrackedJson(cwd, relativePath) {
  const filePath = path.join(cwd, relativePath);
  if (fs.existsSync(filePath)) {
    return readJson(filePath);
  }
  return JSON.parse(
    execFileSync("git", ["show", `:${relativePath}`], {
      cwd,
      encoding: "utf8",
    }),
  );
}

function isAllowedPinnedSpec(spec) {
  if (typeof spec !== "string") {
    return false;
  }
  if (EXACT_SEMVER_PATTERN.test(spec) || EXACT_NPM_ALIAS_PATTERN.test(spec)) {
    return true;
  }
  if (spec === "workspace:*" || spec.startsWith("file:") || spec.startsWith("link:")) {
    return true;
  }
  if (/^(?:git\+|github:|gitlab:|bitbucket:)/u.test(spec)) {
    return PINNED_GIT_PATTERN.test(spec);
  }
  return false;
}

function getBlockedPackageReason(name) {
  for (const rule of BLOCKED_DEPENDENCY_RULES) {
    if (rule.pattern.test(name)) {
      return rule.reason;
    }
  }
  return null;
}

function getBlockedVersionReason(name, version) {
  if (!version) {
    return null;
  }
  return BLOCKED_PACKAGE_VERSIONS.get(name)?.has(version)
    ? "known malicious Mini Shai-Hulud package version"
    : null;
}

function collectPackageJsonViolations(cwd) {
  const violations = [];
  for (const relativePath of listTrackedPackageJsonFiles(cwd)) {
    const packageJson = readTrackedJson(cwd, relativePath);
    for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
      for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
        if (!isAllowedPinnedSpec(spec)) {
          violations.push({ file: relativePath, section, name, spec });
        }
      }
    }
  }
  return violations;
}

function collectPackageJsonBlockedDependencyViolations(cwd) {
  const violations = [];
  for (const relativePath of listTrackedPackageJsonFiles(cwd)) {
    const packageJson = readTrackedJson(cwd, relativePath);
    for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
      for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
        const ruleReason = getBlockedPackageReason(name);
        const versionReason = getBlockedVersionReason(name, spec);
        const reason = ruleReason ?? versionReason;
        if (reason) {
          violations.push({ file: relativePath, section, name, spec, reason });
        }
      }
    }
  }
  return violations;
}

function collectDependencyMapViolations(file, section, dependencyMap, violations) {
  for (const [name, spec] of Object.entries(dependencyMap ?? {})) {
    if (!isAllowedPinnedSpec(spec)) {
      violations.push({ file, section, name, spec });
    }
  }
}

function collectWorkspaceViolations(cwd) {
  const file = "pnpm-workspace.yaml";
  const workspacePath = path.join(cwd, file);
  if (!fs.existsSync(workspacePath)) {
    return [];
  }
  const workspace = YAML.parse(fs.readFileSync(workspacePath, "utf8"));
  const violations = [];
  for (const section of WORKSPACE_DEPENDENCY_SECTIONS) {
    collectDependencyMapViolations(file, section, workspace?.[section], violations);
  }
  for (const [packageName, extension] of Object.entries(workspace?.packageExtensions ?? {})) {
    collectDependencyMapViolations(
      file,
      `packageExtensions.${packageName}.dependencies`,
      extension?.dependencies,
      violations,
    );
  }
  return violations;
}

function normalizeLockPackageName(name) {
  if (typeof name !== "string") {
    return "";
  }
  if (name.startsWith("node_modules/")) {
    return name.slice("node_modules/".length);
  }
  return name;
}

function splitPnpmLockPackageKey(key) {
  let normalized = key.replace(/^\/+/u, "");
  normalized = normalized.split("(")[0];
  const versionSeparator = normalized.lastIndexOf("@");
  if (versionSeparator <= 0) {
    return null;
  }
  return {
    name: normalized.slice(0, versionSeparator),
    version: normalized.slice(versionSeparator + 1),
  };
}

function collectLockPackageViolation(file, name, version, violations) {
  const normalizedName = normalizeLockPackageName(name);
  const ruleReason = getBlockedPackageReason(normalizedName);
  const versionReason = getBlockedVersionReason(normalizedName, version);
  const reason = ruleReason ?? versionReason;
  if (reason) {
    violations.push({
      file,
      section: "lockfile",
      name: normalizedName,
      spec: version ?? "(unknown)",
      reason,
    });
  }
}

function collectPackageLockBlockedDependencyViolations(file, lockfile, violations) {
  for (const [packagePath, metadata] of Object.entries(lockfile.packages ?? {})) {
    if (!packagePath || packagePath === "") {
      continue;
    }
    collectLockPackageViolation(file, packagePath, metadata?.version, violations);
  }
}

function collectPnpmLockBlockedDependencyViolations(file, lockfile, violations) {
  for (const packageKey of Object.keys(lockfile.packages ?? {})) {
    const parsed = splitPnpmLockPackageKey(packageKey);
    if (parsed) {
      collectLockPackageViolation(file, parsed.name, parsed.version, violations);
    }
  }
}

function collectYarnLockBlockedDependencyViolations(file, content, violations) {
  for (const line of content.split(/\r?\n/u)) {
    const match = /^"?((?:@[^/@]+\/)?[^@"\s]+)@[^"]*"?\s*:\s*$/u.exec(line);
    if (match) {
      const name = match[1];
      const reason = getBlockedPackageReason(name);
      if (reason || BLOCKED_PACKAGE_VERSIONS.has(name)) {
        violations.push({
          file,
          section: "lockfile",
          name,
          spec: "(inspect yarn.lock entry)",
          reason: reason ?? "known malicious Mini Shai-Hulud package has lockfile entry",
        });
      }
    }
  }
}

function collectLockfileBlockedDependencyViolations(cwd) {
  const violations = [];
  for (const file of listTrackedFiles(cwd, LOCKFILE_PATHS)) {
    const content = fs.existsSync(path.join(cwd, file))
      ? fs.readFileSync(path.join(cwd, file), "utf8")
      : execFileSync("git", ["show", `:${file}`], { cwd, encoding: "utf8" });
    if (file.endsWith("package-lock.json")) {
      collectPackageLockBlockedDependencyViolations(file, JSON.parse(content), violations);
    } else if (file.endsWith("pnpm-lock.yaml")) {
      collectPnpmLockBlockedDependencyViolations(file, YAML.parse(content), violations);
    } else if (file.endsWith("yarn.lock")) {
      collectYarnLockBlockedDependencyViolations(file, content, violations);
    }
  }
  return violations;
}

export function collectDependencyPinViolations(cwd = process.cwd()) {
  return [...collectPackageJsonViolations(cwd), ...collectWorkspaceViolations(cwd)];
}

export function collectBlockedDependencyViolations(cwd = process.cwd()) {
  return [
    ...collectPackageJsonBlockedDependencyViolations(cwd),
    ...collectLockfileBlockedDependencyViolations(cwd),
  ];
}

export function collectDependencyPinAudit(cwd = process.cwd()) {
  const packageJsonFiles = listTrackedPackageJsonFiles(cwd);
  let packageSpecCount = 0;
  for (const relativePath of packageJsonFiles) {
    const packageJson = readTrackedJson(cwd, relativePath);
    for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
      packageSpecCount += Object.keys(packageJson[section] ?? {}).length;
    }
  }
  const workspaceViolations = collectWorkspaceViolations(cwd);
  const violations = [...collectPackageJsonViolations(cwd), ...workspaceViolations];
  const blockedDependencyViolations = collectBlockedDependencyViolations(cwd);
  return {
    packageManifestCount: packageJsonFiles.length,
    packageSpecCount,
    violations,
    blockedDependencyViolations,
  };
}

export async function main() {
  const audit = collectDependencyPinAudit();
  const { violations, blockedDependencyViolations } = audit;
  if (violations.length === 0 && blockedDependencyViolations.length === 0) {
    process.stdout.write(
      `PASS direct dependency pin guard: checked ${audit.packageSpecCount} directly declared ` +
        `dependency specs across ${audit.packageManifestCount} tracked package manifests; ` +
        "0 pin violations; 0 blocked Mini Shai-Hulud dependencies.\n",
    );
    return;
  }

  if (violations.length > 0) {
    console.error(
      `FAIL direct dependency pin guard: ${violations.length} unpinned directly declared ` +
        "dependency specs found. Direct dependency specs must be pinned exactly outside peer " +
        "dependency contracts:",
    );
    for (const violation of violations) {
      console.error(
        `- ${violation.file}:${violation.section}:${violation.name} -> ${JSON.stringify(violation.spec)}`,
      );
    }
  }
  if (blockedDependencyViolations.length > 0) {
    console.error(
      `FAIL Mini Shai-Hulud dependency guard: ${blockedDependencyViolations.length} blocked ` +
        "dependency references found:",
    );
    for (const violation of blockedDependencyViolations) {
      console.error(
        `- ${violation.file}:${violation.section}:${violation.name} -> ` +
          `${JSON.stringify(violation.spec)} (${violation.reason})`,
      );
    }
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
