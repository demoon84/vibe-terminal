const { spawnSync } = require("node:child_process");

function runAudit() {
  const registry =
    String(process.env.AUDIT_REGISTRY || process.env.NPM_PUBLIC_REGISTRY || "").trim()
    || "https://registry.npmjs.org";

  const args = [
    "audit",
    "--omit=dev",
    "--json",
    "--audit-level=high",
    "--registry",
    registry,
  ];
  return spawnSync("npm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      npm_config_registry: registry,
    },
  });
}

function parseAuditJson(stdout, stderr) {
  const text = String(stdout || "").trim() || String(stderr || "").trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function getHighOrCriticalCount(auditJson) {
  if (!auditJson || typeof auditJson !== "object") {
    return null;
  }

  const vulns = auditJson.metadata?.vulnerabilities;
  if (!vulns || typeof vulns !== "object") {
    return null;
  }

  const high = Number(vulns.high) || 0;
  const critical = Number(vulns.critical) || 0;
  return high + critical;
}

function main() {
  const result = runAudit();
  const auditJson = parseAuditJson(result.stdout, result.stderr);
  const highOrCriticalCount = getHighOrCriticalCount(auditJson);

  if (highOrCriticalCount === null) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    // eslint-disable-next-line no-console
    console.error("dependency audit failed: unable to parse npm audit output");
    if (stderr) {
      // eslint-disable-next-line no-console
      console.error(stderr);
    } else if (stdout) {
      // eslint-disable-next-line no-console
      console.error(stdout);
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: highOrCriticalCount === 0,
        highOrCritical: highOrCriticalCount,
        vulnerabilities: auditJson.metadata?.vulnerabilities || {},
      },
      null,
      2,
    ),
  );

  if (highOrCriticalCount > 0) {
    process.exit(1);
  }
}

main();
