#!/usr/bin/env node
import { runOpenClawCommand } from "./openclaw-wrapper.js";

process.exitCode = await runOpenClawCommand(process.argv.slice(2));
