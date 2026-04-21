#!/usr/bin/env node
import "dotenv/config";
import { program } from "../src/cli/index.js";
program.parse(process.argv);
