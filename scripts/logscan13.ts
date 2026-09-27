import * as fs from "node:fs/promises";
import * as path from "node:path";

const LOG = path.join("E:", "Cache", "temp", "opencode", "gametest", "server", "gametest.log");

async function main() {
    const t = await fs.readFile(LOG, "utf8");
    const lines = t.split("\n");
    console.log("total lines:", lines.length);
    for (const ln of lines) {
        const low = ln.toLowerCase();
        if (low.includes("mixin") && (low.includes("mod mixintest") || low.includes("mixintest.mixins")
            || low.includes("inject") || low.includes("appl"))) {
            console.log(ln.slice(0, 220));
        }
    }
    console.log("---- count check ----");
    const n = (t.match(/[Mm]ixin/g) || []).length;
    console.log("total mixin mentions:", n);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

export {};