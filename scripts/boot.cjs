// HARMONY's entry point. Before anything loads, it applies a finished update (dist-next -> dist, keeping the old one as
// dist-old) or an "undo" (dist-old -> dist). Nothing from dist is open yet, so the folders can be swapped safely.
// If anything goes wrong it leaves a working dist in place and starts that.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), at = p => path.join(root, p);
const has = p => fs.existsSync(path.join(at(p), 'electron', 'main.cjs'));
function swap(from, keepAs) {
  fs.rmSync(at(keepAs), { recursive: true, force: true });
  if (fs.existsSync(at('dist'))) fs.renameSync(at('dist'), at(keepAs));
  try { fs.renameSync(at(from), at('dist')); }
  catch (e) { if (!has('dist') && has(keepAs)) fs.renameSync(at(keepAs), at('dist')); throw e; }
}
try {
  if (fs.existsSync(at('.rollback-update'))) {
    fs.rmSync(at('.rollback-update'), { force: true });
    if (has('dist-old')) swap('dist-old', 'dist-undone');
  } else if (fs.existsSync(path.join(at('dist-next'), '.complete')) && has('dist-next')) {
    swap('dist-next', 'dist-old');
    fs.rmSync(path.join(at('dist'), '.complete'), { force: true });
  } else if (fs.existsSync(at('dist-next'))) {
    fs.rmSync(at('dist-next'), { recursive: true, force: true }); // an unfinished build
  }
  fs.rmSync(at('dist-undone'), { recursive: true, force: true });
} catch (e) { console.error('HARMONY update could not be applied; starting the current version.', e && e.message); }
require(path.join(at('dist'), 'electron', 'main.cjs'));
