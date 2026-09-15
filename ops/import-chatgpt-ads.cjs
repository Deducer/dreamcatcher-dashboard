// Accept a connector response envelope on stdin. Keep private report data out of Git.
const fs = require('node:fs');
const path = require('node:path');
const {validateSnapshot} = require('../src/chatgpt-ads');
const target = process.argv[2];
if (!target || !path.isAbsolute(target) || target.split(path.sep).includes('public')) throw Error('An absolute private output path is required');
const snapshot = validateSnapshot(JSON.parse(fs.readFileSync(0, 'utf8')));
fs.mkdirSync(path.dirname(target), {recursive:true,mode:0o700});
const temporary = target + '.' + process.pid + '.tmp';
fs.writeFileSync(temporary, JSON.stringify(snapshot), {mode:0o600,flag:'wx'});
fs.renameSync(temporary, target);
console.log('Validated ChatGPT Ads report imported.');
