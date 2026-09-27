import * as fs from "node:fs/promises";
import * as path from "node:path";

const LOG = path.join("E:", "Cache", "temp", "opencode", "gametest", "server", "gametest.log");

async function main() {
    const t = await fs.readFile(LOG, "utf8");
    const lines = t.split("\n");
    console.log("total:", lines.length);
    for (const ln of lines) {
        const low = ln.toLowerCase();
        if (low.includes("mixintext-handler") || low.includes("interactblock") || low.includes("place_failed")
            || low.includes("mixintest place") || low.includes("changed the block at 10")) {
            console.log(ln.slice(0, 200));
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

export {};