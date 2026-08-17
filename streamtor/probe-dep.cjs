const fs = require('fs');
const path = require('path');

function walk(d) {
  let out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '.git') out = out.concat(walk(p));
    } else if (/\.(js|cjs|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

console.log('=== who requires ip in bittorrent-tracker ===');
for (const f of walk('node_modules/bittorrent-tracker')) {
  const c = fs.readFileSync(f, 'utf8');
  if (c.includes('from "ip"') || c.includes("from 'ip'") || c.includes('require("ip")')) {
    console.log('ip-dep:', f);
  }
}

console.log('=== who requires ip anywhere under node_modules (top-level only) ===');
for (const f of walk('node_modules')) {
  const c = fs.readFileSync(f, 'utf8');
  if (c.includes('from "ip"') || c.includes("from 'ip'") || c.includes('require("ip")')) {
    console.log('ip-dep:', f);
  }
}