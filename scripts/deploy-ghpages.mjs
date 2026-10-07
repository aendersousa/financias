import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const deployDir = path.join(projectRoot, '.deploy-gh-pages');
const outPwaDir = path.join(projectRoot, 'out', 'pwa');

console.log('Fetching origin gh-pages...');
execSync('git fetch origin gh-pages', { stdio: 'inherit' });

if (fs.existsSync(deployDir)) {
  console.log('Cleaning up existing deploy directory...');
  execSync(`git worktree remove --force "${deployDir}"`, { stdio: 'inherit' }).catch?.(() => {});
  if (fs.existsSync(deployDir)) {
    fs.rmSync(deployDir, { recursive: true, force: true });
  }
}

console.log('Adding worktree for gh-pages...');
execSync(`git worktree add -B gh-pages "${deployDir}" origin/gh-pages`, { stdio: 'inherit' });

console.log('Clearing old files in deploy worktree (keeping .git)...');
const entries = fs.readdirSync(deployDir);
for (const entry of entries) {
  if (entry === '.git') continue;
  fs.rmSync(path.join(deployDir, entry), { recursive: true, force: true });
}

console.log('Copying out/pwa into deploy worktree...');
fs.cpSync(outPwaDir, deployDir, { recursive: true });

// Ensure .nojekyll exists for GitHub Pages
fs.writeFileSync(path.join(deployDir, '.nojekyll'), '', 'utf8');

console.log('Staging changes in gh-pages worktree...');
execSync('git add -A', { cwd: deployDir, stdio: 'inherit' });

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const status = execSync('git status --porcelain', { cwd: deployDir, encoding: 'utf8' }).trim();
if (!status) {
  console.log('No changes detected in gh-pages.');
} else {
  console.log(`Committing release ${pkg.version} to gh-pages...`);
  execSync(`git commit -m "deploy: WalletUp ${pkg.version} remove lancamento rapido das configuracoes"`, {
    cwd: deployDir,
    stdio: 'inherit'
  });
  console.log('Pushing gh-pages to origin...');
  execSync('git push origin gh-pages', { cwd: deployDir, stdio: 'inherit' });
}

console.log('Removing worktree...');
execSync(`git worktree remove --force "${deployDir}"`, { stdio: 'inherit' });

console.log('Deploy to gh-pages completed successfully!');
