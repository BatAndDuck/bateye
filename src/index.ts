#!/usr/bin/env node
import { createCLI } from './cli/index';

const program = createCLI();
program.parse(process.argv);
