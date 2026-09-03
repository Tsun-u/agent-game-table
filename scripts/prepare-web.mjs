import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../node_modules/lottie-web/build/player/lottie_light.min.js", import.meta.url));
const destination = fileURLToPath(new URL("../web/vendor/lottie-light.min.js", import.meta.url));

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
