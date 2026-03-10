const fs = require('fs');
const path = require('path');

const targets = [
  {
    source: path.resolve(__dirname, '../src/features/audit/builtin-reviewers'),
    destination: path.resolve(__dirname, '../dist/features/audit/builtin-reviewers'),
  },
  {
    source: path.resolve(__dirname, '../src/features/system-design/assets'),
    destination: path.resolve(__dirname, '../dist/features/system-design/assets'),
  },
];

function copyRecursive(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

for (const target of targets) {
  copyRecursive(target.source, target.destination);
}
