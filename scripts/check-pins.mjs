import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];
const GLOB = /[*?{[]/;

function checkOverrides(node, path, file, out) {
  for (const [key, value] of Object.entries(node)) {
    const where = `${path}.${key}`;
    if (typeof value === "string") {
      if (!EXACT.test(value)) out.push(`${file}: ${where} has non-exact range "${value}"`);
    } else if (value !== null && typeof value === "object") {
      checkOverrides(value, where, file, out);
    } else {
      out.push(`${file}: ${where} has an unsupported value`);
    }
  }
}

export function findViolations(root) {
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const violations = [];
  const workspaces = rootPkg.workspaces ?? [];
  // Unsupported forms must fail loudly, otherwise nothing gets checked.
  if (!Array.isArray(workspaces)) {
    violations.push("package.json: workspaces must be a plain array of directories, the object form is not supported");
  }
  const dirs = ["."];
  for (const w of Array.isArray(workspaces) ? workspaces : []) {
    if (typeof w !== "string" || GLOB.test(w)) {
      violations.push(`package.json: workspace entry ${JSON.stringify(w)} must be a literal directory, globs are not supported`);
    } else if (!existsSync(join(root, w, "package.json"))) {
      violations.push(`package.json: workspace "${w}" has no package.json`);
    } else {
      dirs.push(w);
    }
  }
  for (const dir of dirs) {
    const file = join(dir, "package.json");
    const pkg = JSON.parse(readFileSync(join(root, file), "utf8"));
    for (const field of FIELDS) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (!EXACT.test(range)) violations.push(`${file}: ${field}.${name} has non-exact range "${range}"`);
      }
    }
  }
  checkOverrides(rootPkg.overrides ?? {}, "overrides", "package.json", violations);
  return violations;
}

const self = realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === self) {
  const root = resolve(process.argv[2] ?? join(self, "../.."));
  const violations = findViolations(root);
  for (const v of violations) console.error(v);
  process.exit(violations.length > 0 ? 1 : 0);
}
