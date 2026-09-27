import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";

const CP = path.join(
    "E:", "Cache", "temp", "opencode",
    "cmdtest", ".gradle", "loom-cache",
    "minecraftMaven", "net", "minecraft",
    "minecraft-merged-076ee84b74",
    "1.20.1-net.fabricmc.yarn.1_20_1.1.20.1+build.1-v2",
    "minecraft-merged-076ee84b74-1.20.1-net.fabricmc.yarn.1_20_1.1.20.1+build.1-v2.jar"
);

async function main() {
    const r = await spawn("javap", ["-p", "-c", "-cp", CP, "net.minecraft.util.ActionResult"], {
        stdio: ["ignore", "pipe", "pipe"]
    });
    let cur = "";
    for await (const line of r.stdout) {
        const s = line.toString().trim();
        if (s.includes("boolean isAccepted") || s.includes("public net.minecraft.util.ActionResult consume")) {
            console.log("###", s.slice(0, 120));
            return;
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

export {};