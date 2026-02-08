// Batch remove console.log/error/warn/info/debug from src/ files
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', '.next', 'generated'].includes(entry.name)) {
      results.push(...walk(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function findStatementEnd(lines, startLine) {
  let parenCount = 0;
  for (let j = startLine; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '(') parenCount++;
      if (ch === ')') parenCount--;
    }
    if (parenCount <= 0) {
      return j;
    }
  }
  return startLine;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const result = [];
  let i = 0;
  let changed = false;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Pattern 1: standalone console.xxx(...) statement
    if (/^console\.(log|error|warn|info|debug)\(/.test(trimmed)) {
      const end = findStatementEnd(lines, i);
      changed = true;
      i = end + 1;
      continue;
    }

    // Pattern 2: .then(() => console.xxx(...)) - remove entire .then chain line
    if (/^\.(then)\(\s*\(\s*\)\s*=>\s*console\.(log|error|warn|info|debug)\(/.test(trimmed)) {
      const end = findStatementEnd(lines, i);
      changed = true;
      i = end + 1;
      continue;
    }

    // Pattern 3: .then(() => { console.xxx(...) }) or similar - need special handling
    // We'll handle these manually

    result.push(lines[i]);
    i++;
  }

  if (changed) {
    // Clean up triple+ blank lines
    const cleaned = result.join('\n').replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(filePath, cleaned, 'utf8');
  }
  return changed;
}

const srcDir = path.join(process.cwd(), 'src');
const files = walk(srcDir);
let totalModified = 0;

for (const file of files) {
  if (processFile(file)) {
    totalModified++;
    console.log('Modified:', path.relative(process.cwd(), file));
  }
}

console.log('\nTotal:', totalModified, 'files modified');
