import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const style = document.createElement("style");
style.textContent = readFileSync(resolve("src/styles.css"), "utf8");
document.head.append(style);
afterEach(cleanup);
