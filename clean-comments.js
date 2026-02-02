const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/utils/migration/post-migration-fixer.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Patterns to remove (redundant comments)
const patternsToRemove = [
  // Remove comments that just repeat what the code does
  /\/\/\s*(Try|Find|Extract|Check|Also|Remove|Replace|Add|Skip|Handle|Convert|This|These|More|Common|Generic|GENERIC|CRITICAL|FINAL|Final|Important|IMPORTANT)\s+[^\n]*\n/g,
  // Remove pattern comments that are obvious
  /\/\/\s*Pattern:\s*[^\n]*\n/g,
  // Remove "Fix X:" comments (keep the actual fix logic)
  /\/\/\s*Fix\s+\d+[a-z]?:\s*[^\n]*\n/g,
  // Remove single-line comments that just describe obvious code
  /\/\/\s*(const|let|var|function|if|else|for|while|return|import|export)\s+[^\n]*\n/g,
];

// Clean up redundant comments
patternsToRemove.forEach(pattern => {
  content = content.replace(pattern, '');
});

// Clean up multiple empty lines
content = content.replace(/\n{3,}/g, '\n\n');

// Clean up comments that are just "// " or "//"
content = content.replace(/\/\/\s*\n/g, '\n');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Comments cleaned!');
