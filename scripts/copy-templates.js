const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(__dirname, '../src/templates');
const destDir = path.resolve(__dirname, '../dist/templates');

function copyRecursive(source, dest) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(dest, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

copyRecursive(sourceDir, destDir);
