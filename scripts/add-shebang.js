/* eslint-disable no-undef, @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
const shebang = '#!/usr/bin/env node\n';

const content = fs.readFileSync(cliPath, 'utf8');
if (!content.startsWith(shebang.trim())) {
  fs.writeFileSync(cliPath, shebang + content);
}
